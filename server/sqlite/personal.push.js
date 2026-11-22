// server/sqlite/personal.push.js —— 个人版下推（pushdown / DPToNextOrder_Do）元数据 + 执行器
// 设计红线：
//  · 加法扩展——本模块只提供 convertRules 元数据（注入 /filter 供前端「下推」下拉消费）与
//    buildPushNextRow 执行器（/pushdo 路由消费），不改任何页既有 schema/引擎；与企业 pushdo 契约逐键同形。
//  · 契约（权威源 client-src）：请求 {strFunc, FRuleID, FTargetFormNumber, Rows}（Rows=选中源行对象，含「单据内码」）；
//    出参 {ok, value:NextRow}，NextRow={H:[headObj], [tab]:[bodyRows]}，headObj/bodyRows 一律按【目标 metaKey（中文契约键）】键
//    （ListView doPush→onOpenBill prefill.head=H[0]/body=v；BillForm prefill 覆盖 headForm/bodyForm 按目标 Info.FField 对齐）。
//  · 字段映射一律显式声明 headMap/bodyMap（目标←源），禁在路由里手写 switch/if；源表体不存在即不产该页签（如实空）。
//  · 自包含：不 import personal.pages.js / personal.schema.js（避免与 convertRules 注入点形成循环依赖），
//    仅依赖调用方注入的 adapter（getMold/getPage/getPageBodies 契约行方法）。

/**
 * @typedef {Object} PushRule
 * @property {string} FRuleID            规则号（前端 convertRules key / doPush 上送）
 * @property {string} src                源 strFunc（下发起点页）
 * @property {string} tgt                目标 strFunc（生成单据页 = FTargetFormNumber）
 * @property {string} tgtName            目标显示名（前端标签「生成${tgtName}」= FTargetName）
 * @property {Record<string,string>} headMap 目标表头 metaKey ← 源表头 metaKey
 * @property {Record<string, Record<string,string>>} [bodyMap] 目标页签 → {目标体 metaKey ← 源体 metaKey}
 */

/** @type {PushRule[]} */
export const PUSH_RULES = [
  // —— 维修主线：模具 → 报修 → 维修任务 → 维修记录 ——
  { FRuleID: 'R1', src: '203101', tgt: '203130', tgtName: '报修单', headMap: { 报修模具: '模具编号' } },
  { FRuleID: 'R2', src: '203130', tgt: '203131', tgtName: '维修任务单', headMap: { 模具编码: '报修模具', 来源报修单号: '报修单号', 报修内容: '故障描述' } },
  { FRuleID: 'R3', src: '203131', tgt: '203133', tgtName: '维修记录', headMap: { 模具编码: '模具编码', 来源任务单号: '单据编号', 维修内容: '报修内容', 负责人: '接收人' } },
  // —— 点检链：点检方案 → 点检任务 → 点检记录 ——
  { FRuleID: 'R4', src: '203111', tgt: '203114', tgtName: '点检任务单', headMap: { 模具编码: '模具编码', 点检方案编码: '点检方案编码' } },
  {
    FRuleID: 'R5', src: '203114', tgt: '203116', tgtName: '点检记录',
    headMap: { 模具编码: '模具编码', 点检方案编码: '点检方案编码', 来源任务单号: '单据编号' },
    bodyMap: { B1: { 点检项目类型: '点检项目类型', 点检项目编码: '点检项目编码', 点检项目: '点检项目', 点检要求: '点检要求', 点检数值: '点检数值', 点检结果: '点检结果', 备注: '备注' } },
  },
  // —— 保养链：保养方案 → 保养任务 → 保养记录 ——
  { FRuleID: 'R6', src: '203121', tgt: '203124', tgtName: '保养任务单', headMap: { 模具编码: '模具编码', 保养方案编码: '保养方案编码' } },
  {
    FRuleID: 'R7', src: '203124', tgt: '203126', tgtName: '保养记录',
    headMap: { 模具编码: '模具编码', 保养方案编码: '保养方案编码', 来源任务单号: '单据编号' },
    bodyMap: { B1: { 保养项目类型: '保养项目类型', 保养项目编码: '保养项目编码', 保养项目: '保养项目', 保养要求: '保养要求', 保养结果: '保养结果', 备注: '备注' } },
  },
  // —— 物料/业务链：生产申领 → 出库申请 → 领用记录 → 归还记录 ——
  {
    FRuleID: 'R8', src: '203140', tgt: '203141', tgtName: '出库申请单',
    headMap: { 申请人: '领用人', 申请时间: '领用时间' },
    bodyMap: { B1: { 模具编码: '模具编码', 模具名称: '模具名称', 出库申请数量: '申领数量' } },
  },
  {
    FRuleID: 'R9', src: '203141', tgt: '203142', tgtName: '领用记录单',
    headMap: { 领用人: '申请人', 领用时间: '申请时间' },
    bodyMap: { B1: { 模具编码: '模具编码', 模具名称: '模具名称', 实际领用数量: '出库申请数量' } },
  },
  {
    FRuleID: 'R10', src: '203142', tgt: '203143', tgtName: '归还记录单',
    headMap: { 归还人: '领用人', 归还时间: '领用时间' },
    bodyMap: { B1: { 模具编码: '模具编码', 模具名称: '模具名称', 归还数量: '实际领用数量' } },
  },
]

