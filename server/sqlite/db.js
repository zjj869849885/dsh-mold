// server/sqlite/db.js —— 个人版连接与迁移（node:sqlite · raw ESM · 零外部依赖）
// 设计稿 §2.2.1：WAL / foreign_keys / busy_timeout 强制；user_version 整数版本按序事务迁移。
// §6 坑 3 恢复红线：替换 .db 前必须 close → 删 -wal/-shm → 再重建连接。
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGE_DEFS, auditableColOf } from './personal.pages.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = join(HERE, '..', 'migrations')
export const DB_FILENAME = 'mold-personal.db'

/** dataDir 解析优先级：显式参数 > 环境变量 M10_PERSONAL_DATADIR > ~/.m10-mold-personal（§需求1 数据目录与插件包解耦）。 */
export function resolveDataDir(opt) {
  if (opt) return opt
  if (process.env.M10_PERSONAL_DATADIR) return process.env.M10_PERSONAL_DATADIR
  return join(homedir(), '.m10-mold-personal')
}

export function getUserVersion(db) {
  return Number(db.prepare('PRAGMA user_version').get().user_version)
}

/** 按文件名数字前缀顺序执行 user_version 之后的迁移，每个文件一个事务，失败回滚上抛（W4：不吞错）。 */
export function migrate(db) {
  const current = getUserVersion(db)
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  for (const f of files) {
    const v = parseInt(f, 10)
    if (!Number.isFinite(v) || v <= current) continue
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${v}`) // pragma 随事务提交，原子生效
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`迁移 ${f} 失败: ${e.message}`)
    }
  }
  ensureBillStateColumns(db)
  ensureCreatorColumns(db)
  ensureSourceBillColumns(db)
  ensureMoldExtraColumns(db)
  ensureEnhancedSchema(db)
  return getUserVersion(db)
}

/**
 * 审核流列兜底（009 配套，每启幂等）：单据类子页（PAGE_DEFS.billNoPrefix 权威枚举）逐表补
 * FBillState（0创建/1已审核，语义对齐企业 FStatus；这些表 FStatus 已被业务枚举占用不能复用）。
 * ALTER ADD COLUMN 无法条件化，静态 SQL 罩不住动态页清单，故由引擎按 schema 驱动幂等补列。
 * 模具档案 203101 沿用既有 FStatus 整数列：旧库默认值 1（已审核）纠正为 0（创建）——
 * 审核此前从未开放（/billstatus 硬拒），存量只可能是未审核；app_setting 标记保一次性，
 * 不会把用户后续真审核的单据改回创建态。
 */
export function ensureBillStateColumns(db) {
  for (const def of Object.values(PAGE_DEFS)) {
    // 审核列覆盖面（UX 需求 2026-11-22）：单据类页 + 被下游 refOf 带出的基础资料页均用 FBillState（模具 203101 走 FStatus 不在此列）。
    if (auditableColOf(def.strFunc) !== 'FBillState') continue
    const cols = db.prepare(`PRAGMA table_info(${def.table})`).all().map((c) => String(c.name))
    const isNewBillState = !cols.includes('FBillState')
    if (isNewBillState)
      db.prepare(`alter table ${def.table} add column FBillState INTEGER NOT NULL DEFAULT 0`).run()
    // 审核人/审核日期兜底列（缺陷修复 2026-11-21）：单据表 006 建表未含这两列，审核写链路需落此二值，与 FBillState 同处幂等补列（模具档案 001 已自带不受影响）。
    if (!cols.includes('FApproverID'))
      db.prepare(`alter table ${def.table} add column FApproverID TEXT DEFAULT ''`).run()
    if (!cols.includes('FApproverDate'))
      db.prepare(`alter table ${def.table} add column FApproverDate TEXT DEFAULT ''`).run()
    // 存量回填（UX 需求 2026-11-22）：新纳入审核的基础资料页（非单据），历史行默认置「已审核」使下游带出立即可用；
    // 单据页维持创建态不变。仅在该列首次新增时执行一次（isNewBillState 幂等守卫）。
    if (isNewBillState && !def.billNoPrefix)
      db.prepare(`update ${def.table} set FBillState = 1 where FBillState = 0`).run()
  }
  const marked = db.prepare("select value from app_setting where key = 'migrate.mold_fstatus_default0'").get()
  if (!marked) {
    db.prepare('update T_MD_Mould set FStatus = 0 where FStatus = 1').run()
    db.prepare("insert into app_setting(key, value) values ('migrate.mold_fstatus_default0', '1')").run()
  }
}

/** 个人版全部 DP 表幂等补齐制单人列；旧库升级与新建库使用同一入口。 */
export function ensureCreatorColumns(db) {
  const tables = ['T_MD_Mould', ...Object.values(PAGE_DEFS).map((def) => def.table)]
  for (const table of new Set(tables)) {
    const cols = db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => String(c.name))
    if (!cols.includes('FCreater')) db.prepare('alter table ' + table + ' add column FCreater TEXT DEFAULT ' + "''").run()
  }
}

/** 补齐出库申请/领用/归还三单据来源单据号列（R8/R9/R10 下推可追溯 + 反审核引用拦截，幂等安全）。 */
export function ensureSourceBillColumns(db) {
  for (const table of ['T_MD_OutboundApply', 'T_MD_PickRecord', 'T_MD_ReturnRecord']) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => String(c.name))
    if (!cols.includes('FSourceBillNo')) db.prepare(`alter table ${table} add column FSourceBillNo TEXT DEFAULT ''`).run()
  }
}

/** 补齐模具档案周期/产能/可用穴数/寿命报警线列，使表单填写可完整落库并支持寿命预警（幂等安全）。 */
export function ensureMoldExtraColumns(db) {
  const cols = db.prepare('PRAGMA table_info(T_MD_Mould)').all().map((c) => String(c.name))
  const add = [
    ['FCycle', 'REAL NOT NULL DEFAULT 0'],
    ['FDESCY', 'REAL NOT NULL DEFAULT 0'],
    ['FLevelCY', 'REAL NOT NULL DEFAULT 0'],
    ['FUsableCavity', 'INTEGER NOT NULL DEFAULT 0'],
    ['FLifeWarn', 'INTEGER NOT NULL DEFAULT 0'],
  ]
  for (const [name, ddl] of add) {
    if (!cols.includes(name)) db.prepare(`alter table T_MD_Mould add column ${name} ${ddl}`).run()
  }
}

/** 扩展表结构（幂等）：点检/保养方案项目明细表、备件库存数量列、盘点盈亏差额列。 */
export function ensureEnhancedSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS T_MD_ChkSchedEntry (
      FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
      FInterID INTEGER NOT NULL,
      FChkItemType TEXT DEFAULT '',
      FChkItemNumber TEXT DEFAULT '',
      FChkItem TEXT DEFAULT '',
      FChkAsk TEXT DEFAULT '',
      FChkStandard TEXT DEFAULT '',
      FNote TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_chksched_entry_head ON T_MD_ChkSchedEntry(FInterID);
    CREATE TABLE IF NOT EXISTS T_MD_MainSchedEntry (
      FEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
      FInterID INTEGER NOT NULL,
      FMainItemType TEXT DEFAULT '',
      FMainItemNumber TEXT DEFAULT '',
      FMainItem TEXT DEFAULT '',
      FMainAsk TEXT DEFAULT '',
      FNote TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_mainsched_entry_head ON T_MD_MainSchedEntry(FInterID);
  `)
  const spareCols = db.prepare('PRAGMA table_info(T_MD_Spare)').all().map((c) => String(c.name))
  if (!spareCols.includes('qty')) db.prepare('alter table T_MD_Spare add column qty REAL NOT NULL DEFAULT 0').run()
  const stCols = db.prepare('PRAGMA table_info(T_MD_StocktakingEntry)').all().map((c) => String(c.name))
  if (!stCols.includes('FDiffQty')) db.prepare('alter table T_MD_StocktakingEntry add column FDiffQty REAL NOT NULL DEFAULT 0').run()
}
/** 打开（或首启创建）本地库：建目录树 → PRAGMA → 迁移。返回 { db, dataDir, dbPath }。 */
export function openDatabase(dataDirOpt) {
  const dataDir = resolveDataDir(dataDirOpt)
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(dataDir, 'images'), { recursive: true })
  mkdirSync(join(dataDir, 'backups'), { recursive: true })
  const dbPath = join(dataDir, DB_FILENAME)
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  migrate(db)
  return { db, dataDir, dbPath }
}

