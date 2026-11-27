// server/index.js —— 个人版插件入口 + 薄路由层（设计稿 §2.2.2 / 阶段 2 p2a）
// Host 契约与企业版逐字同构：export name / inject=['tools'] / apply(ctx, config)，
// 路由经 scope.webServer.register({kind:'exact',path,handler}) 挂载。
// createRoutes(adapter, prefix) 独立导出：冒烟探针可直接挂 node:http 全链路验证，零 Host 依赖。
// 端点最小集（个人版能力闭环，出参与企业版 localApi 逐键同形）：
//   GET  /version /pages /org
//   POST /filter /data /billinit /detail /save /billstatus /image /popdata /item /itemdo /colset
// 失败一律如实上抛为 {ok:false,message}（W4），不做防御性兜底。
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { spawn, execFile, execFileSync } from 'node:child_process'
import { PersonalSqliteAdapter, mimeOf } from './sqlite/adapter.js'
import { resolveDataDir } from './sqlite/db.js'
import { buildBillInit, buildDataHead, NUMERIC_METAKEYS } from './sqlite/personal.schema.js'
import { isPageStrFunc, buildPageFilterMeta, buildPageBillInit, buildPageDataHead, numericMetaKeys as pageNumericMetaKeys, auditableColOf } from './sqlite/personal.pages.js'
import { isItemStrFunc } from './sqlite/personal.item.js'
import { isReportStrFunc, buildReport, buildReportDetail } from './sqlite/personal.report.js'
import { buildPushNextRow } from './sqlite/personal.push.js'
import { registerPersonalTools } from './sqlite/personal.tools.js'
import { registerAiRoutes } from './sqlite/personal.ai.js'
import { registerPromoRoutes } from './promo/promo.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'))
// v0.1.7 免重启更新：PKG 是模块加载时快照，自主更新写盘后老模块仍报旧版 —— 版本比对/展示一律实时读盘；
// runningVersion（仍在跑的代码版本）保留 PKG 常量语义，供热更新完成判定（前端轮询它追平 latest 即成功）。
function readPkgVersion() {
  try { return String(JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version || PKG.version) } catch { return String(PKG.version) }
}
let hotReloadGetter = null
async function hotReloadSelf() {
  if (!hotReloadGetter) return { ok: false, why: 'no-ctx' }
  let hmr = null
  try { hmr = hotReloadGetter() } catch (e) { return { ok: false, why: 'get-hmr:' + String((e && e.message) || e) } }
  if (!hmr || typeof hmr.runExclusive !== 'function' || typeof hmr.reconcileProfile !== 'function') return { ok: false, why: 'no-hmr' }
  try {
    const r = await hmr.runExclusive(() => hmr.reconcileProfile([]))
    const blocking = (r && r.restartReason) || (r && r.pending && r.pending.length)
    return blocking ? { ok: false, why: 'pending:' + String(blocking) } : { ok: true }
  } catch (e) { return { ok: false, why: 'err:' + String((e && e.message) || e) } }
}
// 自动更新（2026-11-22）：发布仓 raw package.json 为权威最新版；进程级 10 分钟缓存，失败不缓存。
const UPDATE_REPO_URL = 'https://github.com/zjj869849885/m10-mold-personal.git'
// 国内网络对 raw.githubusercontent 不通很常见（本机 2026-11-22 实测超时），按候选顺序降级探测并记住通的那条。
// v0.2.3 顺序修正：jsdelivr 分支名 @master 有边缘缓存 TTL 会返回旧版本（实测 GitHub 抖动期把「最新版本」
// 钉在旧缓存上），故降级链只排权威新鲜源（api.github、raw.githubusercontent），@master 仅垫底兜网络不通。
const UPDATE_RAW_URLS = [
  'https://api.github.com/repos/zjj869849885/m10-mold-personal/contents/package.json',
  'https://raw.githubusercontent.com/zjj869849885/m10-mold-personal/master/package.json',
  'https://cdn.jsdelivr.net/gh/zjj869849885/m10-mold-personal@master/package.json',
]
let updateGoodUrl = null
const API_GITHUB_PKG_URL = UPDATE_RAW_URLS[0]
/** 逐个抓发布仓 package.json 取 version；成功记住该 URL，全败抛出最后错误（路由如实 ok:false，绝不假报）。 */
async function fetchLatestPkgVersion() {
  const rest = UPDATE_RAW_URLS.filter((u) => u !== API_GITHUB_PKG_URL)
  const order = (updateGoodUrl && updateGoodUrl !== API_GITHUB_PKG_URL) ? [API_GITHUB_PKG_URL, updateGoodUrl, ...rest.filter((u) => u !== updateGoodUrl)] : UPDATE_RAW_URLS.slice()
  let lastErr = null
  for (const u of order) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(6000), headers: { 'cache-control': 'no-cache' } })
      if (!r.ok) throw new Error('HTTP ' + r.status + ' @ ' + new URL(u).host)
      let remote
      if (u.startsWith('https://api.github.com')) {
        // contents API 回 base64（每 76 字符带换行），去空白后解码
        const meta = await r.json()
        const b64 = String(meta.content || '').replace(/\s+/g, '')
        remote = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))))
      } else {
        remote = await r.json()
      }
      updateGoodUrl = u
      return remote && typeof remote.version === 'string' ? remote.version : ''
    } catch (e) { lastErr = e }
  }
  throw lastErr || new Error('all update urls failed')
}
const UPDATE_OWNER_REPO = 'zjj869849885/m10-mold-personal'
const UPDATE_META = new Set(['.gitignore', '.gitattributes'])
/** 解析发布仓 master 最新 commit SHA：api.github 权威（内容随 SHA 不可变，杜绝 jsdelivr @master 边缘缓存返回旧文件）。 */
async function resolveRemoteSha() {
  const u = `https://api.github.com/repos/${UPDATE_OWNER_REPO}/commits/master`
  let lastErr = null
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache', 'user-agent': 'm10-update', accept: 'application/vnd.github+json' } })
    if (!r.ok) throw new Error('resolve sha HTTP ' + r.status)
    const j = await r.json()
    const sha = String(j.sha || '')
    if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('resolve sha invalid')
    return sha
  } catch (e) { lastErr = e }
  // v0.2.3 限流降级：匿名 api.github 配额打爆（403 rate limit）时走 git 协议 ls-remote——直连 origin 实时解析，
  // 不受 REST 配额与 CDN 缓存影响，SHA 权威；本机无 git 环境再落 jsdelivr 清单接口，全败如实上抛。
  try {
    const sha = await resolveRemoteShaViaLsRemote()
    if (sha) return sha
  } catch (e) { lastErr = e }
  // v0.2.3 第三降级：jsdelivr 清单接口拿最新 release tag（semver 取大），再经 @tag 解析重定向取不可变 SHA。
  try {
    const ju = `https://data.jsdelivr.com/v1/packages/gh/${UPDATE_OWNER_REPO}?structure=flat`
    const jr = await fetch(ju, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache' } })
    if (jr.ok) {
      const jj = await jr.json()
      const tags = (jj.versions || []).map((v) => String(v && v.version || '')).filter((t) => /^\d+\.\d+\.\d+$/.test(t))
      tags.sort((a, b) => (semverLt(a, b) ? 1 : -1))
      if (tags.length) {
        const cdn = await fetch(`https://cdn.jsdelivr.net/gh/${UPDATE_OWNER_REPO}@${tags[0]}/package.json`, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) })
        const rm = String(cdn.url || '').match(/@([0-9a-f]{40})\//)
        if (rm) return rm[1]
      }
    }
  } catch (e) { lastErr = e }
  throw lastErr || new Error('resolve sha all sources failed')
}
function resolveRemoteShaViaLsRemote() {
  return new Promise((res, rej) => {
    let gitExe = 'git'
    try { if (process.platform === 'win32') gitExe = process.env.M10_GIT_EXE || 'git' } catch { }
    const p = spawn(gitExe, ['ls-remote', UPDATE_REPO_URL, 'refs/heads/master'], { windowsHide: true })
    let out = ''
    const t = setTimeout(() => { try { p.kill() } catch { } rej(new Error('ls-remote timeout')) }, 12000)
    p.stdout.on('data', (d) => { out += String(d) })
    p.on('error', (e) => { clearTimeout(t); rej(e) })
    p.on('close', () => {
      clearTimeout(t)
      const m = out.match(/^([0-9a-f]{40})\s+refs\/heads\/master/m)
      if (m) res(m[1]); else rej(new Error('ls-remote no master ref'))
    })
  })
}
/** 发布仓文件清单（按 SHA）：api.github git trees 权威，jsdelivr flat 降级。返回相对路径数组（无前导斜杠）。 */
async function fetchRemoteFileList(sha) {
  try {
    const gu = `https://api.github.com/repos/${UPDATE_OWNER_REPO}/git/trees/${sha}?recursive=1`
    const gr = await fetch(gu, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache', 'user-agent': 'm10-update' } })
    if (gr.ok) {
      const gj = await gr.json()
      const names = (gj.tree || []).filter((t) => t.type === 'blob').map((t) => String(t.path)).filter((p) => p && !UPDATE_META.has(p))
      if (names.length) return names
    }
  } catch { /* 落降级 */ }
  const u = `https://data.jsdelivr.com/v1/packages/gh/${UPDATE_OWNER_REPO}@${sha}?structure=flat`
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error('file list HTTP ' + r.status)
  const j = await r.json()
  return (j.files || []).map((f) => String(f.name || '').replace(/^\/+/, '')).filter((n) => n && !UPDATE_META.has(n))
}
/** 下载单个文件（按 SHA 不可变）：jsdelivr CDN@sha 优先（内容随 SHA 固定，绝不返回旧缓存），降级 api.github contents base64。 */
async function fetchRemoteFile(sha, rel) {
  const cdn = `https://cdn.jsdelivr.net/gh/${UPDATE_OWNER_REPO}@${sha}/${rel}`
  try {
    const r = await fetch(cdn, { signal: AbortSignal.timeout(15000) })
    if (r.ok) return Buffer.from(await r.arrayBuffer())
  } catch { /* 落降级 */ }
  const api = `https://api.github.com/repos/${UPDATE_OWNER_REPO}/contents/${rel}?ref=${sha}`
  const r2 = await fetch(api, { signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-cache', 'user-agent': 'm10-update' } })
  if (!r2.ok) return null
  const meta = await r2.json()
  const b64 = String(meta.content || '').replace(/\s+/g, '')
  return Buffer.from(b64, 'base64')
}

const UPDATE_TTL_MS = 10 * 60 * 1000
let updCache = null
/** 三段式 semver 比较 a<b（缺段按 0）；仅数值段有效，预发布后缀忽略——发布仓约定纯 x.y.z。 */
function semverLt(a, b) {
  const pa = String(a || '').split('.')
  const pb = String(b || '').split('.')
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0
    const y = parseInt(pb[i], 10) || 0
    if (x !== y) return x < y
  }
  return false
}
// 本机登录账户名（方案A）：/pages user.name 与新单据 FCreater 的真实来源。
// os.userInfo() 属 Node 内置零依赖；异常/空值如实回落占位「本机用户」，不伪造用户名。
const LOCAL_USER = (() => {
  try {
    const u = os.userInfo().username
    return u ? u.charAt(0).toUpperCase() + u.slice(1) : '本机用户'
  } catch {
    return '本机用户'
  }
})()
// 操作员名解析（Harness 登录账号优先）：显示规则与宿主账号菜单一致，name 为空时取 contact。
// watch(..., true) 即时感知身份变化；服务缺失/未登录/离线/异常时回落本机用户。
// deepseekAccount 非本包静态 inject，必须用 ctx.inject 动态获取。
function makeOperator(ctx) {
  let opName = '', inflight = null, forced = null, inflightForce = false, inflightEpoch = 0, lastTry = 0, acct = null, watching = false, epoch = 0
  const lifetime = new AbortController()
  const fallbackName = () => String(typeof fallback === 'function' ? fallback() : (fallback || '')).trim()
  const fallbackValue = () => LOCAL_USER
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const identityOf = (profile) => {
    if (!profile || profile.status !== 'ready' || !profile.value) return ''
    return [profile.value.name, profile.value.contact]
      .map((value) => String(value == null ? '' : value).trim())
      .find(Boolean) || ''
  }
  async function startRefresh(force) {
    if (!acct || typeof acct.getProfile !== 'function') return
    const now = Date.now()
    if (!force && now - lastTry < 15000) return
    lastTry = now
    const requestEpoch = epoch
    const request = (async () => {
      try {
        const profile = await acct.getProfile({ version: String(PKG.version || '0.0.0'), locale: 'zh-CN', timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 })
        if (requestEpoch !== epoch) return
        if (profile === null) opName = ''
        else if (profile && profile.status === 'ready') opName = identityOf(profile)
      } catch { /* 离线/未登录：保留最近一次成功值，等待 watch 或下次刷新 */ }
    })()
    inflight = request
    inflightForce = force
    inflightEpoch = requestEpoch
    try { await request } finally { if (inflight === request) { inflight = null; inflightForce = false } }
  }
  function refresh(force) {
    if (!inflight) return startRefresh(force)
    if (!force || (inflightForce && inflightEpoch === epoch)) return inflight
    if (forced) return forced
    // 强制刷新与在途普通查询合并：旧查询结束后所有等待者共享一次新查询。
    forced = inflight.then(() => startRefresh(true)).finally(() => { forced = null })
    return forced
  }
  function watchIdentity() {
    if (watching || !acct || typeof acct.watch !== 'function') return
    watching = true
    void (async () => {
      try {
        for await (const update of acct.watch(lifetime.signal, true)) {
          if (lifetime.signal.aborted) break
          epoch += 1
          if (!update || !update.state || update.state.status !== 'credential-stored') {
            opName = ''
            continue
          }
          if (update.type === 'credentials-changed') opName = ''
          await refresh(true)
        }
      } catch { /* 服务关闭/连接中断：保留节流与有界等待兜底 */ }
    })()
  }
  try {
    if (ctx && typeof ctx.inject === 'function') {
      ctx.inject(['deepseekAccount'], (scope) => {
        acct = scope.deepseekAccount
        void refresh(true)
        watchIdentity()
      })
    }
  } catch { /* mock/无该服务：使用回落值 */ }
  if (ctx && typeof ctx.effect === 'function') ctx.effect(() => () => lifetime.abort())
  return {
    current() { return opName || fallbackValue() },
    async ensure(timeoutMs = 2000, force = false) {
      const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0)
      await Promise.race([refresh(force), sleep(Math.max(1, deadline - Date.now()))])
      if (opName) return opName
      while (Date.now() < deadline) {
        await sleep(100)
        await Promise.race([refresh(false), sleep(Math.max(1, deadline - Date.now()))])
        if (opName) return opName
      }
      return opName || fallbackValue()
    },
  }
}
export const name = PKG.name
export const inject = ['tools']

/**
 * 个人版静态页清单（与企业版 pages.js 同形状：groups[].pages[]{name,strFunc,form}）。
 * 分组对齐企业侧栏语义（模具管理/维修管理/点检·保养），不再把 4 页全塞在「模具管理」下。
 * 企业版分组：模具管理(6)、点检管理(4)、保养管理(4)、维修管理(5)、业务处理(12)、报表分析(15)。
 * 个人版分组：模具管理(6：4 dp + 2 item)、维修管理(1)、点检·保养(1)。
 * 模具管理组同时容纳 dp 主页（档案/部件/备件/组）与 item 基础资料（模具类型/部件分类），与 ListView 数据驱动契约零冲突。
 */
const PAGE_GROUPS = [
  {
    key: 'pg090',
    name: '基础资料',
    pages: [
      { name: '模具类型', fNumber: '210150090001', strFunc: 'MDType', form: 'item' },
      { name: '模具部件分类', fNumber: '210150090002', strFunc: 'MDPartClass', form: 'item' },
      { name: '库位', fNumber: '210150090003', strFunc: 'MDLocation', form: 'item' },
      { name: '模具组', fNumber: '210150090004', strFunc: 'MDMoldGroup', form: 'item' },
      { name: '供应商', fNumber: '210150090005', strFunc: 'MDSupplier', form: 'item' },
      { name: '客户', fNumber: '210150090006', strFunc: 'MDCustomer', form: 'item' },
      { name: '车间/部门', fNumber: '210150090007', strFunc: 'MDDept', form: 'item' },
      { name: '生产中心', fNumber: '210150090008', strFunc: 'MDProdLine', form: 'item' },
      { name: '仓库', fNumber: '210150090009', strFunc: 'MDStock', form: 'item' },
      { name: '人员', fNumber: '210150090010', strFunc: 'MDEmployee', form: 'item' },
      { name: '计量单位', fNumber: '210150090011', strFunc: 'MDUnit', form: 'item' },
      { name: '币别', fNumber: '210150090012', strFunc: 'MDCurrency', form: 'item' },
      { name: '岗位/角色', fNumber: '210150090013', strFunc: 'MDPosition', form: 'item' },
      { name: '点检项目类型', fNumber: '210150090014', strFunc: 'MDChkItemType', form: 'item' },
      { name: '保养项目类型', fNumber: '210150090015', strFunc: 'MDMainItemType', form: 'item' },
      { name: '组织', fNumber: '210150090016', strFunc: 'MDOrg', form: 'item' },
    ],
  },
  {
    key: 'pg100',
    name: '模具管理',
    pages: [
      { name: '模具档案', fNumber: '203101', strFunc: '203101', form: 'dp', p0: true },
      { name: '部件档案', fNumber: '203102', strFunc: '203102', form: 'dp', p0: true },
      { name: '备件档案', fNumber: '203103', strFunc: '203103', form: 'dp', p0: true },
    ],
  },
  {
    key: 'pg120',
    name: '点检管理基础资料',
    pages: [
      { name: '点检项目', fNumber: '210150120002', strFunc: '203110', form: 'dp' },
      { name: '点检方案', fNumber: '210150120003', strFunc: '203111', form: 'dp' },
    ],
  },
  {
    key: 'pg115',
    name: '点检管理',
    pages: [
      { name: '点检任务单', fNumber: '203114', strFunc: '203114', form: 'dp' },
      { name: '点检记录', fNumber: '203116', strFunc: '203116', form: 'dp' },
    ],
  },
  {
    key: 'pg140',
    name: '保养管理基础资料',
    pages: [
      { name: '保养项目', fNumber: '210150140002', strFunc: '203120', form: 'dp' },
      { name: '保养方案', fNumber: '210150140003', strFunc: '203121', form: 'dp' },
    ],
  },
  {
    key: 'pg135',
    name: '保养管理',
    pages: [
      { name: '保养任务单', fNumber: '203124', strFunc: '203124', form: 'dp' },
      { name: '保养记录', fNumber: '203126', strFunc: '203126', form: 'dp' },
    ],
  },
  {
    key: 'pg130',
    name: '维修管理',
    pages: [
      { name: '报修单', fNumber: '203130', strFunc: '203130', form: 'dp' },
      { name: '维修任务单', fNumber: '203131', strFunc: '203131', form: 'dp' },
      { name: '维修记录', fNumber: '203133', strFunc: '203133', form: 'dp' },
    ],
  },
  {
    key: 'pg150',
    name: '业务处理',
    pages: [
      { name: '生产申领单', fNumber: '203140', strFunc: '203140', form: 'dp' },
      { name: '出库申请单', fNumber: '203141', strFunc: '203141', form: 'dp' },
      { name: '领用记录单', fNumber: '203142', strFunc: '203142', form: 'dp' },
      { name: '归还记录单', fNumber: '203143', strFunc: '203143', form: 'dp' },
      { name: '报废单', fNumber: '203146', strFunc: '203146', form: 'dp' },
      { name: '使用汇报单', fNumber: '203149', strFunc: '203149', form: 'dp' },
      { name: '盘点记录单', fNumber: '203151', strFunc: '203151', form: 'dp' },
      { name: '状态变更单', fNumber: '203153', strFunc: '203153', form: 'dp' },
    ],
  },
  {
    key: 'pg160',
    name: '报表分析',
    pages: [
      { name: '点检报表', fNumber: 'C001', strFunc: 'C001', form: 'report' },
      { name: '保养报表', fNumber: 'C002', strFunc: 'C002', form: 'report' },
      { name: '报修报表', fNumber: 'C003', strFunc: 'C003', form: 'report' },
      { name: '维修报表', fNumber: 'C004', strFunc: 'C004', form: 'report' },
      { name: '领用报表', fNumber: 'C005', strFunc: 'C005', form: 'report' },
      { name: '归还报表', fNumber: 'C006', strFunc: 'C006', form: 'report' },
      { name: '寿命报表', fNumber: 'C007', strFunc: 'C007', form: 'report' },
      { name: '日常业务处理记录', fNumber: 'C009', strFunc: 'C009', form: 'report' },
      { name: '故障次数统计', fNumber: 'C010', strFunc: 'C010', form: 'reportmulti' },
      { name: '保养执行报表', fNumber: 'C011', strFunc: 'C011', form: 'report' },
      { name: '人员任务统计', fNumber: 'C012', strFunc: 'C012', form: 'reportmulti' },
      { name: '报废预测', fNumber: 'C013', strFunc: 'C013', form: 'report' },
      { name: '使用情况统计', fNumber: 'C014', strFunc: 'C014', form: 'report' },
      { name: '模具履历', fNumber: 'C015', strFunc: 'C015', form: 'reportmulti' },
    ],
  },
]
const MODULE_DEF = { mid: 'S20', fNumber: '210150', parentNumber: '210', name: '模具管理' }
const COUNTS = { dp: 22, item: 16, total: 52 }
const EDITION = 'personal'

const JSON_HEADERS_OK = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

/**
 * b8 二维码标签「扫码直达」基址（设计稿 §6 坑 1：绝不把 localhost/127.0.0.1/0.0.0.0 编进二维码）。
 * 优先取请求 Host；命中回环/通配地址时使用默认路由优选后的 hostLanIp，避免 VPN 虚拟网卡假地址。
 */
function detectLanBase(req, forceIp = false) {
  const hostHdr = String((req.headers && req.headers.host) || '')
  const sep = hostHdr.lastIndexOf(':')
  const h = sep > 0 ? hostHdr.slice(0, sep) : hostHdr
  const port = sep > 0 ? hostHdr.slice(sep) : ''
  const isLoopback = !h || h === 'localhost' || h.startsWith('127.') || h === '0.0.0.0' || h === '[::1]' || h === '::1'
  if (!isLoopback) return 'http://' + hostHdr
  const ip = hostLanIp(forceIp)
  if (ip) return 'http://' + ip + port
  const ifaces = os.networkInterfaces()
  for (const k of Object.keys(ifaces)) {
    for (const a of ifaces[k] || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && usableLanIp(String(a.address))) return 'http://' + a.address + port
    }
  }
  return 'http://' + (hostHdr || '127.0.0.1')
}

