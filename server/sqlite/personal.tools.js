// server/sqlite/personal.tools.js —— 个人版 AI 工具（设计稿 §2.2.4 aiTools / 阶段 3）
// 四把工具：查模（只读）/ 记模次（写 usage_log+used_shots 原子）/ 记保养（写 maintenance_log，保养联动周期重置）/ 预警查询（只读派生）。
// 零依赖红线：不 import @deepseek-ai/dsh-tools——宿主 ToolsService.register() 接受平对象定义
// （name/description/parameters[JSON Schema]/output{schema,render}/execute），defineTool 仅是校验包装，
// 此处直接产出 registry-ready 形状（实测宿主 register 断言 output.render 函数 + schema 子集）。
// 失败如实上抛（W4）：execute 内业务错误返回 {ok:false,message}，不静默兜底。

/** 按模具编号取活动模具（契约行 + 内码）；不存在返回 null。 */
function moldByCode(adapter, code) {
  const row = adapter.getMoldByCode(code)
  return row ? { id: Number(row['单据内码']), row } : null
}

const moldBrief = (r) => ({
  模具编号: r['模具编号'], 模具名称: r['模具名称'], 规格: r['规格'] || '', 类型: r['类型'] || '',
  状态: r['状态'] || '', 库位: r['库位'] || '', 设计寿命模次: Number(r['设计寿命模次']) || 0,
  已用模次: Number(r['已用模次']) || 0, 剩余寿命百分比: r['剩余寿命百分比'], 距下次保养模次: r['距下次保养模次'],
})

const LIST_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: '是否成功' },
    totalCount: { type: 'integer', description: '命中总数' },
    data: { type: 'array', description: '模具行（编号/名称/状态/模次/派生预警指标）', items: { type: 'object', additionalProperties: true } },
    message: { type: 'string', description: '失败原因，成功时为空串' },
  },
  required: ['ok', 'totalCount', 'data', 'message'],
}
const WRITE_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    ok: { type: 'boolean', description: '是否成功' },
    moldCode: { type: 'string', description: '模具编号' },
    usedShots: { type: 'integer', description: '写入后的累计已用模次' },
    message: { type: 'string', description: '失败原因或成功摘要' },
  },
  required: ['ok', 'moldCode', 'usedShots', 'message'],
}
const renderRows = (value) => [{
  type: 'text',
  text: value.ok
    ? (value.data.length ? value.data.map((r) => `${r.模具编号} ${r.模具名称}｜${r.状态}｜已用${r.已用模次}/${r.设计寿命模次}模｜剩余寿命${r.剩余寿命百分比 == null ? '-' : r.剩余寿命百分比 + '%'}｜距下次保养${r.距下次保养模次 == null ? '-' : r.距下次保养模次 + '模'}`).join('\n') : '无命中数据')
    : `失败：${value.message}`,
}]

/**
 * 注册四把个人版工具。ctx 须已 inject ['tools']（入口 index.js 声明）。
 * 每把经 ctx.effect 注册，作用域销毁自动反注册（与企业版同口径）。
 */
