// server/sqlite/personal.pages.js —— 个人版「补齐模具子页」通用实体引擎（v0.4 扩展）
// 设计红线：
//  · 加法扩展——模具 203101 仍走 personal.schema.js 既有绿色路径（71/71 扫雷 + 四探针基线不动），
//    本模块只服务新增子页 strFunc，二者在路由层按 strFunc 分派，互不干扰。
//  · 输出与企业版 /filter、/billinit、/data 逐键同形的 dp 契约包，共享 harness client-src（ListView/BillForm）
//    零前端分叉消费；能力裁剪走数据（actions/printTemplates/convertRules 空、打印关）。
//  · 字段双向映射一律按本表 metaKey↔dbCol 自动翻译，禁手写 switch/if 字段堆（§6 坑 2 同口径）。
//  · 数值性判定以【服务端权威 schema】（每页 numericMetaKeys）为准，不信客户端自报 FDataType（暗雷 1 同族加固）。

// 下推元数据：b9 加法，convertRules 由 personal.push.js 规则表按源页 strFunc 过滤注入（前端「下推」下拉消费）。
import { convertRulesFor } from './personal.push.js'
// 模具主档字段表：仅用于自动扫描 itemRef 引用面（ITEM_BIZ_REFS，基础资料删除保护文案源），不参与本模块页面引擎。
import { MOLD_FIELDS } from './personal.schema.js'

/**
 * @typedef {Object} PageField
 * @property {string} metaKey  前端契约键（中文，与企业 /filter 列名口径一致）
 * @property {string} dbCol    SQLite 物理列
 * @property {string} title    显示标题
 * @property {'text'|'int'|'decimal'|'datetime'|'date'|'memo'|'dict'|'enum'|'item'|'ref'} type
 * @property {boolean} [hidden]   隐藏键（单据内码）：不进 info、不进 list 列定义
 * @property {boolean} [readonly] 只读键：不进 info（新单据不可编辑），随 /detail head 展示
 * @property {boolean} [required] 必填（FIsMust）
 * @property {string[]} [enum]    枚举下拉
 * @property {string} [dict]      dict_option 分类
 * @property {boolean} [moldRef]  下拉取当前模具编号（跨页关联，来自 /data 模具台账实时值）
 * @property {string} [itemRef]   下拉取 item 台账（T_MD_Item 指定类别）启用行名称（如点检/保养项目类型）
 * @property {string} [refOf]     下拉取另一 dp 台账（strFunc）编码列活动记录（如作业计划→方案编码）
 * @property {string} [default]   新单据预填 FDefaultValue
 */

/**
 * @typedef {Object} PageBody 表体页签（第五批表体引擎：对齐企业 W_DocumentTAB FType='B' 形状）
 * @property {string} tab        页签号（'B1'/'B2'，与企业 FTABNumber 同字）
 * @property {string} name       页签显示名（如「点检记录项目」）
 * @property {string} table      SQLite 物理表名（FEntryID 自增 + FInterID 归属，保存语义 delete+insert）
 * @property {PageField[]} fields 表体字段（metaKey=中文契约键，行数据以其为键）
 * @property {boolean} [required] 页签必录（Tab.FIsMust：前端保存前校验至少一行）
 */

