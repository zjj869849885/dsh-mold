// server/sqlite/personal.ai.js —— 个人版模块内 AI 助手：本地 SQLite 数据分析 + 可选本地/OpenAI 兼容模型直连

function fmtPct(v) {
  return v == null || v === '' ? '-' : `${Number(v)}%`
}

function fmtNum(v) {
  const n = Number(v) || 0
  return n.toLocaleString('zh-CN')
}

function getAiCfg(adapter) {
  try {
    const row = adapter.db.prepare('select value from app_setting where key = ?').get('ai.model_config')
    const cfg = row && row.value ? JSON.parse(row.value) : {}
    return {
      enabled: cfg.enabled === true,
      baseUrl: String(cfg.baseUrl || 'http://127.0.0.1:11434/v1').trim(),
      model: String(cfg.model || '').trim(),
      apiKey: String(cfg.apiKey || '').trim(),
    }
  } catch {
    return { enabled: false, baseUrl: 'http://127.0.0.1:11434/v1', model: '', apiKey: '' }
  }
}

function saveAiCfg(adapter, body) {
  const prev = getAiCfg(adapter)
  const next = {
    enabled: body.enabled === true,
    baseUrl: String(body.baseUrl ?? prev.baseUrl ?? 'http://127.0.0.1:11434/v1').trim(),
    model: String(body.model ?? prev.model ?? '').trim(),
    apiKey: body.apiKey === undefined ? prev.apiKey : String(body.apiKey || '').trim(),
  }
  adapter.db.prepare('insert into app_setting(key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
    .run('ai.model_config', JSON.stringify(next))
  return next
}

export function analyzeLocalMolds(adapter, rawQuestion) {
  const q = String(rawQuestion || '').trim()
  const ql = q.toLowerCase()
  const { head: molds } = adapter.listMolds({ pageSize: 10000 })
  const total = molds.length

  const statusMap = new Map()
  let totalUsedShots = 0
  let lifePctSum = 0
  let lifePctCount = 0
  const maintAlerts = []
  const lifeAlerts = []

  for (const m of molds) {
    const st = String(m['状态'] || '未设置')
    statusMap.set(st, (statusMap.get(st) || 0) + 1)
    totalUsedShots += Number(m['已用模次']) || 0
    if (m['剩余寿命百分比'] != null && m['剩余寿命百分比'] !== '') {
      const pct = Number(m['剩余寿命百分比'])
      if (Number.isFinite(pct)) {
        lifePctSum += pct
        lifePctCount++
        if (pct < 20) lifeAlerts.push(m)
      }
    }
    const leftMaint = m['距下次保养模次']
    const maintCycle = Number(m['保养周期模次']) || 0
    if (leftMaint != null && leftMaint !== '') {
      const lm = Number(leftMaint)
      if (Number.isFinite(lm) && (lm <= 0 || (maintCycle > 0 && lm <= maintCycle * 0.1))) {
        maintAlerts.push(m)
      }
    }
  }

  maintAlerts.sort((a, b) => Number(a['距下次保养模次']) - Number(b['距下次保养模次']))
  lifeAlerts.sort((a, b) => Number(a['剩余寿命百分比']) - Number(b['剩余寿命百分比']))

  const avgLife = lifePctCount > 0 ? Math.round(lifePctSum / lifePctCount) : null
  const statusText = Array.from(statusMap.entries()).map(([k, v]) => `${k} ${v} 副`).join(' · ') || '暂无'

  const usageRows = adapter.db.prepare(`
    SELECT m.FMDNumber AS code, m.FName AS name, SUM(u.delta_shots) AS shots, COUNT(*) AS cnt
    FROM usage_log u
    JOIN T_MD_Mould m ON m.FInterID = u.mold_id AND m.deleted_at IS NULL
    GROUP BY u.mold_id
    ORDER BY shots DESC
    LIMIT 5
  `).all()

  const maintStats = adapter.db.prepare(`
    SELECT log_type AS type, COUNT(*) AS cnt, COALESCE(SUM(cost), 0) AS total_cost
    FROM maintenance_log l
    JOIN T_MD_Mould m ON m.FInterID = l.mold_id AND m.deleted_at IS NULL
    GROUP BY log_type
  `).all()

  const repairTop = adapter.db.prepare(`
    SELECT m.FMDNumber AS code, m.FName AS name, COUNT(*) AS cnt, COALESCE(SUM(l.cost), 0) AS total_cost
    FROM maintenance_log l
    JOIN T_MD_Mould m ON m.FInterID = l.mold_id AND m.deleted_at IS NULL
    WHERE l.log_type = '维修'
    GROUP BY l.mold_id
    ORDER BY cnt DESC, total_cost DESC
    LIMIT 5
  `).all()

  const metrics = [
    { label: '模具总数', value: String(total) },
    { label: '保养预警', value: String(maintAlerts.length), tone: maintAlerts.length > 0 ? 'warn' : 'ok' },
    { label: '寿命<20%', value: String(lifeAlerts.length), tone: lifeAlerts.length > 0 ? 'danger' : 'ok' },
    { label: '平均剩余寿命', value: avgLife != null ? `${avgLife}%` : '-' },
  ]

  const moldBriefLines = molds.slice(0, 40).map((m) =>
    `${m['模具编号']} ${m['模具名称']}｜状态:${m['状态'] || '-'}｜类型:${m['类型'] || '-'}｜库位:${m['库位'] || '-'}｜已用/设计:${fmtNum(m['已用模次'])}/${fmtNum(m['设计寿命模次'])}｜剩余寿命:${fmtPct(m['剩余寿命百分比'])}｜距保养:${m['距下次保养模次'] == null ? '-' : m['距下次保养模次']}`
  )
  const llmContext = [
    `【本地模具总览】共 ${total} 副（${statusText}），累计已用 ${fmtNum(totalUsedShots)} 模次` + (avgLife != null ? `，平均剩余寿命 ${avgLife}%` : '') + '。',
    `保养预警 ${maintAlerts.length} 副；剩余寿命<20% ${lifeAlerts.length} 副。`,
    maintStats.length ? `维护汇总：${maintStats.map((s) => `${s.type}${s.cnt}次(¥${Number(s.total_cost).toFixed(0)})`).join('、')}` : '',
    moldBriefLines.length ? `【模具明细（最多40条）】\n${moldBriefLines.join('\n')}` : '',
  ].filter(Boolean).join('\n')

  if (total === 0) {
    return {
      ok: true,
      mode: 'local',
      metrics,
      llmContext,
      reply: '当前本地模具台账暂无数据（0 副模具）。\n\n建议先在「模具管理 → 模具档案」中新增模具，或通过「记模次 / 保养记录」积累运行数据后，我就可以为你分析健康度、寿命预警和维修排行。',
    }
  }

  const matchedMold = q
    ? molds.find((m) => {
      const code = String(m['模具编号'] || '').toLowerCase()
      const name = String(m['模具名称'] || '').toLowerCase()
      return (code && ql.includes(code)) || (name && name.length >= 2 && ql.includes(name))
    })
    : null

  if (matchedMold) {
    const id = Number(matchedMold['单据内码'])
    const recentLogs = adapter.db.prepare(
      `SELECT log_type, log_date, result, cost, shots_at_log FROM maintenance_log WHERE mold_id = ? ORDER BY log_date DESC, id DESC LIMIT 5`
    ).all(id)
    const lines = [
      `【${matchedMold['模具编号']} · ${matchedMold['模具名称']}】`,
      `• 状态：${matchedMold['状态'] || '-'} ｜ 类型：${matchedMold['类型'] || '-'} ｜ 库位：${matchedMold['库位'] || '-'}`,
      `• 模次：已用 ${fmtNum(matchedMold['已用模次'])} / 设计寿命 ${fmtNum(matchedMold['设计寿命模次'])} 模（剩余寿命 ${fmtPct(matchedMold['剩余寿命百分比'])}）`,
      `• 保养：距下次保养 ${matchedMold['距下次保养模次'] == null ? '未设置周期' : fmtNum(matchedMold['距下次保养模次']) + ' 模'}`,
    ]
    if (recentLogs.length) {
      lines.push('', '最近维护记录：')
      for (const l of recentLogs) {
        lines.push(`- ${l.log_date} [${l.log_type}] ${l.result || '-'}${Number(l.cost) > 0 ? `（¥${l.cost}）` : ''}`)
      }
    } else {
      lines.push('', '暂无点检/保养/维修记录。')
    }
    return { ok: true, mode: 'local', metrics, llmContext, reply: lines.join('\n') }
  }

  if (/保养|预警|寿命|到期|健康风险|报警/.test(q) && !/整体|健康度|汇总|概览/.test(q)) {
    const lines = [`当前共扫描 ${total} 副模具，预警明细如下：`, '']
    lines.push(`1. 保养到期预警（${maintAlerts.length} 副）：`)
    if (maintAlerts.length) {
      for (const m of maintAlerts.slice(0, 8)) {
        const left = Number(m['距下次保养模次'])
        lines.push(`- ${m['模具编号']} ${m['模具名称']}（${m['状态']}）：${left <= 0 ? `已超期 ${fmtNum(Math.abs(left))} 模` : `距保养仅余 ${fmtNum(left)} 模`}`)
      }
    } else {
      lines.push('- 暂无达到保养阈值的模具，周期状态良好。')
    }
    lines.push('', `2. 剩余寿命偏低（<20%，共 ${lifeAlerts.length} 副）：`)
    if (lifeAlerts.length) {
      for (const m of lifeAlerts.slice(0, 8)) {
        lines.push(`- ${m['模具编号']} ${m['模具名称']}：剩余 ${fmtPct(m['剩余寿命百分比'])}（已用 ${fmtNum(m['已用模次'])}/${fmtNum(m['设计寿命模次'])} 模）`)
      }
    } else {
      lines.push('- 暂无剩余寿命低于 20% 的模具。')
    }
    return { ok: true, mode: 'local', metrics, llmContext, reply: lines.join('\n') }
  }

  if (/维修|打次|使用|排行|费用|消耗|高频/.test(q)) {
    const lines = ['本地使用与维护统计如下：', '']
    if (maintStats.length) {
      lines.push('1. 维护记录汇总：')
      for (const s of maintStats) {
        lines.push(`- ${s.type}：${s.cnt} 次${Number(s.total_cost) > 0 ? `，累计费用 ¥${Number(s.total_cost).toFixed(2)}` : ''}`)
      }
    } else {
      lines.push('1. 维护记录汇总：暂无点检/保养/维修流水。')
    }
    lines.push('', '2. 高频维修模具 Top 5：')
    if (repairTop.length) {
      for (const r of repairTop) {
        lines.push(`- ${r.code} ${r.name}：维修 ${r.cnt} 次${Number(r.total_cost) > 0 ? `（¥${Number(r.total_cost).toFixed(2)}）` : ''}`)
      }
    } else {
      lines.push('- 暂无维修记录。')
    }
    lines.push('', '3. 累计打次排行 Top 5：')
    if (usageRows.length) {
      for (const u of usageRows) {
        lines.push(`- ${u.code} ${u.name}：记录新增 ${fmtNum(u.shots)} 模（${u.cnt} 次填报）`)
      }
    } else {
      const topByTotal = [...molds].sort((a, b) => (Number(b['已用模次']) || 0) - (Number(a['已用模次']) || 0)).slice(0, 5)
      for (const m of topByTotal) {
        lines.push(`- ${m['模具编号']} ${m['模具名称']}：已用 ${fmtNum(m['已用模次'])} 模`)
      }
    }
    return { ok: true, mode: 'local', metrics, llmContext, reply: lines.join('\n') }
  }

  if (/在库|可用|空闲|生产中|维修中|保养中|报废|清单/.test(q)) {
    const targetStatus = ['在库', '生产中', '保养中', '维修中', '报废'].find((s) => q.includes(s)) || (q.includes('可用') || q.includes('空闲') ? '在库' : '')
    const list = targetStatus ? molds.filter((m) => m['状态'] === targetStatus) : molds
    const lines = [targetStatus ? `状态为「${targetStatus}」的模具共 ${list.length} 副：` : `当前模具台账（共 ${list.length} 副）：`, '']
    for (const m of list.slice(0, 12)) {
      lines.push(`- ${m['模具编号']} ${m['模具名称']}｜${m['状态']}${m['库位'] ? `｜库位 ${m['库位']}` : ''}｜剩余寿命 ${fmtPct(m['剩余寿命百分比'])}`)
    }
    if (list.length > 12) lines.push(`…其余 ${list.length - 12} 副可在「模具档案」查看。`)
    return { ok: true, mode: 'local', metrics, llmContext, reply: lines.join('\n') }
  }

  const lines = [
    `当前本地共有 ${total} 副模具，状态分布：${statusText}。`,
    `累计运行 ${fmtNum(totalUsedShots)} 模次${avgLife != null ? `，平均剩余寿命 ${avgLife}%` : ''}。`,
    '',
    '重点关注建议：',
    maintAlerts.length > 0
      ? `• 有 ${maintAlerts.length} 副模具已临近或超出保养周期（优先安排：${maintAlerts.slice(0, 3).map((m) => m['模具编号']).join('、')}）。`
      : '• 保养周期整体可控，暂无到期预警模具。',
    lifeAlerts.length > 0
      ? `• 有 ${lifeAlerts.length} 副模具剩余寿命低于 20%（关注：${lifeAlerts.slice(0, 3).map((m) => `${m['模具编号']}(${fmtPct(m['剩余寿命百分比'])})`).join('、')}），建议提前评估备模/大修。`
      : '• 全部模具剩余寿命均在安全区间（≥20%）。',
    '• 你可以直接输入模具编号（如「分析 MD-1001」），或点击右上角 ⚙ 接入本地模型（如 Ollama / LM Studio）进行深度推理。',
  ]
  return { ok: true, mode: 'local', metrics, llmContext, reply: lines.join('\n') }
}

async function callOpenAiCompatible(cfg, llmContext, question) {
  const endpoint = `${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const headers = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 30000)
  try {
    const rsp = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: '你是制造业个人版「AI 模具管理助手」。请严格基于下方提供的本地真实模具台账数据进行分析，不要编造未提供的数据；回答简洁清晰、分点给出可落地的排查或保养建议。\n\n' + llmContext,
          },
          { role: 'user', content: question },
        ],
      }),
    })
    if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`)
    const data = await rsp.json()
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!content) throw new Error('模型返回内容为空')
    return String(content).trim()
  } finally {
    clearTimeout(timer)
  }
}

