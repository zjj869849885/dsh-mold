// server/sqlite/personal.schema.js —— 个人版静态 Schema（设计稿 §2.2.2 / §6 坑 2 定稿口径）
// 每个字段显式声明 metaKey（前端契约键）↔ dbCol（SQLite 列），list/get/save 统一按本表自动翻译，
// 禁止在 adapter 里手写 switch/if 字段转换堆。
// 阶段 2 定稿：info 行逐键对齐企业版 W_DocumentInfo 英文键形状（FField/FFieldName/FType/FTABNumber/
// FDataType/FInputType/FIsMust/FDefaultValue/FIsAlter/FIsAPAlter/FDecPlaces/FLength），
// 前端 BillForm/ListView 零分叉消费；dict/enum 字段的下拉选项由服务端在 Info 行直接预置
// `_options:[{value,label}]`（BillForm renderControl `optsRaw = optsIn ?? it._options` 天然消费，
// 绕开个人版无表体导致的 displayMap/popdata 两条前端桥接通道失效——见台账 [197:00] 后取证）。

// 下推元数据：b9 加法，模具 203101 的 convertRules（→报修单）由 personal.push.js 规则表注入。
import { convertRulesFor } from './personal.push.js'

export const MOLD_FIELDS = [
  { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
  { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
  { metaKey: '模具编号', dbCol: 'FMDNumber', title: '编号', type: 'text', required: true },
  { metaKey: '模具名称', dbCol: 'FName', title: '名称', type: 'text', required: true },
  { metaKey: '规格', dbCol: 'FModel', title: '规格', type: 'text' },
  { metaKey: '类型', dbCol: 'FType', title: '类型', type: 'dict', dict: 'mold_type', itemRef: 'MDType' },
  { metaKey: '状态', dbCol: 'FMDStatus', title: '状态', type: 'enum', enum: ['在库', '生产中', '保养中', '维修中', '报废'] },
  { metaKey: '库位', dbCol: 'FMDPlace', title: '库位', type: 'dict', dict: 'mold_location', itemRef: 'MDLocation' },
  // —— 基础资料模块（请求D）：对齐企业 203101 表头追加；下拉接台账，台账空自然退文本（opts.length 判据） ——
  { metaKey: '简称', dbCol: 'FBriefName', title: '简称', type: 'text' },
  { metaKey: '模具组', dbCol: 'FSmallType', title: '模具组', type: 'dict', dict: 'mold_group', itemRef: 'MDMoldGroup' },
  { metaKey: '验收状态', dbCol: 'FChkStatus', title: '验收状态', type: 'enum', enum: ['未验收', '已验收'], default: '未验收' },
  { metaKey: '库存状态', dbCol: 'FMDStockStatus', title: '库存状态', type: 'enum', enum: ['出库', '在库'], default: '在库' },
  { metaKey: '车间', dbCol: 'FDept', title: '所属车间', type: 'dict', dict: 'dept', itemRef: 'MDDept' },
  { metaKey: '生产中心', dbCol: 'FProdLine', title: '所属生产中心', type: 'dict', dict: 'prod_line', itemRef: 'MDProdLine' },
  { metaKey: '仓库', dbCol: 'FStock', title: '存放仓库', type: 'dict', dict: 'stock', itemRef: 'MDStock' },
  { metaKey: '仓位', dbCol: 'FStorageLoc', title: '存放仓位', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
  { metaKey: '保养方案', dbCol: 'FMainSche', title: '保养方案', type: 'text' },
  { metaKey: '点检方案', dbCol: 'FCheckSche', title: '点检方案', type: 'text' },
  { metaKey: '保养角色', dbCol: 'FMainRole', title: '保养人角色', type: 'dict', dict: 'position', itemRef: 'MDPosition' },
  { metaKey: '点检角色', dbCol: 'FCheckRole', title: '点检人角色', type: 'dict', dict: 'position', itemRef: 'MDPosition' },
  { metaKey: '重量', dbCol: 'FWeight', title: '重量', type: 'decimal' },
  { metaKey: '重量单位', dbCol: 'FWeightUnit', title: '重量单位', type: 'dict', dict: 'unit', itemRef: 'MDUnit', enum: ['个', '千克'] },
  { metaKey: '适配原材料', dbCol: 'FItemName', title: '适配原材料', type: 'text' },
  { metaKey: '接收日期', dbCol: 'FReceiverDate', title: '接收日期', type: 'date' },
  { metaKey: '启用日期', dbCol: 'FEnableDate', title: '启用日期', type: 'date' },
  { metaKey: '报废日期', dbCol: 'FScrapDate', title: '报废日期', type: 'date' },
  { metaKey: '变更日期', dbCol: 'FMDChargeDate', title: '变更日期', type: 'date' },
  { metaKey: '供应商', dbCol: 'FSupplier', title: '供应商', type: 'dict', dict: 'supplier', itemRef: 'MDSupplier' },
  { metaKey: '客户', dbCol: 'FCust', title: '客户', type: 'dict', dict: 'customer', itemRef: 'MDCustomer' },
  { metaKey: '工程更改前号', dbCol: 'FBeforeENGR', title: '工程更改前号', type: 'text' },
  { metaKey: '标准适配机型', dbCol: 'FAdaptedType', title: '标准适配机型', type: 'text' },
  { metaKey: '标准周期', dbCol: 'FCycle', title: '标准周期(S)', type: 'decimal' },
  { metaKey: '设计产能', dbCol: 'FDESCY', title: '设计产能(8H)', type: 'decimal' },
  { metaKey: '标准产能', dbCol: 'FLevelCY', title: '标准产能(8H)', type: 'decimal' },
  { metaKey: '可用穴数', dbCol: 'FUsableCavity', title: '可用穴数', type: 'int' },
  { metaKey: '寿命报警线', dbCol: 'FLifeWarn', title: '寿命报警线', type: 'int' },
  { metaKey: '剩余寿命', dbCol: 'FRemainLifeQty', title: '剩余寿命', type: 'int', readonly: true, showReadonly: true },
  { metaKey: '金额', dbCol: 'FMDCost', title: '模具金额', type: 'decimal' },
  { metaKey: '设计寿命模次', dbCol: 'FDesignLife', title: '设计寿命', type: 'int' },
  { metaKey: '已用模次', dbCol: 'used_shots', title: '已用模次', type: 'int', readonly: true, showReadonly: true },
  { metaKey: '模穴数', dbCol: 'cavity_count', title: '模穴数', type: 'int' },
  { metaKey: '保养周期模次', dbCol: 'maint_interval_shots', title: '保养周期', type: 'int' },
  { metaKey: '上次保养模次', dbCol: 'last_maint_shots', title: '上次保养', type: 'int', readonly: true, showReadonly: true },
  { metaKey: '备注', dbCol: 'remark', title: '备注', type: 'memo' },
  // 封面图（单图维护）：无 dbCol——base64 不进主档列，由 /save 提取 FImage → adapter.saveImage 落盘 mold_image。
  // 声明于 info（FORM_FIELDS）即触发前端 BillForm isImageType 控件（选择/更换/删除）；noList 排除于列表列。
  { metaKey: '封面图', dbCol: '', title: '封面图', type: 'image', noList: true },
  { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
  { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
]

/** 列表 /data 的 head 列（契约）：单据内码不进列定义，前端经行键 cellText(r,'单据内码') 直取。图片类 noList 字段不进列表列（无物理数据列）。 */
export const LIST_FIELDS = MOLD_FIELDS.filter((f) => !f.hidden && !f.noList)

/** BillForm 表头字段（契约）：隐藏键不进表头渲染（无 bodyheader 时前端按 Info 行全量落 fgrid）。 */
/** BillForm 表头字段（契约）：showLock（使用组织）灰锁但保留展示，企业 FORGID 可见不可改同口径。 */
export const FORM_FIELDS = MOLD_FIELDS.filter((f) => !f.hidden && (!f.readonly || f.showLock || f.showReadonly))

/**
 * 数值型契约字段 metaKey 集合（type ∈ int/decimal）。
 * /save 判定「空数字串不进契约」以此【服务端权威 schema】为准，而非客户端自报的 FDataType——
 * 防旧客户端/异常载荷缺省或错标 FDataType 时，'' 重新污染 SQLite INTEGER 列（扫雷暗雷 1 的同族加固）。
 */
export const NUMERIC_METAKEYS = new Set(MOLD_FIELDS.filter((f) => /^(int|decimal)$/i.test(f.type)).map((f) => f.metaKey))

const META2DB = new Map(MOLD_FIELDS.map((f) => [f.metaKey, f.dbCol]))
const DB2META = new Map(MOLD_FIELDS.map((f) => [f.dbCol, f.metaKey]))

/** SQLite 行 → 前端契约行（metaKey 键）。 */
export function toContractRow(row) {
  const out = {}
  for (const [dbCol, v] of Object.entries(row)) {
    const k = DB2META.get(dbCol)
    if (k) out[k] = v
  }
  // 审核流（缺陷 A 修复）：模具档案沿用 FStatus 整数列（企业同义），原样透出供前端状态锁，
  // 并合成「单据状态」文本（/detail「其他」块消费）；非 MOLD_FIELDS 字段，不进 /data 列头。
  if (row && row.FStatus !== undefined) {
    out['FStatus'] = String(row.FStatus)
    out['单据状态'] = ({ '1': '已审核', '6': '已关闭' })[String(row.FStatus)] || '创建'
  }
  // 审核人/审核日期（缺陷修复 2026-11-21）：物理列直取透出（前端「其他」块按 FApproverID/FApproverDate 读），不进 /data 列头。
  if (row && row.FCreater !== undefined) out['FCreater'] = row.FCreater
  if (row && row.FApproverID !== undefined) out['FApproverID'] = row.FApproverID
  if (row && row.FApproverDate !== undefined) out['FApproverDate'] = row.FApproverDate
  return out
}

/** 前端契约行（metaKey 键，可含未知键则忽略）→ SQLite 行（dbCol 键）。 */
export function fromContractRow(contract) {
  const out = {}
  for (const [k, v] of Object.entries(contract || {})) {
    const dbCol = META2DB.get(k)
    if (dbCol) out[dbCol] = v === undefined ? null : v
  }
  if (Object.prototype.hasOwnProperty.call(contract || {}, 'FCreater')) out.FCreater = contract.FCreater
  return out
}

/** 字段类型 → 企业版 W_DocumentInfo 的 (FDataType, FInputType) 口径。 */
function dtypeOf(f) {
  switch (f.type) {
    case 'int': return { FDataType: 'Int', FInputType: '手工录入' }
    case 'decimal': return { FDataType: 'Decimal', FInputType: '手工录入' }
    case 'datetime': return { FDataType: 'DateTime', FInputType: '手工录入' }
    case 'date': return { FDataType: 'Date', FInputType: '手工录入' }
    // memo/备注：企业真库 W_DocumentInfo 无 FDataType='Text'、FInputType 无「多行」（见《模具字段类型核对与处理.md》§3 证伪行）
    // → 原生/企业均单行 form-input，前端 isMultiline 判据命中数 0。个人版对齐：单行手工录入，勿引入 textarea。
    case 'memo': return { FDataType: 'Varchar', FInputType: '手工录入' }
    // 图片字段：FDataType='Image' 命中前端 BillForm isImageType（dt.includes('image')）→ 渲染选择/更换/删除缩略图控件。
    case 'image': return { FDataType: 'Image', FInputType: '手工录入' }
    // dict/enum 下拉：采企业 DP 页真实值 '下拉查询选择'（前端 L929 `.includes('下拉')` 恒命中下拉渲染，且与企业 FInputType 值域逐字一致）
    case 'dict': return { FDataType: 'Varchar', FInputType: '下拉查询选择' }
    case 'enum': return { FDataType: 'Varchar', FInputType: '下拉查询选择' }
    default: return { FDataType: 'Varchar', FInputType: '手工录入' }
  }
}

/**
 * 组装与企业版 /filter 返回包同键的元数据（前端 ListView/BillForm 消费契约，
 * dpReadQueries.getFilter 逐键对齐：ok/strFunc/doc/columnCount/info/tabs/filters/
 * actions/convertRules/printTemplates/tpList/message）。
 * 能力裁剪走数据：actions/printTemplates/tpList/convertRules 空数组、doc 打印/审核标志全关——前端自然隐藏（§2.2.2）。
 * @param strFunc 页功能号（个人版仅 203101 模具档案）
 * @param dictOptions 可选 { mold_type: ['冲压模',…], mold_location: […] }，来自 dict_option 实时查询；
 *                    缺省时 dict 字段回落 schema 静态枚举，下拉不通道中断。
 * @param itemOptions 可选 { MDType: [...], MDLocation: [...] }，来自 item 台账启用名称；
 *                    字段声明 itemRef 时优先取此（b9 库位/类型可维护化），dict 作回落兼容。
 */
export function buildFilterMeta(strFunc = '203101', dictOptions = {}, itemOptions = {}, curOrgName = '') {
  const infoRow = (f) => {
    const dt = dtypeOf(f)
    const row = {
      FField: f.metaKey,
      FFieldName: f.title || f.metaKey,
      FType: 'H',
      FTABNumber: 'H',
      FDataType: dt.FDataType,
      FInputType: dt.FInputType,
      FIsMust: f.required ? 1 : 0,
      FDefaultValue: f.showLock ? curOrgName : (f.metaKey === '状态' ? '在库' : (f.default || '')),
      FIsAlter: f.readonly ? 0 : 1,
      FIsAPAlter: 0,
      FDecPlaces: dt.FDataType === 'Decimal' ? 2 : (dt.FDataType === 'Int' ? 0 : -1),
      FLength: dt.FDataType === 'Varchar' ? 256 : 0,
    }
    const opts = (f.itemRef && Array.isArray(itemOptions[f.itemRef])) ? itemOptions[f.itemRef] : ((f.dict && Array.isArray(dictOptions[f.dict])) ? dictOptions[f.dict] : (Array.isArray(f.enum) ? f.enum : null))
    if (opts && opts.length) row._options = opts.map((v) => ({ value: String(v), label: String(v) }))
    return row
  }
  // 筛选面板字段（filters 行=后端 W_Filter 中文键形状；与 info 行按 类型_FTABNumber_数据字段 匹配，
  // buildFilterFields 逐条消费）。制单日期特例：数据字段用内置别名 'FCreateDate' 之外的中文名走 BUILTIN 会
  // 命不中（个人版无 W_DocumentInfo 内置行），直接以普通日期字段下发，前端 _From/_To 拆分后服务端映射 created_at。
  const filterRow = (f) => {
    const dt = dtypeOf(f)
    return { 列名: f.title || f.metaKey, 数据类型: dt.FDataType, 类型: 'H', 数据字段: f.metaKey, FTABNumber: 'H' }
  }
  const byMeta = (k) => MOLD_FIELDS.find((f) => f.metaKey === k)
  return {
    ok: true,
    strFunc,
    doc: {
      FName: '模具档案',
      FTableName: 'T_MD_Mould',
      FIsBody: false,
      FBodyName: '',
      FIsBillStatus: true,
      FIsCloseStatus: false,
      FIsPrint: false,
      FIsBRPrint: false,
      FBRFuncNumber: '',
      FBRFilterStr: '',
      FBRFilterCol: '',
      FDefDatediffType: 'M',
      FDefDatediff: 0,
    },
    // 企业版不变量 columnCount = info.length（set.Info 行数）；隐藏键不进 info 也不计入。
    columnCount: FORM_FIELDS.length,
    // 表头字段不进 info（无 bodyheader 时前端按 Info 行渲染 fgrid，混入会出只读 '—' 死字段）；
    // 创建/更新时间经 /detail head 键 + 「其他」块同源展示。
    info: FORM_FIELDS.map(infoRow),
    tabs: [
      // 键集逐字对齐企业版 W_DocumentTAB 行形状（前端 BillForm L1012 按大写 FTABName 读分区标题）。
      { FTABNumber: 'H', FType: 'H', FTABName: '基本信息', FTableName: 'T_MD_Mould', FIsMust: 0, FIsAlter: 1, FIndex: 1, FBodyIsDel: false, FBodyIsSave: true, FBodyIsVisable: true },
    ],
    filters: ['模具编号', '模具名称', '类型', '状态', '库位', '创建时间'].map((k) => filterRow(byMeta(k))),
    actions: [],
    convertRules: convertRulesFor(strFunc),
    printTemplates: [],
    tpList: [],
    message: '',
  }
}

/** /billinit 出参 value（前端消费 Info/Tab/bodyheader；个人版无表体 → bodyheader 空对象）。 */
export function buildBillInit(strFunc = '203101', dictOptions = {}, itemOptions = {}, curOrgName = '') {
  const meta = buildFilterMeta(strFunc, dictOptions, itemOptions, curOrgName)
  return {
    Info: meta.info,
    List: [meta.doc],
    Tab: meta.tabs,
    Action: [],
    BTF_ConvertRule: [],
    bodyheader: {},
    srcbtn: [],
    pageset: {},
    template: {},
  }
}

/** /data 列头（与企业版 getData head 列逐键同形；width 前端有 MIN_COL_WIDTH 下限兜底）。 */
export function buildDataHead() {
  return LIST_FIELDS.map((f) => {
    const dt = dtypeOf(f)
    return {
      name: f.metaKey,
      title: f.title || f.metaKey,
      fix: '',
      type: 'normal',
      contentTip: true,
      must: f.required === true,
      edit: false,
      hide: false,
      valueType: dt.FDataType,
    }
  })
}

/**
 * /data 服务端过滤的键映射（前端 FilterList.name → mold 物理列）：
 * 中文数据字段键（H_H_xxx / xxx）走 schema 白名单；内置筛选别名 制单日期 对应 created_at。
 * 白名单之外一律拒绝拼接（防注入，W4：未知键如实回 1=0 空结果不静默放宽）。
 */
const LIST_COL_BY_FILTER = new Map([
  ...MOLD_FIELDS.map((f) => [f.metaKey, f.dbCol]),
  ...MOLD_FIELDS.map((f) => [`H_H_${f.metaKey}`, f.dbCol]),
  ['制单日期', 'FCreateDate'],
  ['FCreateDate', 'FCreateDate'],
])

/** T_MD_Mould 主档表全部映射物理列（/data order by 白名单）。 */
export const MOLD_DB_COLS = MOLD_FIELDS.map((f) => f.dbCol)

/** 契约行 → T_MD_Mould 主档物理列名（未知筛选键回 ''，调用方落 1=0）。 */
export function filterColOf(key) {
  return LIST_COL_BY_FILTER.get(String(key)) || LIST_COL_BY_FILTER.get(String(key).replace(/^H_H_/, '').replace(/_(From|To)$/, '')) || ''
}

/** 派生字段：剩余寿命、剩余寿命%、距下次保养模次（详情/列表/预警/手机卡片消费，不落库）。 */
export function withDerived(row) {
  const design = Number(row['设计寿命模次']) || 0
  const used = Number(row['已用模次']) || 0
  const interval = Number(row['保养周期模次']) || 0
  const lastMaint = Number(row['上次保养模次']) || 0
  return {
    ...row,
    剩余寿命: design > 0 ? Math.max(0, design - used) : 0,
    剩余寿命百分比: design > 0 ? Math.max(0, Math.round(((design - used) / design) * 100)) : null,
    距下次保养模次: interval > 0 ? Math.max(0, interval - Math.max(0, used - lastMaint)) : null,
  }
}