/** @type {Record<string, {strFunc:string,name:string,table:string,codeCol?:string,codeLabel?:string,billNoPrefix?:string,fields:PageField[],filterKeys:string[],bodies?:PageBody[]}>} */
export const PAGE_DEFS = {
  '203102': {
    strFunc: '203102',
    name: '部件档案',
    table: 'T_MD_Part',
    codeCol: 'FPartNumber',
    codeLabel: '部件编号',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '部件编号', dbCol: 'FPartNumber', title: '部件编号', type: 'text', required: true },
      { metaKey: '部件名称', dbCol: 'FName', title: '部件名称', type: 'text', required: true },
      { metaKey: '规格', dbCol: 'FModel', title: '规格', type: 'text' },
      { metaKey: '所属模具', dbCol: 'FMouldNumber', title: '所属模具', type: 'text', moldRef: true },
      { metaKey: '部件类型', dbCol: 'FPartType', title: '部件类型', type: 'dict', dict: 'part_type', itemRef: 'MDPartClass' },
      { metaKey: '部件分类', dbCol: 'FPartClass', title: '部件分类', type: 'dict', dict: 'part_class', itemRef: 'MDPartClass' },
      { metaKey: '数量', dbCol: 'qty', title: '数量', type: 'int' },
      { metaKey: '更换周期模次', dbCol: 'replace_cycle_shots', title: '更换周期', type: 'int' },
      { metaKey: '状态', dbCol: 'FMDStatus', title: '状态', type: 'enum', enum: ['在用', '备用', '已更换', '报废'], default: '在用' },
      { metaKey: '备注', dbCol: 'remark', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['部件编号', '部件名称', '所属模具', '部件类型', '状态'],
  },
  '203130': {
    strFunc: '203130',
    name: '报修单',
    table: 'T_MD_Repair',
    billNoPrefix: 'BX',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '报修单号', dbCol: 'FBillNo', title: '报修单号', type: 'text', readonly: true },
      { metaKey: '报修模具', dbCol: 'FMouldNumber', title: '报修模具', type: 'text', required: true, moldRef: true },
      { metaKey: '故障描述', dbCol: 'FFaultDesc', title: '故障描述', type: 'memo', required: true },
      { metaKey: '故障级别', dbCol: 'FFaultLevel', title: '故障级别', type: 'enum', enum: ['一级故障', '二级故障', '三级故障'] },
      { metaKey: '来源类型', dbCol: 'FScType', title: '来源类型', type: 'enum', enum: ['生产异常', '点检异常'] },
      { metaKey: '报修人', dbCol: 'FRPTRepairerEmp', title: '报修人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '报修日期', dbCol: 'FRepairDate', title: '报修日期', type: 'date' },
      { metaKey: '处理状态', dbCol: 'FStatus', title: '处理状态', type: 'enum', enum: ['待处理', '维修中', '已修复', '已关闭'], default: '待处理' },
      { metaKey: '维修负责人', dbCol: 'FHandler', title: '维修负责人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '完成日期', dbCol: 'FFinishDate', title: '完成日期', type: 'date' },
      { metaKey: '处理结果', dbCol: 'FResult', title: '处理结果', type: 'text' },
      { metaKey: '维修费用', dbCol: 'cost', title: '维修费用', type: 'decimal' },
      { metaKey: '备注', dbCol: 'remark', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['报修单号', '报修模具', '处理状态', '报修日期'],
  },
  '203103': {
    strFunc: '203103',
    name: '备件档案',
    table: 'T_MD_Spare',
    codeCol: 'FSpareNumber',
    codeLabel: '备件编号',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '备件编号', dbCol: 'FSpareNumber', title: '备件编号', type: 'text', required: true },
      { metaKey: '备件名称', dbCol: 'FName', title: '备件名称', type: 'text', required: true },
      { metaKey: '备件型号', dbCol: 'FModel', title: '备件型号', type: 'text' },
      { metaKey: '备件属性', dbCol: 'FProperty', title: '备件属性', type: 'dict', dict: 'spare_property' },
      { metaKey: '助记码', dbCol: 'FHelpCode', title: '助记码', type: 'text' },
      { metaKey: '基本单位', dbCol: 'FUnit', title: '基本单位', type: 'dict', dict: 'unit', itemRef: 'MDUnit' },
      { metaKey: '库存数量', dbCol: 'qty', title: '库存数量', type: 'decimal' },
      { metaKey: '单价', dbCol: 'FPrice', title: '单价', type: 'decimal' },
      { metaKey: '币别', dbCol: 'FCurrency', title: '币别', type: 'dict', dict: 'currency', itemRef: 'MDCurrency', enum: ['人民币', '香港元', '欧元', '日本日圆', '新台币元', '英镑', '美元'], default: '人民币' },
      { metaKey: '默认仓库', dbCol: 'FStock', title: '默认仓库', type: 'dict', dict: 'stock', itemRef: 'MDStock' },
      { metaKey: '默认仓位', dbCol: 'FStorageLoc', title: '默认仓位', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
      { metaKey: '供应商', dbCol: 'FSupplier', title: '供应商', type: 'dict', dict: 'supplier', itemRef: 'MDSupplier' },
      { metaKey: '备注', dbCol: 'remark', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['备件编号', '备件名称', '备件属性', '币别'],
  },
  // ---------- 第四批：点检/保养基础资料（企业 g120/g140 的个人精简，均表头单页型） ----------
  '203110': {
    strFunc: '203110',
    name: '点检项目',
    table: 'T_MD_ChkItem',
    codeCol: 'FNumber',
    codeLabel: '点检项目编码',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '点检项目编码', dbCol: 'FNumber', title: '点检项目编码', type: 'text', required: true },
      { metaKey: '点检项目类型', dbCol: 'FChkItemType', title: '点检项目类型', type: 'item', itemRef: 'MDChkItemType' },
      { metaKey: '点检项目', dbCol: 'FChkItem', title: '点检项目', type: 'text', required: true },
      { metaKey: '点检要求', dbCol: 'FChkAsk', title: '点检要求', type: 'text' },
      { metaKey: '说明', dbCol: 'FExplain', title: '说明', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['点检项目编码', '点检项目类型', '点检项目'],
  },
  '203111': {
    strFunc: '203111',
    name: '点检方案',
    table: 'T_MD_ChkSched',
    codeCol: 'FNumber',
    codeLabel: '点检方案编码',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '点检方案编码', dbCol: 'FNumber', title: '点检方案编码', type: 'text', required: true },
      { metaKey: '点检方案名称', dbCol: 'FName', title: '点检方案名称', type: 'text', required: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true },
      { metaKey: '适用机台', dbCol: 'FMach', title: '适用机台(生产中心)', type: 'dict', dict: 'prod_line', itemRef: 'MDProdLine' },
      { metaKey: '方案说明', dbCol: 'FExplain', title: '方案说明', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '点检项目明细', table: 'T_MD_ChkSchedEntry', fields: [
        { metaKey: '点检项目类型', dbCol: 'FChkItemType', title: '点检项目类型', type: 'item', itemRef: 'MDChkItemType' },
        { metaKey: '点检项目编码', dbCol: 'FChkItemNumber', title: '点检项目编码', type: 'text', required: true, refOf: '203110', attach: { 点检项目: 'FChkItem', 点检要求: 'FChkAsk', 点检项目类型: 'FChkItemType' } },
        { metaKey: '点检项目', dbCol: 'FChkItem', title: '点检项目', type: 'text' },
        { metaKey: '点检要求', dbCol: 'FChkAsk', title: '点检要求', type: 'text' },
        { metaKey: '点检标准', dbCol: 'FChkStandard', title: '点检标准', type: 'text' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['点检方案编码', '点检方案名称', '模具编码'],
  },
  '203120': {
    strFunc: '203120',
    name: '保养项目',
    table: 'T_MD_MainItem',
    codeCol: 'FNumber',
    codeLabel: '保养项目编码',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '保养项目编码', dbCol: 'FNumber', title: '保养项目编码', type: 'text', required: true },
      { metaKey: '保养项目类型', dbCol: 'FMainItemType', title: '保养项目类型', type: 'item', itemRef: 'MDMainItemType' },
      { metaKey: '保养项目', dbCol: 'FMainItem', title: '保养项目', type: 'text', required: true },
      { metaKey: '保养要求', dbCol: 'FMainAsk', title: '保养要求', type: 'text' },
      { metaKey: '说明', dbCol: 'FExplain', title: '说明', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['保养项目编码', '保养项目类型', '保养项目'],
  },
  '203121': {
    strFunc: '203121',
    name: '保养方案',
    table: 'T_MD_MainSched',
    codeCol: 'FNumber',
    codeLabel: '保养方案编码',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '保养方案编码', dbCol: 'FNumber', title: '保养方案编码', type: 'text', required: true },
      { metaKey: '保养方案名称', dbCol: 'FName', title: '保养方案名称', type: 'text', required: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true },
      { metaKey: '适用机台', dbCol: 'FMach', title: '适用机台(生产中心)', type: 'dict', dict: 'prod_line', itemRef: 'MDProdLine' },
      { metaKey: '预计周期', dbCol: 'FDueCycle', title: '预计周期(天)', type: 'int' },
      { metaKey: '说明', dbCol: 'FExplain', title: '说明', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '保养项目明细', table: 'T_MD_MainSchedEntry', fields: [
        { metaKey: '保养项目类型', dbCol: 'FMainItemType', title: '保养项目类型', type: 'item', itemRef: 'MDMainItemType' },
        { metaKey: '保养项目编码', dbCol: 'FMainItemNumber', title: '保养项目编码', type: 'text', required: true, refOf: '203120', attach: { 保养项目: 'FMainItem', 保养要求: 'FMainAsk', 保养项目类型: 'FMainItemType' } },
        { metaKey: '保养项目', dbCol: 'FMainItem', title: '保养项目', type: 'text' },
        { metaKey: '保养要求', dbCol: 'FMainAsk', title: '保养要求', type: 'text' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['保养方案编码', '保养方案名称', '模具编码'],
  },
  // ---------- 第五批：维修 + 点检/保养闭环 6 单（表体引擎首批消费页；作业单/作业配置计划已按需求剔除） ----------
  '203114': {
    strFunc: '203114',
    name: '点检任务单',
    table: 'T_MD_CheckTask',
    billNoPrefix: 'RW',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true, attach: { 模具名称: 'FName' } },
      { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
      { metaKey: '点检方案编码', dbCol: 'FScheNumber', title: '点检方案编码', type: 'ref', refOf: '203111', attach: { 点检方案名称: 'FName' } },
      { metaKey: '点检方案名称', dbCol: 'FScheName', title: '点检方案名称', type: 'text' },
      { metaKey: '点检计划开始时间', dbCol: 'FChkPlanStartTime', title: '点检计划开始时间', type: 'date' },
      { metaKey: '点检计划结束时间', dbCol: 'FChkPlanEndTime', title: '点检计划结束时间', type: 'date' },
      { metaKey: '接收人', dbCol: 'FReceiverEmp', title: '接收人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
      { metaKey: '工序编码', dbCol: 'FOperNumber', title: '工序编码', type: 'text' },
      { metaKey: '派工单号', dbCol: 'FWorkNo', title: '派工单号', type: 'text' },
      { metaKey: '来源单据号', dbCol: 'FSourceBillNo', title: '来源单据号', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '点检记录项目', table: 'T_MD_CheckTaskEntry', fields: [
        { metaKey: '点检项目类型', dbCol: 'FChkItemType', title: '点检项目类型', type: 'item', itemRef: 'MDChkItemType' },
        { metaKey: '点检项目编码', dbCol: 'FChkItemNumber', title: '点检项目编码', type: 'ref', refOf: '203110', required: true, attach: { 点检项目: 'FChkItem', 点检要求: 'FChkAsk', 点检项目类型: 'FChkItemType' } },
        { metaKey: '点检项目', dbCol: 'FChkItem', title: '点检项目', type: 'text' },
        { metaKey: '点检要求', dbCol: 'FChkAsk', title: '点检要求', type: 'text' },
        { metaKey: '点检数值', dbCol: 'FChkValue', title: '点检数值', type: 'decimal' },
        { metaKey: '点检结果', dbCol: 'FChkResult', title: '点检结果', type: 'enum', enum: ['通过', '不通过'] },
        { metaKey: '点检标准', dbCol: 'FChkStandard', title: '点检标准', type: 'text' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203116': {
    strFunc: '203116',
    name: '点检记录',
    table: 'T_MD_CheckRecord',
    billNoPrefix: 'JL',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true },
      { metaKey: '来源任务单号', dbCol: 'FSourceBillNo', title: '来源任务单号', type: 'text' },
      { metaKey: '点检方案编码', dbCol: 'FScheNumber', title: '点检方案编码', type: 'ref', refOf: '203111' },
      { metaKey: '点检开始时间', dbCol: 'FChkStartTime', title: '点检开始时间', type: 'date' },
      { metaKey: '点检结束时间', dbCol: 'FChkEndTime', title: '点检结束时间', type: 'date' },
      { metaKey: '执行时长', dbCol: 'FDuration', title: '执行时长', type: 'decimal' },
      { metaKey: '处理人', dbCol: 'FOperatEmp', title: '处理人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '接收人', dbCol: 'FReceiverEmp', title: '接收人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '点检记录项目', table: 'T_MD_CheckRecordEntry', fields: [
        { metaKey: '点检项目类型', dbCol: 'FChkItemType', title: '点检项目类型', type: 'item', itemRef: 'MDChkItemType' },
        { metaKey: '点检项目编码', dbCol: 'FChkItemNumber', title: '点检项目编码', type: 'ref', refOf: '203110', required: true, attach: { 点检项目: 'FChkItem', 点检要求: 'FChkAsk', 点检项目类型: 'FChkItemType' } },
        { metaKey: '点检项目', dbCol: 'FChkItem', title: '点检项目', type: 'text' },
        { metaKey: '点检要求', dbCol: 'FChkAsk', title: '点检要求', type: 'text' },
        { metaKey: '点检数值', dbCol: 'FChkValue', title: '点检数值', type: 'decimal' },
        { metaKey: '点检结果', dbCol: 'FChkResult', title: '点检结果', type: 'enum', enum: ['通过', '不通过'], required: true },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
      { tab: 'B2', name: '物资使用记录', table: 'T_MD_CheckRecordEntry_A', fields: [
        { metaKey: '物资编码', dbCol: 'FMtrlNumber', title: '物资编码', type: 'ref', refOf: '203103', attach: { 物资名称: 'FName', 单位: 'FUnit' } },
        { metaKey: '物资名称', dbCol: 'FMtrlName', title: '物资名称', type: 'text' },
        { metaKey: '物资用量', dbCol: 'FMtrlUseQty', title: '物资用量', type: 'decimal' },
        { metaKey: '单位', dbCol: 'FUnit', title: '单位', type: 'dict', dict: 'unit', itemRef: 'MDUnit' },
      ] },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203124': {
    strFunc: '203124',
    name: '保养任务单',
    table: 'T_MD_MainTask',
    billNoPrefix: 'BY',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true, attach: { 模具名称: 'FName' } },
      { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
      { metaKey: '保养方案编码', dbCol: 'FScheNumber', title: '保养方案编码', type: 'ref', refOf: '203121', attach: { 保养方案名称: 'FName' } },
      { metaKey: '保养方案名称', dbCol: 'FScheName', title: '保养方案名称', type: 'text' },
      { metaKey: '保养计划开始时间', dbCol: 'FMainPlanStartTime', title: '保养计划开始时间', type: 'date' },
      { metaKey: '保养计划结束时间', dbCol: 'FMainPlanEndTime', title: '保养计划结束时间', type: 'date' },
      { metaKey: '接收人', dbCol: 'FReceiverEmp', title: '接收人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
      { metaKey: '工序编码', dbCol: 'FOperNumber', title: '工序编码', type: 'text' },
      { metaKey: '派工单号', dbCol: 'FWorkNo', title: '派工单号', type: 'text' },
      { metaKey: '来源单据号', dbCol: 'FSourceBillNo', title: '来源单据号', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '保养记录项目', table: 'T_MD_MainTaskEntry', fields: [
        { metaKey: '保养项目类型', dbCol: 'FMainItemType', title: '保养项目类型', type: 'item', itemRef: 'MDMainItemType' },
        { metaKey: '保养项目编码', dbCol: 'FMainItemNumber', title: '保养项目编码', type: 'ref', refOf: '203120', required: true, attach: { 保养项目: 'FMainItem', 保养要求: 'FMainAsk', 保养项目类型: 'FMainItemType' } },
        { metaKey: '保养项目', dbCol: 'FMainItem', title: '保养项目', type: 'text' },
        { metaKey: '保养要求', dbCol: 'FMainAsk', title: '保养要求', type: 'text' },
        { metaKey: '保养结果', dbCol: 'FMainResult', title: '保养结果', type: 'enum', enum: ['合格', '不合格'] },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203126': {
    strFunc: '203126',
    name: '保养记录',
    table: 'T_MD_MainRecord',
    billNoPrefix: 'BJ',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true },
      { metaKey: '来源任务单号', dbCol: 'FSourceBillNo', title: '来源任务单号', type: 'text' },
      { metaKey: '保养方案编码', dbCol: 'FScheNumber', title: '保养方案编码', type: 'ref', refOf: '203121' },
      { metaKey: '保养开始时间', dbCol: 'FMainStartTime', title: '保养开始时间', type: 'date' },
      { metaKey: '保养结束时间', dbCol: 'FMainEndTime', title: '保养结束时间', type: 'date' },
      { metaKey: '执行时长', dbCol: 'FDuration', title: '执行时长', type: 'decimal' },
      { metaKey: '处理人', dbCol: 'FOperatEmp', title: '处理人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '接收人', dbCol: 'FReceiverEmp', title: '接收人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '保养记录项目', table: 'T_MD_MainRecordEntry', fields: [
        { metaKey: '保养项目类型', dbCol: 'FMainItemType', title: '保养项目类型', type: 'item', itemRef: 'MDMainItemType' },
        { metaKey: '保养项目编码', dbCol: 'FMainItemNumber', title: '保养项目编码', type: 'ref', refOf: '203120', required: true, attach: { 保养项目: 'FMainItem', 保养要求: 'FMainAsk', 保养项目类型: 'FMainItemType' } },
        { metaKey: '保养项目', dbCol: 'FMainItem', title: '保养项目', type: 'text' },
        { metaKey: '保养要求', dbCol: 'FMainAsk', title: '保养要求', type: 'text' },
        { metaKey: '保养结果', dbCol: 'FMainResult', title: '保养结果', type: 'enum', enum: ['正常', '异常'], required: true },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
      { tab: 'B2', name: '物资使用记录', table: 'T_MD_MainRecordEntry_A', fields: [
        { metaKey: '物资编码', dbCol: 'FMtrlNumber', title: '物资编码', type: 'ref', refOf: '203103', attach: { 物资名称: 'FName', 单位: 'FUnit' } },
        { metaKey: '物资名称', dbCol: 'FMtrlName', title: '物资名称', type: 'text' },
        { metaKey: '物资用量', dbCol: 'FMtrlUseQty', title: '物资用量', type: 'decimal' },
        { metaKey: '单位', dbCol: 'FUnit', title: '单位', type: 'dict', dict: 'unit', itemRef: 'MDUnit' },
      ] },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203131': {
    strFunc: '203131',
    name: '维修任务单',
    table: 'T_MD_ServerTask',
    billNoPrefix: 'RX',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true },
      { metaKey: '来源报修单号', dbCol: 'FRepairBillNo', title: '来源报修单号', type: 'text' },
      { metaKey: '报修内容', dbCol: 'FFaultDesc', title: '报修内容', type: 'memo' },
      { metaKey: '要求完成日期', dbCol: 'FRequireDate', title: '要求完成日期', type: 'date' },
      { metaKey: '接收人', dbCol: 'FReceiverEmp', title: '接收人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '维修类型', dbCol: 'FServerType', title: '维修类型', type: 'enum', enum: ['外部类型', '内部类型'] },
      { metaKey: '维修单位', dbCol: 'FServerUnit', title: '维修单位', type: 'dict', dict: 'supplier', itemRef: 'MDSupplier' },
      { metaKey: '联系人', dbCol: 'FContactEmp', title: '联系人', type: 'text' },
      { metaKey: '联系方式', dbCol: 'FContactWay', title: '联系方式', type: 'text' },
      { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
      { metaKey: '工序编码', dbCol: 'FOperNumber', title: '工序编码', type: 'text' },
      { metaKey: '派工单号', dbCol: 'FWorkNo', title: '派工单号', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203133': {
    strFunc: '203133',
    name: '维修记录',
    table: 'T_MD_Server',
    billNoPrefix: 'WX',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true },
      { metaKey: '来源任务单号', dbCol: 'FSourceBillNo', title: '来源任务单号', type: 'text' },
      { metaKey: '维修类型', dbCol: 'FServerType', title: '维修类型', type: 'enum', enum: ['外部类型', '内部类型'] },
      { metaKey: '维修内容', dbCol: 'FRepairContent', title: '维修内容', type: 'memo' },
      { metaKey: '故障原因', dbCol: 'FReversoContext', title: '故障原因', type: 'enum', enum: ['机械故障', '液压/气动故障', '软件/控制系统故障', '人为操作故障', '环境因素故障', '电气故障'] },
      { metaKey: '报修人', dbCol: 'FRPTRepairerEmp', title: '报修人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '处理人', dbCol: 'FOperatEmp', title: '处理人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '负责人', dbCol: 'FPrincipal', title: '负责人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '维修日期', dbCol: 'FRepairDate', title: '维修日期', type: 'date' },
      { metaKey: '验收日期', dbCol: 'FCheckDate', title: '验收日期', type: 'date' },
      { metaKey: '维修结果', dbCol: 'FResult', title: '维修结果', type: 'enum', enum: ['合格', '不合格'] },
      { metaKey: '维修费用', dbCol: 'FCost', title: '维修费用', type: 'decimal' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '部件领用记录', table: 'T_MD_ServerEntry', fields: [
        { metaKey: '部件编码', dbCol: 'FPartNumber', title: '部件编码', type: 'ref', refOf: '203102', required: true, attach: { 部件名称: 'FName', 规格型号: 'FModel' } },
        { metaKey: '部件名称', dbCol: 'FPartName', title: '部件名称', type: 'text' },
        { metaKey: '规格型号', dbCol: 'FModel', title: '规格型号', type: 'text' },
        { metaKey: '数量', dbCol: 'FQty', title: '数量', type: 'decimal' },
        { metaKey: '单位', dbCol: 'FUnit', title: '单位', type: 'dict', dict: 'unit', itemRef: 'MDUnit' },
        { metaKey: '领用仓库', dbCol: 'FStock', title: '领用仓库', type: 'dict', dict: 'stock', itemRef: 'MDStock' },
        { metaKey: '领用仓位', dbCol: 'FStorageLoc', title: '领用仓位', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
        { metaKey: '领用人', dbCol: 'FPickEmp', title: '领用人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  // ---------- 第六批：业务处理 12 单（203140-149/151/153；5 页带体表，模具编码在体表；7 页纯头，模具编码在头） ----------
  '203140': {
    strFunc: '203140',
    name: '生产申领单',
    table: 'T_MD_PordApply',
    billNoPrefix: 'SL',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '单据类型', dbCol: 'FBillType', title: '单据类型', type: 'enum', enum: ['生产', '维修', '保养', '出厂', '归还'], default: '生产' },
      { metaKey: '领用人', dbCol: 'FApplyEmp', title: '领用人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '领用时间', dbCol: 'FApplyTime', title: '领用时间', type: 'date' },
      { metaKey: '处理人', dbCol: 'FOperatEmp', title: '处理人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '处理时间', dbCol: 'FOperatTime', title: '处理时间', type: 'date' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '生产申领明细', table: 'T_MD_PordApplyEntry', fields: [
        { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true, required: true, attach: { 模具名称: 'FName' } },
        { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
        { metaKey: '存放仓库', dbCol: 'FStock', title: '存放仓库', type: 'dict', dict: 'stock', itemRef: 'MDStock' },
        { metaKey: '存放仓位', dbCol: 'FStorageLoc', title: '存放仓位', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
        { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
        { metaKey: '申领数量', dbCol: 'FApplyQty', title: '申领数量', type: 'decimal' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号'],
  },
  '203141': {
    strFunc: '203141',
    name: '出库申请单',
    table: 'T_MD_OutboundApply',
    billNoPrefix: 'CK',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '单据类型', dbCol: 'FBiiType', title: '单据类型', type: 'enum', enum: ['生产', '维修', '保养', '出厂', '归还'], default: '出厂' },
      { metaKey: '申请人', dbCol: 'FApplyEmp', title: '申请人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '申请时间', dbCol: 'FApplyTime', title: '申请时间', type: 'date' },
      { metaKey: '预计领用时间', dbCol: 'FExReceiveDate', title: '预计领用时间', type: 'date' },
      { metaKey: '预计归还时间', dbCol: 'FExReturn', title: '预计归还时间', type: 'date' },
      { metaKey: '来源单据号', dbCol: 'FSourceBillNo', title: '来源单据号', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '出库申请明细', table: 'T_MD_OutboundApplyEntry', fields: [
        { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true, required: true, attach: { 模具名称: 'FName', 出库模次: 'used_shots' } },
        { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
        { metaKey: '存放仓库', dbCol: 'FStock', title: '存放仓库', type: 'dict', dict: 'stock', itemRef: 'MDStock' },
        { metaKey: '存放仓位', dbCol: 'FStorageLoc', title: '存放仓位', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
        { metaKey: '申领机台', dbCol: 'FMach', title: '申领机台(生产中心)', type: 'dict', dict: 'prod_line', itemRef: 'MDProdLine' },
        { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
        { metaKey: '出库模次', dbCol: 'FOutMDNum', title: '出库模次', type: 'text' },
        { metaKey: '出库申请数量', dbCol: 'FOverLQty', title: '出库申请数量', type: 'decimal' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号'],
  },
  '203142': {
    strFunc: '203142',
    name: '领用记录单',
    table: 'T_MD_PickRecord',
    billNoPrefix: 'LY',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '单据类型', dbCol: 'FBiiType', title: '单据类型', type: 'enum', enum: ['生产', '维修', '保养', '出厂', '归还'], default: '生产' },
      { metaKey: '领用人', dbCol: 'FPickEmp', title: '领用人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee', required: true },
      { metaKey: '领用时间', dbCol: 'FPickTime', title: '领用时间', type: 'date' },
      { metaKey: '处理人', dbCol: 'FOperatEmp', title: '处理人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '处理时间', dbCol: 'FOperatTime', title: '处理时间', type: 'date' },
      { metaKey: '来源单据号', dbCol: 'FSourceBillNo', title: '来源单据号', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '领用明细', table: 'T_MD_PickRecordEntry', fields: [
        { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true, required: true, attach: { 模具名称: 'FName' } },
        { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
        { metaKey: '存放仓库', dbCol: 'FStock', title: '存放仓库', type: 'dict', dict: 'stock', itemRef: 'MDStock' },
        { metaKey: '存放仓位', dbCol: 'FStorageLoc', title: '存放仓位', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
        { metaKey: '申领机台', dbCol: 'FMach', title: '申领机台(生产中心)', type: 'dict', dict: 'prod_line', itemRef: 'MDProdLine' },
        { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
        { metaKey: '实际领用数量', dbCol: 'FPickQty', title: '实际领用数量', type: 'decimal' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号'],
  },
  '203143': {
    strFunc: '203143',
    name: '归还记录单',
    table: 'T_MD_ReturnRecord',
    billNoPrefix: 'GH',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '归还人', dbCol: 'FReturnEmp', title: '归还人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '归还时间', dbCol: 'FReturnTime', title: '归还时间', type: 'date' },
      { metaKey: '处理人', dbCol: 'FOperatEmp', title: '处理人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '处理时间', dbCol: 'FOperatTime', title: '处理时间', type: 'date' },
      { metaKey: '来源单据号', dbCol: 'FSourceBillNo', title: '来源单据号', type: 'text' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '归还明细', table: 'T_MD_ReturnRecordEntry', fields: [
        { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true, required: true, attach: { 模具名称: 'FName', 入库模次: 'used_shots' } },
        { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
        { metaKey: '申领机台', dbCol: 'FMach', title: '申领机台(生产中心)', type: 'dict', dict: 'prod_line', itemRef: 'MDProdLine' },
        { metaKey: '班制', dbCol: 'FShift', title: '班制', type: 'text' },
        { metaKey: '归还数量', dbCol: 'FReturnQty', title: '归还数量', type: 'decimal' },
        { metaKey: '入库模次', dbCol: 'FInMDNum', title: '入库模次', type: 'text' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号'],
  },
  '203146': {
    strFunc: '203146',
    name: '报废单',
    table: 'T_MD_Scrap',
    billNoPrefix: 'BF',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true, attach: { 模具名称: 'FName' } },
      { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
      { metaKey: '报废原因', dbCol: 'FScrapReason', title: '报废原因', type: 'text' },
      { metaKey: '说明', dbCol: 'FExplain', title: '说明', type: 'memo' },
      { metaKey: '单据类型', dbCol: 'FBillType', title: '单据类型', type: 'enum', enum: ['生产', '维修', '保养', '出厂', '归还'] },
      { metaKey: '申请人', dbCol: 'FApplyEmp', title: '申请人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '申请时间', dbCol: 'FApplyTime', title: '申请时间', type: 'date' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203149': {
    strFunc: '203149',
    name: '使用汇报单',
    table: 'T_MD_UseReport',
    billNoPrefix: 'HB',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true, attach: { 模具名称: 'FName', 汇报前模次: 'used_shots' } },
      { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
      { metaKey: '汇报人', dbCol: 'FEmp', title: '汇报人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee', required: true },
      { metaKey: '汇报前模次', dbCol: 'FPreRptNum', title: '汇报前模次', type: 'decimal' },
      { metaKey: '汇报使用模次', dbCol: 'FRptUseNum', title: '汇报使用模次', type: 'decimal' },
      { metaKey: '使用时长', dbCol: 'FUseTime', title: '使用时长', type: 'decimal' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
  '203151': {
    strFunc: '203151',
    name: '盘点记录单',
    table: 'T_MD_Stocktaking',
    billNoPrefix: 'PD',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '盘点日期', dbCol: 'FDate', title: '盘点日期', type: 'date' },
      { metaKey: '盘点人员', dbCol: 'FEmp', title: '盘点人员', type: 'dict', dict: 'employee', itemRef: 'MDEmployee' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    bodies: [
      { tab: 'B1', name: '盘点明细', table: 'T_MD_StocktakingEntry', fields: [
        { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', moldRef: true, required: true, attach: { 模具名称: 'FName' } },
        { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
        { metaKey: '帐存数量', dbCol: 'FAccountQty', title: '帐存数量', type: 'decimal' },
        { metaKey: '盘点数量', dbCol: 'FStocktakQty', title: '盘点数量', type: 'decimal' },
        { metaKey: '盈亏差额', dbCol: 'FDiffQty', title: '盈亏差额', type: 'decimal', readonly: true },
        { metaKey: '存放地点', dbCol: 'FPosition', title: '存放地点', type: 'dict', dict: 'storage_loc', itemRef: 'MDLocation' },
        { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      ] },
    ],
    filterKeys: ['单据编号'],
  },
  '203153': {
    strFunc: '203153',
    name: '状态变更单',
    table: 'T_MD_StatusChange',
    billNoPrefix: 'ZB',
    fields: [
      { metaKey: '使用组织', dbCol: 'FORGID', title: '使用组织', type: 'dict', dict: 'org', itemRef: 'MDOrg', readonly: true, showLock: true },
      { metaKey: '单据内码', dbCol: 'FInterID', title: '内码', type: 'int', hidden: true },
      { metaKey: '单据编号', dbCol: 'FBillNo', title: '单据编号', type: 'text', readonly: true },
      { metaKey: '模具编码', dbCol: 'FMouldNumber', title: '模具编码', type: 'text', required: true, moldRef: true, attach: { 模具名称: 'FName', 当前状态: 'FMDStatus' } },
      { metaKey: '模具名称', dbCol: 'FMouldName', title: '模具名称', type: 'text' },
      { metaKey: '当前状态', dbCol: 'FMDStatus', title: '当前状态', type: 'enum', enum: ['在库', '生产中', '维修中', '保养中', '点检', '报废', '停用', '不在库'] },
      { metaKey: '变更后状态', dbCol: 'FUpdateMDStatus', title: '变更后状态', type: 'enum', enum: ['在库', '生产中', '维修中', '保养中', '点检', '报废', '停用', '不在库'] },
      { metaKey: '接收人', dbCol: 'FReceiverEmp', title: '接收人', type: 'dict', dict: 'employee', itemRef: 'MDEmployee', required: true },
      { metaKey: '接收时间', dbCol: 'FReceiverDate', title: '接收时间', type: 'date' },
      { metaKey: '备注', dbCol: 'FNote', title: '备注', type: 'memo' },
      { metaKey: '创建时间', dbCol: 'FCreateDate', title: '创建时间', type: 'datetime', readonly: true },
      { metaKey: '更新时间', dbCol: 'FModifyTime', title: '更新时间', type: 'datetime', readonly: true },
    ],
    filterKeys: ['单据编号', '模具编码'],
  },
}

/** 本模块是否受理该 strFunc。 */
export const isPageStrFunc = (strFunc) => Object.prototype.hasOwnProperty.call(PAGE_DEFS, String(strFunc))

// ---------- 类型 → 企业版 (FDataType, FInputType) 口径（与 personal.schema.js dtypeOf 同值域） ----------
function dtypeOf(f) {
  switch (f.type) {
    case 'int': return { FDataType: 'Int', FInputType: '手工录入' }
    case 'decimal': return { FDataType: 'Decimal', FInputType: '手工录入' }
    case 'datetime': return { FDataType: 'DateTime', FInputType: '手工录入' }
    case 'date': return { FDataType: 'Date', FInputType: '手工录入' }
    case 'memo': return { FDataType: 'Varchar', FInputType: '手工录入' }
    case 'dict':
    case 'enum': return { FDataType: 'Varchar', FInputType: '下拉查询选择' }
    case 'item':
    case 'ref': return { FDataType: 'Varchar', FInputType: '下拉查询选择' }
    default: return { FDataType: 'Varchar', FInputType: '手工录入' }
  }
}

const LIST_FIELDS = (def) => def.fields.filter((f) => !f.hidden)
// showLock 例外（请求G）：使用组织 readonly（FIsAlter=0 灰锁）但仍进契约展示，与企业 FORGID「可见不可改」同口径；
// 创建/更新时间等纯审计 readonly 字段维持不进契约（走「其他」块）。
const FORM_FIELDS = (def) => def.fields.filter((f) => !f.hidden && (!f.readonly || f.showLock))

/** 每页数值型 metaKey 集合（/save 空数字串不进契约的权威判定源）。 */
export function numericMetaKeys(strFunc) {
  const def = PAGE_DEFS[String(strFunc)]
  if (!def) return new Set()
  return new Set(def.fields.filter((f) => /^(int|decimal)$/.test(f.type)).map((f) => f.metaKey))
}

/**
 * 组装某子页的 /filter 元数据包（与模具 buildFilterMeta 同键同形）。
 * @param strFunc
 * @param ctx {dictOptions, moldNumbers} dict 选项与模具编号实时下拉
 */
export function buildPageFilterMeta(strFunc, { dictOptions = {}, moldNumbers = [], itemOptions = {}, refValues = {}, refRows = {}, moldRows = [], curOrgName = '' } = {}) {
  const def = PAGE_DEFS[String(strFunc)]
  if (!def) return { ok: false, strFunc, message: `未知子页 strFunc：${strFunc}` }
  // 带出目标字段一律只读（主流 ERP 口径：防手改造成「编码与名称/快照不一致」）。
  const headAttachTargets = new Set()
  for (const f of def.fields || []) {
    if (f.attach) for (const k of Object.keys(f.attach)) headAttachTargets.add(k)
  }
  const bodyAttachTargets = {}
  for (const b of def.bodies || []) {
    const s = new Set()
    for (const f of b.fields || []) {
      if (f.attach) for (const k of Object.keys(f.attach)) s.add(k)
    }
    bodyAttachTargets[b.tab] = s
  }
  const infoRow = (f, tab = 'H') => {
    const dt = dtypeOf(f)
    if (f.moldRef) dt.FInputType = '下拉查询选择'
    const isAttachedTarget = tab === 'H' ? headAttachTargets.has(f.metaKey) : !!(bodyAttachTargets[tab] && bodyAttachTargets[tab].has(f.metaKey))
    const row = {
      FField: f.metaKey,
      FFieldName: f.title || f.metaKey,
      FType: tab === 'H' ? 'H' : 'B',
      FTABNumber: tab,
      FDataType: dt.FDataType,
      FInputType: dt.FInputType,
      FIsMust: f.required ? 1 : 0,
      FDefaultValue: f.showLock ? curOrgName : (f.default || ''),
      FIsAlter: (f.readonly || isAttachedTarget) ? 0 : 1,
      FIsAPAlter: 0,
      FDecPlaces: dt.FDataType === 'Decimal' ? 2 : (dt.FDataType === 'Int' ? 0 : -1),
      FLength: dt.FDataType === 'Varchar' ? 256 : 0,
    }
    let opts = null
    let force = false // 引用类字段（模具/item 台账/跨页 ref）恒挂下拉结构，空台账如实空下拉
    // 基础资料 itemRef / 跨页 refOf：台账无行则不挂下拉、自然退化为手工文本（用户口径「取不到就文本」）
    if (f.moldRef) { opts = moldNumbers; force = true }
    else if (f.itemRef) { opts = itemOptions[f.itemRef] || []; force = (opts || []).length > 0 }
    else if (f.refOf) { opts = refValues[f.refOf] || []; force = (opts || []).length > 0 }
    else if (f.dict && Array.isArray(dictOptions[f.dict])) opts = dictOptions[f.dict]
    else if (Array.isArray(f.enum)) opts = f.enum
    if (opts && (force || opts.length)) row._options = opts.map((v) => ({ value: String(v), label: String(v) }))
    else if (f.itemRef || f.refOf) row.FInputType = '手工录入'
    // 表体/表头「选编码带名称」：源编码字段声明 attach（目标 metaKey ← 源台账 dbCol），前端 attachWrites
    //  按 _dropValueName 命中 _dropRows 行、取 FInputInfo 第 2 个 [...] 目标列写入 name（同行/同单目标字段）。
    if (f.attach) {
      const srcTable = f.moldRef ? 'T_MD_Mould' : (PAGE_DEFS[f.refOf] && PAGE_DEFS[f.refOf].table) || ''
      const valueCol = f.moldRef ? 'FMDNumber' : (PAGE_DEFS[f.refOf] && PAGE_DEFS[f.refOf].codeCol) || ''
      const rows = f.moldRef ? moldRows : (refRows[f.refOf] || [])
      if (srcTable && valueCol && Array.isArray(rows)) {
        const attach = {}
        for (const [tgtMeta, srcCol] of Object.entries(f.attach)) {
          attach[tgtMeta] = { FInputType: '已有列属性', FInputInfo: `[${srcTable}].[${srcCol}]`, name: tgtMeta }
        }
        row._attach = attach
        row._dropRows = rows
        row._dropValueName = valueCol
      }
    }
    return row
  }
  const bodyList = def.bodies || []
  const bodyFields = (b) => b.fields.filter((f) => !f.hidden)
  const info = [...FORM_FIELDS(def).map((f) => infoRow(f)), ...bodyList.flatMap((b) => bodyFields(b).map((f) => infoRow(f, b.tab)))]
  const filterRow = (f) => {
    const dt = dtypeOf(f)
    return { 列名: f.title || f.metaKey, 数据类型: dt.FDataType, 类型: 'H', 数据字段: f.metaKey, FTABNumber: 'H' }
  }
  const byMeta = (k) => def.fields.find((f) => f.metaKey === k)
  return {
    ok: true,
    strFunc,
    doc: {
      FName: def.name,
      FTableName: def.table,
      FIsBody: bodyList.length > 0,
      FBodyName: bodyList.map((b) => b.name).join(','),
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
    columnCount: info.length,
    info,
    tabs: [
      { FTABNumber: 'H', FType: 'H', FTABName: '基本信息', FTableName: def.table, FIsMust: 0, FIsAlter: 1, FIndex: 1, FBodyIsDel: false, FBodyIsSave: true, FBodyIsVisable: true },
      ...bodyList.map((b, i) => ({ FTABNumber: b.tab, FType: 'B', FTABName: b.name, FTableName: b.table, FIsMust: b.required ? 1 : 0, FIsAlter: 1, FIndex: i + 2, FBodyIsDel: false, FBodyIsSave: true, FBodyIsVisable: true })),
    ],
    filters: def.filterKeys.map((k) => byMeta(k)).filter(Boolean).map(filterRow),
    actions: [],
    convertRules: convertRulesFor(strFunc),
    printTemplates: [],
    tpList: [],
    message: '',
  }
}

/** /billinit 出参 value（同模具形状：Info/List/Tab + 表体 bodyheader + 空能力位）。 */
export function buildPageBillInit(strFunc, ctx) {
  const meta = buildPageFilterMeta(strFunc, ctx)
  const def = PAGE_DEFS[String(strFunc)]
  const bodyheader = {}
  // 表体列定义（企业 getDPAddPageInit head[FTABNumber] 同形：name=FField、title=FFieldName）；
  // _options 直挂列上（前端 editable 态下拉消费 c._options，Info B 行同步携带，两路同源）。
  if (meta.ok && def) {
    for (const b of def.bodies || []) {
      bodyheader[b.tab] = b.fields.filter((f) => !f.hidden).map((f) => {
        const row = meta.info.find((it) => it.FType === 'B' && it.FTABNumber === b.tab && it.FField === f.metaKey) || {}
        return {
          name: f.metaKey,
          ffield: row.FFieldName || f.title || f.metaKey,
          title: row.FFieldName || f.title || f.metaKey,
          fix: '',
          type: 'edit',
          contentTip: 'true',
          edit: row.FIsAlter ?? (f.readonly ? 0 : 1),
          must: row.FIsMust ?? (f.required ? 1 : 0),
          hide: false,
          valueType: row.FDataType || dtypeOf(f).FDataType,
          FInputType: row.FInputType || dtypeOf(f).FInputType,
          FInputInfo: '',
          FDecPlaces: row.FDecPlaces ?? -1,
          FLength: row.FLength ?? 0,
          FIsAPAlter: 0,
          ...(Array.isArray(row._options) ? { _options: row._options } : {}),
        }
      })
    }
  }
  return {
    Info: meta.info,
    List: [meta.doc],
    Tab: meta.tabs,
    Action: [],
    BTF_ConvertRule: [],
    bodyheader,
    srcbtn: [],
    pageset: {},
    template: {},
  }
}

/** /data 列头（同 buildDataHead 逐键）。 */
export function buildPageDataHead(strFunc) {
  const def = PAGE_DEFS[String(strFunc)]
  return LIST_FIELDS(def).map((f) => {
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

// ---------- 契约行 ↔ 物理行 双向翻译（按 def.fields） ----------
function meta2db(def) { const m = new Map(); for (const f of def.fields) m.set(f.metaKey, f.dbCol); return m }
function db2meta(def) { const m = new Map(); for (const f of def.fields) m.set(f.dbCol, f.metaKey); return m }

/** 契约行（metaKey）→ 物理行（dbCol，仅已知键、undefined→null）。 */
export function pageContractToRow(strFunc, contract) {
  const def = PAGE_DEFS[String(strFunc)]
  const map = meta2db(def)
  const out = {}
  for (const [k, v] of Object.entries(contract || {})) {
    const col = map.get(k)
    if (col) out[col] = v === undefined ? null : v
  }
  if (Object.prototype.hasOwnProperty.call(contract || {}, 'FCreater')) out.FCreater = contract.FCreater
  return out
}

/** 物理行（dbCol）→ 契约行（metaKey）。 */
export function pageRowToContract(strFunc, row) {
  const def = PAGE_DEFS[String(strFunc)]
  const map = db2meta(def)
  const out = {}
  for (const [col, v] of Object.entries(row || {})) {
    const k = map.get(col)
    if (k) out[k] = v
  }
  // 审核流（缺陷 A 修复 + UX 需求 2026-11-22）：单据类页与被下游带出的基础资料页把物理列 FBillState 以契约键 FStatus 透出（前端状态锁消费），
  // 并合成「单据状态」文本（/detail「其他」块）；不出现在 /data 列头，不参与字段翻译白名单。
  if (auditableColOf(strFunc) === 'FBillState' && row && row.FBillState !== undefined) {
    out['FStatus'] = String(row.FBillState)
    out['单据状态'] = BILL_STATE_TEXT[String(row.FBillState)] || BILL_STATE_TEXT['0']
  }
  // 审核人/审核日期（缺陷修复 2026-11-21）：物理列直取透出（前端「其他」块按 FApproverID/FApproverDate 读），不进 /data 列头。
  if (row && row.FCreater !== undefined) out['FCreater'] = row.FCreater
  if (row && row.FApproverID !== undefined) out['FApproverID'] = row.FApproverID
  if (row && row.FApproverDate !== undefined) out['FApproverDate'] = row.FApproverDate
  return out
}

/** 可插入/更新列白名单（排除主键、审计时间、软删、封面等非契约列；只写 def 声明的 editable 业务列）。 */
export function pageColsInsert(strFunc) {
  const def = PAGE_DEFS[String(strFunc)]
  const skip = new Set(['FInterID', 'FCreateDate', 'FModifyTime', 'deleted_at', 'FBillNo'])
  return [...new Set([...def.fields.map((f) => f.dbCol), 'FCreater'])].filter((c) => !skip.has(c))
}

/** 单据状态文本（企业 FStatus 整数语义 → 中文，前端「其他」块/stag 直接消费）。 */
export const BILL_STATE_TEXT = { '0': '创建', '1': '已审核', '6': '已关闭' }

/**
 * 被下游 refOf「选中带出」引用的基础资料页集合（动态派生，随 PAGE_DEFS 演进）：
 * 这类档案须审核后方可被下游单据带出（UX 需求 2026-11-22），故与单据页同为可审核页，用 FBillState。
 */
const AUDITABLE_ARCHIVE = (() => {
  const set = new Set()
  for (const def of Object.values(PAGE_DEFS)) {
    const all = [...(def.fields || []), ...(def.bodies || []).flatMap((b) => b.fields || [])]
    for (const f of all) if (f.refOf) set.add(String(f.refOf))
  }
  return set
})()
export function isAuditableArchive(strFunc) { return AUDITABLE_ARCHIVE.has(String(strFunc)) }

/**
 * 审核态物理列定位（缺陷 A 修复 + UX 需求 2026-11-22）：模具档案 203101 用既有 FStatus（企业同义整数列）；
 * 单据类子页（billNoPrefix）与被下游 refOf 带出的基础资料页用 FBillState；其余档案类页不可审核回 ''。
 */
export function auditableColOf(strFunc) {
  const s = String(strFunc)
  if (s === '203101') return 'FStatus'
  const def = PAGE_DEFS[s]
  if (def && def.billNoPrefix) return 'FBillState'
  if (AUDITABLE_ARCHIVE.has(s)) return 'FBillState'
  return ''
}

/**
 * 审核态下游引用登记表（删除/反审核保护，企业「源单被引用禁止反审核/删除」同义）：
 * 源 strFunc → 目标 [{table, col(=源单号列 或 源编码列), match, entry?}]，match 声明拿源单的哪个值去比；
 * entry:true 时引用列在表体行表（需 join 头表排软删）。
 * 模具档案按编号被引用，单据链按单号被引用（下推/回指列落库，b5/b9 既有列名零新增）。
 */
export const BILL_DOWNSTREAM_REFS = {
  '203101': [
    { table: 'T_MD_Part', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_ChkSched', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_MainSched', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_Repair', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_CheckTask', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_CheckRecord', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_MainTask', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_MainRecord', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_ServerTask', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_Server', col: 'FMouldNumber', match: 'code' },
    // 业务处理：申领/出库/领用/归还/盘点在表体行，报废/使用汇报/状态变更在表头
    { table: 'T_MD_PordApplyEntry', head: 'T_MD_PordApply', col: 'FMouldNumber', match: 'code', entry: true },
    { table: 'T_MD_OutboundApplyEntry', head: 'T_MD_OutboundApply', col: 'FMouldNumber', match: 'code', entry: true },
    { table: 'T_MD_PickRecordEntry', head: 'T_MD_PickRecord', col: 'FMouldNumber', match: 'code', entry: true },
    { table: 'T_MD_ReturnRecordEntry', head: 'T_MD_ReturnRecord', col: 'FMouldNumber', match: 'code', entry: true },
    { table: 'T_MD_Scrap', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_UseReport', col: 'FMouldNumber', match: 'code' },
    { table: 'T_MD_StocktakingEntry', head: 'T_MD_Stocktaking', col: 'FMouldNumber', match: 'code', entry: true },
    { table: 'T_MD_StatusChange', col: 'FMouldNumber', match: 'code' },
  ],
  '203102': [{ table: 'T_MD_ServerEntry', head: 'T_MD_Server', col: 'FPartNumber', match: 'code', entry: true }],
  '203103': [
    { table: 'T_MD_CheckRecordEntry_A', head: 'T_MD_CheckRecord', col: 'FMtrlNumber', match: 'code', entry: true },
    { table: 'T_MD_MainRecordEntry_A', head: 'T_MD_MainRecord', col: 'FMtrlNumber', match: 'code', entry: true },
  ],
  '203110': [
    { table: 'T_MD_ChkSchedEntry', head: 'T_MD_ChkSched', col: 'FChkItemNumber', match: 'code', entry: true },
    { table: 'T_MD_CheckTaskEntry', head: 'T_MD_CheckTask', col: 'FChkItemNumber', match: 'code', entry: true },
    { table: 'T_MD_CheckRecordEntry', head: 'T_MD_CheckRecord', col: 'FChkItemNumber', match: 'code', entry: true },
  ],
  '203111': [
    { table: 'T_MD_CheckTask', col: 'FScheNumber', match: 'code' },
    { table: 'T_MD_CheckRecord', col: 'FScheNumber', match: 'code' },
  ],
  '203120': [
    { table: 'T_MD_MainSchedEntry', head: 'T_MD_MainSched', col: 'FMainItemNumber', match: 'code', entry: true },
    { table: 'T_MD_MainTaskEntry', head: 'T_MD_MainTask', col: 'FMainItemNumber', match: 'code', entry: true },
    { table: 'T_MD_MainRecordEntry', head: 'T_MD_MainRecord', col: 'FMainItemNumber', match: 'code', entry: true },
  ],
  '203121': [
    { table: 'T_MD_MainTask', col: 'FScheNumber', match: 'code' },
    { table: 'T_MD_MainRecord', col: 'FScheNumber', match: 'code' },
  ],
  '203130': [{ table: 'T_MD_ServerTask', col: 'FRepairBillNo', match: 'billNo' }],
  '203114': [{ table: 'T_MD_CheckRecord', col: 'FSourceBillNo', match: 'billNo' }],
  '203124': [{ table: 'T_MD_MainRecord', col: 'FSourceBillNo', match: 'billNo' }],
  '203131': [{ table: 'T_MD_Server', col: 'FSourceBillNo', match: 'billNo' }],
  '203140': [{ table: 'T_MD_OutboundApply', col: 'FSourceBillNo', match: 'billNo' }],
  '203141': [{ table: 'T_MD_PickRecord', col: 'FSourceBillNo', match: 'billNo' }],
  '203142': [{ table: 'T_MD_ReturnRecord', col: 'FSourceBillNo', match: 'billNo' }],
}

/** /data 服务端过滤键 → 物理列（含 H_H_ 前缀与日期 From/To 拆分，同 mold filterColOf 口径）。 */
export function pageFilterColOf(strFunc, key) {
  const def = PAGE_DEFS[String(strFunc)]
  const map = new Map()
  for (const f of def.fields) { map.set(f.metaKey, f.dbCol); map.set(`H_H_${f.metaKey}`, f.dbCol) }
  const k = String(key)
  const hit = map.get(k) || map.get(k.replace(/^H_H_/, '').replace(/_(From|To)$/, ''))
  if (hit) return hit
  // 前端首屏固定下发「制单日期_From/To」（企业 DP.cs 口径）：各表均有 FCreateDate 物理列但非 PAGE_DEFS 字段，
  // 无特例则落 1=0 列表永空（2026-11-19 走查缺陷 B，同 mold LIST_COL_BY_FILTER ['制单日期','FCreateDate'] 口径）。
  if (k === '制单日期' || k === 'FCreateDate') return 'FCreateDate'
  return ''
}

/** 报修/点检保养单据号生成（档案页无单据号，返回 ''）。 */
export function pageBillNo(def, id, now) {
  if (!def.billNoPrefix) return ''
  const d = now instanceof Date ? now : new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${def.billNoPrefix}${ymd}${String(id).padStart(4, '0')}`
}

// ---------- 表体（第五批表体引擎）：页签定义查找 + 行双向翻译（权威与头同族，不信客户端） ----------

/** 取某页某页签的表体定义（无则 null）。 */
export function getPageBodyDef(strFunc, tab) {
  const def = PAGE_DEFS[String(strFunc)]
  return ((def && def.bodies) || []).find((b) => b.tab === String(tab)) || null
}

/** 表体物理行（dbCol）→ 契约行（metaKey）；FEntryID/FInterID 不进契约（行定位按数组序，同企业 delete+insert 语义）。 */
export function pageBodyRowToContract(strFunc, tab, row) {
  const b = getPageBodyDef(strFunc, tab)
  if (!b) return {}
  const out = {}
  for (const f of b.fields) {
    if (f.dbCol === 'FInterID' || f.dbCol === 'FEntryID') continue
    if (Object.prototype.hasOwnProperty.call(row, f.dbCol)) out[f.metaKey] = row[f.dbCol]
  }
  if (String(strFunc) === '203151' && String(tab) === 'B1') {
    const acc = Number(out['帐存数量']) || 0
    const act = Number(out['盘点数量']) || 0
    out['盈亏差额'] = Number((act - acc).toFixed(4))
  }
  return out
}

/** 表体契约行（metaKey）→ 物理行（dbCol，仅已知键）；数值空串不进行（走 schema DEFAULT，头同族加固）。 */
export function pageBodyContractToRow(strFunc, tab, contract) {
  const b = getPageBodyDef(strFunc, tab)
  if (!b) throw new Error(`未知表体页签：${strFunc}/${tab}`)
  const out = {}
  for (const [k, v] of Object.entries(contract || {})) {
    const f = b.fields.find((x) => x.metaKey === k)
    if (!f || f.dbCol === 'FInterID' || f.dbCol === 'FEntryID') continue
    if (v === '' && /^(int|decimal)$/.test(f.type)) continue
    out[f.dbCol] = v === undefined ? null : v
  }
  if (String(strFunc) === '203151' && String(tab) === 'B1') {
    const acc = Number(out.FAccountQty) || 0
    const act = Number(out.FStocktakQty) || 0
    out.FDiffQty = Number((act - acc).toFixed(4))
  }
  return out
}

/** 表体必填校验集（服务端权威）：返回 [{metaKey,title}]；数值空串已被 ContractToRow 剔除，两者合并判「缺失或空」。 */
export function pageBodyRequired(strFunc, tab) {
  const b = getPageBodyDef(strFunc, tab)
  if (!b) return []
  return b.fields.filter((f) => f.required).map((f) => ({ metaKey: f.metaKey, title: f.title || f.metaKey, numeric: /^(int|decimal)$/.test(f.type) }))
}

/**
 * 物理表名 → 业务页名（提示文案专用）：面向车间用户的报错不得出现 T_MD_* 表名（企业版同口径）。
 * 表体行表按其属主页命名（用户视角是「点检记录单里引用了它」，不是「T_MD_CheckRecordEntry」）。
 */
export const BILL_TABLE_NAMES = (() => {
  const m = { T_MD_Mould: '模具档案', T_MD_Item: '基础资料' }
  for (const def of Object.values(PAGE_DEFS)) {
    m[def.table] = def.name
    for (const b of def.bodies || []) m[b.table] = def.name
  }
  return m
})()

/**
 * 基础资料（T_MD_Item 类别）被业务数据的引用面：不手写清单——以各页 schema 已声明的 `itemRef`
 * 为唯一权威源自动扫描（itemRef 下拉落库存的是台账【名称】文本，与全链同口径），
 * 新增页/字段声明 itemRef 即自动纳入删除拦截，杜绝「登记表与 schema 两套事实」脱节。
 * head 非空表示引用列在表体行表（行表无软删列，须 join 头表排软删，同 BILL_DOWNSTREAM_REFS 口径）。
 * 消费方：personal.item.js /itemdo delete ——「仍被使用的档案不能删，请改用禁用」。
 */
export const ITEM_BIZ_REFS = (() => {
  const idx = {}
  const add = (itemType, table, col, head) => {
    const list = idx[itemType] || (idx[itemType] = [])
    if (!list.some((r) => r.table === table && r.col === col)) list.push({ table, col, head })
  }
  for (const f of MOLD_FIELDS) if (f.itemRef) add(f.itemRef, 'T_MD_Mould', f.dbCol, '')
  for (const def of Object.values(PAGE_DEFS)) {
    for (const f of def.fields) if (f.itemRef) add(f.itemRef, def.table, f.dbCol, '')
    for (const b of def.bodies || []) for (const f of b.fields) if (f.itemRef) add(f.itemRef, b.table, f.dbCol, def.table)
  }
  // 基础资料自身的组织归属列同为组织名称文本；MDOrg 不在 itemRef 扫描面（无父台账），手工补登记
  add('MDOrg', 'T_MD_Item', 'FORGID', '')
  return idx
})()



