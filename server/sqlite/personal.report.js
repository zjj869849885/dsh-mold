// server/sqlite/personal.report.js —— 个人版报表引擎（第七批，C001-C015 本地 SQLite 重算）
//
// 契约对齐：出参逐键镜像企业 localApi.report / Host /report（见 docs 基准 + 企业侧 reportQueries.js），
//   前端 client-src/pages/ReportView.tsx（个人版已编译进 client.js，form=report/reportmulti 分派）消费：
//   { ok, head:[{name,title,valueType,align?,width?}], data:[行按 head.name 键], totalCount,
//     reportFilter:[{序号,关键字,标题,数据类型,...}], funcSetes:[{FISDEL,FISSave,FIsPrint}], actions:[],
//     [多页签] RptTABGroup:[{FGroupNumber,FGroupName}], RptTAB:[{FTABNumber,FTABName,FGroupNumber}] }
//   /reportdetail：{ ok, data:[行按中文列名键] }（前端按首行 Object.keys 派生明细列）。
//
// 企业差异（个人版口径）：数据源 = 本地 SQLite 业务表（001-007），非 ERP 跨库/存储过程；
//   过滤在 SQL 参数化执行（不做企业 W_RptList.FSQL 字面量替换，规避 date 转换暗雷）；
//   写操作（保存/删除）与企业报表一致不开放（funcSetes 全 false）；引出/打印属后续批（此处 FIsPrint=false）。
// 失败一律如实上抛为 {ok:false,message}（W4），不做防御性兜底、不伪造行集。

/** dtfilter（前端 {关键字:值} 单值对象）→ WHERE 片段 + 参数。mode: from/to(日期界)/like/eq。 */
function mkWhere(filters, f) {
  const parts = []
  const params = []
  for (const fl of filters || []) {
    const raw = f[fl.key]
    const s = raw == null ? '' : String(raw).trim()
    if (s === '') continue
    if (fl.mode === 'from') { parts.push(`date(${fl.col}) >= date(?)`); params.push(s) }
    else if (fl.mode === 'to') { parts.push(`date(${fl.col}) <= date(?)`); params.push(s) }
    else if (fl.mode === 'like') { parts.push(`${fl.col} LIKE ?`); params.push(`%${s}%`) }
    else if (fl.mode === 'eq') { parts.push(`${fl.col} = ?`); params.push(s) }
  }
  return { clause: parts.length ? ` and ${parts.join(' and ')}` : '', params }
}

const dt = (key, title, col, mode) => ({ key, title, type: 'date', col, mode })
const tx = (key, title, col) => ({ key, title, type: 'text', col, mode: 'like' })
// 通用三条件：起止日期（制单/记录时间）+ 模具编码
const dateMold = (dateCol, moldCol = 'h.FMouldNumber') => [dt('开始日期', '开始日期', dateCol, 'from'), dt('结束日期', '结束日期', dateCol, 'to'), tx('模具编码', '模具编码', moldCol)]

const COL = (name, opt = {}) => ({ name, title: opt.title || name, num: !!opt.num, align: opt.align })
// 单表页公共列（末列创建时间）
const CREATED = COL('创建时间')