function readJsonBody(req, res, cb) {
  let size = 0
  let aborted = false
  const chunks = []
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > 16384) {
      aborted = true
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, message: '请求体过大' }))
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (aborted) return
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { body = {} }
    cb(body)
  })
}

const sendJson = (res, obj) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

export function registerAiRoutes(routes, adapter, prefix) {
  routes[`${prefix}/ai-config`] = (req, res) => {
    if (req.method === 'GET') {
      const cfg = getAiCfg(adapter)
      sendJson(res, { ok: true, enabled: cfg.enabled, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey })
      return
    }
    if (req.method === 'POST') {
      readJsonBody(req, res, (body) => {
        const next = saveAiCfg(adapter, body)
        sendJson(res, { ok: true, enabled: next.enabled, baseUrl: next.baseUrl, model: next.model, hasKey: !!next.apiKey })
      })
      return
    }
    res.writeHead(405, { allow: 'GET, POST' })
    res.end()
  }

  routes[`${prefix}/ai-analyze`] = (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' })
      res.end()
      return
    }
    readJsonBody(req, res, async (body) => {
      try {
        const local = analyzeLocalMolds(adapter, body.question)
        const cfg = getAiCfg(adapter)
        if (cfg.enabled && cfg.baseUrl && cfg.model && String(body.question || '').trim()) {
          try {
            const llmReply = await callOpenAiCompatible(cfg, local.llmContext, String(body.question))
            sendJson(res, { ok: true, mode: 'llm', model: cfg.model, metrics: local.metrics, reply: llmReply })
            return
          } catch (e) {
            sendJson(res, {
              ok: true,
              mode: 'local',
              metrics: local.metrics,
              reply: `${local.reply}\n\n（注：本地模型 ${cfg.model} 调用失败：${String((e && e.message) || e)}，已自动回落本地台账分析）`,
            })
            return
          }
        }
        sendJson(res, { ok: true, mode: 'local', metrics: local.metrics, reply: local.reply })
      } catch (e) {
        sendJson(res, { ok: false, message: String((e && e.message) || e) })
      }
    })
  }
}
