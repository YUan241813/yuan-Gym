// yuan-Gym — production server.
//
// Two jobs and nothing else:
//   1. serve the built app (dist/) as static files
//   2. proxy POST /ai to Zhipu's OpenAI-compatible endpoint, so the API key never
//      reaches the browser and the browser never has to deal with cross-origin calls
//
// The path is /ai rather than /api/ai on purpose: /api belongs to the optional sync
// server, and the two must never shadow each other.
//
// Zero dependencies on purpose: this has to run on a small box next to the static files.
//
//   PORT=8080 GLM_API_KEY=xxx node server/server.mjs
//
// The key is read from the environment first, then from server/config.json (git-ignored,
// never copied into dist/). A request that arrives without a key is answered with a clear
// 503 instead of a hang, so the UI can fall back to its offline planner.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStore } from './accounts.mjs'
import { sendMail, verifyEmailTemplate } from './smtp.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const DIST = path.join(ROOT, 'app', 'frontend', 'dist')

// ---- config ----------------------------------------------------------------

function readConfig() {
  const file = path.join(HERE, 'config.json')
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}
const CONFIG = readConfig()

const KEY = process.env.GLM_API_KEY || CONFIG.glmApiKey || ''
const MODEL = process.env.GLM_MODEL || CONFIG.glmModel || 'glm-4.7-flash'
const FALLBACK_MODELS = (process.env.GLM_FALLBACK || CONFIG.glmFallback || 'glm-4-flash,glm-4-air').split(',')
const UPSTREAM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const PORT = Number(process.env.PORT) || 8080

// Accounts, sessions and the synced state live beside the code, in server/data/.
const store = createStore(path.join(HERE, 'data'), { saltSecret: process.env.SALT_SECRET || CONFIG.saltSecret })
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || CONFIG.adminToken || ''
const SMTP = CONFIG.smtp || (process.env.SMTP_HOST ? {
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE !== '0', user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM,
} : null)

// ---- static ----------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.map': 'application/json',
}

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target))
  return p.startsWith(base) ? p : null
}

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase()
  const stat = fs.statSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  })
  fs.createReadStream(file).pipe(res)
}

// ---- AI proxy --------------------------------------------------------------

const json = (res, code, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

async function callUpstream(model, messages, { temperature = 0.6, maxTokens = 3000 } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: ctrl.signal,
    })
    const text = await r.text()
    if (!r.ok) return { ok: false, status: r.status, detail: text.slice(0, 500) }
    return { ok: true, data: JSON.parse(text) }
  } catch (err) {
    return { ok: false, status: 0, detail: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

async function handleAi(req, res) {
  if (!KEY) {
    json(res, 503, { ok: false, error: 'no_key', message: 'AI 未配置：服务端缺少 GLM_API_KEY' })
    return
  }

  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1_000_000) { json(res, 413, { ok: false, error: 'too_large' }); return }
  }

  let payload
  try { payload = JSON.parse(body) } catch { json(res, 400, { ok: false, error: 'bad_json' }); return }

  const messages = Array.isArray(payload.messages) ? payload.messages : []
  if (!messages.length) { json(res, 400, { ok: false, error: 'no_messages' }); return }

  const wanted = payload.model || MODEL
  const attempts = [wanted, ...(wanted === MODEL ? FALLBACK_MODELS : [MODEL, ...FALLBACK_MODELS])]

  let last = null
  for (const model of attempts.filter(Boolean)) {
    const out = await callUpstream(model, messages, {
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
    })
    if (out.ok) {
      const text = out.data?.choices?.[0]?.message?.content || ''
      json(res, 200, { ok: true, model, text, usage: out.data?.usage || null })
      return
    }
    last = { model, ...out }
    // 1211 / 1213 are "model not found"; anything else is not worth retrying elsewhere.
    if (![400, 404].includes(out.status)) break
  }

  json(res, 502, { ok: false, error: 'upstream', detail: last })
}

// ---- server ----------------------------------------------------------------

// ---- accounts, sync, admin -------------------------------------------------