/**
 * 某源页可用的下推规则（注入 /filter.convertRules，前端 ListView「下推」下拉消费）。
 * @param strFunc 源页 strFunc
 * @returns {{FRuleID:string,FTargetFormNumber:string,FTargetName:string}[]}
 */
export function convertRulesFor(strFunc) {
  const src = String(strFunc)
  return PUSH_RULES.filter((r) => r.src === src)
    .map((r) => ({ FRuleID: r.FRuleID, FTargetFormNumber: r.tgt, FTargetName: r.tgtName }))
}

/** 契约行取内码：单据内码（metaKey）优先，回落 FInterID。 */
function rowIdOf(row) {
  if (!row || typeof row !== 'object') return ''
  return String(row['单据内码'] ?? row.FInterID ?? '')
}

/** 按 map（目标←源）从源对象挑值，仅落非空键（缺省=不预填，目标走自身默认）。 */
function pickByMap(src, map) {
  const out = {}
  for (const [tgtKey, srcKey] of Object.entries(map)) {
    const v = src[srcKey]
    if (v !== undefined && v !== null && v !== '') out[tgtKey] = v
  }
  return out
}

/**
 * 执行下推：载入源单据契约行（含表体），按规则映射生成目标新单据预填包 NextRow。
 * 失败一律如实上抛（W4），由 /pushdo 路由转 {ok:false,message}。
 * @param adapter PersonalSqliteAdapter
 * @param source {strFunc, FRuleID, FTargetFormNumber, Rows}
 * @returns {{H:Record<string,unknown>[],[tab:string]:unknown[]}}
 */
export function buildPushNextRow(adapter, source) {
  const strFunc = String(source && source.strFunc || '')
  const ruleId = String(source && source.FRuleID || '')
  const rule = PUSH_RULES.find((r) => r.src === strFunc && r.FRuleID === ruleId)
  if (!rule) throw new Error('未知下推规则，请刷新页面后重试')
  const rows = Array.isArray(source.Rows) ? source.Rows : []
  const fid = rowIdOf(rows[0])
  if (fid === '') throw new Error('请先选择要下推的源单据行')
  const isMoldSrc = rule.src === '203101'
  const srcRow = isMoldSrc ? adapter.getMold(fid) : adapter.getPage(rule.src, fid)
  if (!srcRow) throw new Error('源单据不存在或已被删除')
  const next = { H: [pickByMap(srcRow, rule.headMap)] }
  if (rule.bodyMap) {
    const srcBodies = isMoldSrc ? {} : adapter.getPageBodies(rule.src, fid)
    for (const [tab, map] of Object.entries(rule.bodyMap)) {
      const srcRows = Array.isArray(srcBodies[tab]) ? srcBodies[tab] : []
      next[tab] = srcRows.map((r) => pickByMap(r, map))
    }
  }
  return next
}
