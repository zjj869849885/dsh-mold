// server/sqlite/personal.item.js —— 个人版「基础资料页」（item 页型）通用引擎（v0.4 扩展 · 第三批）
// 设计红线：
//  · 加法扩展——模具 203101（personal.schema.js）与 dp 子页（personal.pages.js）绿色路径完全不动，
//    本模块只服务 item 页型 strFunc（MDType/MDPartClass），路由层按 strFunc 分派到 /item、/itemdo。
//  · 出参与企业版逐键同形（企业侧 itemQueries.getItem / itemWriteQueries.itemDataOperate），
//    共享 harness client-src（ListView/ItemDrawer）零前端分叉消费：
//      /item   → { ok, head, data, totalCount, firstGroup, basic, meta:{basic} }
//      /itemdo → 成功 { ok, strFunc, value, desc, message }；失败 { ok:false, code:'FAIL', message }
//  · 个人精简：企业每类别一张动态表 T_{FItemType} + T_Item/T_Itemprop 元数据 + 多级分组树；
//    个人版单表 T_MD_Item（FItemType 列区分类别）、无自定义属性列、扁平无组（FIsRoot 恒 0/FParentNumber 恒 '0'）。
//    head 精简为「代码/名称/状态」三列（是否组/上级组在企业侧恒空，个人版不展示，属能力裁剪走数据）。
//  · 失败一律如实上抛为 {ok:false,message}（W4），不做防御性兜底。

// 删除保护引用面：复用 dp 侧 itemRef 权威声明自动扫描结果，避免基础资料与业务表两套事实。
import { ITEM_BIZ_REFS, BILL_TABLE_NAMES } from './personal.pages.js'

/** 类别契约：strFunc(=FItemType) → 名称。个人版落模具族 2 类 + 点检/保养项目类型 2 类（第四批）。 */
export const ITEM_DEFS = {
  MDType: { strFunc: 'MDType', name: '模具类型' },
  MDPartClass: { strFunc: 'MDPartClass', name: '模具部件分类' },
  MDLocation: { strFunc: 'MDLocation', name: '库位' },
  MDChkItemType: { strFunc: 'MDChkItemType', name: '点检项目类型' },
  MDMainItemType: { strFunc: 'MDMainItemType', name: '保养项目类型' },
  // —— 基础资料模块（请求D）：ERP 公共台账个人精简，单表按 FItemType 区分；下拉经 itemRef 消费 ——
  MDSupplier: { strFunc: 'MDSupplier', name: '供应商' },
  MDCustomer: { strFunc: 'MDCustomer', name: '客户' },
  MDDept: { strFunc: 'MDDept', name: '车间/部门' },
  MDProdLine: { strFunc: 'MDProdLine', name: '生产中心' },
  MDStock: { strFunc: 'MDStock', name: '仓库' },
  MDEmployee: { strFunc: 'MDEmployee', name: '人员' },
  MDUnit: { strFunc: 'MDUnit', name: '计量单位' },
  MDCurrency: { strFunc: 'MDCurrency', name: '币别' },
  MDPosition: { strFunc: 'MDPosition', name: '岗位/角色' },
  MDMoldGroup: { strFunc: 'MDMoldGroup', name: '模具组' },
  // —— 多组织（请求E）：组织台账行=会话组织候选；FORGID 存名称文本，与 itemRef 全链同口径 ——
  MDOrg: { strFunc: 'MDOrg', name: '组织' },
}

/** 本模块是否受理该 item strFunc。 */
export const isItemStrFunc = (strFunc) => Object.prototype.hasOwnProperty.call(ITEM_DEFS, String(strFunc))

/** 全局字典类（请求G）：跨组织共用、不加组织归属、不按组织过滤。其余 item 类别一律「按组织维护」。
 *  MDOrg 是组织字典本身（自举，不能按组织隔离）；计量单位/币别为通用度量，全局共用。 */
export const GLOBAL_ITEM_TYPES = new Set(['MDOrg', 'MDUnit', 'MDCurrency'])
export const isGlobalItemType = (t) => GLOBAL_ITEM_TYPES.has(String(t))