async function readBody(req, limit = 2_000_000) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw new Error('too_large')
  }
  try { return JSON.parse(body || '{}') } catch { return null }
}

const cookiesOf = req => Object.fromEntries(
  String(req.headers.cookie || '').split(';').map(p => p.trim()).filter(Boolean)
    .map(p => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))] }),
)

const tokenOf = req => {
  const c = cookiesOf(req)
  if (c.yg_session) return c.yg_session
  const auth = String(req.headers.authorization || '')
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

const setSessionCookie = (res, token) => {
  res.setHeader('Set-Cookie', `yg_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${process.env.HTTPS === '1' ? '; Secure' : ''}`)
}

const clientMeta = req => ({
  ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim().replace(/^::ffff:/, ''),
  ua: String(req.headers['user-agent'] || ''),
})

// Five attempts per IP per ten minutes: enough for a typo, not enough to guess.
const tries = new Map()
function tooMany(ip) {
  const now = Date.now()
  const rec = tries.get(ip) || { n: 0, until: 0 }
  if (rec.until > now) return true
  return false
}
function noteTry(ip, ok) {
  const now = Date.now()
  const rec = tries.get(ip) || { n: 0, until: 0 }
  if (ok) { tries.delete(ip); return }
  rec.n += 1
  if (rec.n >= 5) { rec.until = now + 10 * 60_000; rec.n = 0 }
  tries.set(ip, rec)
}

const adminOk = (req, url) => {
  if (!ADMIN_TOKEN) return false
  const given = url.searchParams.get('token') || cookiesOf(req).yg_admin || ''
  return given === ADMIN_TOKEN
}

async function handleApi(req, res, pathname, url) {
  const meta = clientMeta(req)
  const send = (code, body) => json(res, code, body)

  // -- auth --
  if (pathname === '/api/auth/code' && req.method === 'POST') {
    if (tooMany(meta.ip)) return send(429, { ok: false, error: '稍后再试：操作太频繁' })
    const body = await readBody(req)
    if (!body) return send(400, { ok: false, error: 'bad_json' })
    const email = String(body.email || '').trim().toLowerCase()
    const purpose = body.purpose === 'reset' ? 'reset' : 'register'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return send(400, { ok: false, error: '邮箱格式不对' })
    if (store.tooSoon(email)) return send(429, { ok: false, error: '刚发过一封，60 秒后再试' })

    const code = store.issueCode(email, purpose)
    store.noteSent(email)
    store.logEvent({ type: purpose === 'reset' ? 'reset_code' : 'verify_code', name: email, ...meta })

    if (!SMTP) {
      // No mail configured yet: the code is printed here and returned to the caller, so the
      // flow can be exercised before SMTP is set up. Never reaches a real user this way.
      console.log(`[yuan-Gym] verification code for ${email} (${purpose}): ${code}`)
      return send(200, { ok: true, delivered: false, devCode: code,
        note: 'SMTP 未配置：验证码已打印在服务端控制台，也随本次响应返回。' })
    }

    const mail = await sendMail({
      ...SMTP, to: email,
      subject: `yuan-Gym 验证码 ${code}`,
      text: `你的 yuan-Gym 验证码是 ${code}，${store.CODE_MINUTES} 分钟内有效。`,
      html: verifyEmailTemplate(code, store.CODE_MINUTES),
    })
    if (!mail.ok) {
      store.logEvent({ type: 'mail_failed', name: email, detail: mail.reason, ...meta })
      return send(502, { ok: false, error: '邮件发送失败：' + (mail.detail || mail.reason) })
    }
    return send(200, { ok: true, delivered: true })
  }

  // The salt a device needs before it can turn a password into a verifier. Derived from the name,
  // so it is the same on every device and nothing has to be stored; an unknown name still gets
  // one, which is what keeps this endpoint from answering "does this account exist?".
  if (pathname === '/api/auth/salt' && req.method === 'GET') {
    const name = url.searchParams.get('name') || ''
    if (!name.trim()) return send(400, { ok: false, error: 'name_required' })
    return send(200, { ok: true, salt: store.saltFor(name), iterations: 210000, algo: 'PBKDF2-SHA512' })
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (tooMany(meta.ip)) return send(429, { ok: false, error: '稍后再试：尝试次数过多' })
    const body = await readBody(req)
    if (!body) return send(400, { ok: false, error: 'bad_json' })
    const checked = store.checkCode(body.email, 'register', body.code)
    if (!checked.ok) { noteTry(meta.ip, false); return send(400, { ok: false, error: checked.error }) }
    const out = store.createUser({ name: body.name, email: body.email, verifier: body.verifier, meta: { ip: meta.ip } })
    if (out.error) { noteTry(meta.ip, false); return send(400, { ok: false, error: out.error }) }
    const token = store.issueToken(out.user.id, meta)
    setSessionCookie(res, token)
    store.logEvent({ type: 'register', userId: out.user.id, name: out.user.name, ...meta })
    return send(200, { ok: true, token, user: { id: out.user.id, name: out.user.name, email: out.user.email } })
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (tooMany(meta.ip)) return send(429, { ok: false, error: '稍后再试：尝试次数过多' })
    const body = await readBody(req)
    if (!body) return send(400, { ok: false, error: 'bad_json' })
    const user = store.verifyVerifier(body.name || body.email, body.verifier)
    if (!user) { noteTry(meta.ip, false); return send(401, { ok: false, error: '用户名/邮箱或密码不对' }) }
    noteTry(meta.ip, true)
    const token = store.issueToken(user.id, meta)
    setSessionCookie(res, token)
    store.recordLogin(user, meta)
    return send(200, { ok: true, token, user: { id: user.id, name: user.name, email: user.email } })
  }

  if (pathname === '/api/auth/reset' && req.method === 'POST') {
    if (tooMany(meta.ip)) return send(429, { ok: false, error: '稍后再试：尝试次数过多' })
    const body = await readBody(req)
    if (!body) return send(400, { ok: false, error: 'bad_json' })
    const checked = store.checkCode(body.email, 'reset', body.code)
    if (!checked.ok) return send(400, { ok: false, error: checked.error })
    const user = store.findByEmail(body.email)
    if (!user) return send(400, { ok: false, error: '这个邮箱没有注册过' })
    if (String(body.password || '').length < 6) return send(400, { ok: false, error: '密码至少 6 位' })
    store.setPassword(user, body.password)
    store.revokeAll(user.id)
    store.logEvent({ type: 'reset_password', userId: user.id, name: user.name, ...meta })
    const token = store.issueToken(user.id, meta)
    setSessionCookie(res, token)
    return send(200, { ok: true, token, user: { id: user.id, name: user.name, email: user.email } })
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    store.revokeToken(tokenOf(req))
    res.setHeader('Set-Cookie', 'yg_session=; Path=/; HttpOnly; Max-Age=0')
    return send(200, { ok: true })
  }

  if (pathname === '/api/auth/me') {
    const user = store.userOfToken(tokenOf(req))
    if (!user) return send(401, { ok: false, error: 'not_signed_in' })
    return send(200, { ok: true, user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt } })
  }

  // -- sync --
  if (pathname === '/api/sync') {
    const user = store.userOfToken(tokenOf(req))
    if (!user) return send(401, { ok: false, error: 'not_signed_in' })
    if (req.method === 'GET') {
      const current = store.getState(user.id)
      store.logEvent({ type: 'sync_pull', userId: user.id, ...meta })
      return send(200, { ok: true, ...current })
    }
    if (req.method === 'PUT') {
      const body = await readBody(req, 8_000_000)
      if (!body || typeof body.state !== 'object' || body.state === null) return send(400, { ok: false, error: 'no_state' })
      const out = store.putState(user.id, body.state, body.baseRev)
      store.logEvent({ type: out.conflict ? 'sync_conflict' : 'sync_push', userId: user.id, ...meta })
      if (out.conflict) return send(409, { ok: false, conflict: true, ...out })
      return send(200, { ok: true, ...out })
    }
    return send(405, { ok: false, error: 'method' })
  }

  if (pathname === '/api/event' && req.method === 'POST') {
    const user = store.userOfToken(tokenOf(req))
    const body = await readBody(req, 20_000)
    store.logEvent({ type: 'app', userId: user?.id || null, name: user?.name || 'guest', meta: body?.meta || null, ...meta })
    return send(200, { ok: true })
  }

  // -- admin --
  if (pathname.startsWith('/api/admin/')) {
    if (!adminOk(req, url)) return send(401, { ok: false, error: 'admin_token' })
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      return send(200, { ok: true, users: store.listUsers() })
    }
    if (pathname === '/api/admin/events' && req.method === 'GET') {
      return send(200, { ok: true, events: store.readEvents(Number(url.searchParams.get('limit')) || 300) })
    }
    if (pathname.startsWith('/api/admin/user/') && req.method === 'DELETE') {
      const id = pathname.split('/').pop()
      return send(200, { ok: store.deleteUser(id) })
    }
    if (pathname === '/api/admin/overview') {
      const users = store.listUsers()
      const events = store.readEvents(400)
      const day = 86400000
      const now = Date.now()
      return send(200, {
        ok: true,
        users: users.length,
        newToday: users.filter(u => now - u.createdAt < day).length,
        activeToday: users.filter(u => u.lastLoginAt && now - u.lastLoginAt < day).length,
        events24h: events.filter(e => now - e.t < day).length,
      })
    }
    return send(404, { ok: false, error: 'unknown_admin_route' })
  }

  return send(404, { ok: false, error: 'unknown_route' })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = decodeURIComponent(url.pathname)

  // CORS in one place, for every route that answers a fetch from another origin: the AI proxy
  // and the account/sync API. The account routes are called with credentials (session cookie)
  // and a bearer, and a credentialed response must name the exact origin — never '*'. So the
  // origin is echoed back, and ALLOW_ORIGIN narrows it to one name in production.
  const origin = process.env.ALLOW_ORIGIN || '*'
  const reqOrigin = String(req.headers.origin || '')
  const cors = pathname.startsWith('/api/') || pathname === '/ai' || pathname === '/ai/health'
  if (cors) {
    const allowed = !origin || origin === '*' ? (reqOrigin || '*') : origin
    res.setHeader('Access-Control-Allow-Origin', allowed)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Vary', 'Origin')
    if (reqOrigin) res.setHeader('Access-Control-Allow-Credentials', 'true')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  }

  if (pathname === '/ai') {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return }
    try { await handleAi(req, res) } catch (err) {
      json(res, 500, { ok: false, error: 'server', detail: String(err?.message || err) })
    }
    return
  }

  if (pathname === '/api/health' || pathname === '/ai/health') {
    json(res, 200, { ok: true, ai: Boolean(KEY), model: MODEL, uptime: process.uptime() })
    return
  }

  // ---- accounts & sync -----------------------------------------------------
  if (pathname.startsWith('/api/')) {
    try { await handleApi(req, res, pathname, url) } catch (err) {
      json(res, 500, { ok: false, error: 'server', detail: String(err?.message || err) })
    }
    return
  }

  if (pathname === '/admin') {
    const file = path.join(HERE, 'admin.html')
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      fs.createReadStream(file).pipe(res)
    } else { res.writeHead(404); res.end('admin.html missing') }
    return
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }

  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('dist/ 不存在，先执行 npm run build')
    return
  }

  const target = pathname === '/' ? '/index.html' : pathname
  const file = safeJoin(DIST, target)
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) { sendFile(res, file); return }

  // Unknown path: hand back the shell (the app routes on the hash).
  sendFile(res, path.join(DIST, 'index.html'))
})

server.listen(PORT, () => {
  console.log(`yuan-Gym server on http://127.0.0.1:${PORT}  (ai=${KEY ? 'on' : 'off'}, model=${MODEL})`)
})