/**
 * 本机服务真实监听绑定形态（多端排障 2026-11-22）：桌面 App 形态宿主固定 --host 127.0.0.1 --port 0，
 * 只监听回环 + 随机端口，手机经局域网必然连不通，而 detectLanBase 仍会拼出「首个非内部 IPv4 + 当前端口」的
 * 幻影地址。故如实回报监听绑定地址与可达结论，供设置页收口地址/二维码展示，不再误导用户查 WiFi 与防火墙。
 * 取不到监听地址时如实回 unknown，并按可达处理（维持旧行为，绝不凭猜测报警）。
 */
function detectLanBindable(req) {
  let addr = ''
  try {
    const srv = req && req.socket && req.socket.server
    const a = srv && typeof srv.address === 'function' ? srv.address() : null
    addr = String((a && a.address) || '')
  } catch {
    addr = ''
  }
  if (!addr) return { bindAddress: '', lanBindable: true }
  const x = addr.replace(/^\[|\]$/g, '')
  const loopback = x === '::1' || x === '0:0:0:0:0:0:0:1' || /^127\./.test(x) || /^::ffff:127\./.test(x)
  return { bindAddress: x, lanBindable: !loopback }
}

/**
 * 局域网实例授权文件（多端自动地址 2026-11-22）：boot token 只存在于宿主进程内存（browser-auth WeakMap），
 * 插件拿不到；官方启动入口（bootPersonal3081.ps1 / personalLan.ps1 start）启动成功后把
 * {ip,port,lanUrl,token,pid} 落盘。局域网侧 /version 见 pid 与当前进程一致即自证，拼含 token 的免登录
 * grantUrl，设置页自动生成可扫二维码（不带 token 的码手机首开必被宿主 401 拦——「扫开打不开」的真因）；
 * 回环侧（桌面 App）读文件并实探局域网实例可达性，桌面设置页同样自动显示地址与二维码。
 * DSH_PERSONAL_LAN_FILE 可覆盖路径；文件缺失/畸形一律如实回 null，绝不猜测。
 */