export const REPORT_DEFS = {
  // —— C001 点检报表（T_MD_CheckRecord 记录头 + 模具名带出）——
  C001: {
    name: '点检报表', form: 'report',
    filters: dateMold('h.FCreateDate'),
    columns: [COL('记录单号'), COL('模具编码'), COL('模具名称'), COL('点检方案'), COL('点检开始时间'), COL('点检结束时间'), COL('执行时长'), COL('处理人'), CREATED],
    select: `select h.FBillNo as 记录单号, h.FMouldNumber as 模具编码, m.FName as 模具名称, h.FScheNumber as 点检方案,
      h.FChkStartTime as 点检开始时间, h.FChkEndTime as 点检结束时间, h.FDuration as 执行时长, h.FHandler as 处理人, h.FCreateDate as 创建时间`,
    from: `from T_MD_CheckRecord h left join T_MD_Mould m on m.FMDNumber = h.FMouldNumber and m.deleted_at is null where h.deleted_at is null`,
    order: 'order by h.FInterID desc',
  },
  // —— C002 保养报表（T_MD_MainRecord）——
  C002: {
    name: '保养报表', form: 'report',
    filters: dateMold('h.FCreateDate'),
    columns: [COL('记录单号'), COL('模具编码'), COL('模具名称'), COL('保养方案'), COL('保养开始时间'), COL('保养结束时间'), COL('执行时长'), COL('处理人'), CREATED],
    select: `select h.FBillNo as 记录单号, h.FMouldNumber as 模具编码, m.FName as 模具名称, h.FScheNumber as 保养方案,
      h.FMainStartTime as 保养开始时间, h.FMainEndTime as 保养结束时间, h.FDuration as 执行时长, h.FHandler as 处理人, h.FCreateDate as 创建时间`,
    from: `from T_MD_MainRecord h left join T_MD_Mould m on m.FMDNumber = h.FMouldNumber and m.deleted_at is null where h.deleted_at is null`,
    order: 'order by h.FInterID desc',
  },
  // —— C003 报修报表（T_MD_Repair）——
  C003: {
    name: '报修报表', form: 'report',
    filters: dateMold('h.FCreateDate'),
    columns: [COL('报修单号'), COL('模具编码'), COL('模具名称'), COL('故障描述'), COL('报修人'), COL('报修日期'), COL('处理状态'), COL('维修负责人'), COL('完成日期'), COL('处理结果'), COL('维修费用', { num: true }), CREATED],
    select: `select h.FBillNo as 报修单号, h.FMouldNumber as 模具编码, m.FName as 模具名称, h.FFaultDesc as 故障描述,
      h.FReporter as 报修人, h.FRepairDate as 报修日期, h.FStatus as 处理状态, h.FHandler as 维修负责人,
      h.FFinishDate as 完成日期, h.FResult as 处理结果, h.cost as 维修费用, h.FCreateDate as 创建时间`,
    from: `from T_MD_Repair h left join T_MD_Mould m on m.FMDNumber = h.FMouldNumber and m.deleted_at is null where h.deleted_at is null`,
    order: 'order by h.FInterID desc',
  },
  // —— C004 维修报表（T_MD_Server 维修记录）——
  C004: {
    name: '维修报表', form: 'report',
    filters: dateMold('h.FCreateDate'),
    columns: [COL('记录单号'), COL('模具编码'), COL('模具名称'), COL('维修内容'), COL('负责人'), COL('维修日期'), COL('验收日期'), COL('维修结果'), COL('维修费用', { num: true }), CREATED],
    select: `select h.FBillNo as 记录单号, h.FMouldNumber as 模具编码, m.FName as 模具名称, h.FRepairContent as 维修内容,
      h.FPrincipal as 负责人, h.FRepairDate as 维修日期, h.FCheckDate as 验收日期, h.FResult as 维修结果, h.FCost as 维修费用, h.FCreateDate as 创建时间`,
    from: `from T_MD_Server h left join T_MD_Mould m on m.FMDNumber = h.FMouldNumber and m.deleted_at is null where h.deleted_at is null`,
    order: 'order by h.FInterID desc',
  },
  // —— C005 领用报表（T_MD_PickRecord 头 + 体逐行）——
  C005: {
    name: '领用报表', form: 'report',
    filters: dateMold('h.FCreateDate', 'e.FMouldNumber'),
    columns: [COL('单据编号'), COL('领用人'), COL('领用时间'), COL('模具编码'), COL('模具名称'), COL('实际领用数量', { num: true }), CREATED],
    select: `select h.FBillNo as 单据编号, h.FPickEmp as 领用人, h.FPickTime as 领用时间,
      e.FMouldNumber as 模具编码, e.FMouldName as 模具名称, e.FPickQty as 实际领用数量, h.FCreateDate as 创建时间`,
    from: `from T_MD_PickRecord h join T_MD_PickRecordEntry e on e.FInterID = h.FInterID where h.deleted_at is null`,
    order: 'order by h.FInterID desc, e.FEntryID',
  },
  // —— C006 归还报表（T_MD_ReturnRecord 头 + 体逐行）——
  C006: {
    name: '归还报表', form: 'report',
    filters: dateMold('h.FCreateDate', 'e.FMouldNumber'),
    columns: [COL('单据编号'), COL('归还人'), COL('归还时间'), COL('模具编码'), COL('模具名称'), COL('归还数量', { num: true }), COL('入库模次'), CREATED],
    select: `select h.FBillNo as 单据编号, h.FReturnEmp as 归还人, h.FReturnTime as 归还时间,
      e.FMouldNumber as 模具编码, e.FMouldName as 模具名称, e.FReturnQty as 归还数量, e.FInMDNum as 入库模次, h.FCreateDate as 创建时间`,
    from: `from T_MD_ReturnRecord h join T_MD_ReturnRecordEntry e on e.FInterID = h.FInterID where h.deleted_at is null`,
    order: 'order by h.FInterID desc, e.FEntryID',
  },
  // —— C007 寿命报表（T_MD_Mould 主档，全量视图）——
  C007: {
    name: '寿命报表', form: 'report',
    filters: [tx('模具编码', '模具编码', 'FMDNumber')],
    columns: [COL('模具编号'), COL('模具名称'), COL('规格型号'), COL('状态'), COL('设计寿命', { num: true }), COL('已用模次', { num: true }), COL('剩余模次', { num: true }), COL('使用率', { num: true })],
    select: `select FMDNumber as 模具编号, FName as 模具名称, FModel as 规格型号, FMDStatus as 状态,
      FDesignLife as 设计寿命, used_shots as 已用模次, (FDesignLife - used_shots) as 剩余模次,
      round(used_shots * 100.0 / nullif(FDesignLife, 0), 1) as 使用率`,
    from: 'from T_MD_Mould where deleted_at is null',
    order: 'order by 使用率 desc, FMDNumber',
  },
  // —— C008 盘点报表（T_MD_Stocktaking 头 + 体逐行，含差异）——
  C008: {
    name: '盘点报表', form: 'report',
    filters: dateMold('h.FCreateDate', 'e.FMouldNumber'),
    columns: [COL('单据编号'), COL('盘点日期'), COL('盘点人员'), COL('模具编码'), COL('模具名称'), COL('帐存数量', { num: true }), COL('盘点数量', { num: true }), COL('差异', { num: true }), COL('存放地点')],
    select: `select h.FBillNo as 单据编号, h.FDate as 盘点日期, h.FEmp as 盘点人员,
      e.FMouldNumber as 模具编码, e.FMouldName as 模具名称, e.FAccountQty as 帐存数量, e.FStocktakQty as 盘点数量,
      (e.FStocktakQty - e.FAccountQty) as 差异, e.FPosition as 存放地点`,
    from: `from T_MD_Stocktaking h join T_MD_StocktakingEntry e on e.FInterID = h.FInterID where h.deleted_at is null`,
    order: 'order by h.FInterID desc, e.FEntryID',
  },
  // —— C009 日常业务处理记录（业务单头 UNION，单据类型/模具编码/日期过滤）——
  C009: {
    name: '日常业务处理记录', form: 'report',
    filters: [dt('开始日期', '开始日期', 't.创建时间', 'from'), dt('结束日期', '结束日期', 't.创建时间', 'to'), tx('模具编码', '模具编码', 't.模具编码'), tx('单据类型', '单据类型', 't.单据类型')],
    columns: [COL('单据类型'), COL('单据编号'), COL('模具编码'), COL('模具名称'), COL('业务时间'), COL('经办人'), CREATED],
    build(f) {
      const u = `
        select '领用' as 单据类型, h.FBillNo as 单据编号, e.FMouldNumber as 模具编码, e.FMouldName as 模具名称, h.FPickTime as 业务时间, h.FPickEmp as 经办人, h.FCreateDate as 创建时间 from T_MD_PickRecord h join T_MD_PickRecordEntry e on e.FInterID = h.FInterID where h.deleted_at is null
        union all select '归还', h.FBillNo, e.FMouldNumber, e.FMouldName, h.FReturnTime, h.FReturnEmp, h.FCreateDate from T_MD_ReturnRecord h join T_MD_ReturnRecordEntry e on e.FInterID = h.FInterID where h.deleted_at is null
        union all select '接收', FBillNo, FMouldNumber, FMouldName, FReceiverDate, FReceiverType, FCreateDate from T_MD_Receive where deleted_at is null
        union all select '验收', FBillNo, FMouldNumber, FMouldName, FStartTime, FConfirmEmp, FCreateDate from T_MD_CheckAccept where deleted_at is null
        union all select '报废', FBillNo, FMouldNumber, FMouldName, FApplyTime, FApplyEmp, FCreateDate from T_MD_Scrap where deleted_at is null
        union all select '出厂申请', FBillNo, FMouldNumber, FMouldName, FOutFTYDate, FApplyEmp, FCreateDate from T_MD_OutFactoryApply where deleted_at is null
        union all select '状态变更', FBillNo, FMouldNumber, FMouldName, FReceiverDate, FReceiverEmp, FCreateDate from T_MD_StatusChange where deleted_at is null`
      const { clause, params } = mkWhere(REPORT_DEFS.C009.filters, f)
      return { sql: `select 单据类型, 单据编号, 模具编码, 模具名称, 业务时间, 经办人, 创建时间 from (${u}) t where 1=1${clause} order by 创建时间 desc`, params }
    },
  },
  // —— C010 故障次数统计（多页签：主表按模具聚合，页签出报修/维修明细）——
  C010: {
    name: '故障次数统计', form: 'reportmulti',
    filters: [dt('开始日期', '开始日期', 'r.FCreateDate', 'from'), dt('结束日期', '结束日期', 'r.FCreateDate', 'to'), tx('模具编码', '模具编码', 'r.FMouldNumber')],
    columns: [COL('模具编码'), COL('模具名称'), COL('报修次数', { num: true }), COL('维修次数', { num: true }), COL('累计维修费用', { num: true })],
    build(f) {
      const { clause, params } = mkWhere(REPORT_DEFS.C010.filters, f)
      const sql = `select r.FMouldNumber as 模具编码, m.FName as 模具名称, count(r.FInterID) as 报修次数,
        (select count(*) from T_MD_Server s where s.deleted_at is null and s.FMouldNumber = r.FMouldNumber) as 维修次数,
        (select coalesce(sum(s.FCost), 0) from T_MD_Server s where s.deleted_at is null and s.FMouldNumber = r.FMouldNumber) as 累计维修费用
        from T_MD_Repair r left join T_MD_Mould m on m.FMDNumber = r.FMouldNumber and m.deleted_at is null
        where r.deleted_at is null${clause}
        group by r.FMouldNumber, m.FName order by 报修次数 desc, r.FMouldNumber`
      return { sql, params }
    },
    tabGroups: [{ FGroupNumber: 'G1', FGroupName: '故障明细' }],
    tabs: [
      { FTABNumber: 'T1', FTABName: '报修明细', FGroupNumber: 'G1' },
      { FTABNumber: 'T2', FTABName: '维修记录', FGroupNumber: 'G1' },
    ],
    detail: {
      T1: (row) => ({ sql: `select FBillNo as 报修单号, FFaultDesc as 故障描述, FReporter as 报修人, FRepairDate as 报修日期, FStatus as 处理状态, FHandler as 维修负责人, FFinishDate as 完成日期, cost as 维修费用
        from T_MD_Repair where deleted_at is null and FMouldNumber = ? order by FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
      T2: (row) => ({ sql: `select FBillNo as 记录单号, FRepairContent as 维修内容, FPrincipal as 负责人, FRepairDate as 维修日期, FCheckDate as 验收日期, FResult as 维修结果, FCost as 维修费用
        from T_MD_Server where deleted_at is null and FMouldNumber = ? order by FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
    },
  },
  // —— C011 保养执行报表（T_MD_MainTask 任务单计划视图）——
  C011: {
    name: '保养执行报表', form: 'report',
    filters: dateMold('h.FCreateDate'),
    columns: [COL('任务单号'), COL('模具编码'), COL('模具名称'), COL('保养方案'), COL('计划开始'), COL('计划结束'), CREATED],
    select: `select h.FBillNo as 任务单号, h.FMouldNumber as 模具编码, m.FName as 模具名称, h.FScheNumber as 保养方案,
      h.FMainPlanStartTime as 计划开始, h.FMainPlanEndTime as 计划结束, h.FCreateDate as 创建时间`,
    from: `from T_MD_MainTask h left join T_MD_Mould m on m.FMDNumber = h.FMouldNumber and m.deleted_at is null where h.deleted_at is null`,
    order: 'order by h.FInterID desc',
  },
  // —— C012 人员任务统计（多页签：主表按人员聚合点检/保养/维修，页签出各人分类明细）——
  C012: {
    name: '人员任务统计', form: 'reportmulti',
    filters: [tx('人员', '人员', 't.人员')],
    columns: [COL('人员'), COL('点检任务数', { num: true }), COL('保养任务数', { num: true }), COL('维修任务数', { num: true }), COL('合计', { num: true })],
    build(f) {
      const { clause, params } = mkWhere(REPORT_DEFS.C012.filters, f)
      const inner = `
        select FHandler as 人员, 1 as 点检, 0 as 保养, 0 as 维修 from T_MD_CheckRecord where deleted_at is null and FHandler <> ''
        union all select FHandler, 0, 1, 0 from T_MD_MainRecord where deleted_at is null and FHandler <> ''
        union all select FPrincipal, 0, 0, 1 from T_MD_Server where deleted_at is null and FPrincipal <> ''`
      return { sql: `select 人员, sum(点检) as 点检任务数, sum(保养) as 保养任务数, sum(维修) as 维修任务数, count(*) as 合计
        from (${inner}) t where 1=1${clause} group by 人员 order by 合计 desc, 人员`, params }
    },
    tabGroups: [{ FGroupNumber: 'G1', FGroupName: '任务明细' }],
    tabs: [
      { FTABNumber: 'T1', FTABName: '点检记录', FGroupNumber: 'G1' },
      { FTABNumber: 'T2', FTABName: '保养记录', FGroupNumber: 'G1' },
      { FTABNumber: 'T3', FTABName: '维修记录', FGroupNumber: 'G1' },
    ],
    detail: {
      T1: (row) => ({ sql: `select FBillNo as 记录单号, FMouldNumber as 模具编码, FChkStartTime as 点检开始时间, FHandler as 处理人, FCreateDate as 创建时间
        from T_MD_CheckRecord where deleted_at is null and FHandler = ? order by FInterID desc`, params: [String(row['人员'] ?? '')] }),
      T2: (row) => ({ sql: `select FBillNo as 记录单号, FMouldNumber as 模具编码, FMainStartTime as 保养开始时间, FHandler as 处理人, FCreateDate as 创建时间
        from T_MD_MainRecord where deleted_at is null and FHandler = ? order by FInterID desc`, params: [String(row['人员'] ?? '')] }),
      T3: (row) => ({ sql: `select FBillNo as 记录单号, FMouldNumber as 模具编码, FRepairDate as 维修日期, FResult as 维修结果, FCreateDate as 创建时间
        from T_MD_Server where deleted_at is null and FPrincipal = ? order by FInterID desc`, params: [String(row['人员'] ?? '')] }),
    },
  },
  // —— C013 报废预测（T_MD_Mould 有寿命档案，按使用率降序 + 预测结论）——
  C013: {
    name: '报废预测', form: 'report',
    filters: [tx('模具编码', '模具编码', 'FMDNumber')],
    columns: [COL('模具编号'), COL('模具名称'), COL('规格型号'), COL('设计寿命', { num: true }), COL('已用模次', { num: true }), COL('剩余模次', { num: true }), COL('使用率', { num: true }), COL('预测结论')],
    select: `select FMDNumber as 模具编号, FName as 模具名称, FModel as 规格型号, FDesignLife as 设计寿命, used_shots as 已用模次,
      (FDesignLife - used_shots) as 剩余模次, round(used_shots * 100.0 / nullif(FDesignLife, 0), 1) as 使用率,
      case when used_shots >= FDesignLife then '已达寿命'
           when used_shots * 100.0 / nullif(FDesignLife, 0) >= 80 then '临近报废'
           else '正常' end as 预测结论`,
    from: 'from T_MD_Mould where deleted_at is null and FDesignLife > 0',
    order: 'order by 使用率 desc, FMDNumber',
  },
  // —— C014 使用情况统计（usage_log 按模具聚合）——
  C014: {
    name: '使用情况统计', form: 'report',
    filters: [dt('开始日期', '开始日期', 'u.log_date', 'from'), dt('结束日期', '结束日期', 'u.log_date', 'to'), tx('模具编码', '模具编码', 'm.FMDNumber')],
    columns: [COL('模具编码'), COL('模具名称'), COL('使用记录数', { num: true }), COL('累计使用模次', { num: true }), COL('最近使用日期')],
    build(f) {
      const { clause, params } = mkWhere(REPORT_DEFS.C014.filters, f)
      const sql = `select m.FMDNumber as 模具编码, m.FName as 模具名称, count(u.id) as 使用记录数,
        coalesce(sum(u.delta_shots), 0) as 累计使用模次, max(u.log_date) as 最近使用日期
        from usage_log u join T_MD_Mould m on m.FInterID = u.mold_id and m.deleted_at is null
        where 1=1${clause}
        group by m.FMDNumber, m.FName order by 累计使用模次 desc, 模具编码`
      return { sql, params }
    },
  },
  // —— C015 模具履历（多页签：主表按模具，页签出各业务类别流水）——
  C015: {
    name: '模具履历', form: 'reportmulti',
    filters: [tx('模具编码', '模具编码', 'FMDNumber'), tx('模具名称', '模具名称', 'FName')],
    columns: [COL('模具编码'), COL('模具名称'), COL('类型'), COL('状态'), COL('已用模次', { num: true }), COL('建档日期')],
    build(f) {
      const { clause, params } = mkWhere(REPORT_DEFS.C015.filters, f)
      return { sql: `select FMDNumber as 模具编码, FName as 模具名称, FType as 类型, FMDStatus as 状态, used_shots as 已用模次,
        FCreateDate as 建档日期 from T_MD_Mould where deleted_at is null${clause} order by FMDNumber`, params }
    },
    tabGroups: [{ FGroupNumber: 'G1', FGroupName: '履历明细' }],
    tabs: [
      { FTABNumber: 'T1', FTABName: '点检', FGroupNumber: 'G1' },
      { FTABNumber: 'T2', FTABName: '保养', FGroupNumber: 'G1' },
      { FTABNumber: 'T3', FTABName: '维修', FGroupNumber: 'G1' },
      { FTABNumber: 'T4', FTABName: '报修', FGroupNumber: 'G1' },
      { FTABNumber: 'T5', FTABName: '领用', FGroupNumber: 'G1' },
      { FTABNumber: 'T6', FTABName: '归还', FGroupNumber: 'G1' },
    ],
    detail: {
      T1: (row) => ({ sql: `select FBillNo as 单号, FScheNumber as 方案, FChkStartTime as 开始时间, FHandler as 处理人, FCreateDate as 时间 from T_MD_CheckRecord where deleted_at is null and FMouldNumber = ? order by FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
      T2: (row) => ({ sql: `select FBillNo as 单号, FScheNumber as 方案, FMainStartTime as 开始时间, FHandler as 处理人, FCreateDate as 时间 from T_MD_MainRecord where deleted_at is null and FMouldNumber = ? order by FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
      T3: (row) => ({ sql: `select FBillNo as 单号, FRepairContent as 内容, FPrincipal as 负责人, FResult as 结果, FCreateDate as 时间 from T_MD_Server where deleted_at is null and FMouldNumber = ? order by FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
      T4: (row) => ({ sql: `select FBillNo as 单号, FFaultDesc as 故障描述, FReporter as 报修人, FStatus as 状态, FCreateDate as 时间 from T_MD_Repair where deleted_at is null and FMouldNumber = ? order by FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
      T5: (row) => ({ sql: `select h.FBillNo as 单号, h.FPickEmp as 领用人, h.FPickTime as 领用时间, e.FPickQty as 数量 from T_MD_PickRecord h join T_MD_PickRecordEntry e on e.FInterID = h.FInterID where h.deleted_at is null and e.FMouldNumber = ? order by h.FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
      T6: (row) => ({ sql: `select h.FBillNo as 单号, h.FReturnEmp as 归还人, h.FReturnTime as 归还时间, e.FReturnQty as 数量 from T_MD_ReturnRecord h join T_MD_ReturnRecordEntry e on e.FInterID = h.FInterID where h.deleted_at is null and e.FMouldNumber = ? order by h.FInterID desc`, params: [String(row['模具编码'] ?? '')] }),
    },
  },
}

/** 报表 strFunc 判定（C0xx）。 */
export function isReportStrFunc(strFunc) {
  return Object.prototype.hasOwnProperty.call(REPORT_DEFS, String(strFunc))
}
export function getReportForm(strFunc) {
  const d = REPORT_DEFS[String(strFunc)]
  return d ? d.form : ''
}

/** reportFilter 出参行（前端 deriveFilterFields 读 关键字/标题/数据类型）。 */
function buildReportFilter(filters) {
  return (filters || []).map((fl, i) => ({
    序号: i + 1,
    关键字: fl.key,
    标题: fl.title || fl.key,
    数据类型: fl.type === 'date' ? '日期' : fl.type === 'number' ? '数量' : '文本',
    FInputInfo: '', FInputDisplayCol: '', FInputValueCol: '',
  }))
}

/** head 出参（列全部可见；num 列右对齐 + valueType=decimal 供前端数值判型）。 */
function buildHead(columns) {
  return columns.map((c) => ({
    name: c.name,
    title: c.title || c.name,
    value: c.title || c.name,
    valueType: c.num ? 'decimal' : 'string',
    align: c.num ? 'right' : (c.align || 'left'),
    hide: false,
  }))
}

const FUNC_SETES = [{ FISDEL: false, FISSave: false, FIsPrint: false }]

/**
 * /report 主查询（单/多页签共用）。dtfilter 为前端 {关键字:值} 对象。
 * @returns 契约对象（成功 {ok:true,head,data,totalCount,reportFilter,funcSetes,actions,[RptTABGroup,RptTAB]}；失败 {ok:false,message}）。
 */
export function buildReport(adapter, { strFunc, dtfilter } = {}) {
  const def = REPORT_DEFS[String(strFunc)]
  if (!def) return { ok: false, strFunc: String(strFunc ?? ''), message: `未知或未接入的报表 strFunc：${JSON.stringify(strFunc)}` }
  const f = dtfilter && typeof dtfilter === 'object' ? dtfilter : {}
  const { sql, params } = def.build ? def.build(f) : (() => {
    const { clause, params: p } = mkWhere(def.filters, f)
    return { sql: `${def.select} ${def.from}${clause} ${def.order || ''}`, params: p }
  })()
  const data = adapter.db.prepare(sql).all(...params)
  const out = {
    ok: true,
    strFunc: String(strFunc),
    form: def.form,
    head: buildHead(def.columns),
    data,
    totalCount: data.length,
    reportFilter: buildReportFilter(def.filters),
    funcSetes: FUNC_SETES,
    actions: [],
    message: '',
  }
  if (def.form === 'reportmulti') {
    out.RptTABGroup = def.tabGroups || []
    out.RptTAB = def.tabs || []
  }
  return out
}

/**
 * /reportdetail 页签明细（多页签报表）。focusRow 为主表聚焦行（dtFoucuseRow[0]）。
 * 明细列由首行键名派生（前端 ReportView detailCols），故 SQL 直接以中文列别名出参。
 */
export function buildReportDetail(adapter, { strFunc, strTab, dtFoucuseRow } = {}) {
  const def = REPORT_DEFS[String(strFunc)]
  if (!def || def.form !== 'reportmulti') return { ok: false, strFunc: String(strFunc ?? ''), data: [], message: '该报表非多页签报表，无页签明细' }
  const tab = String(strTab ?? '')
  const fn = def.detail && def.detail[tab]
  if (!fn) return { ok: false, strFunc: String(strFunc ?? ''), data: [], message: `未知页签：${JSON.stringify(strTab)}` }
  const row = Array.isArray(dtFoucuseRow) && dtFoucuseRow[0] && typeof dtFoucuseRow[0] === 'object' ? dtFoucuseRow[0] : null
  if (!row) return { ok: false, strFunc: String(strFunc ?? ''), data: [], message: '缺少主表聚焦行（dtFoucuseRow）' }
  const { sql, params } = fn(row)
  const data = adapter.db.prepare(sql).all(...params)
  return { ok: true, strFunc: String(strFunc), strTab: tab, data, totalCount: data.length, message: '' }
}