/** OOBE 首启灌默认字典与示例（幂等：仅 dict_option 为空时写入）。 */
export function seedDefaults(db, { sampleMolds = false } = {}) {
  const cnt = db.prepare("select count(*) c from dict_option where category in ('mold_type','mold_location')").get().c
  if (Number(cnt) === 0) {
    const ins = db.prepare('insert into dict_option(category,value,sort) values (?,?,?)')
    for (const [i, v] of ['冲压模', '注塑模', '压铸模'].entries()) ins.run('mold_type', v, i)
    for (const [i, v] of ['A区-01', 'A区-02', 'B区-01'].entries()) ins.run('mold_location', v, i)
  }
  // 部件类型字典（子页 203102 部件档案消费；独立幂等判据，不影响上面模具字典的既有语义）
  const pcnt = db.prepare("select count(*) c from dict_option where category = 'part_type'").get().c
  if (Number(pcnt) === 0) {
    const ins = db.prepare('insert into dict_option(category,value,sort) values (?,?,?)')
    for (const [i, v] of ['成型件', '导向件', '冲压件', '功能件'].entries()) ins.run('part_type', v, i)
  }
  // 备件属性字典（子页 203103 备件档案消费；独立幂等判据）
  const scnt = db.prepare("select count(*) c from dict_option where category = 'spare_property'").get().c
  if (Number(scnt) === 0) {
    const ins = db.prepare('insert into dict_option(category,value,sort) values (?,?,?)')
    for (const [i, v] of ['易损件', '关键件', '通用件', '专用件'].entries()) ins.run('spare_property', v, i)
  }
  // 基础资料页（item 页型）初始台账：模具族 2 类 + 点检/保养项目类型 2 类（第四批；逐类别独立幂等判据）
  const insItem = db.prepare('insert into T_MD_Item(FItemType,FNumber,FName,FStatus,FIsRoot) values (?,?,?,0,0)')
  for (const [type, rows] of [
    ['MDType', [['01', '冲压模'], ['02', '注塑模'], ['03', '压铸模']]],
    ['MDPartClass', [['01', '成型零件'], ['02', '导向零件'], ['03', '功能零件']]],
    ['MDLocation', [['01', 'A区-01'], ['02', 'A区-02'], ['03', 'B区-01']]],
    ['MDChkItemType', [['01', '外观类'], ['02', '尺寸类'], ['03', '功能类']]],
    ['MDMainItemType', [['01', '润滑类'], ['02', '紧固类'], ['03', '清洁类']]],
    // 基础资料模块（请求D）：ERP 公共台账种子，名称与单据历史文本值兼容（人员=姓名字符串）
    ['MDSupplier', [['S001', '华东模具供应商'], ['S002', '精工模具设备厂'], ['S003', '西南标准件有限公司']]],
    ['MDCustomer', [['C001', '华正精密科技'], ['C002', '东信模塑股份'], ['C003', '坤泰制品']]],
    ['MDDept', [['01', '注塑车间'], ['02', '冲压车间'], ['03', '模具维修班']]],
    ['MDProdLine', [['01', '一号生产中心'], ['02', '二号生产中心']]],
    ['MDStock', [['01', '模具主仓'], ['02', '备件仓']]],
    ['MDEmployee', [['E001', '张伟'], ['E002', '李强'], ['E003', '王芳'], ['E004', '刘洋'], ['E005', '陈斌']]],
    ['MDUnit', [['Pcs', '个'], ['Kg', '千克'], ['Set', '套']]],
    ['MDCurrency', [['PRE001', '人民币'], ['PRE007', '美元'], ['PRE003', '欧元']]],
    ['MDPosition', [['P01', '点检员'], ['P02', '保养员'], ['P03', '维修工'], ['P04', '模具主管']]],
    ['MDMoldGroup', [['G01', '冲压模组'], ['G02', '注塑模组']]],
    // 组织（MDOrg）不播种：组织是数据源，由用户在「基础资料-组织」自行维护；
    // 未维护时 /org 如实回错、做单被 orgGate 拦截提示（企业版同向：组织字典空→「组织字典不可用」）。
  ]) {
    const icnt = db.prepare('select count(*) c from T_MD_Item where FItemType = ?').get(type).c
    if (Number(icnt) === 0) for (const [code, name] of rows) insItem.run(type, code, name)
  }
  if (sampleMolds && db.prepare('select count(*) c from T_MD_Mould').get().c === 0) {
    db.prepare('insert into T_MD_Mould(FMDNumber,FName,FModel,FType,FMDStatus,FMDPlace,FDesignLife,maint_interval_shots) values (?,?,?,?,?,?,?,?)')
      .run('SAMPLE-001', '示例模具（可删除）', '300×200', '冲压模', '在库', 'A区-01', 500000, 50000)
  }
}

/**
 * 恢复替换红线执行器（§6 坑 3/7）：调用方已把新库放好并校验通过后，
 * close → 删 -wal/-shm → 替换 → 重开。失败时由调用方保证现有数据不动。
 */
export function swapDatabaseFile(dbHandle, newDbPath, dataDirOpt) {
  const { dbPath } = dbHandle
  dbHandle.db.close()
  for (const suf of ['-wal', '-shm']) {
    try { unlinkSync(dbPath + suf) } catch { /* 无伴随文件（未开 WAL/已清）视为正常 */ }
  }
  copyFileSync(newDbPath, dbPath)
  return openDatabase(dataDirOpt)
}