function lanGrantFilePath() {
  try {
    if (process.env.DSH_PERSONAL_LAN_FILE) return process.env.DSH_PERSONAL_LAN_FILE
    return join(os.homedir(), '.dsh', 'profiles', 'personal', 'lan-instance.json')
  } catch { return '' }
}
function readLanGrantFile() {
  const p = lanGrantFilePath()
  if (!p) return null
  try {
    const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
    if (!j || typeof j.lanUrl !== 'string' || !/^https?:\/\/.+/.test(j.lanUrl)) return null
    const token = typeof j.token === 'string' ? j.token : ''
    return {
      lanUrl: j.lanUrl,
      grantUrl: token ? j.lanUrl.replace(/\/+$/, '') + '/?token=' + token : '',
      pid: Number(j.pid) || 0,
    }
  } catch { return null }
}
/** 实探局域网实例：GET <baseUrl>/…/version 期望 lanBindable=true；1.5s 超时如实回 false。 */
async function probeLanAlive(baseUrl, apiPrefix) {
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, '') + apiPrefix + '/version', { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    const j = await res.json()
    return !!(j && j.ok === true && j.lanBindable === true)
  } catch { return false }
}

/**
 * 主机 IANA 时区（阶段 5 多时区显示层锚点）：库内 datetime 是主机本地墙钟（jsonNorm 用 UTC 取值器输出无偏移 yyyy-MM-dd HH:mm:ss），
 * 前端需知道这堵墙钟属于哪个时区才能正确换算到浏览设备时区。取运行本插件的 Node 进程 OS 时区，纯新增、异常回空串。
 */
/** 本机真实局域网 IPv4（多端 IP 显示/漂移）：Windows 默认路由接口优先，192.168 网段次之，
 * 避免 VPN/TUN 虚拟网卡使用私有网段地址时抢在真实 WiFi 前被枚举选中。 */
const HOST_LAN_IP_TTL = 5000
let hostLanIpCache = { at: 0, ip: '' }

function usableLanIp(ip) {
  return !!ip && ip !== '0.0.0.0' && ip !== '255.255.255.255' && !ip.startsWith('127.') &&
    !ip.startsWith('169.254.') && !/^198\.(18|19)\./.test(ip) && !/^(22[4-9]|23\d)\./.test(ip)
}
function lanIpRank(ip) {
  if (ip.startsWith('192.168.')) return 0
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1
  if (ip.startsWith('10.')) return 2
  return 3
}
/** 纯函数：默认路由地址排在候选前，同档位稳定保持枚举顺序；192.168 > 172 > 10 > 其他。 */
export function pickLanIp(candidates = [], preferred = []) {
  const clean = (arr) => Array.from(new Set((arr || []).map((x) => String(x || '').trim()).filter(usableLanIp)))
  const pool = clean([...(preferred || []), ...(candidates || [])])
  pool.sort((a, b) => lanIpRank(a) - lanIpRank(b))
  return pool[0] || ''
}
/** Windows 默认路由（0.0.0.0/0）按 metric 排序后取接口 IPv4；失败由 hostLanIp 回退系统枚举。 */
function defaultRouteLanIps() {
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$routes=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric",
    "foreach($r in $routes){$a=Get-NetIPAddress -InterfaceIndex $r.ifIndex -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1; if($a){$a.IPAddress}}",
  ].join(';')
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', timeout: 1500, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  })
  return String(out).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
}
function hostLanIp(force = false) {
  const now = Date.now()
  if (!force && hostLanIpCache.ip && now - hostLanIpCache.at < HOST_LAN_IP_TTL) return hostLanIpCache.ip
  const candidates = []
  try {
    const ifaces = os.networkInterfaces()
    for (const k of Object.keys(ifaces)) {
      for (const a of ifaces[k] || []) {
        if ((a.family === 'IPv4' || a.family === 4) && !a.internal) candidates.push(String(a.address))
      }
    }
  } catch { /* ignore */ }
  let preferred = []
  if (process.platform === 'win32') {
    try { preferred = defaultRouteLanIps() } catch { /* 回退系统枚举 */ }
  }
  const ip = pickLanIp(candidates, preferred)
  if (ip) hostLanIpCache = { at: now, ip }
  return ip
}
/** 仅本机回环可调（多端一键启停 v0.2.0）：手机侧/远程请求一律拒绝，避免任意设备触发启停。 */
function isLoopbackReq(req) {
  const ra = String((req && req.socket && req.socket.remoteAddress) || '')
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1'
}
/** 随插件发布的局域网启停脚本绝对路径（相对 server 目录，绝不硬编码工作区/绝对盘符）。 */
function lanScriptPath() {
  try {
    const p = join(HERE, '..', 'scripts', 'personalLan.ps1')
    return existsSync(p) ? p : ''
  } catch { return '' }
}
let lanCtlBusy = false

// ───────── 进程内独立局域网 HTTP 服务（多端零外部依赖方案） ─────────
// 解决问题：别的电脑只装了桌面版 App + 插件，没有全局 Node.js 或几百 MB 的 Harness 源码仓（apps/cli/src/bin.ts），
// 原 personalLan.ps1 拉起外部宿主必然失败并卡 60 秒超时。
// 现改为直接在当前插件 Node 进程内起 node:http 监听 0.0.0.0:3081，复用同一套 routes 与 SQLite adapter，
// 并直出内联了 React 18 运行时的单页 Web 应用（client.js），任何电脑零配置秒启动。
const DEFAULT_LAN_PORT = 3081
let inProcLan = null // { server, port, token, ip, lanUrl, grantUrl, startedAt }

function writeLanGrantJson(info) {
  const p = lanGrantFilePath()
  if (!p) return
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify({
      ip: info.ip,
      port: info.port,
      lanUrl: info.lanUrl,
      token: info.token,
      pid: process.pid,
      mode: 'inproc',
      startedAt: info.startedAt,
    }))
  } catch { /* ignore */ }
}