export function registerPersonalTools(ctx, adapter) {
  // ① 查模（只读）：关键字/状态过滤，返回真实台账 + 派生预警指标。
  ctx.effect(() => ctx.tools.register({
    name: 'm10p_mold_query',
    description: '【个人版模具台账·只读】按关键字（编号/名称模糊）与状态（在库/生产中/保养中/维修中/报废）查询本地模具档案，' +
      '返回编号/名称/规格/类型/状态/库位/设计寿命/已用模次/剩余寿命百分比/距下次保养模次。适合「查一下XX模具」「在库的模具有哪些」。不修改任何数据。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        keyword: { type: 'string', description: '编号或名称关键字（模糊匹配），缺省查全部。' },
        status: { type: 'string', description: '业务状态精确过滤：在库/生产中/保养中/维修中/报废。缺省不过滤。' },
        limit: { type: 'integer', description: '最多返回行数，默认 20，上限 100。' },
      },
    },
    output: { schema: LIST_OUTPUT_SCHEMA, render: (_args, value) => renderRows(value) },
    isConcurrencySafe: () => true,
    async execute(args) {
      const limit = Math.min(100, Math.max(1, Number(args.limit) || 20))
      const { head, totalCount } = adapter.listMolds({ keyword: String(args.keyword || '').trim(), status: String(args.status || '').trim(), pageSize: limit })
      return { ok: true, totalCount, data: head.map(moldBrief), message: '' }
    },
  }))

  // ② 记模次（写）：usage_log 插入 + used_shots 累加同事务原子（adapter.addUsage，§2.2.3-5）。
  ctx.effect(() => ctx.tools.register({
    name: 'm10p_add_usage',
    description: '【个人版记模次·写入】给指定模具记录一次生产打次：新增模次原子累加到「已用模次」并留使用记录（使用情况统计报表数据源）。' +
      '适合「XX模具今天打了500模」。新增模次必须为正整数；模具编号必须已存在。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        moldCode: { type: 'string', description: '模具编号（如 MD-1001），必须已建档。' },
        deltaShots: { type: 'integer', description: '本次新增模次，正整数。' },
        machineNo: { type: 'string', description: '机台号（可选）。' },
        logDate: { type: 'string', description: '记录日期 YYYY-MM-DD（可选，缺省今天）。' },
        remark: { type: 'string', description: '备注（可选）。' },
      },
      required: ['moldCode', 'deltaShots'],
    },
    output: {
      schema: WRITE_OUTPUT_SCHEMA,
      render: (_args, v) => [{ type: 'text', text: v.ok ? `已记模次：${v.moldCode} 累计 ${v.usedShots} 模。${v.message}` : `记模次失败：${v.message}` }],
    },
    async execute(args) {
      const hit = moldByCode(adapter, args.moldCode)
      if (!hit) return { ok: false, moldCode: String(args.moldCode || ''), usedShots: 0, message: `模具编号「${args.moldCode}」不存在（请先建档）` }
      const delta = Number(args.deltaShots)
      if (!Number.isInteger(delta) || delta <= 0) return { ok: false, moldCode: hit.row['模具编号'], usedShots: Number(hit.row['已用模次']) || 0, message: '本次新增模次必须为正整数' }
      try {
        const r = adapter.addUsage(hit.id, { delta_shots: delta, machine_no: String(args.machineNo || ''), remark: String(args.remark || ''), log_date: String(args.logDate || '') || undefined })
        return { ok: true, moldCode: hit.row['模具编号'], usedShots: Number(r.used_shots), message: `本次 +${delta} 模` }
      } catch (e) {
        return { ok: false, moldCode: hit.row['模具编号'], usedShots: Number(hit.row['已用模次']) || 0, message: String((e && e.message) || e) }
      }
    },
  }))

  // ③ 记保养/点检/维修（写）：maintenance_log；log_type=保养 时同事务重置 last_maint_shots（保养联动）。
  ctx.effect(() => ctx.tools.register({
    name: 'm10p_add_maintenance',
    description: '【个人版记保养/点检/维修·写入】给指定模具记一条维护记录。类型=保养时自动把「上次保养模次」重置为当前模次（距下次保养重新起算）。' +
      '适合「XX模具刚做完保养」「记一次点检，结果合格」。模具编号必须已存在。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        moldCode: { type: 'string', description: '模具编号（如 MD-1001），必须已建档。' },
        logType: { type: 'string', enum: ['点检', '保养', '维修'], description: '记录类型。' },
        result: { type: 'string', description: '结果（如 合格/异常/已修复）。' },
        operator: { type: 'string', description: '处理人（可选）。' },
        cost: { type: 'number', description: '费用（可选，维修常用）。' },
        logDate: { type: 'string', description: '记录日期 YYYY-MM-DD（可选，缺省今天）。' },
        remark: { type: 'string', description: '备注（可选）。' },
      },
      required: ['moldCode', 'logType', 'result'],
    },
    output: {
      schema: WRITE_OUTPUT_SCHEMA,
      render: (_args, v) => [{ type: 'text', text: v.ok ? `已记维护记录：${v.moldCode}（当前 ${v.usedShots} 模）。${v.message}` : `记维护失败：${v.message}` }],
    },
    async execute(args) {
      const hit = moldByCode(adapter, args.moldCode)
      if (!hit) return { ok: false, moldCode: String(args.moldCode || ''), usedShots: 0, message: `模具编号「${args.moldCode}」不存在（请先建档）` }
      try {
        const r = adapter.addMaintenance(hit.id, {
          log_type: String(args.logType), result: String(args.result), operator: String(args.operator || ''),
          cost: Number(args.cost) || 0, remark: String(args.remark || ''), log_date: String(args.logDate || '') || undefined,
        })
        return { ok: true, moldCode: hit.row['模具编号'], usedShots: Number(r.shots_at_log), message: `${args.logType}已记录${args.logType === '保养' ? '，保养周期已重新起算' : ''}` }
      } catch (e) {
        return { ok: false, moldCode: hit.row['模具编号'], usedShots: Number(hit.row['已用模次']) || 0, message: String((e && e.message) || e) }
      }
    },
  }))

  // ④ 预警查询（只读）：寿命告急（剩余寿命% < 阈值，默认 10）+ 保养到期（距下次保养模次 = 0）。
  ctx.effect(() => ctx.tools.register({
    name: 'm10p_alerts',
    description: '【个人版预警·只读】列出需要关注的模具：① 寿命告急（剩余寿命百分比低于阈值，默认 10%）② 保养到期（距下次保养模次为 0）。' +
      '适合「哪些模具快报废了」「该保养的模具有哪些」。不修改任何数据。',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        lifeThreshold: { type: 'integer', description: '剩余寿命百分比阈值（0-100），低于该值判寿命告急，默认 10。' },
      },
    },
    output: { schema: LIST_OUTPUT_SCHEMA, render: (_args, value) => renderRows(value) },
    isConcurrencySafe: () => true,
    async execute(args) {
      const rawTh = Number(args.lifeThreshold)
      const th = Math.min(100, Math.max(0, Number.isFinite(rawTh) ? rawTh : 10))
      const { head } = adapter.listMolds({ pageSize: 1000 })
      const hits = head.filter((r) => {
        const life = r['剩余寿命百分比']
        const maint = r['距下次保养模次']
        return (life != null && life < th) || maint === 0
      }).map((r) => ({ ...moldBrief(r), 预警原因: [r['剩余寿命百分比'] != null && r['剩余寿命百分比'] < th ? `剩余寿命${r['剩余寿命百分比']}%` : '', r['距下次保养模次'] === 0 ? '保养到期' : ''].filter(Boolean).join('；') }))
      return { ok: true, totalCount: hits.length, data: hits, message: '' }
    },
  }))
}