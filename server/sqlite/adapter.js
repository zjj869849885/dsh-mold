// server/sqlite/adapter.js —— PersonalSqliteAdapter（阶段 1 · 数据层核心）
// 对外返回与企业版同构的 ViewMeta + 契约行（metaKey 键），字段翻译全部走 personal.schema.js（§6 坑 2）。
// 图片写链路口径（§2.2.3）：前端 FImage/FThumbImage 纯 base64 → 本 adapter 解码落盘 dataDir/images/，服务端不切图。
// 失败一律如实上抛（W4），防御性兜底零添加。
import { backup } from 'node:sqlite'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, rmdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase, seedDefaults, getUserVersion } from './db.js'
import { buildFilterMeta, toContractRow, fromContractRow, withDerived, filterColOf } from './personal.schema.js'
import { PAGE_DEFS, numericMetaKeys, pageContractToRow, pageRowToContract, pageColsInsert, pageFilterColOf, pageBillNo, pageBodyContractToRow, pageBodyRowToContract, auditableColOf, BILL_DOWNSTREAM_REFS, BILL_TABLE_NAMES } from './personal.pages.js'
import { ITEM_DEFS, getItemList, itemOperate } from './personal.item.js'

const MOLD_COLS_INSERT = ['FMDNumber', 'FName', 'FModel', 'FType', 'FMDStatus', 'FMDPlace', 'remark', 'FDesignLife', 'used_shots', 'cavity_count', 'maint_interval_shots', 'last_maint_shots',
  // 基础资料模块（请求D）：与 personal.schema.js MOLD_FIELDS 追加列同步（saveMold 仅写白名单列）
  'FBriefName', 'FSmallType', 'FChkStatus', 'FMDStockStatus', 'FDept', 'FProdLine', 'FStock', 'FStorageLoc', 'FMainSche', 'FCheckSche', 'FMainRole', 'FCheckRole',
  'FWeight', 'FWeightUnit', 'FItemName', 'FReceiverDate', 'FEnableDate', 'FScrapDate', 'FMDChargeDate', 'FSupplier', 'FCust', 'FBeforeENGR', 'FAdaptedType',
  'FMDCost', 'FORGID', 'FCreater']

/** 字节头判型（与企业版 getImage 的 mimeOf 同口径，读端契约一致）。 */
export function mimeOf(buf) {
  if (!buf || buf.length < 12) return ''
  const h = buf.subarray(0, 12)
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png'
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg'
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) return 'image/gif'
  if (h[0] === 0x42 && h[1] === 0x4d) return 'image/bmp'
  if (String.fromCharCode(h[0], h[1], h[2], h[3]) === 'RIFF' && String.fromCharCode(h[8], h[9], h[10], h[11]) === 'WEBP') return 'image/webp'
  return ''
}

export class PersonalSqliteAdapter {
  constructor({ dataDir, seed = {} } = {}) {
    const handle = openDatabase(dataDir)
    this.db = handle.db
    this.dataDir = handle.dataDir
    this.dbPath = handle.dbPath
    this.schemaVersion = getUserVersion(this.db)
    if (seed.dicts !== false) seedDefaults(this.db, { sampleMolds: !!seed.sampleMolds })
  }

  // ---------- 元数据契约 ----------
  viewMeta(strFunc = '203101') {
    return buildFilterMeta(strFunc, this.dictOptions(), this.itemOptionsMap(), this.curOrgName())
  }

  /** item 台账各类别启用行名称（供模具 itemRef 字段：类型→MDType、库位→MDLocation）。 */
  itemOptionsMap() {
    const out = {}
    for (const k of Object.keys(ITEM_DEFS)) {
      out[k] = getItemList(this.db, k, null, this.curOrgName()).data.filter((r) => r['状态'] === '启用').map((r) => r['名称'])
    }
    return out
  }

  // ---------- 多组织会话态（请求E）：当前组织持久 app_setting，台账源=MDOrg 活动行；未设默认首个组织行 ----------
  /** 活动组织行（id=T_MD_Item.FID 字符串, name=名称），供 /org 字典与切换校验。 */
  orgRows() {
    return getItemList(this.db, 'MDOrg').data
      .filter((r) => r['状态'] === '启用')
      .map((r) => ({ id: r['自增列'], name: r['名称'] }))
  }
  /** 当前组织 {id,name}；配置缺失/指向停用行 → 回落首个活动组织行；无台账行如实 null。 */
  curOrg() {
    const orgs = this.orgRows()
    const row = this.db.prepare("select value from app_setting where key = 'curOrg'").get()
    if (row && row.value) {
      try {
        const v = JSON.parse(row.value)
        const hit = orgs.find((o) => String(o.id) === String(v.id))
        if (hit) return hit
      } catch { /* 坏配置回落默认组织行 */ }
    }
    return orgs[0] || null
  }
  /** 当前组织名称（FORGID 铸造/过滤消费）；无组织如实空串=全局模式。 */
  curOrgName() { const o = this.curOrg(); return o ? String(o.name || '') : '' }
  /** 做单门禁（请求F）：组织台账（基础资料-组织）未维护时禁止做单，如实提示先维护。
   *  与企业版同向（组织字典空→前端明确报「组织数据不可用」），个人版落点在写链路服务端硬拦。 */
  orgGate() {
    if (this.curOrgName() === '') throw new Error('组织数据源未维护：请先在「基础资料 - 组织」中维护组织，维护后才能做单')
  }
  /** 切换组织：id 必须命中活动组织行，否则如实回错（W4）。 */
  setCurOrg(id) {
    const want = String(id ?? '')
    if (want === '') return { ok: false, message: '未指定要切换的组织，请刷新页面后重试' }
    const hit = this.orgRows().find((o) => String(o.id) === want)
    if (!hit) return { ok: false, message: '要切换的组织不存在或已被禁用（可能刚被删除），请刷新页面后重试' }
    this.db.prepare(
      "insert into app_setting(key, value) values ('curOrg', ?) on conflict(key) do update set value = excluded.value",
    ).run(JSON.stringify({ id: hit.id, name: hit.name }))
    return { ok: true }
  }
  /** /pages 装饰载荷（展开形 {id,name,orgs}，前端 MoldShell 与 /org 嵌套形区分）。 */
  orgPayload() {
    const c = this.curOrg()
    return c ? { id: c.id, name: c.name, orgs: this.orgRows() } : null
  }

  /** dict_option 实时选项（/filter、/billinit 的 _options 预置与 /popdata 同源）。 */
  dictOptions() {
    const out = {}
    for (const r of this.db.prepare('select category, value from dict_option order by category, sort, id').all()) {
      (out[r.category] = out[r.category] || []).push(r.value)
    }
    return out
  }

  // ---------- 列显示设置（/colset，落 app_setting 表；企业版落 W_FormStyle 的个人版等价） ----------
  /** 读取某 FPage 已保存的列设置行（英文键）；无记录回 [] 即“无个性化→走默认”，忠实非伪造。 */
  getColset(FPage) {
    const row = this.db.prepare("select value from app_setting where key = ?").get(`colset:${FPage}`)
    if (!row || row.value == null || row.value === '') return []
    const v = JSON.parse(row.value)
    return Array.isArray(v) ? v : []
  }