function removeLanGrantJsonIfSelf() {
  const p = lanGrantFilePath()
  if (!p || !existsSync(p)) return
  try {
    const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''))
    if (j && (j.pid === process.pid || j.mode === 'inproc')) rmSync(p, { force: true })
  } catch { /* ignore */ }
}

function ensureWindowsFirewall() {
  if (process.platform !== 'win32') return
  try {
    const exe = process.execPath
    const cmd = `$exe = '${exe.replace(/'/g, "''")}'; $ok = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True -ErrorAction SilentlyContinue | Where-Object { ($_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program -eq $exe }; if (-not $ok) { New-NetFirewallRule -DisplayName 'DSH Personal LAN (in-process)' -Direction Inbound -Action Allow -Program $exe -Profile Any -ErrorAction SilentlyContinue | Out-Null }`
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
  } catch { /* 非管理员或受限环境静默跳过，不阻断服务 */ }
}

function parseCookies(req) {
  const out = {}
  const raw = String((req.headers && req.headers.cookie) || '')
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

// /version 调用方是否可信：本机回环，或携带有效局域网 token/Cookie。
// 安全门（v0.3.0）：/version 在进程内 LAN 服务里免鉴权（探活用），若不门控会把含 token 的 grantUrl
// 泄给局域网匿名请求，拿到即可绕过全部 401 拦截；匿名侧只给 alive/url，不给 grantUrl。
function lanCallerTrusted(req) {
  try {
    if (isLoopbackReq(req)) return true
    if (!inProcLan || !inProcLan.token) return false
    const u = new URL(req.url || '/', 'http://localhost')
    const q = u.searchParams.get('token') || ''
    const c = parseCookies(req)['m10_lan_token'] || ''
    return q === inProcLan.token || c === inProcLan.token
  } catch { return false }
}

function buildStandaloneHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>AI模具管理</title>
  <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  <style>
    html, body, #m10-standalone-root {
      margin: 0; padding: 0; width: 100%; height: 100%;
      overflow: hidden; background: #f5f6f7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
  </style>
</head>
<body>
  <div id="m10-standalone-root"></div>
  <script src="/client.js"></script>
</body>
</html>`
}

async function startInProcLanServer(routes, prefix, port = DEFAULT_LAN_PORT) {
  const curIp = hostLanIp() || '127.0.0.1'
  if (inProcLan && inProcLan.server && inProcLan.server.listening) {
    if (inProcLan.ip !== curIp && curIp !== '127.0.0.1') {
      inProcLan.ip = curIp
      inProcLan.lanUrl = `http://${curIp}:${inProcLan.port}`
      inProcLan.grantUrl = `${inProcLan.lanUrl}/?token=${inProcLan.token}`
      writeLanGrantJson(inProcLan)
    }
    return { ok: true, already: true, info: inProcLan }
  }
  const token = randomBytes(18).toString('base64url')
  const clientJsPath = join(HERE, '..', 'client.js')
  const iconPath = join(HERE, '..', 'icon.svg')

  const srv = createServer((req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://localhost')
      const pathname = u.pathname
      // 1. 静态图标与版本探针免鉴权（供 probeLanAlive 与浏览器标签图标加载）
      if (pathname === `${prefix}/version` && routes[pathname]) {
        const r = routes[pathname](req, res)
        if (r && typeof r.catch === 'function') r.catch((e) => { if (!res.writableEnded) sendJson(res, 200, { ok: false, message: String((e && e.message) || e) }) })
        return
      }
      if (pathname === '/icon.svg' || pathname === '/favicon.ico') {
        if (existsSync(iconPath)) {
          res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=3600' })
          res.end(readFileSync(iconPath))
        } else {
          res.writeHead(204); res.end()
        }
        return
      }

      // 2. Token / Cookie 鉴权（本机回环请求或携带有效 token/cookie 均放行）
      const qToken = u.searchParams.get('token') || ''
      const cookies = parseCookies(req)
      const cToken = cookies['m10_lan_token'] || ''
      const activeToken = (inProcLan && inProcLan.token) || token
      const authed = isLoopbackReq(req) || (qToken && qToken === activeToken) || (cToken && cToken === activeToken)

      if (!authed) {
        if (pathname.startsWith(prefix + '/')) {
          sendJson(res, 401, { ok: false, sessionExpired: true, message: '未授权或会话已过期，请在电脑端设置页重新扫码访问' })
        } else {
          res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
          res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>需要扫码授权</title></head><body style="font-family:system-ui,sans-serif;padding:32px;text-align:center;color:#333;"><h3>访问未授权或已过期</h3><p>请在电脑端「设置 → 手机局域网访问」中扫描二维码打开本页面。</p></body></html>')
        }
        return
      }

      // 若 URL 携带有效 token，种下 HttpOnly Cookie，后续 API / 刷新免带参数
      const setCookieHdr = (qToken && qToken === activeToken)
        ? `m10_lan_token=${activeToken}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`
        : ''

      // 3. 前端脚本产物
      if (pathname === '/client.js') {
        if (!existsSync(clientJsPath)) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('client.js not found')
          return
        }
        const headers = { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' }
        if (setCookieHdr) headers['set-cookie'] = setCookieHdr
        res.writeHead(200, headers)
        res.end(readFileSync(clientJsPath))
        return
      }

      // 4. 插件业务 API 路由
      const handler = routes[pathname] || (pathname.startsWith(`${prefix}/promo/assets/`) ? routes[`${prefix}/promo/assets/`] : null)
      if (handler) {
        if (setCookieHdr) res.setHeader('set-cookie', setCookieHdr)
        const r = handler(req, res)
        if (r && typeof r.catch === 'function') r.catch((e) => { if (!res.writableEnded) sendJson(res, 200, { ok: false, message: String((e && e.message) || e) }) })
        return
      }

      // 5. 根路径及前端页面直出独立 Web HTML 壳
      if (req.method === 'GET' || req.method === 'HEAD') {
        const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
        if (setCookieHdr) headers['set-cookie'] = setCookieHdr
        res.writeHead(200, headers)
        res.end(req.method === 'HEAD' ? undefined : buildStandaloneHtml())
        return
      }

      res.writeHead(404, JSON_HEADERS_OK)
      res.end(JSON.stringify({ ok: false, message: 'NOT_FOUND' }))
    } catch (e) {
      if (!res.writableEnded) sendJson(res, 500, { ok: false, message: String((e && e.message) || e) })
    }
  })

  try {
    await new Promise((resolveP, rejectP) => {
      const onErr = (err) => { srv.removeListener('listening', onListen); rejectP(err) }
      const onListen = () => { srv.removeListener('error', onErr); resolveP() }
      srv.once('error', onErr)
      srv.once('listening', onListen)
      srv.listen(port, '0.0.0.0')
    })
  } catch (e) {
    try { srv.close() } catch { /* ignore */ }
    return { ok: false, code: e && e.code, message: String((e && e.message) || e) }
  }

  const actualPort = (srv.address() && typeof srv.address() === 'object' ? srv.address().port : port) || port
  const lanUrl = `http://${curIp}:${actualPort}`
  const grantUrl = `${lanUrl}/?token=${token}`
  const startedAt = new Date().toISOString().replace('T', ' ').slice(0, 19)
  inProcLan = { server: srv, port: actualPort, token, ip: curIp, lanUrl, grantUrl, startedAt }
  writeLanGrantJson(inProcLan)
  ensureWindowsFirewall()
  return { ok: true, info: inProcLan }
}

async function stopInProcLanServer() {
  if (!inProcLan || !inProcLan.server) return false
  const srv = inProcLan.server
  inProcLan = null
  removeLanGrantJsonIfSelf()
  await new Promise((resolveP) => {
    try {
      srv.close(() => resolveP())
      if (typeof srv.closeAllConnections === 'function') srv.closeAllConnections()
    } catch { resolveP() }
  })
  return true
}
function detectHostTz() {
  try { return String(Intl.DateTimeFormat().resolvedOptions().timeZone || '') } catch { return '' }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, JSON_HEADERS_OK)
  res.end(body)
}