/** head 固定列（逐键镜像企业 selectItemDataAndHead：width100/fix''/contentTip/must/edit/hide/valueType/fitWidth，去 自增列/上级组代码）。 */
function itemHeadCol(name) {
  return {
    name, field: name, title: name, width: 100, fix: '',
    contentTip: true, must: false, edit: false, hide: false,
    valueType: 'System.String', fitWidth: false,
  }
}

/**
 * /item 出参（镜像 getItem：全量不分页 + basic 供前端 itemOpenEdit/itemRowOp 解析 ftype）。
 * @param db node:sqlite DatabaseSync
 * @param strFunc 类别代码（= FItemType）
 * @param filterForm 可选 {fnumber, fname} 文本 like（对齐企业 selectItemData 筛选契约）
 */
export function getItemList(db, strFunc, filterForm = null, curOrg = '') {
  const def = ITEM_DEFS[String(strFunc)]
  if (!def) return { ok: false, strFunc, message: `未知或未接入的基础资料类别：${String(strFunc)}` }
  const scoped = !isGlobalItemType(def.strFunc)
  const where = ['FItemType = ?', 'deleted_at IS NULL']
  const params = [def.strFunc]
  // 按组织隔离（请求G）：非全局类别只见「本组织 + 未分派旧数据（FORGID 空）」；全局字典类不加组织
  if (scoped && curOrg) { where.push("(FORGID = '' OR FORGID IS NULL OR FORGID = ?)"); params.push(curOrg) }
  const ff = filterForm && typeof filterForm === 'object' ? filterForm : null
  if (ff) {
    const fn = ff.fnumber == null ? '' : String(ff.fnumber)
    const nm = ff.fname == null ? '' : String(ff.fname)
    if (fn !== '') { where.push('FNumber LIKE ?'); params.push(`%${fn}%`) }
    if (nm !== '') { where.push('FName LIKE ?'); params.push(`%${nm}%`) }
  }
  const rows = db
    .prepare(`select FID, FNumber, FName, FStatus, FIsRoot, FParentNumber, FORGID from T_MD_Item where ${where.join(' AND ')} order by FNumber`)
    .all(...params)
  // data 行键与企业 selectItemData 一致（含隐藏键 自增列/上级组代码，供 itemRowOp 定位 FID）
  const data = rows.map((r) => {
    const o = {
      代码: r.FNumber == null ? '' : String(r.FNumber),
      名称: r.FName == null ? '' : String(r.FName),
      自增列: String(r.FID),
      状态: Number(r.FStatus) === 0 ? '启用' : '禁用',
      是否组: Number(r.FIsRoot) === 1 ? '是' : '否',
      上级组代码: r.FParentNumber == null ? '0' : String(r.FParentNumber),
      上级组: '',
    }
    if (scoped) o['使用组织'] = r.FORGID == null ? '' : String(r.FORGID) // 组织归属如实回显（''=未分派旧数据）
    return o
  })
  const head = [itemHeadCol('代码'), itemHeadCol('名称'), itemHeadCol('状态')]
  if (scoped) head.push(itemHeadCol('使用组织'))
  // basic：个人扁平——number===ftype ⇒ 前端 groupnumber 取 '0'（新增落顶层，无组上下文）
  const basic = { name: def.name, number: def.strFunc, ftype: def.strFunc, parentNumber: '' }
  return { ok: true, head, data, totalCount: data.length, firstGroup: def.strFunc, basic, meta: { basic } }
}

/** Json_Fail("", msg) 等价：业务失败（对齐企业 itemWriteQueries.fail）。 */
function fail(message) {
  return { ok: false, code: 'FAIL', message }
}

/**
 * 基础资料删除拦截（2026-11-20 需求：组织/仓库等仍被单据使用时不得删除）。
 *  · 引用面 = personal.pages.js ITEM_BIZ_REFS（各页 itemRef 声明自动扫描）；落库存台账【名称】，
 *    历史脏数据兼容再按【代码】比一次，两者任一命中即视为在用。
 *  · 组织另有「当前会话组织」这重特殊身份：删掉后做单失去归属锚点，必须先切换。
 *  · 同名档案跨组织可共存（不同组织同代码/同名合法），故非组织类按可见范围（本组织+未分派）过滤，防误拦。
 *  · 口径：不能删 ≠ 不能停用，引导走「禁用」，已保存单据零影响。
 */