  /** 幂等 upsert 某 FPage 的列设置（存客户端提交的英文键行原样），回写入行。 */
  saveColset(FPage, arrColSet) {
    const rows = Array.isArray(arrColSet) ? arrColSet : []
    this.db.prepare(
      "insert into app_setting(key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
    ).run(`colset:${FPage}`, JSON.stringify(rows))
    return rows
  }

  // ---------- 模具主档 CRUD ----------
  listMolds({ keyword = '', status = '', page = 1, pageSize = 20, FilterList = [], filterForm = {} } = {}) {
    const where = ['deleted_at IS NULL']
    const params = []
    // 多组织（请求E）：当前组织可见=本组织单 + 未分派旧数据（FORGID 空），与切换联动（orgEpoch 重查同企业语义）
    const orgScope = this.curOrgName()
    if (orgScope) { where.push("(FORGID = '' OR FORGID IS NULL OR FORGID = ?)"); params.push(orgScope) }
    if (keyword) { where.push('(FMDNumber LIKE ? OR FName LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
    if (status) { where.push('FMDStatus = ?'); params.push(status) }
    // 企业版 /data 同契约的服务端过滤（dpQueries.getDPSelectData FilterList 口径）：
    // type 1 文本 like / 4 精确 in / 3 日期区间（Display 起/止 → _From/_To）；未知键落 1=0 如实空结果（W4 不静默放宽）。
    const ff = filterForm && typeof filterForm === 'object' ? filterForm : {}
    for (const row of (Array.isArray(FilterList) ? FilterList : [])) {
      if (!row) continue
      const type = String(row.type ?? '')
      const name = String(row.name ?? '')
      const display = String(row.Display ?? '')
      if (type === '3') {
        const base = name.replace(/_From$/, '').replace(/_To$/, '')
        const col = filterColOf(base)
        if (!col) { where.push('1=0'); continue }
        if (display.endsWith('起')) {
          const v = String(ff[`${base}_From`] ?? '')
          if (v !== '') { where.push(`${col} >= ?`); params.push(v) }
        } else if (display.endsWith('止')) {
          const v = String(ff[`${base}_To`] ?? '')
          if (v !== '') { where.push(`${col} <= ?`); params.push(v) }
        } else {
          const v = String(ff[name] ?? '')
          if (v !== '') { where.push(`${col} = ?`); params.push(v) }
        }
        continue
      }
      const col = filterColOf(name)
      if (!col) { where.push('1=0'); continue }
      const v = String(ff[name] ?? '')
      if (v === '') continue
      if (type === '4') { where.push(`${col} = ?`); params.push(v) }
      else { where.push(`${col} LIKE ?`); params.push(`%${v}%`) }
    }
    const w = where.join(' AND ')
    const total = Number(this.db.prepare(`select count(*) c from T_MD_Mould where ${w}`).get(...params).c)
    const rows = this.db.prepare(`select * from T_MD_Mould where ${w} order by FInterID desc limit ? offset ?`)
      .all(...params, Number(pageSize), (Number(page) - 1) * Number(pageSize))
    return { head: rows.map((r) => withDerived(toContractRow(r))), totalCount: total }
  }

  getMold(id) {
    const r = this.db.prepare('select * from T_MD_Mould where FInterID = ? and deleted_at is null').get(Number(id))
    return r ? withDerived(toContractRow(r)) : null
  }

  /** 按模具编号取活动模具（契约行 + 派生预警指标）；不存在返回 null。AI 工具/记模次端点共用。 */
  getMoldByCode(code) {
    const c = String(code || '').trim()
    if (!c) return null
    const r = this.db.prepare('select * from T_MD_Mould where FMDNumber = ? and deleted_at is null').get(c)
    return r ? withDerived(toContractRow(r)) : null
  }

  /**
   * 新增/修改（契约行 metaKey 键）。单据内码有值→update，无→insert。
   * code 唯一由部分索引兜底（坑 4），软删后同号重建必须可行。
   */
  saveMold(contract) {
    const row = fromContractRow(contract)
    const id = Number(row.FInterID) || 0
    // 多组织收口（请求F）：做单先过组织门禁；FORGID 恒铸会话组织、忽略客户端值
    //（企业 OrderUtil.Save.cs 同径：FORGID 列剥离后无条件 DefaultValue=OpenGlobal.OID 重写）
    this.orgGate()
    row.FORGID = this.curOrgName()
    if (!row.FMDNumber) throw new Error('模具编号不能为空')
    if (!row.FName) throw new Error('模具名称不能为空')
    if (id) {
      // 审核锁（企业同义）：已审核单禁改，反审核解锁（前端 checkState 同一口径，服务端兼并拦截非法直连）
      const st = this.db.prepare('select FStatus, FMDNumber, FName from T_MD_Mould where FInterID = ? and deleted_at is null').get(id)
      if (st && String(st.FStatus) === '1') throw new Error(`${this.billLabel('203101', st)}已审核，不能修改，请先反审核`)
      // 仅提供列参与更新，缺省列保持现值（used_shots/last_maint_shots 由专改事务维护，不接受表单直写意外清零）
      const cols = MOLD_COLS_INSERT.filter((c) => row[c] !== undefined && row[c] !== null)
      try {
        if (cols.length) {
          const sets = cols.map((c) => `${c} = ?`).join(', ')
          const r = this.db.prepare(`update T_MD_Mould set ${sets}, FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null`)
            .run(...cols.map((c) => row[c]), id)
          if (r.changes === 0) throw new Error(`模具 ${id} 不存在或已删除`)
        } else {
          const r = this.db.prepare("update T_MD_Mould set FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null").run(id)
          if (r.changes === 0) throw new Error(`模具 ${id} 不存在或已删除`)
        }
      } catch (e) {
        // 撞其它活动行编号：与 insert 分支同口径转中文友好文案（暗雷 3 修复）
        if (/UNIQUE/i.test(String(e.message))) throw new Error(`模具编号「${row.FMDNumber}」已存在`)
        throw e
      }
      return { ok: true, id, mode: 'update' }
    }
    // 新增同样只写提供列，缺省走 schema DEFAULT（如 status='在库'），禁止强填 0 污染文本列
    const cols = MOLD_COLS_INSERT.filter((c) => row[c] !== undefined && row[c] !== null)
    // 审核态服务端权威：新建必为「创建」FStatus=0，显式落列不依赖物理默认值
    //（旧库升级后 FStatus 列 DEFAULT 仍可能为 1，SQLite 无法 ALTER 既有列默认值，此处兜正）
    if (!cols.includes('FStatus')) { row.FStatus = 0; cols.push('FStatus') }
    let r
    try {
      r = this.db.prepare(`insert into T_MD_Mould(${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => row[c]))
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) throw new Error(`模具编号「${row.FMDNumber}」已存在`)
      throw e
    }
    return { ok: true, id: Number(r.lastInsertRowid), mode: 'add' }
  }

  getRawField(col, id) {
    return this.db.prepare(`select ${col} v from T_MD_Mould where FInterID = ?`).get(Number(id))?.v ?? 0
  }

  /** 软删除（防误操作，§2.2.3；恢复同号可行由部分索引保障）。审核保护与下游引用拦截统一收口 deleteBlockReason。 */
  deleteMold(id) {
    const why = this.deleteBlockReason('203101', id)
    if (why.kind !== 'ok') throw new Error(why.msg)
    const r = this.db.prepare("update T_MD_Mould set deleted_at = datetime('now','localtime'), FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null").run(Number(id))
    if (r.changes === 0) throw new Error(`模具 ${id} 不存在或已删除`)
    return { ok: true, id: Number(id) }
  }

  // ---------- 审核流（缺陷 A 修复，2026-11-19 全链走查） ----------
  // 列定位由 auditableColOf 权威声明：模具 203101 用 FStatus，单据类子页用 FBillState；档案类页不可审核。

  /** 读当前审核态；无行报不存在，非审核页报能力口径（W4 如实上抛）。 */
  getBillStatus(strFunc, id) {
    const col = auditableColOf(strFunc)
    if (col === '') {
      const def = PAGE_DEFS[String(strFunc)]
      throw new Error(`${(def && def.name) || strFunc}为档案类页面，不支持审核操作`)
    }
    const table = String(strFunc) === '203101' ? 'T_MD_Mould' : PAGE_DEFS[String(strFunc)].table
    const row = this.db.prepare(`select ${col} as st from ${table} where FInterID = ? and deleted_at is null`).get(Number(id))
    // 文案与删除分支同口径（2026-11-21 按钮审计 B12 取证）：不露内码数字，给「刷新列表」下一步动作。
    if (!row) throw new Error('所选单据已不存在或已被删除，请刷新列表后重试')
    return String(row.st)
  }

  /**
   * 审核态迁移：TargetStatus '5' 审核（0→1）/ '1' 反审核（1→0）。
   * 前置校验全部在写库前上抛：重复审核/未审核反审核/反审核时已下游引用或已保存修改。
   */
  setBillStatus(strFunc, id, targetStatus, auditor = '') {
    // 前置校验唯一权威改为 statusBlockReason（与 /billstatus 批量预检同源），避免单条/批量两套文案漂移。
    const why = this.statusBlockReason(strFunc, id, targetStatus)
    if (why.kind !== 'ok') throw new Error(why.msg)
    const next = targetStatus === '5' ? '1' : '0'
    this.updateBillStatusCol(strFunc, id, next, auditor)
    return { ok: true, id: Number(id), status: next }
  }

  updateBillStatusCol(strFunc, id, value, auditor = '') {
    const sf = String(strFunc)
    const col = auditableColOf(sf)
    const table = sf === '203101' ? 'T_MD_Mould' : PAGE_DEFS[sf].table
    // 审核人/审核日期回写（缺陷修复 2026-11-21）：审核铸入操作人 + 本地时间，反审核清空；此前仅改状态列致「其他」块恒空。
    const auditing = String(value) === '1'
    const auditSet = auditing ? `, FApproverID = ?, FApproverDate = datetime('now','localtime')` : `, FApproverID = '', FApproverDate = ''`
    const sql = `update ${table} set ${col} = ?${auditSet}, FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null`
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const before = this.db.prepare(`select * from ${table} where FInterID = ? and deleted_at is null`).get(Number(id))
      if (!before) throw new Error('所选单据已不存在或已被删除，请刷新列表后重试')
      const r = auditing
        ? this.db.prepare(sql).run(Number(value), String(auditor || ''), Number(id))
        : this.db.prepare(sql).run(Number(value), Number(id))
      if (r.changes === 0) throw new Error('所选单据已不存在或已被删除，请刷新列表后重试')
      this.applyBillAuditWriteBack(sf, before, auditing)
      this.db.exec('COMMIT')
    } catch (e) {
      try { this.db.exec('ROLLBACK') } catch { /* 已回滚忽略 */ }
      throw e
    }
  }

  /**
   * 单据审核/反审核业务反写（同事务原子执行）：
   * 覆盖 203149 使用汇报→模次/日志、203153/203146 状态/报废→模具状态、
   * 203142/203143 领用/归还→库存状态、203116/203126/203133→维护日志/保养周期/报修闭环。
   */
  applyBillAuditWriteBack(strFunc, row, auditing) {
    if (!row) return
    const today = new Date().toISOString().slice(0, 10)
    const statusMap = { 生产: '生产中', 维修: '维修中', 保养: '保养中' }
    const mapStatus = (s) => statusMap[String(s || '')] || String(s || '')
    const findMold = (code) => {
      const c = String(code || '').trim()
      return c ? this.db.prepare('select FInterID, FMDStatus, used_shots from T_MD_Mould where FMDNumber = ? and deleted_at is null').get(c) : null
    }

    if (strFunc === '203149') {
      const m = findMold(row.FMouldNumber)
      const delta = Number(row.FRptUseNum) || 0
      const tag = `使用汇报单:${String(row.FBillNo || row.FInterID)}`
      if (!m || delta <= 0) return
      if (auditing) {
        this.db.prepare('insert into usage_log(mold_id, log_date, delta_shots, machine_no, remark) values (?,?,?,?,?)')
          .run(Number(m.FInterID), today, delta, '', tag)
        this.db.prepare("update T_MD_Mould set used_shots = used_shots + ?, FModifyTime = datetime('now','localtime') where FInterID = ?")
          .run(delta, Number(m.FInterID))
      } else {
        this.db.prepare('delete from usage_log where mold_id = ? and remark = ?').run(Number(m.FInterID), tag)
        this.db.prepare("update T_MD_Mould set used_shots = max(0, used_shots - ?), FModifyTime = datetime('now','localtime') where FInterID = ?")
          .run(delta, Number(m.FInterID))
      }
      return
    }

    if (strFunc === '203153') {
      const m = findMold(row.FMouldNumber)
      if (!m) return
      if (auditing) {
        const nextSt = mapStatus(row.FUpdateMDStatus)
        if (!nextSt) return
        if (!row.FMDStatus) {
          this.db.prepare('update T_MD_StatusChange set FMDStatus = ? where FInterID = ?').run(String(m.FMDStatus || ''), Number(row.FInterID))
        }
        const chgDate = String(row.FReceiverDate || '').trim() || today
        this.db.prepare("update T_MD_Mould set FMDStatus = ?, FMDChargeDate = ?, FModifyTime = datetime('now','localtime') where FInterID = ?")
          .run(nextSt, chgDate, Number(m.FInterID))
      } else if (row.FMDStatus) {
        this.db.prepare("update T_MD_Mould set FMDStatus = ?, FModifyTime = datetime('now','localtime') where FInterID = ?")
          .run(mapStatus(row.FMDStatus), Number(m.FInterID))
      }
      return
    }

    if (strFunc === '203146') {
      const m = findMold(row.FMouldNumber)
      if (!m) return
      if (auditing) {
        const scrapDate = String(row.FApplyTime || '').trim() || today
        this.db.prepare("update T_MD_Mould set FMDStatus = '报废', FScrapDate = ?, FModifyTime = datetime('now','localtime') where FInterID = ?")
          .run(scrapDate, Number(m.FInterID))
      } else if (m.FMDStatus === '报废') {
        this.db.prepare("update T_MD_Mould set FMDStatus = '在库', FModifyTime = datetime('now','localtime') where FInterID = ?")
          .run(Number(m.FInterID))
      }
      return
    }

    if (strFunc === '203142' || strFunc === '203143') {
      const entryTbl = strFunc === '203142' ? 'T_MD_PickRecordEntry' : 'T_MD_ReturnRecordEntry'
      const molds = this.db.prepare(`select distinct FMouldNumber from ${entryTbl} where FInterID = ? and FMouldNumber <> ''`).all(Number(row.FInterID))
      const stockSt = auditing ? (strFunc === '203142' ? '出库' : '在库') : (strFunc === '203142' ? '在库' : '出库')
      for (const r of molds) {
        this.db.prepare("update T_MD_Mould set FMDStockStatus = ?, FModifyTime = datetime('now','localtime') where FMDNumber = ? and deleted_at is null")
          .run(stockSt, String(r.FMouldNumber))
      }
      return
    }

    if (strFunc === '203116' || strFunc === '203126') {
      const m = findMold(row.FMouldNumber)
      if (!m) return
      const isMaint = strFunc === '203126'
      const logType = isMaint ? '保养' : '点检'
      const tag = `${logType}记录:${String(row.FBillNo || row.FInterID)}`
      if (auditing) {
        const dt = String((isMaint ? (row.FMainEndTime || row.FMainStartTime) : (row.FChkEndTime || row.FChkStartTime)) || '').trim() || today
        const op = String(row.FOperatEmp || row.FHandler || '').trim()
        const shots = Number(m.used_shots) || 0
        this.db.prepare('insert into maintenance_log(mold_id, log_type, log_date, items_json, result, cost, shots_at_log, operator, remark, image_ids_json) values (?,?,?,?,?,?,?,?,?,?)')
          .run(Number(m.FInterID), logType, dt, '[]', isMaint ? '已保养' : '已点检', 0, shots, op, tag, '[]')
        if (isMaint) {
          this.db.prepare("update T_MD_Mould set last_maint_shots = ?, FModifyTime = datetime('now','localtime') where FInterID = ?")
            .run(shots, Number(m.FInterID))
        }
      } else {
        this.db.prepare('delete from maintenance_log where mold_id = ? and remark = ?').run(Number(m.FInterID), tag)
        if (isMaint) {
          const prev = this.db.prepare("select shots_at_log from maintenance_log where mold_id = ? and log_type = '保养' order by id desc limit 1").get(Number(m.FInterID))
          this.db.prepare("update T_MD_Mould set last_maint_shots = ?, FModifyTime = datetime('now','localtime') where FInterID = ?")
            .run(prev ? Number(prev.shots_at_log) || 0 : 0, Number(m.FInterID))
        }
      }
      return
    }

    if (strFunc === '203131') {
      const rb = String(row.FRepairBillNo || '').trim()
      if (!rb) return
      if (auditing) {
        this.db.prepare("update T_MD_Repair set FStatus = '维修中', FHandler = coalesce(nullif(FHandler,''), ?), FModifyTime = datetime('now','localtime') where FBillNo = ? and deleted_at is null and FStatus = '待处理'")
          .run(String(row.FReceiverEmp || ''), rb)
      } else {
        this.db.prepare("update T_MD_Repair set FStatus = '待处理', FModifyTime = datetime('now','localtime') where FBillNo = ? and deleted_at is null and FStatus = '维修中'")
          .run(rb)
      }
      return
    }

    if (strFunc === '203133') {
      const m = findMold(row.FMouldNumber)
      const tag = `维修记录:${String(row.FBillNo || row.FInterID)}`
      const srcTask = String(row.FSourceBillNo || '').trim()
      const taskRow = srcTask ? this.db.prepare('select FRepairBillNo from T_MD_ServerTask where FBillNo = ? and deleted_at is null').get(srcTask) : null
      const repairNo = taskRow ? String(taskRow.FRepairBillNo || '').trim() : ''
      if (auditing) {
        if (m) {
          const dt = String(row.FCheckDate || row.FRepairDate || '').trim() || today
          const op = String(row.FOperatEmp || row.FPrincipal || '').trim()
          this.db.prepare('insert into maintenance_log(mold_id, log_type, log_date, items_json, result, cost, shots_at_log, operator, remark, image_ids_json) values (?,?,?,?,?,?,?,?,?,?)')
            .run(Number(m.FInterID), '维修', dt, '[]', String(row.FResult || ''), Number(row.FCost) || 0, Number(m.used_shots) || 0, op, tag, '[]')
        }
        if (repairNo) {
          const nextSt = row.FResult === '不合格' ? '维修中' : '已修复'
          const finDate = String(row.FCheckDate || row.FRepairDate || '').trim()
          const handler = String(row.FPrincipal || row.FOperatEmp || '').trim()
          const cost = Number(row.FCost) || 0
          this.db.prepare("update T_MD_Repair set FStatus = ?, FFinishDate = coalesce(nullif(?, ''), FFinishDate), FResult = coalesce(nullif(?, ''), FResult), cost = case when ? > 0 then ? else cost end, FHandler = coalesce(nullif(?, ''), FHandler), FModifyTime = datetime('now','localtime') where FBillNo = ? and deleted_at is null")
            .run(nextSt, finDate, String(row.FResult || ''), cost, cost, handler, repairNo)
        }
      } else {
        if (m) this.db.prepare('delete from maintenance_log where mold_id = ? and remark = ?').run(Number(m.FInterID), tag)
        if (repairNo) {
          this.db.prepare("update T_MD_Repair set FStatus = '维修中', FModifyTime = datetime('now','localtime') where FBillNo = ? and deleted_at is null and FStatus = '已修复'")
            .run(repairNo)
        }
      }
    }
  }

  /** 单据业务标识（提示文案专用）：优先单号，档案类回落编号列，全无回落「页名#内码」，自带「」便于定位行。 */
  billLabel(strFunc, row) {
    if (!row) return ''
    const no = String(row.FBillNo ?? '')
    if (no !== '') return `「${no}」`
    const def = String(strFunc) === '203101' ? null : PAGE_DEFS[String(strFunc)]
    const codeCol = String(strFunc) === '203101' ? 'FMDNumber' : (def && def.codeCol) || ''
    const v = codeCol ? String(row[codeCol] ?? '') : ''
    if (v !== '') return `「${v}」`
    return `「${(def && def.name) || '模具档案'}#${Number(row.FInterID) || ''}」`
  }

  /**
   * 下游引用扫描文案（删除/反审核共用唯一文案源）：登记表内任一目标表存在活动引用行即成一笔。
   * 返回 '' 表示无引用。表名一律经 BILL_TABLE_NAMES 换成业务页名并附引用条数
   *（旧文案「该单已被下游记录引用（T_MD_ServerTask）」对用户不可读，2026-11-20 需求改造）。
   */
  downstreamRefMsg(strFunc, row) {
    const sf = String(strFunc)
    const def = sf === '203101' ? null : PAGE_DEFS[sf]
    const codeCol = sf === '203101' ? 'FMDNumber' : (def && def.codeCol) || ''
    const code = codeCol ? String(row?.[codeCol] ?? '') : ''
    const billNo = String(row?.FBillNo ?? '')
    const hits = []
    for (const ref of BILL_DOWNSTREAM_REFS[sf] || []) {
      const v = ref.match === 'code' ? code : billNo
      if (v === '' || v == null) continue
      // entry 行表无软删列（delete-by-head 语义），只 join 头表排软删
      const sql = ref.entry
        ? `select count(*) c from ${ref.table} e join ${ref.head} h on h.FInterID = e.FInterID where e.${ref.col} = ? and h.deleted_at is null`
        : `select count(*) c from ${ref.table} where ${ref.col} = ? and deleted_at is null`
      const c = Number(this.db.prepare(sql).get(v)?.c || 0)
      if (c > 0) hits.push(`${BILL_TABLE_NAMES[ref.table] || ref.table} ${c} 张`)
    }
    if (!hits.length) return ''
    return `${this.billLabel(strFunc, row)}已生成下游单据（${hits.join('、')}），请先删除下游单据`
  }

  /** 下游引用硬拦截：有引用即按统一文案上抛（入参改为源单整行，取值口径内置）。 */
  assertNoDownstreamRefs(strFunc, row) {
    const msg = this.downstreamRefMsg(strFunc, row)
    if (msg !== '') throw new Error(msg)
  }

  /**
   * 删除可行性预检（单条删除与 /billstatus 批量预检的唯一权威）：
   * 返回 { kind:'ok' } 或 { kind:'missing'|'audited'|'downstream', label, msg }。
   * kind 供路由按同类原因聚合（多张已审核合并成一句，避免逐条刷屏），label 供文案定位单据。
   */
  deleteBlockReason(strFunc, id) {
    const isMold = String(strFunc) === '203101'
    const def = isMold ? null : PAGE_DEFS[String(strFunc)]
    if (!isMold && !def) return { kind: 'missing', label: '', msg: `未知或未接入的页面 strFunc：${strFunc}` }
    const row = this.db.prepare(`select * from ${isMold ? 'T_MD_Mould' : def.table} where FInterID = ? and deleted_at is null`).get(Number(id))
    if (!row) return { kind: 'missing', label: '', msg: '所选单据已不存在或已被删除，请刷新列表后重试' }
    const label = this.billLabel(strFunc, row)
    const stCol = auditableColOf(strFunc)
    if (stCol !== '' && String(row[stCol]) === '1') return { kind: 'audited', label, msg: `${label}已审核，不能删除，请先反审核` }
    const ref = this.downstreamRefMsg(strFunc, row)
    if (ref !== '') return { kind: 'downstream', label, msg: ref }
    return { kind: 'ok', label, msg: '' }
  }

  /**
   * 审核/反审核可行性预检（/billstatus 批量与 setBillStatus 的唯一权威，与 deleteBlockReason 同构）：
   * 返回 { kind:'ok' } 或 { kind:'missing'|'noaudit'|'repeat'|'notaudited'|'downstream'|'unsupported', label, msg }。
   * 文案口径（规范 2026-11-20）：必须带 billLabel 业务标识 + 下一步动作，不露表名/内码；
   * kind 供路由按同类原因聚合（多张同状态合并成一句，避免逐条刷屏）。
   */
  statusBlockReason(strFunc, id, targetStatus) {
    if (targetStatus !== '5' && targetStatus !== '1') {
      return { kind: 'unsupported', label: '', msg: `个人版审核仅受理 审核/反审核，收到 TargetStatus=${targetStatus}` }
    }
    const isMold = String(strFunc) === '203101'
    const def = isMold ? null : PAGE_DEFS[String(strFunc)]
    if (!isMold && !def) return { kind: 'missing', label: '', msg: `未知或未接入的页面 strFunc：${strFunc}` }
    const col = auditableColOf(strFunc)
    if (col === '') return { kind: 'noaudit', label: '', msg: `${(def && def.name) || strFunc}为档案类页面，不支持审核操作` }
    const row = this.db.prepare(`select * from ${isMold ? 'T_MD_Mould' : def.table} where FInterID = ? and deleted_at is null`).get(Number(id))
    if (!row) return { kind: 'missing', label: '', msg: '所选单据已不存在或已被删除，请刷新列表后重试' }
    const label = this.billLabel(strFunc, row)
    const audited = String(row[col]) === '1'
    if (targetStatus === '5' && audited) return { kind: 'repeat', label, msg: `${label}已审核，无需重复审核（如需改动请先反审核）` }
    if (targetStatus === '1' && !audited) return { kind: 'notaudited', label, msg: `${label}未审核，不能反审核（请先审核该单）` }
    // 引用比对取值由 downstreamRefMsg 按行内列自取（模具档案=编号 FMDNumber，单据链=单号 FBillNo）
    if (targetStatus === '1') {
      const ref = this.downstreamRefMsg(strFunc, row)
      if (ref !== '') return { kind: 'downstream', label, msg: ref }
    }
    return { kind: 'ok', label, msg: '' }
  }

  /** 按内码取单据业务标识（提示文案专用）：行已不在时回落「页名#内码」，保证文案永远能定位到行。 */
  billLabelById(strFunc, id) {
    const isMold = String(strFunc) === '203101'
    const def = isMold ? null : PAGE_DEFS[String(strFunc)]
    const table = isMold ? 'T_MD_Mould' : (def && def.table) || ''
    if (table === '') return ''
    const row = this.db.prepare(`select * from ${table} where FInterID = ? and deleted_at is null`).get(Number(id))
    return this.billLabel(strFunc, row) || `「${(def && def.name) || (isMold ? '模具档案' : strFunc)}#${id}」`
  }

  // ---------- 模次与记录流 ----------
  /** 记模次：usage_log 插入与 mold.used_shots 累加同事务原子（§2.2.3-5）。 */
  addUsage(moldId, { delta_shots, machine_no = '', remark = '', log_date } = {}) {
    const delta = Number(delta_shots)
    if (!Number.isFinite(delta) || delta <= 0) throw new Error('本次新增模次必须为正整数')
    const date = log_date || new Date().toISOString().slice(0, 10)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('insert into usage_log(mold_id, log_date, delta_shots, machine_no, remark) values (?,?,?,?,?)')
        .run(Number(moldId), date, delta, machine_no, remark)
      const r = this.db.prepare("update T_MD_Mould set used_shots = used_shots + ?, FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null").run(delta, Number(moldId))
      if (r.changes === 0) throw new Error(`模具 ${moldId} 不存在或已删除`)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, used_shots: Number(this.getRawField('used_shots', moldId)) }
  }

  /** 点检/保养/维修记录；log_type=保养 时同事务把 last_maint_shots 置为当前模次。 */
  addMaintenance(moldId, log = {}) {
    if (!log.log_type) throw new Error('记录类型（点检/保养/维修）不能为空')
    if (!['点检', '保养', '维修'].includes(log.log_type)) throw new Error('记录类型必须为 点检/保养/维修')
    const shots = Number(this.getRawField('used_shots', moldId))
    this.db.exec('BEGIN')
    try {
      this.db.prepare('insert into maintenance_log(mold_id, log_type, log_date, items_json, result, cost, shots_at_log, operator, remark, image_ids_json) values (?,?,?,?,?,?,?,?,?,?)')
        .run(Number(moldId), log.log_type, log.log_date || new Date().toISOString().slice(0, 10),
          JSON.stringify(log.items_json ?? []), log.result || '', Number(log.cost) || 0, shots,
          log.operator || '', log.remark || '', JSON.stringify(log.image_ids_json ?? []))
      if (log.log_type === '保养') {
        this.db.prepare("update T_MD_Mould set last_maint_shots = ?, FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null").run(shots, Number(moldId))
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { ok: true, shots_at_log: shots }
  }

  listLogs(moldId, kind = 'usage') {
    const table = kind === 'maintenance' ? 'maintenance_log' : 'usage_log'
    return this.db.prepare(`select * from ${table} where mold_id = ? order by log_date desc, id desc limit 200`).all(Number(moldId))
  }

  // ---------- 部件/备件 ----------
  listParts(moldId) {
    return this.db.prepare('select * from mold_part where mold_id = ? order by id').all(Number(moldId))
  }

  savePart(moldId, part = {}) {
    if (!part.name) throw new Error('部件名称不能为空')
    if (part.id) {
      this.db.prepare("update mold_part set part_code=?, name=?, spec=?, qty=?, replace_cycle_shots=?, remark=?, updated_at=datetime('now','localtime') where id=? and mold_id=?")
        .run(part.part_code || '', part.name, part.spec || '', Number(part.qty) || 0, Number(part.replace_cycle_shots) || 0, part.remark || '', Number(part.id), Number(moldId))
      return { ok: true, id: Number(part.id) }
    }
    const r = this.db.prepare('insert into mold_part(mold_id, part_code, name, spec, qty, replace_cycle_shots, remark) values (?,?,?,?,?,?,?)')
      .run(Number(moldId), part.part_code || '', part.name, part.spec || '', Number(part.qty) || 0, Number(part.replace_cycle_shots) || 0, part.remark || '')
    return { ok: true, id: Number(r.lastInsertRowid) }
  }

  // ---------- 图片（磁盘落盘，图不入库 BLOB） ----------
  /**
   * FImage/FThumbImage 均为剥前缀后的纯 base64（前端 Canvas 已压缩/出缩略图，§6 坑 2）。
   * 落盘 dataDir/images/mold{id}/，mold_image 存相对路径；首图自动置封面。
   */
  saveImage(moldId, { FImage, FThumbImage, isCover = false } = {}) {
    if (!FImage) throw new Error('图片数据为空')
    const buf = Buffer.from(String(FImage), 'base64')
    const mime = mimeOf(buf)
    if (!mime) throw new Error('无法识别的图片格式（PNG/JPEG/GIF/BMP/WEBP 之外不支持）')
    const ext = mime.split('/')[1].replace('jpeg', 'jpg').replace('x-icon', 'ico')
    const relDir = join('images', `mold${Number(moldId)}`)
    const absDir = join(this.dataDir, relDir)
    mkdirSync(absDir, { recursive: true })
    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e4)}`
    const file = `${stamp}.${ext}`
    writeFileSync(join(absDir, file), buf)
    let thumbRel = ''
    if (FThumbImage) {
      const tbuf = Buffer.from(String(FThumbImage), 'base64')
      const tmime = mimeOf(tbuf) || mime
      const tfile = `${stamp}_t.${tmime.split('/')[1].replace('jpeg', 'jpg')}`
      writeFileSync(join(absDir, tfile), tbuf)
      thumbRel = join(relDir, tfile)
    }
    const r = this.db.prepare('insert into mold_image(mold_id, file_path, thumb_path, mime, size_bytes, is_cover) values (?,?,?,?,?,?)')
      .run(Number(moldId), join(relDir, file), thumbRel, mime, buf.length, isCover ? 1 : 0)
    const imageId = Number(r.lastInsertRowid)
    const mold = this.db.prepare('select cover_image_id from T_MD_Mould where FInterID = ? and deleted_at is null').get(Number(moldId))
    if (!mold) throw new Error(`模具 ${moldId} 不存在或已删除`)
    if (isCover || mold.cover_image_id == null) {
      const prevCover = mold.cover_image_id == null ? null : Number(mold.cover_image_id)
      this.db.prepare('update T_MD_Mould set cover_image_id = ? where FInterID = ?').run(imageId, Number(moldId))
      if (isCover) {
        this.db.prepare('update mold_image set is_cover = 0 where mold_id = ? and id != ?').run(Number(moldId), imageId)
        // 换封面即顶旧位：旧封面行+文件随即物理删（单图档案不清历史，否则孤儿文件随换图次数堆积）。
        if (prevCover != null && prevCover !== imageId) this.purgeImageRow(prevCover)
      }
    }
    return { ok: true, imageId, mime, sizeBytes: buf.length }
  }

  /** 与企业版 /image 端点同契约：{strFunc,id} → {dataUrl}（封面图 dataURL；无图回空串）。
   *  thumb=true（阶段 4 卡片秒开）：优先返 320px 缩略图，无缩略图/文件丢失回落原图（不谎报）。 */
  getImage({ id, thumb = false } = {}) {
    const mold = this.db.prepare('select cover_image_id from T_MD_Mould where FInterID = ? and deleted_at is null').get(Number(id))
    if (!mold || mold.cover_image_id == null) return { dataUrl: '' }
    const img = this.db.prepare('select file_path, thumb_path, mime from mold_image where id = ?').get(Number(mold.cover_image_id))
    if (!img) return { dataUrl: '' }
    let rel = img.file_path
    if (thumb && img.thumb_path) {
      const tabs = join(this.dataDir, img.thumb_path)
      if (existsSync(tabs)) rel = img.thumb_path
    }
    const abs = join(this.dataDir, rel)
    if (!existsSync(abs)) return { dataUrl: '' }
    const buf = readFileSync(abs)
    const mime = mimeOf(buf) || img.mime
    return { dataUrl: buf.length ? `data:${mime};base64,${buf.toString('base64')}` : '' }
  }

  /** 删除封面图（表单回显删除 → FDeleteImage）：清封面指针 + 删行删文件；图片目录空则一并移除（零残留）。 */
  deleteImage(moldId) {
    const mold = this.db.prepare('select cover_image_id from T_MD_Mould where FInterID = ? and deleted_at is null').get(Number(moldId))
    if (!mold) throw new Error(`模具 ${moldId} 不存在或已删除`)
    if (mold.cover_image_id == null) return { ok: true }
    this.purgeImageRow(Number(mold.cover_image_id))
    this.db.prepare('update T_MD_Mould set cover_image_id = null where FInterID = ?').run(Number(moldId))
    const dir = join(this.dataDir, 'images', `mold${Number(moldId)}`)
    try { if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir) } catch { /* 目录非空/占用不动 */ }
    return { ok: true }
  }

  /** 图片行物理删除：文件（主图+缩略图）先删、DB 行后删；force 容忍文件缺失，单文件失败不阻塞主链路。 */
  purgeImageRow(imageId) {
    const img = this.db.prepare('select file_path, thumb_path from mold_image where id = ?').get(Number(imageId))
    if (!img) return
    for (const rel of [img.file_path, img.thumb_path]) {
      if (!rel) continue
      try { rmSync(join(this.dataDir, rel), { force: true }) } catch { /* 容忍个别文件失败 */ }
    }
    this.db.prepare('delete from mold_image where id = ?').run(Number(imageId))
  }

  // ---------- 概览 / 预警 ----------
  stats() {
    const one = (sql, ...p) => Number(this.db.prepare(sql).get(...p).c)
    return {
      total: one('select count(*) c from T_MD_Mould where deleted_at is null'),
      producing: one("select count(*) c from T_MD_Mould where deleted_at is null and FMDStatus = '生产中'"),
      abnormal: one("select count(*) c from T_MD_Mould where deleted_at is null and FMDStatus in ('维修中','报废')"),
      maintainDue: one('select count(*) c from T_MD_Mould where deleted_at is null and maint_interval_shots > 0 and used_shots - last_maint_shots >= maint_interval_shots'),
      lifeLow: one('select count(*) c from T_MD_Mould where deleted_at is null and FDesignLife > 0 and used_shots * 100 >= FDesignLife * 90'),
    }
  }

  // ---------- 备份（§6 坑 3：backup 首参必须是 DatabaseSync 对象） ----------
  /** 热备份到目标路径（源库持连接+WAL 写入中可备份）；promise 形式 await。 */
  async backupTo(destPath) {
    const p = backup(this.db, destPath)
    if (p && typeof p.then === 'function') await p
    return { ok: true, destPath }
  }

  // ---------- 补齐子页通用台账（部件 203102 / 报修 203130 / 点检保养 203115） ----------
  // 与模具主档完全同构的 dp 契约，但按 PAGE_DEFS 逐页配置驱动，模具 203101 绿色路径不经过本组方法（加法扩展、零分叉）。

  /** 当前模具编号实时下拉（子页「所属模具/报修模具/模具编号」moldRef 字段消费）。 */
  moldNumbers() {
    // E8 收紧（2026-11-21 用户决策）：下游单据（报修/点检/保养等）的模具下拉值域只列已审核模具（FStatus=1），
    // 未审核模具不应被下游引用。本改动在个人版包内（node:sqlite adapter），企业版走 SQL Server 网关不经过此处，零影响。
    return this.db.prepare('select FMDNumber from T_MD_Mould where deleted_at is null and FStatus = 1 order by FMDNumber').all().map((r) => r.FMDNumber)
  }

  /**
   * 第四批引擎联动下拉（/filter /billinit ctx 消费）：
   *  itemOptions — item 台账（T_MD_Item）各类别启用行名称，供 itemRef 字段（点检/保养项目类型）；
   *  refValues  — 按 PAGE_DEFS 声明的 refOf 目标台账取编码列活动记录（作业计划→方案编码）。
   */
  pageDropdownCtx() {
    const itemOptions = {}
    for (const k of Object.keys(ITEM_DEFS)) {
      itemOptions[k] = getItemList(this.db, k, null, this.curOrgName()).data.filter((r) => r['状态'] === '启用').map((r) => r['名称'])
    }
    const refValues = {}
    // 表体/表头「选编码带名称」带出源行：按 refOf 目标台账取全部非隐藏业务列的活动记录（键=dbCol），
    // 供 buildPageFilterMeta 给源编码字段挂 _dropRows（前端 attachWrites 按 _dropValueName 命中行取目标列带出）。
    const refRows = {}
    for (const def of Object.values(PAGE_DEFS)) {
      const allFields = [...def.fields, ...(def.bodies || []).flatMap((b) => b.fields)]
      for (const f of allFields) {
        if (!f.refOf || f.refOf in refValues) continue
        const t = PAGE_DEFS[f.refOf]
        // 带出值域审核门控（UX 需求 2026-11-22）：被带出的基础资料页若可审核，则只放已审核（FBillState=1）行，
        // 与 moldRows「只取已审核模具」同口径，杜绝未审核项目/方案被下游选中带出。
        const auditGate = t && auditableColOf(f.refOf) === 'FBillState' ? ' and FBillState = 1' : ''
        refValues[f.refOf] = t && t.codeCol
          ? this.db.prepare(`select ${t.codeCol} as c from ${t.table} where deleted_at is null${auditGate} order by 1`).all().map((r) => r.c)
          : []
        if (t) {
          const cols = t.fields.filter((x) => !x.hidden && String(x.dbCol) !== 'FInterID').map((x) => x.dbCol)
          refRows[f.refOf] = cols.length
            ? this.db.prepare(`select ${cols.join(', ')} from ${t.table} where deleted_at is null${auditGate}`).all()
            : []
        }
      }
    }
    // 模具带出源行（moldRef 字段→模具名称）：编号 + 名称（下拉值=FMDNumber，与 moldNumbers 同口径）
    // 模具带出源行同口径只取已审核模具（与 moldNumbers 下拉值域一致，避免下拉与带出两套值域分叉）。
    const moldRows = this.db.prepare('select FMDNumber, FName, used_shots, FMDStatus from T_MD_Mould where deleted_at is null and FStatus = 1').all()
    return { itemOptions, refValues, refRows, moldRows }
  }

  listPage(strFunc, { keyword = '', page = 1, pageSize = 20, FilterList = [], filterForm = {} } = {}) {
    const def = PAGE_DEFS[String(strFunc)]
    if (!def) throw new Error(`未知或未接入的子页 strFunc：${strFunc}`)
    const where = ['deleted_at IS NULL']
    const params = []
    // 多组织（请求E）：当前组织可见=本组织单 + 未分派旧数据（FORGID 空）
    const orgScope = this.curOrgName()
    if (orgScope) { where.push("(FORGID = '' OR FORGID IS NULL OR FORGID = ?)"); params.push(orgScope) }
    if (keyword) { where.push('1=0') } // 子页顶层 keyword 未定义全局检索列，如实空（W4 不放宽）；过滤走 FilterList
    const ff = filterForm && typeof filterForm === 'object' ? filterForm : {}
    for (const row of (Array.isArray(FilterList) ? FilterList : [])) {
      if (!row) continue
      const type = String(row.type ?? '')
      const name = String(row.name ?? '')
      const display = String(row.Display ?? '')
      if (type === '3') {
        const base = name.replace(/_From$/, '').replace(/_To$/, '')
        const col = pageFilterColOf(strFunc, base)
        if (!col) { where.push('1=0'); continue }
        if (display.endsWith('起')) { const v = String(ff[`${base}_From`] ?? ''); if (v !== '') { where.push(`${col} >= ?`); params.push(v) } }
        else if (display.endsWith('止')) { const v = String(ff[`${base}_To`] ?? ''); if (v !== '') { where.push(`${col} <= ?`); params.push(v) } }
        else { const v = String(ff[name] ?? ''); if (v !== '') { where.push(`${col} = ?`); params.push(v) } }
        continue
      }
      const col = pageFilterColOf(strFunc, name)
      if (!col) { where.push('1=0'); continue }
      const v = String(ff[name] ?? '')
      if (v === '') continue
      if (type === '4') { where.push(`${col} = ?`); params.push(v) }
      else { where.push(`${col} LIKE ?`); params.push(`%${v}%`) }
    }
    const w = where.join(' AND ')
    const total = Number(this.db.prepare(`select count(*) c from ${def.table} where ${w}`).get(...params).c)
    const rows = this.db.prepare(`select * from ${def.table} where ${w} order by FInterID desc limit ? offset ?`)
      .all(...params, Number(pageSize), (Number(page) - 1) * Number(pageSize))
    return { head: rows.map((r) => pageRowToContract(strFunc, r)), totalCount: total }
  }

  getPage(strFunc, id) {
    const def = PAGE_DEFS[String(strFunc)]
    if (!def) throw new Error(`未知或未接入的子页 strFunc：${strFunc}`)
    const r = this.db.prepare(`select * from ${def.table} where FInterID = ? and deleted_at is null`).get(Number(id))
    return r ? pageRowToContract(strFunc, r) : null
  }

  /** 新增/修改（契约行 metaKey 键）。单据内码有值→update，无→insert；必填/唯一撞库均中文友好上抛。
   * bodiesMap（表体，第五批）：{B1:[契约行],…}；只处理下发页签（delete-by-head + 逐行 insert，企业同源语义），
   * 未下发页签不动。有表体写时整单包事务，防「单已存、体失败」半库（W4）。 */
  savePage(strFunc, contract, bodiesMap = null) {
    const def = PAGE_DEFS[String(strFunc)]
    if (!def) throw new Error(`未知或未接入的子页 strFunc：${strFunc}`)
    // 表体预翻译/预校验（全部副作用前上抛）
    const bodyPlans = []
    for (const b of def.bodies || []) {
      if (!bodiesMap || !Array.isArray(bodiesMap[b.tab])) continue
      if (b.required && bodiesMap[b.tab].length === 0) throw new Error(`表体[${b.name}]必须至少填写一行`)
      const reqs = b.fields.filter((f) => f.required)
      const rows = bodiesMap[b.tab].map((r, i) => {
        const phys = pageBodyContractToRow(strFunc, b.tab, r)
        for (const f of reqs) {
          const val = phys[f.dbCol]
          if (val === undefined || val === null || String(val).trim() === '') throw new Error(`表体[${b.name}]第 ${i + 1} 行 ${f.title || f.metaKey}不能为空`)
        }
        return phys
      })
      bodyPlans.push({ table: b.table, rows })
    }
    const inTx = bodyPlans.length > 0
    if (inTx) this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.savePageHead(def, strFunc, contract)
      for (const p of bodyPlans) {
        this.db.prepare(`delete from ${p.table} where FInterID = ?`).run(result.id)
        for (const phys of p.rows) {
          const cols = Object.keys(phys)
          this.db.prepare(`insert into ${p.table}(FInterID${cols.length ? ',' + cols.join(',') : ''}) values (?${cols.length ? ',' + cols.map(() => '?').join(',') : ''})`)
            .run(result.id, ...cols.map((c) => phys[c]))
        }
      }
      if (inTx) this.db.exec('COMMIT')
      return result
    } catch (e) {
      if (inTx) { try { this.db.exec('ROLLBACK') } catch { /* 已回滚忽略 */ } }
      throw e
    }
  }

  /** 表体物理行→契约行（按页签声明）；供 /detail 顶层 tab 键出参（前端 BillForm raw[tab] 消费）。 */
  getPageBodies(strFunc, id) {
    const def = PAGE_DEFS[String(strFunc)]
    const out = {}
    for (const b of (def && def.bodies) || []) {
      const rows = this.db.prepare(`select * from ${b.table} where FInterID = ? order by FEntryID`).all(Number(id))
      out[b.tab] = rows.map((r) => pageBodyRowToContract(strFunc, b.tab, r))
    }
    return out
  }

  /** 单据头落库（savePage 内层；事务包裹由 savePage 负责）。 */
  savePageHead(def, strFunc, contract) {
    const row = pageContractToRow(strFunc, contract)
    const id = Number(row.FInterID) || 0
    // 多组织收口（请求F）：做单先过组织门禁；FORGID 恒铸会话组织、忽略客户端值（同 saveMold，企业口径）
    this.orgGate()
    row.FORGID = this.curOrgName()
    // 必填校验：数值空串已由路由 NUMERIC 判定剔除；此处校验文本/枚举必填（新增缺省即空、更新仅在显式提供空时报错）
    for (const f of def.fields) {
      if (!f.required) continue
      const provided = row[f.dbCol] !== undefined
      const val = row[f.dbCol]
      const empty = val === undefined || val === null || String(val).trim() === ''
      if (id ? (provided && empty) : empty) throw new Error(`${f.title || f.metaKey}不能为空`)
    }
    const cols = pageColsInsert(strFunc).filter((c) => row[c] !== undefined && row[c] !== null)
    if (id) {
      // 审核锁（企业同义）：单据类页已审核禁改，反审核解锁（档案页无审核列不拦截）
      const stCol = auditableColOf(strFunc)
      if (stCol !== '' && stCol !== 'FStatus') {
        const st = this.db.prepare(`select * from ${def.table} where FInterID = ? and deleted_at is null`).get(id)
        if (st && String(st[stCol]) === '1') throw new Error(`${this.billLabel(strFunc, st)}已审核，不能修改，请先反审核`)
      }
      try {
        if (cols.length) {
          const sets = cols.map((c) => `${c} = ?`).join(', ')
          const r = this.db.prepare(`update ${def.table} set ${sets}, FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null`)
            .run(...cols.map((c) => row[c]), id)
          if (r.changes === 0) throw new Error(`${def.name} ${id} 不存在或已删除`)
        } else {
          const r = this.db.prepare(`update ${def.table} set FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null`).run(id)
          if (r.changes === 0) throw new Error(`${def.name} ${id} 不存在或已删除`)
        }
      } catch (e) {
        if (/UNIQUE/i.test(String(e.message)) && def.codeCol) throw new Error(`${def.codeLabel}「${row[def.codeCol]}」已存在`)
        throw e
      }
      return { ok: true, id, mode: 'update' }
    }
    let r
    try {
      r = this.db.prepare(`insert into ${def.table}(${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => row[c]))
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message)) && def.codeCol) throw new Error(`${def.codeLabel}「${row[def.codeCol]}」已存在`)
      throw e
    }
    const newId = Number(r.lastInsertRowid)
    if (def.billNoPrefix) {
      this.db.prepare(`update ${def.table} set FBillNo = ? where FInterID = ?`).run(pageBillNo(def, newId, new Date()), newId)
    }
    return { ok: true, id: newId, mode: 'add' }
  }

  deletePage(strFunc, id) {
    const def = PAGE_DEFS[String(strFunc)]
    if (!def) throw new Error(`未知或未接入的子页 strFunc：${strFunc}`)
    // 审核保护 + 下游引用拦截：与 deleteMold 同走 deleteBlockReason（档案页无审核列/无下游登记自然直通）
    const why = this.deleteBlockReason(strFunc, id)
    if (why.kind !== 'ok') throw new Error(why.msg)
    const r = this.db.prepare(`update ${def.table} set deleted_at = datetime('now','localtime'), FModifyTime = datetime('now','localtime') where FInterID = ? and deleted_at is null`).run(Number(id))
    if (r.changes === 0) throw new Error(`${def.name} ${id} 不存在或已删除`)
    return { ok: true, id: Number(id) }
  }

  // ---------- 基础资料页（item 页型：模具类型 MDType / 模具部件分类 MDPartClass） ----------
  // 与 dp 子页同为加法扩展：模具 203101 绿色路径不经过本组方法；出参逐键镜像企业 item 契约（personal.item.js）。

  /** /item 全量列表（不分页）+ basic（供前端解析 ftype 执行增删改/启禁）。 */
  listItem(strFunc, filterForm = null) {
    return getItemList(this.db, strFunc, filterForm, this.curOrgName())
  }

  /** /itemdo 写操作（add/addgroups/update/delete/ban/enable）。失败回 {ok:false,code:'FAIL',message}（W4 如实）。 */
  itemOperate(input) {
    return itemOperate(this.db, input, this.curOrgName())
  }

  close() {
    this.db.close()
  }
}