/** 自定义 Logo 辅助：查找 dataDir 下的 custom-logo.* 文件（返回绝对路径或 null）。 */
function _findLogoFile(dataDir) {
  for (const ext of ['png', 'jpg', 'webp', 'svg']) {
    const p = join(dataDir, `custom-logo.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}
/** 清除 dataDir 下所有 custom-logo.* 文件。 */
function _removeLogoFiles(dataDir) {
  for (const ext of ['png', 'jpg', 'webp', 'svg']) {
    try { rmSync(join(dataDir, `custom-logo.${ext}`), { force: true }) } catch { /* ignore */ }
  }
}

/** 与企业版同口径的 JSON body 读取（上限 + 解析失败回 400 并返回 null）。 */
function readJsonBody(req, res, maxSize, cb) {
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
      // 优雅 FIN（socket.end）而非 RST（req.destroy）：大体积上传途中立即 destroy 会抢先发 RST，
      // 把已写入的 413 响应字节连同客户端接收缓冲一起丢弃（客户端只剩“网络中断”，违 W4 如实上抛）。
      // 413 经全双工在上传途中即可抵达，故等冲刷完成（finish）后优雅半关。
      res.on('finish', () => { try { req.socket.end() } catch { /* 已关闭忽略 */ } })
      return
    }
    chunks.push(c)
  })
  req.on('end', () => {
    if (aborted || res.writableEnded) return
    let parsed = null
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      sendJson(res, 400, { ok: false, message: '请求体不是合法 JSON' })
      return
    }
    // cb 在事件回调里执行，apply 注册层的同步 try/catch 罩不到：
    // 此处不兼平则路由内任何异步抛错（如非法图片 saveImage Throw）直接 uncaughtException 打崩 Host 进程。
    // 包上闸：如实上抛为 {ok:false,message}（W4），绝不静默吞。
    try {
      cb(parsed == null || typeof parsed !== 'object' ? {} : parsed)
    } catch (e) {
      if (!res.writableEnded) sendJson(res, 200, { ok: false, message: String((e && e.message) || e) })
    }
  })
  req.on('error', () => {
    if (!res.writableEnded) sendJson(res, 400, { ok: false, message: '请求读取失败' })
  })
}

/** 个人版受理删除/审核/反审核（TargetStatus '2'/'5'/'1'）；关闭/作废等其余状态动作能力裁剪，如实回错。 */
function unsupportedStatus(targetStatus) {
  const labels = { 6: '关闭', 3: '作废', 4: '提交' }
  return `个人版不支持该状态操作（${labels[String(targetStatus)] || String(targetStatus)}）`
}

/** strFunc 白名单：模具档案 203101（personal.schema.js 既有绿色路径）+ 补齐子页（personal.pages.js 通用引擎）。 */
const knownPage = (strFunc) => strFunc === '203101' || isPageStrFunc(strFunc)
const isMold = (strFunc) => strFunc === '203101'

/**
 * 生成 path → handler 的纯映射（探针/Host 共用）。handler(req,res) 自带方法网关与错误上抛。
 * @param adapter PersonalSqliteAdapter 实例
 * @param prefix  路由前缀（默认 /m10-mold-personal/api）
 */
export function createRoutes(adapter, prefix = '/m10-mold-personal/api', operator = { current: () => LOCAL_USER, ensure: async () => LOCAL_USER }, hooks = {}) {
  const unknownFunc = (strFunc) => ({ ok: false, sessionExpired: false, message: `未知或未接入的页面 strFunc：${JSON.stringify(strFunc)}` })

  const routes = {}
  // v0.1.7 热更新：apply() 经 hooks 传下取宿主 hmr 的闭包；零 Host 探针不传 hooks 则热更自动降级为「重启生效」。
  if (hooks && typeof hooks.getHotReload === 'function') hotReloadGetter = hooks.getHotReload

  routes[`${prefix}/version`] = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const refreshIp = /(?:^|[?&])refresh=1(?:&|$)/.test(String((req && req.url) || ''))
    const bind = detectLanBindable(req)
    const lanUrl = detectLanBase(req, refreshIp)
    // 局域网实例自动探测（多端 2026-11-23 升级进程内独立 HTTP 服务）：
    // ① 优先识别本进程内已启动的 node:http 独立局域网实例（inProcLan），零外部依赖、单进程同 SQLite 库；
    // ② 其次局域网侧自证并带 grantUrl（启动脚本落盘的授权文件 pid 吻合或就是 inProcLan）；
    // ③ 回环侧（桌面 App）实探授权文件指向的外部实例，探通才报 alive——绝不凭文件存在就给出打不开的地址。
    let lanInstance = null
    const grant = readLanGrantFile()
    if (inProcLan && inProcLan.server && inProcLan.server.listening) {
      const curIp = hostLanIp() || inProcLan.ip || '127.0.0.1'
      const curUrl = `http://${curIp}:${inProcLan.port}`
      // 安全门（v0.3.0）：仅回环或持有效 token/Cookie 的调用方可见 grantUrl，防匿名 /version 泄漏 token 绕过鉴权
      lanInstance = { alive: true, url: curUrl, grantUrl: lanCallerTrusted(req) ? `${curUrl}/?token=${inProcLan.token}` : null, via: bind.lanBindable ? 'self' : 'inproc' }
    } else if (bind.lanBindable) {
      lanInstance = { alive: true, url: lanUrl, grantUrl: grant && grant.pid === process.pid ? grant.grantUrl || null : null, via: 'self' }
    } else if (grant && await probeLanAlive(grant.lanUrl, prefix)) {
      lanInstance = { alive: true, url: grant.lanUrl, grantUrl: grant.grantUrl || null, via: 'probe' }
    }
    const body = JSON.stringify({
      ok: true, name: PKG.name, version: readPkgVersion(), runningVersion: String(PKG.version), hotReloadAvailable: !!hotReloadGetter, edition: EDITION, schemaVersion: adapter.schemaVersion,
      lanUrl, hostTz: detectHostTz(), hostLanIp: hostLanIp(refreshIp),
      lanBindable: bind.lanBindable, bindAddress: bind.bindAddress,
      lanInstance,
    })
    res.writeHead(200, JSON_HEADERS_OK)
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  // /update-check：自动更新版本比对（GitHub 发布仓 package.json，进程级 10 分钟缓存）。
  // 网络不通/未发布如实回 ok:false，绝不假报「已是最新」。
  routes[`${prefix}/update-check`] = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const force = String(req.url || '').includes('force=1')
    if (!force && updCache && Date.now() - updCache.at < UPDATE_TTL_MS) { sendJson(res, 200, { ok: true, cached: true, ...updCache.body }); return }
    try {
      const latest = await fetchLatestPkgVersion()
      if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('remote package.json has no semver version')
      const hasUpdate = semverLt(readPkgVersion(), latest)
      updCache = { at: Date.now(), body: { current: readPkgVersion(), latest, hasUpdate, repo: UPDATE_REPO_URL } }
      sendJson(res, 200, { ok: true, ...updCache.body })
    } catch (e) {
      sendJson(res, 200, { ok: false, current: readPkgVersion(), message: '无法获取最新版本（网络不通或仓库未发布）：' + String((e && e.message) || e) })
    }
  }

  // /update-apply：自主更新——从发布仓按最新 commit SHA 拉取全部文件覆盖目标目录（生产=插件根；测试用环境变量 M10_UPDATE_TARGET 指向沙箱）。
  // SHA 固定下载杜绝旧缓存；仅覆盖清单内文件，拒绝 .. 逃逸与元文件；服务端改动需重启生效，client.js 刷新即生效。失败如实回 ok:false。
  routes[`${prefix}/update-apply`] = async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    try {
      const latest = await fetchLatestPkgVersion()
      if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('remote version invalid')
      if (!semverLt(readPkgVersion(), latest)) { sendJson(res, 200, { ok: false, message: '已是最新版本，无需更新', current: readPkgVersion(), latest }); return }
      const target = process.env.M10_UPDATE_TARGET || join(HERE, '..')
      const sha = await resolveRemoteSha()
      const files = await fetchRemoteFileList(sha)
      if (!files.length) throw new Error('remote file list empty')
      let written = 0
      let serverChanged = false
      for (const rel of files) {
        if (rel.includes('..')) continue
        const buf = await fetchRemoteFile(sha, rel)
        if (buf == null) continue
        const out = join(target, rel)
        mkdirSync(dirname(out), { recursive: true })
        writeFileSync(out, buf)
        written++
        if (/^(server|migrations)[\\/]/.test(rel) || rel === 'cordis.patch.yml') serverChanged = true
      }
      updCache = null
      // 沙箱验证（M10_UPDATE_TARGET≠插件目录）不碰运行中实例；写的是本实例才排期热替换。
      const isSelf = !process.env.M10_UPDATE_TARGET && resolve(target) === resolve(join(HERE, '..'))
      const hotScheduled = isSelf && serverChanged && !!hotReloadGetter
      sendJson(res, 200, {
        ok: true, current: readPkgVersion(), latest, sha, written, serverChanged,
        hotScheduled, restartRequired: serverChanged && !hotScheduled, target,
      })
      // 时序铁律：热替换会销毁重启本插件 fiber（SQLite 适配器/路由/本次响应同属它），
      // 必须先把响应刷出再触发，故延迟 800ms 异步执行；结果由前端轮询 /version runningVersion 判定。
      if (hotScheduled) setTimeout(() => { void hotReloadSelf() }, 800)
    } catch (e) {
      sendJson(res, 200, { ok: false, message: '更新失败：' + String((e && e.message) || e) })
    }
  }

  // /lan-start、/lan-stop：桌面 App（回环侧）一键启停局域网实例（多端 A v0.2.0 → 2026-11-23 升级进程内独立 HTTP 服务）。
  // 仅本机回环可调（手机侧/远程一律 403）；优先在当前插件 Node 进程内直接启动 node:http 独立局域网服务（0.0.0.0:3081），
  // 无需外部 Node.js 或 Harness 宿主目录，秒级启动且共用同一 SQLite 实例；若 3081 已被外部局域网实例占用，如实兼容。
  routes[`${prefix}/lan-start`] = async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    if (!isLoopbackReq(req)) { sendJson(res, 403, { ok: false, message: '仅允许在本机桌面 App 内操作' }); return }
    if (lanCtlBusy) { sendJson(res, 200, { ok: false, busy: true, message: '局域网实例正在启动中，请稍候' }); return }
    lanCtlBusy = true
    const unlockTimer = setTimeout(() => { lanCtlBusy = false }, 5000)
    if (typeof unlockTimer.unref === 'function') unlockTimer.unref()
    try {
      const r = await startInProcLanServer(routes, prefix, DEFAULT_LAN_PORT)
      if (r.ok) {
        sendJson(res, 200, {
          ok: true,
          started: true,
          mode: 'inproc',
          lanUrl: r.info.lanUrl,
          grantUrl: r.info.grantUrl,
          message: '局域网实例已启动，可扫码访问',
        })
        return
      }
      // 若端口已被先前跑起的外部局域网实例占用且探活通过，直接视为已启动
      if (r.code === 'EADDRINUSE') {
        const curIp = hostLanIp() || '127.0.0.1'
        const extUrl = `http://${curIp}:${DEFAULT_LAN_PORT}`
        if (await probeLanAlive(extUrl, prefix)) {
          sendJson(res, 200, { ok: true, started: true, mode: 'external', lanUrl: extUrl, message: '局域网实例已在运行中' })
          return
        }
      }
      clearTimeout(unlockTimer)
      lanCtlBusy = false
      sendJson(res, 200, { ok: false, message: `局域网服务启动失败（端口 ${DEFAULT_LAN_PORT}）：${r.message}` })
    } catch (e) {
      clearTimeout(unlockTimer)
      lanCtlBusy = false
      sendJson(res, 200, { ok: false, message: '启动失败：' + String((e && e.message) || e) })
    }
  }

  routes[`${prefix}/lan-stop`] = async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    if (!isLoopbackReq(req)) { sendJson(res, 403, { ok: false, message: '仅允许在本机桌面 App 内操作' }); return }
    lanCtlBusy = false
    try {
      const stoppedInProc = await stopInProcLanServer()
      if (stoppedInProc) {
        sendJson(res, 200, { ok: true, output: 'STOPPED (in-process)' })
        return
      }
      // 兼容停止旧版由 personalLan.ps1 拉起的外部实例
      const script = lanScriptPath()
      if (!script) { sendJson(res, 200, { ok: true, output: 'NOT-RUNNING' }); return }
      const out = await new Promise((resolveP) => {
        execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, 'stop'], { windowsHide: true, timeout: 20000 }, (err, stdout) => resolveP(String(stdout || (err && err.message) || '')))
      })
      sendJson(res, 200, { ok: true, output: String(out).trim().slice(0, 200) })
    } catch (e) {
      sendJson(res, 200, { ok: false, message: '停止失败：' + String((e && e.message) || e) })
    }
  }

  // ---------- 自定义 Logo（v0.2.5 设置页客户可自行更换侧栏图标） ----------
  // GET /logo：存在自定义 logo 时直出图片二进制，否则 JSON 告知无自定义。
  routes[`${prefix}/logo`] = (req, res) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const logoFile = _findLogoFile(adapter.dataDir)
      if (logoFile) {
        const buf = readFileSync(logoFile)
        const mime = mimeOf(buf) || 'image/png'
        res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache', 'content-length': buf.length })
        res.end(req.method === 'HEAD' ? undefined : buf)
      } else {
        sendJson(res, 200, { ok: true, hasCustom: false })
      }
      return
    }
    if (req.method === 'POST') {
      readJsonBody(req, res, 512 * 1024, (body) => {
        const dataUrl = String(body.dataUrl || '')
        const m = dataUrl.match(/^data:(image\/(?:png|jpeg|svg\+xml|webp));base64,(.+)$/)
        if (!m) { sendJson(res, 200, { ok: false, message: '无效的图片数据（需 data:image/…;base64,… 格式）' }); return }
        const mime = m[1]
        const raw = Buffer.from(m[2], 'base64')
        if (raw.length > 200 * 1024) { sendJson(res, 200, { ok: false, message: '图片文件过大，请控制在 200KB 以内' }); return }
        // 清除旧 logo 文件
        _removeLogoFiles(adapter.dataDir)
        const ext = mime === 'image/svg+xml' ? 'svg' : mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png'
        const dest = join(adapter.dataDir, `custom-logo.${ext}`)
        writeFileSync(dest, raw)
        sendJson(res, 200, { ok: true, message: 'Logo 已更新' })
      })
      return
    }
    if (req.method === 'DELETE') {
      _removeLogoFiles(adapter.dataDir)
      sendJson(res, 200, { ok: true, message: '已恢复默认 Logo' })
      return
    }
    res.writeHead(405, { allow: 'GET, HEAD, POST, DELETE' }); res.end()
  }

  routes[`${prefix}/user`] = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const force = typeof req.url === 'string' && /[?&]refresh=1(?:&|$)/.test(req.url)
    const userName = await operator.ensure(2000, force)
    const out = { ok: true }
    if (userName) out.user = { name: userName }
    const body = JSON.stringify(out)
    res.writeHead(200, JSON_HEADERS_OK)
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  routes[`${prefix}/pages`] = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return }
    const body = JSON.stringify({
      ok: true, source: 'module', modules: [MODULE_DEF], module: MODULE_DEF,
      counts: COUNTS, groups: PAGE_GROUPS, edition: EDITION, user: { name: await operator.ensure() },
      // 多组织（请求E）：展开形 {id,name,orgs}（MoldShell L197 消费同企业版；orgs 空时前端选择器自然不渲染）
      org: adapter.orgPayload(),
    })
    res.writeHead(200, JSON_HEADERS_OK)
    res.end(req.method === 'HEAD' ? undefined : body)
  }

  // 多组织（请求E）：GET 回当前组织+字典；POST {id} 切换（app_setting 持久）。出参与企业版 localApi /org 逐键同形。
  routes[`${prefix}/org`] = (req, res) => {
    if (req.method === 'GET') {
      const orgs = adapter.orgRows()
      if (!orgs.length) { sendJson(res, 200, { ok: false, message: '组织字典不可用：请先在「基础资料 - 组织」维护组织' }); return }
      sendJson(res, 200, { ok: true, current: adapter.curOrg(), orgs }); return
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'GET, POST' }); res.end(); return }
    readJsonBody(req, res, 4096, (source) => {
      const sw = adapter.setCurOrg(source.id)
      if (!sw.ok) { sendJson(res, 200, { ok: false, message: sw.message }); return }
      sendJson(res, 200, { ok: true, current: adapter.curOrg(), orgs: adapter.orgRows() })
    })
  }

  routes[`${prefix}/filter`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const fmeta = isMold(strFunc) ? adapter.viewMeta(strFunc) : buildPageFilterMeta(strFunc, { dictOptions: adapter.dictOptions(), moldNumbers: adapter.moldNumbers(), ...adapter.pageDropdownCtx(), curOrgName: adapter.curOrgName() })
      // 可审核信号（UX 优化 2026-11-22）：档案类/基础资料页（无 billNoPrefix 且非模具）不可审核，顶层透出 auditable，列表页据此隐藏「审核」按钮，杜绝点击撞后端拒绝。
      sendJson(res, 200, { ...fmeta, auditable: auditableColOf(strFunc) !== '' })
    })
  }

  routes[`${prefix}/data`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const currentPage = Number.isFinite(source.currentPage) && source.currentPage >= 1 ? Math.floor(source.currentPage) : 1
      const pageSize = Number.isFinite(source.pageSize) && source.pageSize >= 1 ? Math.floor(source.pageSize) : 50
      const opts = {
        page: currentPage,
        pageSize,
        FilterList: Array.isArray(source.FilterList) ? source.FilterList : [],
        filterForm: source.filterForm && typeof source.filterForm === 'object' ? source.filterForm : {},
      }
      // 模具走既有 listMolds/buildDataHead 绿色路径；补齐子页走通用 listPage/buildPageDataHead（同形契约）。
      if (isMold(strFunc)) {
        const { head: data, totalCount } = adapter.listMolds(opts)
        sendJson(res, 200, { ok: true, head: buildDataHead(), data, totalCount, desc: '', message: '' })
      } else {
        const { head: data, totalCount } = adapter.listPage(strFunc, opts)
        sendJson(res, 200, { ok: true, head: buildPageDataHead(strFunc), data, totalCount, desc: '', message: '' })
      }
    })
  }

  routes[`${prefix}/billinit`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const value = isMold(strFunc) ? buildBillInit(strFunc, adapter.dictOptions(), adapter.itemOptionsMap(), adapter.curOrgName()) : buildPageBillInit(strFunc, { dictOptions: adapter.dictOptions(), moldNumbers: adapter.moldNumbers(), ...adapter.pageDropdownCtx(), curOrgName: adapter.curOrgName() })
      // 可审核信号（UX 优化 2026-11-22）：随 value 顶层透出 auditable，BillForm 经 view.meta.auditable 读取以隐藏不可审核页「审核」按钮。
      sendJson(res, 200, { ok: true, strFunc, value: { ...value, auditable: auditableColOf(strFunc) !== '' }, desc: '', message: '' })
    })
  }

  routes[`${prefix}/detail`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const cur = source.CurrentRow && typeof source.CurrentRow === 'object' ? source.CurrentRow : {}
      const fid = String(cur['单据内码'] ?? cur.FInterID ?? '')
      const row = fid === '' ? null : (isMold(strFunc) ? adapter.getMold(fid) : adapter.getPage(strFunc, fid))
      if (!row) { sendJson(res, 200, { ok: false, strFunc, desc: '', message: '单据不存在或已被删除' }); return }
      // head[0] = 契约行（metaKey 中文键，前端按 Info.FField 对齐回填）+ 系统键（FInterID/状态「其他」块消费）。
      // displayMap 空：下拉选项已由 /billinit Info._options 直供；FileList 空：个人版附件能力未接入（如实空值）。
      // 表体页（第五批）：各页签行数组按顶层 tab 键出参（value.B1=[…]，前端 BillForm raw[tab] 消费，与企业 getDetail 同形）。
      const head0 = { FInterID: Number(fid), FStatus: '0', FCloseStatus: '0', FBillNo: String(row['单据编号'] ?? row['模具编号'] ?? row['部件编号'] ?? row['报修单号'] ?? row['记录单号'] ?? ''), FCreater: row.FCreater ?? row['制单人'] ?? '', FCreateDate: row['创建时间'] ?? '', ...row }
      const bodies = isMold(strFunc) ? {} : adapter.getPageBodies(strFunc, fid)
      sendJson(res, 200, { ok: true, strFunc, value: { head: [head0], ...bodies, displayMap: [], FileList: [] }, desc: '', message: '' })
    })
  }

  routes[`${prefix}/save`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    // 图片 base64 走 FImage 键（前端 Image 控件剥前缀后下发），上限与企业版对齐放宽到 8MB
    readJsonBody(req, res, 8388608, async (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const data = source.Data && typeof source.Data === 'object' ? source.Data : {}
      const headRows = Array.isArray(data.head) ? data.head : []
      // 契约行重组：head 行 {FField, FValue[, FImage, FThumbImage]} → metaKey 键；FInterID → 单据内码（add 为 0/空）
      const contract = {}
      let imageB64 = ''
      // 阶段 4：前端 Canvas 同批生成的 320px 缩略图（FThumbImage 伴随字段，§6 坑 2），服务端不切图只落盘。
      let imageThumbB64 = ''
      // 重开回显删除（前端 imgEcho 态删除后保存）：image 列恒空无法表达「删图」，靠 FDeleteImage 显式标记。
      let imageDelete = false
      // 数值性判定权威源：模具用 NUMERIC_METAKEYS，补齐子页用逐页 pageNumericMetaKeys（同族加固，不信客户端 FDataType）。
      const numericSet = isMold(strFunc) ? NUMERIC_METAKEYS : pageNumericMetaKeys(strFunc)
      for (const it of headRows) {
        if (!it || it.FField == null) continue
        const k = String(it.FField)
        const v = it.FValue == null ? '' : String(it.FValue)
        // 数字字段空串不进契约：缺省=未提供（新增走 schema DEFAULT，更新保持现值），
        // 防表单 '' 污染 SQLite INTEGER 列、更防 used_shots 等事务累加列被编辑保存意外清零
        //（企业侧 MSSQL 对 ''→0 强转，个人侧以「缺省不写」为同位口径，adapter 注释本意钉死）。
        // 数值性判定以【服务端权威 schema（NUMERIC_METAKEYS）】为准，不信客户端自报 FDataType：
        // 旧客户端/异常载荷缺省或错标 FDataType 时，'' 仍不会污染 INTEGER 列（暗雷 1 同族加固）。
        if (v === '' && numericSet.has(k)) continue
        contract[k] = v
        if (String(it.FDataType || '') === 'Image' && it.FImage) {
          imageB64 = String(it.FImage)
          if (it.FThumbImage) imageThumbB64 = String(it.FThumbImage)
        }
        if (String(it.FDataType || '') === 'Image' && it.FDeleteImage) imageDelete = true
      }
      const finterid = Number(data.FInterID ?? contract['单据内码'] ?? 0) || 0
      contract['单据内码'] = finterid || ''
      // 表体下发提取（第五批，企业 saveDPBill Data.bodyArr+Data.body 同源）：只取数组化页签；
      // 无 bodyArr/未下发 → null（savePage 不动任何表体，保头页行为不变）。
      let bodiesMap = null
      if (Array.isArray(data.bodyArr) && data.body && typeof data.body === 'object') {
        bodiesMap = {}
        for (const tab of data.bodyArr) { const t = String(tab); if (Array.isArray(data.body[t])) bodiesMap[t] = data.body[t] }
        if (Object.keys(bodiesMap).length === 0) bodiesMap = null
      }
      // 图片魔数前置校验：非法图整体失败且不落「单已存、图失败」的半库主档（扫雷暗雷：图验证必须早于落库）
      if (imageB64 !== '' && !mimeOf(Buffer.from(imageB64, 'base64'))) {
        sendJson(res, 200, { ok: false, strFunc, desc: '', message: '无法识别的图片格式（PNG/JPEG/GIF/BMP/WEBP 之外不支持）' })
        return
      }
      // 审计字段服务端权威：新增写当前账号，编辑不覆盖原制单人和制单日期。
      delete contract['FCreater']
      delete contract['FCreateDate']
      delete contract['制单人']
      delete contract['创建时间']
      if (finterid === 0) contract['FCreater'] = await operator.ensure(2000)
      let saved
      try {
        saved = isMold(strFunc) ? adapter.saveMold(contract) : adapter.savePage(strFunc, contract, bodiesMap)
      } catch (e) {
        sendJson(res, 200, { ok: false, strFunc, desc: '', message: String((e && e.message) || e) })
        return
      }
      // 模具档案单图即封面语义：带图保存一律 isCover=true（换图须替换封面并清理旧图，而非只置空时补位）。
      if (imageB64 !== '') adapter.saveImage(saved.id, { FImage: imageB64, FThumbImage: imageThumbB64, isCover: isMold(strFunc) })
      else if (imageDelete && isMold(strFunc)) adapter.deleteImage(saved.id)
      const row = isMold(strFunc) ? adapter.getMold(saved.id) : adapter.getPage(strFunc, saved.id)
      const codeVal = row ? String(row['单据编号'] ?? row['模具编号'] ?? row['部件编号'] ?? row['报修单号'] ?? row['记录单号'] ?? '') : ''
      sendJson(res, 200, {
        ok: true,
        strFunc,
        value: String(saved.id),
        desc: `单据编号${codeVal}`,
        message: '',
        result: { FInterID: saved.id, FBillNo: codeVal, FCreater: row ? (row.FCreater ?? row['制单人'] ?? '') : '', FCreateDate: row ? row['创建时间'] : '', FileList: [] },
      })
    })
  }

  routes[`${prefix}/pushdo`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    // 下推：按源页 strFunc + FRuleID 载入源单据契约行，映射生成目标新单据预填包 NextRow（{H:[head],[tab]:[rows]}）。
    // 失败一律如实上抛 {ok:false,message}（W4）；目标 metaKey 键由 personal.push.js 规则表显式声明，路由零字段 switch。
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      try {
        // 下推前置（企业同义）：可审核源单必须已审核才能下推；档案类页（模具/方案等，无审核列）不受门槛。
        const firstFid = (() => {
          const rows = Array.isArray(source.Rows) ? source.Rows : []
          const c = rows[0] && typeof rows[0] === 'object' ? rows[0] : {}
          return String(c['单据内码'] ?? c.FInterID ?? '')
        })()
        if (auditableColOf(strFunc) !== '' && firstFid !== '' && adapter.getBillStatus(strFunc, firstFid) !== '1') {
          sendJson(res, 200, { ok: false, strFunc, desc: '', message: `${adapter.billLabelById(strFunc, firstFid)}未审核，不能下推（请先审核源单）` })
          return
        }
        const value = buildPushNextRow(adapter, source)
        // 多选下推语义显性化（2026-11-21 按钮审计 B3d）：本端点按首条源单预填一张目标单，其余选中行不自动生成。
        // 旧实现零提示 → 用户框选 3 张以为出了 3 张单。文案由 ListView doPush 原样 toast，不改前端契约。
        const selCount = (Array.isArray(source.Rows) ? source.Rows : []).length
        const multiHint = selCount > 1 ? `已按首条选中单据生成预填单（其余 ${selCount - 1} 条未下推，请逐条操作）` : ''
        sendJson(res, 200, { ok: true, strFunc, value, desc: '', message: multiHint })
      } catch (e) {
        sendJson(res, 200, { ok: false, strFunc, desc: '', message: String((e && e.message) || e) })
      }
    })
  }

  routes[`${prefix}/billstatus`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const d = source.Data && typeof source.Data === 'object' ? source.Data : {}
      const targetStatus = String(d.TargetStatus ?? '')
      const fids = (Array.isArray(d.fids) ? d.fids : []).map((x) => String(x ?? '').trim()).filter((x) => x !== '')
      if (!['2', '5', '1'].includes(targetStatus)) { sendJson(res, 200, { ok: false, strFunc, desc: '', message: unsupportedStatus(targetStatus) }); return }
      if (fids.length === 0) { sendJson(res, 200, { ok: false, strFunc, desc: '', message: '未选中数据行（需要单据内码）' }); return }
      try {
        // 审核/反审核/删除：前置校验（存在性+状态机+审核锁+下游引用）全部先于首次写入，
        // 整批要么全成功要么不动库（企业批量审核同义，防半批状态）。
        // 删除同样必须整批预检：旧实现逐行执行，中途撞「已审核」时前面几行已真删、后面才报错，
        // 用户看到失败提示却已丢单（2026-11-20 temp 库取证 D2 实测，本轮按需求收口）。
        if (targetStatus === '2') {
          const blocked = fids.map((fid) => adapter.deleteBlockReason(strFunc, fid)).filter((b) => b.kind !== 'ok')
          if (blocked.length) {
            const audited = blocked.filter((b) => b.kind === 'audited')
            const parts = []
            if (audited.length) parts.push(`${audited.slice(0, 3).map((b) => b.label).join('、')}${audited.length > 3 ? ` 等 ${audited.length} 张` : ''}已审核，不能删除，请先反审核`)
            // 同因合并（与审核分支同口径）：多张同为「已不存在」不重复刷屏
            const rest = blocked.filter((x) => x.kind !== 'audited')
            const blockedMsgs = [...new Set(rest.map((b) => b.msg))]
            for (const m of blockedMsgs.slice(0, 2)) parts.push(m)
            if (blockedMsgs.length > 2) parts.push(`另有 ${blockedMsgs.length - 2} 类其它限制`)
            throw new Error(`${parts.join('；')}${fids.length > blocked.length ? `（本次选中 ${fids.length} 张，均未删除）` : ''}`)
          }
          for (const fid of fids) { if (isMold(strFunc)) adapter.deleteMold(fid); else adapter.deletePage(strFunc, fid) }
        } else {
          // 审核/反审核走与删除同一套「只读整批预检 + 按 kind 聚合」：旧文案「单据已审核，请勿重复操作」
          // 不指认是哪一张，多选时用户无从下手（2026-11-21 按钮审计 B1b/B2b 取证）。
          // 反审核的下游引用拦截已内置 statusBlockReason（kind='downstream'），不再另跑一遍单条断言。
          const blocked = fids.map((fid) => adapter.statusBlockReason(strFunc, fid, targetStatus)).filter((b) => b.kind !== 'ok')
          if (blocked.length) {
            const stateOnes = blocked.filter((b) => b.kind === 'repeat' || b.kind === 'notaudited')
            const others = blocked.filter((b) => b.kind !== 'repeat' && b.kind !== 'notaudited')
            const parts = []
            if (stateOnes.length) {
              const tail = targetStatus === '5' ? '已审核，无需重复审核（如需改动请先反审核）' : '未审核，不能反审核（请先审核该单）'
              parts.push(`${stateOnes.slice(0, 3).map((b) => b.label).join('、')}${stateOnes.length > 3 ? ` 等 ${stateOnes.length} 张` : ''}${tail}`)
            }
            // 同因合并（2026-11-21 live 指纹 L2 实锤）：多张同为「已不存在」时逐条 push 会把同一句重复拼两遍
            const otherMsgs = [...new Set(others.map((b) => b.msg))]
            for (const m of otherMsgs.slice(0, 2)) parts.push(m)
            if (otherMsgs.length > 2) parts.push(`另有 ${otherMsgs.length - 2} 类其它限制`)
            // 状态类句子自带收尾括号，未变更声明改用逗号接续，避免出现「）（」双括号排版
            throw new Error(`${parts.join('；')}${fids.length > blocked.length ? `，本次选中 ${fids.length} 张均未变更审核状态` : ''}`)
          }
          for (const fid of fids) adapter.updateBillStatusCol(strFunc, fid, targetStatus === '5' ? '1' : '0', operator.current())
        }
      } catch (e) {
        sendJson(res, 200, { ok: false, strFunc, desc: '', message: String((e && e.message) || e) })
        return
      }
      sendJson(res, 200, { ok: true, strFunc, value: '', desc: '', message: '' })
    })
  }

  routes[`${prefix}/image`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      const id = typeof source.id === 'string' || typeof source.id === 'number' ? String(source.id).trim() : ''
      if (strFunc === '' || !knownPage(strFunc)) { sendJson(res, 200, { ok: false, code: 'FAIL', dataUrl: '', message: `未知或未接入的页面 strFunc：${JSON.stringify(strFunc)}` }); return }
      if (id === '') { sendJson(res, 200, { ok: false, code: 'FAIL', dataUrl: '', message: '缺少记录内码 id' }); return }
      // 图片仅为模具档案能力；补齐子页无图片字段，如实回未接入（不跨表误取模具封面）。
      if (!isMold(strFunc)) { sendJson(res, 200, { ok: false, code: 'NOT_WIRED', dataUrl: '', message: '个人版该页未接入图片能力' }); return }
      const { dataUrl } = adapter.getImage({ id, thumb: source.thumb === true || source.thumb === 1 || source.thumb === '1' })
      sendJson(res, 200, { ok: true, dataUrl, message: '' })
    })
  }

  // /popdata：个人版下拉走 /billinit Info._options 直供，dropdSet 恒空、前端不会触达；
  // 保留端点如实回未接入（W4：不伪造行集）。
  routes[`${prefix}/popdata`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, () => {
      sendJson(res, 200, { ok: false, strFunc: '', value: { data: [] }, desc: '', message: '个人版未接入在线下拉数据源' })
    })
  }

  // /item：基础资料页（item 页型）整表读取（服务端不分页）。出参逐键镜像企业 itemQueries.getItem。
  routes[`${prefix}/item`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !isItemStrFunc(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const filterForm = source.filterForm && typeof source.filterForm === 'object' ? source.filterForm : null
      sendJson(res, 200, adapter.listItem(strFunc, filterForm))
    })
  }

  // /itemdo：基础资料写（add/addgroups/update/delete/ban/enable）。出参逐键镜像企业 itemWriteQueries.itemDataOperate。
  routes[`${prefix}/itemdo`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const fItemType = typeof source.FItemType === 'string' ? source.FItemType.trim() : ''
      if (fItemType === '' || !isItemStrFunc(fItemType)) {
        sendJson(res, 200, { ok: false, code: 'FAIL', strFunc: String(source.strFunc ?? ''), value: '', desc: '', message: `未知或未接入的基础资料类别：${JSON.stringify(fItemType)}` })
        return
      }
      sendJson(res, 200, adapter.itemOperate(source))
    })
  }

  // /colset：列显示设置读/写（与企业版同契约 {op:'get'|'save', FPage, arrColSet}，个人版落 app_setting）。
  // 客户端切列表视图会主动 POST /colset(op=get) 取个性化列宽；无已存配置回 value:[] 走默认（非 405）。
  routes[`${prefix}/colset`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 1048576, (source) => {
      const op = source.op === 'save' ? 'save' : 'get'
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      const FPage = typeof source.FPage === 'string' ? source.FPage.trim() : ''
      if (FPage === '') { sendJson(res, 200, { ok: false, strFunc, op, message: '页面设置编码为空' }); return }
      if (op === 'get') {
        sendJson(res, 200, { ok: true, strFunc, op: 'get', value: adapter.getColset(FPage), message: '' })
        return
      }
      const saved = adapter.saveColset(FPage, Array.isArray(source.arrColSet) ? source.arrColSet : [])
      sendJson(res, 200, { ok: true, strFunc, op: 'save', value: saved, message: '' })
    })
  }

  // /report：报表页（report/reportmulti 页型）本地 SQLite 重算。出参逐键镜像企业 localApi.report
  //   {ok,head,data,totalCount,reportFilter,funcSetes,actions,[RptTABGroup,RptTAB]}；dtfilter 兼容对象/数组首元。
  routes[`${prefix}/report`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 65536, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !isReportStrFunc(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const dtfilter = source.dtfilter && typeof source.dtfilter === 'object' && !Array.isArray(source.dtfilter)
        ? source.dtfilter
        : (Array.isArray(source.dtfilter) && source.dtfilter[0] && typeof source.dtfilter[0] === 'object' ? source.dtfilter[0] : null)
      sendJson(res, 200, buildReport(adapter, { strFunc, dtfilter }))
    })
  }

  // /reportdetail：多页签报表页签明细（主表聚焦行 dtFoucuseRow[0] + 当前页签 strTab）。出参 {ok,data:[行按中文列键]}。
  routes[`${prefix}/reportdetail`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => {
      const strFunc = typeof source.strFunc === 'string' ? source.strFunc.trim() : ''
      if (strFunc === '' || !isReportStrFunc(strFunc)) { sendJson(res, 200, unknownFunc(strFunc)); return }
      const strTab = typeof source.strTab === 'string' ? source.strTab : ''
      sendJson(res, 200, buildReportDetail(adapter, { strFunc, strTab, dtFoucuseRow: Array.isArray(source.dtFoucuseRow) ? source.dtFoucuseRow : [] }))
    })
  }

  // 阶段 3 记模次/记维护 HTTP 入口（与 AI 工具同源 adapter 事务）：手机快捷栏/扫码场景消费。
  // /usage：usage_log 插入 + used_shots 原子累加；/maintenance：maintenance_log（保养联动周期重置）。
  routes[`${prefix}/usage`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => {
      const row = adapter.getMoldByCode(source.moldCode)
      if (!row) { sendJson(res, 200, { ok: false, message: `模具编号「${String(source.moldCode ?? '')}」不存在（请先建档）` }); return }
      const delta = Number(source.deltaShots)
      if (!Number.isInteger(delta) || delta <= 0) { sendJson(res, 200, { ok: false, message: '本次新增模次必须为正整数' }); return }
      try {
        const r = adapter.addUsage(Number(row['单据内码']), { delta_shots: delta, machine_no: String(source.machineNo || ''), remark: String(source.remark || ''), log_date: String(source.logDate || '') || undefined })
        sendJson(res, 200, { ok: true, moldCode: row['模具编号'], usedShots: Number(r.used_shots), message: `本次 +${delta} 模` })
      } catch (e) {
        sendJson(res, 200, { ok: false, message: String((e && e.message) || e) })
      }
    })
  }
  routes[`${prefix}/maintenance`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => {
      const row = adapter.getMoldByCode(source.moldCode)
      if (!row) { sendJson(res, 200, { ok: false, message: `模具编号「${String(source.moldCode ?? '')}」不存在（请先建档）` }); return }
      const logType = String(source.logType || '')
      if (!['点检', '保养', '维修'].includes(logType)) { sendJson(res, 200, { ok: false, message: '记录类型必须为 点检/保养/维修' }); return }
      try {
        const r = adapter.addMaintenance(Number(row['单据内码']), { log_type: logType, result: String(source.result || ''), operator: String(source.operator || ''), cost: Number(source.cost) || 0, remark: String(source.remark || ''), log_date: String(source.logDate || '') || undefined })
        sendJson(res, 200, { ok: true, moldCode: row['模具编号'], shotsAtLog: Number(r.shots_at_log), message: `${logType}已记录` })
      } catch (e) {
        sendJson(res, 200, { ok: false, message: String((e && e.message) || e) })
      }
    })
  }

  // 企业版独有功能族诚实落点（扫雷暗雷：客户端 dp 工具栏/选项 会主动 POST 这三路，
  // 无路由即裸 HTTP 404 英文 toast）：与 /popdata 同口径能力裁剪走数据，如实回 ok:false 中文原因。
  const notWired = (what) => ({ ok: false, strFunc: '', value: '', desc: '', message: `个人版暂不支持「${what}」（属企业版同源能力，未在个人能力闭环内）` })
  routes[`${prefix}/export`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => sendJson(res, 200, { ...notWired('引出'), strFunc: String(source.strFunc ?? '') }))
  }
  routes[`${prefix}/imp`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => sendJson(res, 200, { ...notWired('引入'), strFunc: String(source.strFunc ?? '') }))
  }
  routes[`${prefix}/filterset`] = (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return }
    readJsonBody(req, res, 262144, (source) => sendJson(res, 200, { ...notWired('过滤条件设置'), strFunc: String(source.strFunc ?? '') }))
  }

  // 推广位本地路由（设计稿-个人版推广位方案；零外部请求，素材只认包内白名单，kill switch 见 creatives.json globalEnabled）
  registerPromoRoutes(routes, adapter, prefix)
  // 个人版模块内 AI 助手本地数据分析路由（只读 SQLite，断网可用）
  registerAiRoutes(routes, adapter, prefix)

  return routes
}

