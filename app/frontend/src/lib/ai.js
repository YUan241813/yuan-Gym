// yuan-Gym — client for the AI coach.
//
// Talks to our own /ai endpoint (server/server.mjs), which holds the Zhipu key and forwards
// to GLM. The browser never sees the key, and there is no cross-origin call in production.
//
// Everything here is allowed to fail. Callers get `{ ok:false, reason }` and must have a
// non-AI path — the planner in lib/plan-engine.js is that path.

import { nativeFetch } from './capacitor-fetch.js'

const DEV_BASE = 'http://127.0.0.1:8080/ai'

// 单机版（手机 APK / 纯静态页）里没有同源的 /ai：包里只有静态资源，所以生产构建必须给
// 绝对地址。Key 在 Worker 上，App 里没有 Key。换域名只改这里，或用
// window.__YUANGYM_AI__ 覆盖（调试时指到本机 server/server.mjs）。
//
// 线上只有 api.yuanzq.top 这一个域名真的应答 /ai（Worker 见 worker/wrangler.toml）。
// 之所以留成数组而不是一个常量：2026-11-10 在手机上撞到过整机 DNS 挂掉的情况（开着代理、
// DNS 指向 1.1.1.1，连 github.com 都解析不出来），那时候最需要的就是"换一条路再试一次"。
// 真加了镜像域名，这里加一行就够，成功过的那条会被记住、下次排最前。
//
// 注意 App 自己的域名 yuan-gym.yuanzq.top 不能当镜像：Worker 对它直接回
// {"ok":false,"error":"use_api_host"}，用它会把真正的 DNS 失败盖成 use_api_host。
const REMOTE_BASES = [
  'https://api.yuanzq.top/ai',
]

const BASE_KEY = 'yuangym_ai_base'

function savedBase() {
  try {
    const v = localStorage.getItem(BASE_KEY) || ''
    return REMOTE_BASES.includes(v) ? v : ''
  } catch { return '' }
}

/** 成功的那个域名排最前，其余按原顺序。 */
export function aiBases() {
  const saved = savedBase()
  return saved ? [saved, ...REMOTE_BASES.filter(b => b !== saved)] : [...REMOTE_BASES]
}

export function aiBase() {
  if (typeof window !== 'undefined' && window.__YUANGYM_AI__) return String(window.__YUANGYM_AI__)
  const dev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV
  return dev ? DEV_BASE : aiBases()[0]
}

function noteWorkingBase(base) {
  try { if (REMOTE_BASES.includes(base)) localStorage.setItem(BASE_KEY, base) } catch { /* 隐私模式忽略 */ }
}

/**
 * 把一次传输失败归成能对用户解释的类。手机上最常见的是 DNS：
 * "Unable to resolve host "api.yuanzq.top": No address associated with hostname"。
 */
export function classifyNetError(err) {
  const m = String((err && (err.message || err.code)) || err || '')
  if (/resolve host|ENOTFOUND|EAI_AGAIN|No address associated|Name or service not known/i.test(m)) return 'dns'
  if (/timeout|timed out|aborted|AbortError/i.test(m)) return 'timeout'
  if (/Failed to fetch|NetworkError|Load failed|ERR_NETWORK/i.test(m)) return 'unreachable'
  return 'network'
}

/** reason → 一句中文人话，别再让用户去猜 Key 是不是错的。 */
export function aiFailHint(reason, detail) {
  const r = String(reason || '')
  if (r === 'dns') return '手机解析不到服务器域名（DNS 失败）。如果开着 VPN／代理，先关掉或换个网络再试。'
  if (r === 'unreachable') return '手机连不上服务器。检查网络，或稍后重试。'
  if (r === 'timeout') return '等太久了，服务器没回应。稍后重试。'
  if (r === 'empty') return '模型返回了空内容，再试一次。'
  if (/^http_5/.test(r)) return '服务器出错了（' + r + '），稍后重试。'
  if (/^http_4/.test(r)) return '请求被服务器拒绝（' + r + '）。'
  const tail = detail ? '（' + String(detail).slice(0, 120) + '）' : ''
  return '没连上模型（' + r + '）' + tail
}

let healthCache = null

/** Whether the server has a key configured. Cached for a minute; never throws. */
export async function aiAvailable() {
  if (healthCache && Date.now() - healthCache.at < 60_000) return healthCache.ok
  try {
    // /api/health is where the Worker and server/server.mjs report it ({"ok":true,"ai":true}).
    // /ai/health is the older path a self-hosted instance may only have; tried second so a
    // deployment of either shape answers.
    let body = null
    for (const full of aiBases()) {
      const base = full.replace(/\/ai$/, '')
      for (const p of ['/api/health', '/ai/health']) {
        try {
          const r = await nativeFetch(`${base}${p}`, { signal: AbortSignal.timeout(4000) })
          const j = await r.json()
          if (j && typeof j.ai !== 'undefined') { body = j; noteWorkingBase(full); break }
        } catch { /* next path */ }
      }
      if (body) break
    }
    healthCache = { ok: Boolean(body?.ai), at: Date.now(), model: body?.model }
    return healthCache.ok
  } catch {
    healthCache = { ok: false, at: Date.now() }
    return false
  }
}

export const aiModel = () => healthCache?.model || DEFAULT_MODEL

// 线上 Worker 的默认模型是 glm-4.7-flash，它对这些账号一直返回 429（"访问量过大"），
// 而 Worker 只在 400/404 时才换模型，于是整条 AI 链路直接失败。客户端自己点名一个可用的
// 型号，问题就绕过去了：glm-4-air 实测 200。
export const DEFAULT_MODEL = 'glm-4-air'

/**
 * One chat turn.
 * @param {{system?: string, prompt: string, json?: boolean, temperature?: number, maxTokens?: number}} options
 * @returns {Promise<{ok: true, text: string, model: string} | {ok: false, reason: string, detail?: any}>}
 */
export async function ask({ system, prompt, json: wantJson = false, temperature = 0.55, maxTokens = 3000, model = DEFAULT_MODEL } = {}) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  let last = { ok: false, reason: 'network' }
  for (const base of aiBases()) {
    try {
      const r = await nativeFetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, temperature, maxTokens, model }),
        signal: AbortSignal.timeout(75_000),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.ok) {
        last = { ok: false, reason: body?.error || `http_${r.status}`, detail: body?.detail || body?.message }
        // 服务器答了话，只是这一句没成：换域名也一样，收工。
        if (r.ok || (r.status >= 400 && r.status < 500)) return last
        continue
      }
      const text = String(body.text || '').trim()
      if (!text) { last = { ok: false, reason: 'empty' }; continue }
      noteWorkingBase(base)
      return { ok: true, text: wantJson ? extractJson(text) : text, model: body.model }
    } catch (err) {
      last = { ok: false, reason: classifyNetError(err), detail: String(err?.message || err) }
    }
  }
  return last
}

/** GLM sometimes wraps JSON in prose or a fence; take the outermost object. */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return raw.trim()
  return raw.slice(start, end + 1).trim()
}

export const COACH_SYSTEM = `你是 yuan-Gym 的私人教练，服务对象是中国大陆的健身爱好者。
规则：
- 只用简体中文回答，语气专业、直接、像真人教练，不要客套话。
- 建议必须可执行：给出动作、组数、次数、重量或强度区间、组间休息。
- 尊重用户的身体数据与伤病史；有风险时明确提示并给替代动作。
- 不确定的事情不要编造；需要更多信息时一次只问最关键的问题。
- 不要输出医疗诊断。`
