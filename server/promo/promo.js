// server/promo/promo.js —— 推广位本地路由（设计稿-个人版推广位方案 §5.2 定稿）
// 红线：零外部请求、零业务数据出机；素材只认包内 creatives.json 白名单，接口不接受任何运行时外部内容输入。
// 由 createRoutes 尾部调用 registerPromoRoutes(routes, adapter, prefix)，路由键 promo/* 不与 strFunc 值域冲突。
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verify as cryptoVerify, createPublicKey } from 'node:crypto'
import { mimeOf } from '../sqlite/adapter.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const JSON_HEADERS_OK = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

function sendJson(res, status, obj) {
  res.writeHead(status, JSON_HEADERS_OK)
  res.end(JSON.stringify(obj))
}

/** 与 scripts/promoKeygen.mjs 定稿同构的码体验签：strip 分组符 → 末 103 字符 sig、其余 payload base32。 */
const B32ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const SIG_B32_LEN = 103
function b32decode(str) {
  let bits = 0, value = 0
  const bytes = []
  for (const ch of str) {
    const idx = B32ALPHABET.indexOf(ch.toUpperCase())
    if (idx < 0) return null
    value = (value << 5) | idx; bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(bytes)
}
function redeemVerify(pubPem, code) {
  const all = String(code).replace(/[^A-Za-z2-7]/g, '').toUpperCase()
  if (all.length <= SIG_B32_LEN + 8) return { ok: false, reason: '兑换码格式不正确' }
  const pB32 = all.slice(0, all.length - SIG_B32_LEN)
  const sB32 = all.slice(all.length - SIG_B32_LEN)
  const sig = b32decode(sB32)
  if (!sig || sig.length !== 64) return { ok: false, reason: '兑换码格式不正确' }
  let pub
  try { pub = createPublicKey(pubPem) } catch { return { ok: false, reason: '服务端验签公钥未配置' } }
  if (!cryptoVerify(null, Buffer.from(pB32, 'utf8'), pub, sig)) return { ok: false, reason: '兑换码无效（伪造或抄误）' }
  const payload = b32decode(pB32)
  if (!payload) return { ok: false, reason: '兑换码格式不正确' }
  const m = payload.toString('utf8').match(/^([0-9a-f]{12})\.([a-z0-9]+)\.(\d{1,4})$/)
  if (!m || Number(m[3]) < 1) return { ok: false, reason: '兑换码格式不正确' }
  return { ok: true, serial: m[1], batch: m[2], days: Number(m[3]) }
}

// creatives.json 进程内缓存（mtimeMs 失效，配合热更新通道换素材）
let _cfgCache = null
function loadCfg() {
  const p = join(HERE, 'creatives.json')
  if (!existsSync(p)) return { globalEnabled: false, creatives: [] }
  const mt = statSync(p).mtimeMs
  if (_cfgCache && _cfgCache.mt === mt) return _cfgCache.cfg
  const cfg = JSON.parse(readFileSync(p, 'utf8'))
  _cfgCache = { mt, cfg }
  return cfg
}

export function registerPromoRoutes(routes, adapter, prefix) {
  const settingGet = (k) => {
    const row = adapter.db.prepare('select value from app_setting where key = ?').get(k)
    return row && row.value != null ? JSON.parse(row.value) : null
  }
  const settingSet = (k, v) => {
    adapter.db.prepare('insert into app_setting(key, value) values (?, ?) on conflict(key) do update set value = excluded.value').run(k, JSON.stringify(v))
  }
  const vipStatus = () => {
    const exp = settingGet('promo.vip_expire_at')
    return { isVip: typeof exp === 'number' && exp > Date.now(), expireAt: typeof exp === 'number' ? exp : 0 }
  }
  const globallyDisabled = () => settingGet('promo.disabled') === true
  const assetName = (c) => String(c.image || '').split('/').pop() || ''
  const assetExists = (c) => !c.image || (/^[A-Za-z0-9._-]+$/.test(assetName(c)) && existsSync(join(HERE, 'assets', assetName(c))))
  const SLOT_LIMIT7 = { promo_sidebar_footer: 3, promo_list_footer: 2, promo_dashboard_aside: 3 } // 频控：近 7 天 impress 上限
  const impressCount7d = (creativeId) => adapter.db
    .prepare("select count(*) c from promo_events where creative_id = ? and event = 'impress' and ts >= ?")
    .get(creativeId, new Date(Date.now() - 7 * 864e5).toISOString()).c

  // ---------- GET /promo/slots?code=<slot>：VIP/开关/频控过滤后下发，前端只管渲染 ----------
  routes[`${prefix}/promo/slots`] = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const code = String(new URL(req.url, 'http://local').searchParams.get('code') || '')
    const cfg = loadCfg()
    const empty = { ok: true, slots: [], vip: vipStatus().isVip }
    if (cfg.globalEnabled !== true || globallyDisabled() || vipStatus().isVip) { sendJson(res, 200, empty); return }
    const hit = (cfg.creatives || []).filter((c) => c.active === true && c.slot === code && assetExists(c))
    const limit = SLOT_LIMIT7[code]
    const out = limit ? hit.filter((c) => Number(impressCount7d(c.creative_id)) < limit) : hit
    sendJson(res, 200, { ok: true, slots: out.map(({ creative_id, slot, type, title, desc, image, cta, link, badge }) => ({ creative_id, slot, type, title, desc, image, cta, link, badge: badge || '' })), vip: false })
  }

  // ---------- GET /promo/assets/<file>：白名单素材直出（仿 /logo，仅允许 creatives 引用过的文件名） ----------
  const assetHandler = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const file = decodeURIComponent(String(req.url || '').split('?')[0].split('/promo/assets/')[1] || '')
    const cfg = loadCfg()
    const allowed = new Set((cfg.creatives || []).map((c) => String(c.image || '').split('/').pop()))
    if (!file || !allowed.has(file)) { sendJson(res, 404, { ok: false, message: '素材不存在' }); return }
    const abs = join(HERE, 'assets', file)
    if (!abs.startsWith(join(HERE, 'assets')) || !existsSync(abs)) { sendJson(res, 404, { ok: false, message: '素材不存在' }); return }
    const buf = readFileSync(abs)
    const contentType = mimeOf(buf) || (file.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg')
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'public, max-age=86400', 'content-length': buf.length })
    res.end(req.method === 'HEAD' ? undefined : buf)
  }
  routes[`${prefix}/promo/assets/`] = assetHandler
  // 为 Host webServer (kind: 'exact') 显式注册当前白名单内每个素材的精确路径
  for (const c of (loadCfg().creatives || [])) {
    const f = assetName(c)
    if (f) routes[`${prefix}/promo/assets/${f}`] = assetHandler
  }

  // ---------- POST /promo/event：本机埋点（白名单校验后落 promo_events，永不外传） ----------
  routes[`${prefix}/promo/event`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readBody(req, res, 4096, (body) => {
      const { slot, creative_id, event, mode } = body || {}
      if (!['impress', 'click', 'close', 'vip_pay'].includes(event)) { sendJson(res, 200, { ok: false, message: '未知事件' }); return }
      const cfg = loadCfg()
      const c = (cfg.creatives || []).find((x) => x.creative_id === creative_id && x.slot === slot)
      if (!c) { sendJson(res, 200, { ok: false, message: '素材不在白名单' }); return }
      adapter.db.prepare('insert into promo_events(slot, creative_id, event, mode, ts) values (?,?,?,?,?)')
        .run(String(slot), String(creative_id), event, ['once', 'vip'].includes(mode) ? mode : '', new Date().toISOString())
      sendJson(res, 200, { ok: true })
    })
  }

  // ---------- POST /promo/vip/redeem：Ed25519 验签 → 写 vip_expire_at（同码本机仅顺延一次） ----------
  routes[`${prefix}/promo/vip/redeem`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readBody(req, res, 4096, (body) => {
      const cfg = loadCfg()
      if (!cfg.vipPubKey) { sendJson(res, 200, { ok: false, message: '服务端未配置验签公钥' }); return }
      const r = redeemVerify(cfg.vipPubKey.replace(/\\n/g, '\n'), String((body && body.code) || ''))
      if (!r.ok) { sendJson(res, 200, { ok: false, message: r.reason }); return }
      const usedKey = `promo.redeemed:${r.serial}`
      if (settingGet(usedKey) != null) { sendJson(res, 200, { ok: false, message: '该兑换码已在本机使用过' }); return }
      const { expireAt } = vipStatus()
      const base = Math.max(Date.now(), expireAt || 0)
      const next = base + r.days * 864e5
      settingSet('promo.vip_expire_at', next)
      settingSet(usedKey, r.days)
      adapter.db.prepare('insert into promo_events(slot, creative_id, event, mode, ts) values (?,?,?,?,?)')
        .run('vip_yearly', `redeem:${r.batch}`, 'vip_pay', 'vip', new Date().toISOString())
      sendJson(res, 200, { ok: true, expireAt: next, addedDays: r.days, message: '激活成功，推广位已全部下线' })
    })
  }

  // ---------- GET /promo/status：VIP 态 + 全局开关查询（侧栏 VIP 入口与设置页消费） ----------
  routes[`${prefix}/promo/status`] = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const cfg = loadCfg()
    const v = vipStatus()
    sendJson(res, 200, { ok: true, ...v, globalEnabled: cfg.globalEnabled === true && !globallyDisabled() })
  }
}

/** 小体量 JSON body 读取（与 index.js readJsonBody 同语义的模块内联版，避免反向依赖）。 */
function readBody(req, res, maxSize, cb) {
  let size = 0
  let aborted = false
  const chunks = []
  req.on('data', (c) => {
    if (aborted) return
    size += c.length
    if (size > maxSize) {
      aborted = true
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' })
      res.end(JSON.stringify({ ok: false, message: '请求体过大' }))
      req.destroy()
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (aborted) return
    let body
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
      res.writeHead(400, JSON_HEADERS_OK)
      res.end(JSON.stringify({ ok: false, message: '无效 JSON' }))
      return
    }
    cb(body)
  })
  req.on('error', () => { /* 断连由响应超时兜底 */ })
}