function itemDeleteBlockReason(db, itemType, row, curOrg) {
  const name = String(row?.FName ?? '')
  const code = String(row?.FNumber ?? '')
  const isOrg = String(itemType) === 'MDOrg'
  if (isOrg && curOrg !== '' && name === curOrg) return `当前组织「${name}」正在使用中，不能删除。请先切换到其它组织；如需停用请改用「禁用」。`
  const vals = [...new Set([name, code].filter((v) => v !== ''))]
  if (!vals.length) return ''
  const hits = []
  let total = 0
  for (const ref of ITEM_BIZ_REFS[String(itemType)] || []) {
    const alias = ref.head ? 'e.' : ''
    const cond = vals.length === 2 ? `${alias}${ref.col} IN (?, ?)` : `${alias}${ref.col} = ?`
    // 组织类匹配的就是 FORGID 本身，不能再按组织过滤；其余类别限「本组织 + 未分派旧数据」可见范围
    const orgCond = isOrg || curOrg === '' ? '' : (ref.head
      ? ' and (h.FORGID = \'\' OR h.FORGID IS NULL OR h.FORGID = ?)'
      : ' and (FORGID = \'\' OR FORGID IS NULL OR FORGID = ?)')
    const sql = ref.head
      ? `select count(*) c from ${ref.table} e join ${ref.head} h on h.FInterID = e.FInterID where ${cond} and h.deleted_at is null${orgCond}`
      : `select count(*) c from ${ref.table} where ${cond} and deleted_at is null${orgCond}`
    const c = Number(db.prepare(sql).get(...(orgCond ? [...vals, curOrg] : vals))?.c || 0)
    if (c > 0) { hits.push(`${BILL_TABLE_NAMES[ref.table] || ref.table} ${c} 条`); total += c }
  }
  if (!hits.length) return ''
  const what = isOrg ? `组织「${name || code}」` : `「${name || code}」`
  const scope = hits.length > 3 ? `${hits.slice(0, 3).join('、')} 等 ${hits.length} 处` : hits.join('、')
  return `${what}仍被业务数据使用（${scope}，共 ${total} 条），不能删除。如需停用请改用「禁用」，已保存的单据不受影响。`
}

/**
 * /itemdo 主移植（镜像 itemDataOperate：delete/ban/enable/add/addgroups/update）。
 * @param db
 * @param input { strFunc, FOperType, FItemType, Form }
 */