/** Host 入口（与企业版同构）：resolveConfig → 打开本地库 → 注册路由。 */
export function apply(ctx, config = {}) {
  const runtime = {
    // routePrefix 语义与企业版 patch 对齐：config.routePrefix=模块前缀（如 '/m10-mold-personal'），
    // 路由统一挂 `${routePrefix}/api/*`（与企业版 makeRoutes(routePrefix) 同口径）。
    routePrefix: String((config && config.routePrefix) || '/m10-mold-personal').replace(/\/+$/, ''),
    dataDir: resolveDataDir(config && config.dataDir),
  }
  const apiPrefix = `${runtime.routePrefix}/api`
  const adapter = new PersonalSqliteAdapter({ dataDir: runtime.dataDir, seed: { dicts: true, sampleMolds: config.sampleMolds === true } })
  const operator = makeOperator(ctx)
  let hotScopeReady = false
  const routes = createRoutes(adapter, apiPrefix, operator, {
    // 宿主 hmr 服务经 inject 动态获取（ctx.get 取不到未声明依赖，与账号服务 deepseekAccount 同坑）；
    // 组合未含 hmr / scope 未就绪时返回 undefined，update-apply 如实降级「重启生效」，绝不报错。
    getHotReload: () => {
      if (!hotScopeReady) { try { ctx.inject(['hmr'], () => { hotScopeReady = true }) } catch { /* 组合无 hmr：保持降级 */ } }
      if (!hotScopeReady) return undefined
      try { return ctx.hmr || (ctx.root && ctx.root.get && ctx.root.get('hmr')) } catch { return undefined }
    },
  })
  // 阶段 3 AI 工具（设计稿 §2.2.4 aiTools）：查模/记模次/记保养/预警，零依赖平对象注册（个人版不引 dsh-tools）。
  registerPersonalTools(ctx, adapter)
  // webServer 为可选注入依赖：与企业版同用 ctx.inject(['webServer'], scope => ...) 动态声明，
  // 否则 cordis 会以「cannot get property "webServer" without inject」拒绝挂载路由（本包入口不激活）。
  ctx.inject(['webServer'], (scope) => {
    for (const [path, handler] of Object.entries(routes)) {
      scope.effect(() =>
        scope.webServer.register({
          kind: 'exact',
          path,
          handler: (req, res) => {
            try {
              const r = handler(req, res)
              if (r && typeof r.catch === 'function') r.catch((e) => { if (!res.writableEnded) sendJson(res, 200, { ok: false, message: String((e && e.message) || e) }) })
            } catch (e) {
              if (!res.writableEnded) sendJson(res, 200, { ok: false, message: String((e && e.message) || e) })
            }
          },
        }),
      )
    }
  })
  ctx.effect(() => () => {
    void stopInProcLanServer()
    adapter.close()
  })
  return { adapter, routes, runtime }
}