export function itemOperate(db, input, curOrg = '') {
  const FOperType = input.FOperType == null ? '' : String(input.FOperType)
  const FItemType = input.FItemType == null ? '' : String(input.FItemType)
  const strFunc = input.strFunc == null ? '' : String(input.strFunc)
  const def = ITEM_DEFS[FItemType]
  if (!def) return fail(`未知或未接入的基础资料类别：${JSON.stringify(FItemType)}`)
  const scoped = !isGlobalItemType(FItemType)
  const fobj = input.Form && typeof input.Form === 'object' && !Array.isArray(input.Form) ? input.Form : {}
  const FID = fobj['自增列'] == null ? '' : String(fobj['自增列'])

  if (FOperType === 'delete') {
    const cur = db.prepare('select FNumber, FName from T_MD_Item where FID = ? and FItemType = ? and deleted_at is null').get(Number(FID) || 0, FItemType)
    if (!cur) return fail('该数据行不存在或已被删除，请刷新列表后重试')
    const why = itemDeleteBlockReason(db, FItemType, cur, curOrg)
    if (why !== '') return fail(why)
    // 企业为硬删（delete from T_{type}）；个人版沿用全库软删红线，deleted_at 打标 + 部分唯一索引保同号重建
    db.prepare("update T_MD_Item set deleted_at = datetime('now','localtime') where FID = ? and FItemType = ? and deleted_at is null")
      .run(Number(FID) || 0, FItemType)
    return { ok: true, strFunc, value: '', desc: `类型delete基础资料编号${FItemType}FID${FID}`, message: '' }
  }
  if (FOperType === 'ban' || FOperType === 'enable') {
    // 存在性 + 当前状态预检（2026-11-21 按钮审计 B4b/B4c）：旧实现裸 update，行已删/已是目标态
    // 仍回 ok:true，前端报「禁用成功」而列表纹丝不动。企业侧靠前端判态，个人版把闸口收到服务端。
    const cur = db.prepare('select FNumber, FName, FStatus from T_MD_Item where FID = ? and FItemType = ? and deleted_at is null')
      .get(Number(FID) || 0, FItemType)
    if (!cur) return fail('该数据行不存在或已被删除，请刷新列表后重试')
    const label = `「${String(cur.FName || cur.FNumber || FID)}」`
    const disabled = Number(cur.FStatus) !== 0
    if (FOperType === 'ban' && disabled) return fail(`${label}已是禁用状态，无需重复禁用`)
    if (FOperType === 'enable' && !disabled) return fail(`${label}已是启用状态，无需重复启用`)
    db.prepare('update T_MD_Item set FStatus = ? where FID = ? and FItemType = ? and deleted_at is null')
      .run(FOperType === 'ban' ? 9 : 0, Number(FID) || 0, FItemType)
    return { ok: true, strFunc, value: '', desc: `类型${FOperType}基础资料编号${FItemType}FID${FID}`, message: '' }
  }

  // add / addgroups / update：fnumber/fname 必录（企业 checkSql 硬约束，逐字对齐文案）
  const fnumber = fobj.fnumber == null ? '' : String(fobj.fnumber)
  const fname = fobj.fname == null ? '' : String(fobj.fname)
  if (fnumber.trim() === '') return fail('代码为必录项，不能为空')
  if (fname.trim() === '') return fail('名称为必录项，不能为空')
  const groupnumber = fobj.groupnumber == null ? '0' : String(fobj.groupnumber)

  if (FOperType === 'update') {
    // 组织隔离（请求G）：非全局类别仅本组织/未分派行可改（跨组织行改不到，防越权）
    const r = scoped
      ? db.prepare("update T_MD_Item set FNumber = ?, FName = ? where FID = ? and FItemType = ? and deleted_at is null and (FORGID = '' OR FORGID = ?)")
        .run(fnumber, fname, Number(FID) || 0, FItemType, curOrg)
      : db.prepare('update T_MD_Item set FNumber = ?, FName = ? where FID = ? and FItemType = ? and deleted_at is null')
        .run(fnumber, fname, Number(FID) || 0, FItemType)
    if (r.changes === 0) return fail('该数据行不存在或已被删除')
    return { ok: true, strFunc, value: '', desc: `类型update基础资料编号${FItemType}FID${FID}`, message: '' }
  }

  if (FOperType === 'add' || FOperType === 'addgroups') {
    // 组织门禁（请求G）：按组织维护的基础资料须先有组织，未维护如实提示（组织/计量单位/币别等全局类除外）
    if (scoped && curOrg === '') return fail('组织数据源未维护：请先在「基础资料 - 组织」中维护组织，维护后才能维护本基础资料')
    // 撞号检查：非全局类别限「本组织 + 未分派旧数据」可见范围（不同组织同代码可共存）；全局类别同类别活动记录内唯一
    const dup = scoped
      ? db.prepare("select 1 from T_MD_Item where FItemType = ? and FNumber = ? and deleted_at is null and (FORGID = '' OR FORGID = ?)").get(FItemType, fnumber, curOrg)
      : db.prepare('select 1 from T_MD_Item where FItemType = ? and FNumber = ? and deleted_at is null').get(FItemType, fnumber)
    if (dup) return fail('该编号已存在')
    const isRoot = FOperType === 'addgroups' ? 1 : 0
    // 新建恒铸会话组织（企业 FORGID=OID 同口径）；全局类别 FORGID 恒 ''
    const r = db.prepare(
      'insert into T_MD_Item(FItemType, FNumber, FName, FStatus, FIsRoot, FParentNumber, FORGID) values (?,?,?,?,?,?,?)',
    ).run(FItemType, fnumber, fname, 0, isRoot, groupnumber, scoped ? curOrg : '')
    return { ok: true, strFunc, value: '', desc: `类型${FOperType}基础资料编号${FItemType}FID${Number(r.lastInsertRowid)}`, message: '' }
  }

  // 其余 FOperType：企业未赋 opersql（空串执行→无行→提交成功）。照搬（结构搬运）。
  return { ok: true, strFunc, value: '', desc: `类型${FOperType}基础资料编号${FItemType}FID${FID}`, message: '' }
}
