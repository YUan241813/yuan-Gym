// yuan-Gym — the whole server, on Cloudflare Workers.
//
// One Worker does three things for https://yuan-gym.yuanzq.top:
//
//   1. answers /api/*   accounts (username + verified email + password), sessions, and the one
//                       synced copy of each user's training state — D1, see src/db.js
//   2. answers /ai      the Zhipu GLM proxy, so the API key never reaches the browser
//   3. anything else    the built app (../app/frontend/dist) straight from Cloudflare's asset store
//
// Why this exists at all: the Node build (server/server.mjs) has to run on a machine that is
// switched on. A Worker does not. The trade is that there is no SMTP from here (src/mail.js uses
// an HTTPS mail API) and that passwords are stretched in the browser (app/frontend/src/lib/pw.js).
//
// Bindings: DB (D1) · ASSETS · secrets ADMIN_TOKEN, SALT_SECRET, GLM_API_KEY, MAIL_PROVIDER,
// MAIL_KEY, MAIL_FROM.

import ADMIN_HTML from './admin.html'
import {
  saltFor, sameVerifier, createUser, verifyVerifier, setVerifier, findById,
  recordLogin, issueToken, userOfToken, revokeToken, revokeAll,
  getState, putState, logEvent, readEvents, listUsers, deleteUser, isLimited, noteAttempt,
} from './db.js'

// src/mail.js is kept for the day an email step comes back (it speaks Brevo, Resend and the
// Cloudflare send_email binding), but nothing here calls it: registering is name + password.
const UPSTREAM = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

const json = (body, code = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  })

const cookiesOf = req => Object.fromEntries(
  String(req.headers.get('cookie') || '').split(';').map(p => p.trim()).filter(Boolean)
    .map(p => { const i = p.indexOf('='); return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))] }),
)

const tokenOf = req => {
  const c = cookiesOf(req)
  if (c.yg_session) return c.yg_session
  const auth = String(req.headers.get('authorization') || '')
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

const sessionCookie = token =>
  `yg_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}; Secure`

const metaOf = req => ({
  ip: String(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim(),
  ua: String(req.headers.get('user-agent') || ''),
})

async function readJson(req, limit = 8_000_000) {
  const text = await req.text()
  if (text.length > limit) return null
  try { return JSON.parse(text || '{}') } catch { return null }
}

const isAdmin = (req, url, env) => {
  if (!env.ADMIN_TOKEN) return false
  const given = url.searchParams.get('token') || cookiesOf(req).yg_admin || ''
  return given === env.ADMIN_TOKEN
}

// ---- API ------------------------------------------------------------------

async function handleApi(req, env, url, pathname) {
  const meta = metaOf(req)
  const send = (body, code = 200, extra = {}) => json(body, code, extra)

  // -- the salt a device needs before it can hash a password -----------------
  if (pathname === '/api/auth/salt' && req.method === 'GET') {
    const name = url.searchParams.get('name') || ''
    if (!name.trim()) return send({ ok: false, error: 'name_required' }, 400)
    return send({ ok: true, salt: await saltFor(env, name), iterations: 210000, algo: 'PBKDF2-SHA512' })
  }

  // -- email code ------------------------------------------------------------
  // Kept as an honest answer rather than a silent 404: the client should stop offering the button
  // instead of wondering why nothing arrives.
  if (pathname === '/api/auth/code' && req.method === 'POST') {
    return send({ ok: false, error: '邮箱验证已关闭：现在注册只需要用户名和密码' }, 410)
  }

  // -- register --------------------------------------------------------------
  // No email step: an account is a name and a password. Email used to be verified with a code,
  // which needed a mail provider; that is gone on purpose, so the name is the only identity and
  // the password is the only proof. `email` is accepted when a client sends one, as a label.
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    if (await isLimited(env, 'register', meta.ip)) return send({ ok: false, error: '稍后再试：尝试次数过多' }, 429)
    const body = await readJson(req, 20_000)
    if (!body) return send({ ok: false, error: 'bad_json' }, 400)

    const out = await createUser(env, { name: body.name, email: body.email, verifier: body.verifier, ip: meta.ip, ua: meta.ua })
    if (out.error) { await noteAttempt(env, 'register', meta.ip, false); return send({ ok: false, error: out.error }, 400) }
    const token = await issueToken(env, out.user.id, meta)
    await logEvent(env, { type: 'register', userId: out.user.id, name: out.user.name, ...meta })
    return send({ ok: true, token, user: { id: out.user.id, name: out.user.name, email: out.user.email } }, 200, { 'Set-Cookie': sessionCookie(token) })
  }

  // -- login -----------------------------------------------------------------
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (await isLimited(env, 'login', meta.ip)) return send({ ok: false, error: '稍后再试：尝试次数过多' }, 429)
    const body = await readJson(req, 20_000)
    if (!body) return send({ ok: false, error: 'bad_json' }, 400)
    const user = await verifyVerifier(env, body.name || body.email, body.verifier)
    if (!user) { await noteAttempt(env, 'login', meta.ip, false); return send({ ok: false, error: '用户名/邮箱或密码不对' }, 401) }
    await noteAttempt(env, 'login', meta.ip, true)
    const token = await issueToken(env, user.id, meta)
    await recordLogin(env, user, meta)
    return send({ ok: true, token, user: { id: user.id, name: user.name, email: user.email } }, 200, { 'Set-Cookie': sessionCookie(token) })
  }

  // -- change password (while signed in) -------------------------------------
  // This replaces the old "reset with an emailed code": with no mail there is no way to prove an
  // address, so the old password is the only thing that can authorise a new one. A forgotten
  // password is an admin reset in the console, not a self-service flow.
  if (pathname === '/api/auth/password' && req.method === 'POST') {
    if (await isLimited(env, 'password', meta.ip)) return send({ ok: false, error: '稍后再试：尝试次数过多' }, 429)
    const user = await userOfToken(env, tokenOf(req))
    if (!user) return send({ ok: false, error: 'not_signed_in' }, 401)
    const body = await readJson(req, 20_000)
    if (!body) return send({ ok: false, error: 'bad_json' }, 400)
    if (!/^[0-9a-f]{64,128}$/.test(String(body.newVerifier || ''))) return send({ ok: false, error: '新密码校验值不合法' }, 400)
    if (!sameVerifier(String(body.oldVerifier || ''), user.verifier)) {
      await noteAttempt(env, 'password', meta.ip, false)
      return send({ ok: false, error: '原密码不对' }, 401)
    }
    await setVerifier(env, user.id, body.newVerifier)
    await revokeAll(env, user.id)
    const token = await issueToken(env, user.id, meta)
    await logEvent(env, { type: 'change_password', userId: user.id, name: user.name, ...meta })
    return send({ ok: true, token }, 200, { 'Set-Cookie': sessionCookie(token) })
  }

  // -- reset with a code -----------------------------------------------------
  if (pathname === '/api/auth/reset' && req.method === 'POST') {
    return send({ ok: false, error: '已停用：邮箱验证已关闭，忘记密码请联系管理员在控制台重置' }, 410)
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    await revokeToken(env, tokenOf(req))
    return send({ ok: true }, 200, { 'Set-Cookie': 'yg_session=; Path=/; HttpOnly; Max-Age=0' })
  }

  if (pathname === '/api/auth/me') {
    const user = await userOfToken(env, tokenOf(req))
    if (!user) return send({ ok: false, error: 'not_signed_in' }, 401)
    return send({ ok: true, user: { id: user.id, name: user.name, email: user.email, createdAt: user.created_at } })
  }

  // -- sync ------------------------------------------------------------------
  if (pathname === '/api/sync') {
    const user = await userOfToken(env, tokenOf(req))
    if (!user) return send({ ok: false, error: 'not_signed_in' }, 401)
    if (req.method === 'GET') {
      const current = await getState(env, user.id)
      return send({ ok: true, ...current })
    }
    if (req.method === 'PUT') {
      const body = await readJson(req)
      if (!body || typeof body.state !== 'object' || body.state === null) return send({ ok: false, error: 'no_state' }, 400)
      const out = await putState(env, user.id, body.state, body.baseRev)
      await logEvent(env, { type: out.conflict ? 'sync_conflict' : 'sync_push', userId: user.id, ...meta })
      if (out.conflict) return send({ ok: false, conflict: true, ...out }, 409)
      return send({ ok: true, ...out })
    }
    return send({ ok: false, error: 'method' }, 405)
  }

  if (pathname === '/api/event' && req.method === 'POST') {
    const user = await userOfToken(env, tokenOf(req))
    const body = await readJson(req, 20_000)
    await logEvent(env, { type: 'app', userId: user?.id || null, name: user?.name || 'guest', meta: body?.meta || null, ...meta })
    return send({ ok: true })
  }

  // -- admin -----------------------------------------------------------------
  if (pathname.startsWith('/api/admin/')) {
    if (!isAdmin(req, url, env)) return send({ ok: false, error: 'admin_token' }, 401)
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      return send({ ok: true, users: await listUsers(env) })
    }
    if (pathname === '/api/admin/events' && req.method === 'GET') {
      return send({ ok: true, events: await readEvents(env, Number(url.searchParams.get('limit')) || 300) })
    }
    // -- admin resets a password --------------------------------------------
    // Passwords are stored as a one-way verifier, so the console can never show an existing one —
    // this is the only way back in for somebody who forgot theirs. The verifier arrives already
    // stretched by the browser (the salt comes from /api/auth/salt), which keeps PBKDF2 out of the
    // Worker's CPU budget and keeps the plaintext out of the request.
    if (pathname.startsWith('/api/admin/user/') && pathname.endsWith('/password') && req.method === 'POST') {
      const id = pathname.split('/')[4]
      const body = await readJson(req, 20_000)
      if (!body) return send({ ok: false, error: 'bad_json' }, 400)
      if (!/^[0-9a-f]{64,128}$/.test(String(body.verifier || ''))) return send({ ok: false, error: '校验值不合法' }, 400)
      const target = await findById(env, id)
      if (!target) return send({ ok: false, error: 'no_such_user' }, 404)
      await setVerifier(env, id, body.verifier)
      await revokeAll(env, id)
      await logEvent(env, { type: 'admin_reset_password', userId: id, name: target.name, ...meta })
      return send({ ok: true, user: { id, name: target.name } })
    }
    if (pathname.startsWith('/api/admin/user/') && req.method === 'DELETE') {
      return send({ ok: await deleteUser(env, pathname.split('/').pop()) })
    }
    if (pathname === '/api/admin/overview') {
      const [users, events] = await Promise.all([listUsers(env), readEvents(env, 400)])
      const day = 86400000
      const now = Date.now()
      return send({
        ok: true,
        users: users.length,
        newToday: users.filter(u => now - u.createdAt < day).length,
        activeToday: users.filter(u => u.lastLoginAt && now - u.lastLoginAt < day).length,
        events24h: events.filter(e => now - e.t < day).length,
      })
    }
    return send({ ok: false, error: 'unknown_admin_route' }, 404)
  }

  return send({ ok: false, error: 'unknown_route' }, 404)
}

// ---- AI proxy -------------------------------------------------------------

async function handleAi(req, env) {
  if (!env.GLM_API_KEY) return json({ ok: false, error: 'no_key', message: 'AI 未配置：缺少 GLM_API_KEY' }, 503)
  const payload = await readJson(req, 1_000_000)
  if (!payload) return json({ ok: false, error: 'bad_json' }, 400)
  const messages = Array.isArray(payload.messages) ? payload.messages : []
  if (!messages.length) return json({ ok: false, error: 'no_messages' }, 400)

  const model = payload.model || env.GLM_MODEL || 'glm-4.7-flash'
  const attempts = [model, 'glm-4-flash', 'glm-4-air']

  let last = null
  for (const m of attempts) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 55_000)
    try {
      const r = await fetch(UPSTREAM, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GLM_API_KEY}` },
        body: JSON.stringify({ model: m, messages, temperature: payload.temperature ?? 0.6, max_tokens: payload.maxTokens ?? 3000, stream: false }),
        signal: ctrl.signal,
      })
      const text = await r.text()
      if (!r.ok) {
        last = { model: m, status: r.status, detail: text.slice(0, 300) }
        if (![400, 404].includes(r.status)) break
        continue
      }
      const data = JSON.parse(text)
      return json({ ok: true, model: m, text: data?.choices?.[0]?.message?.content || '', usage: data?.usage || null })
    } catch (err) {
      last = { model: m, status: 0, detail: String(err?.message || err) }
      break
    } finally {
      clearTimeout(timer)
    }
  }
  return json({ ok: false, error: 'upstream', detail: last }, 502)
}

// ---- entry ----------------------------------------------------------------

// The app and its API are two names on one Worker:
//   yuan-gym.yuanzq.top  static files only — no accounts, no keys, cacheable
//   api.yuanzq.top       /api/*, /ai, /admin
// Two hosts is not decoration: the app host can then be pointed at a plain CDN later without
// touching the accounts, and the API host is the one place that must never be cached.
const API_HOST = 'api.yuanzq.top'

const CORS_HEADERS = (req, env) => {
  const origin = req.headers.get('origin') || ''
  if (!origin) return {}
  const allow = String(env.ALLOW_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (allow.length && !allow.includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  }
}

const adminPage = () => new Response(ADMIN_HTML, {
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
})

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const pathname = decodeURIComponent(url.pathname)
    const onApiHost = url.hostname === API_HOST
    const isApiPath = pathname.startsWith('/api/') || pathname === '/ai'

    if (onApiHost) {
      if (pathname === '/admin') return adminPage()
      if (pathname === '/' ) return json({ ok: true, service: 'yuan-Gym API', app: 'https://yuan-gym.yuanzq.top' })
      if (!isApiPath) return json({ ok: false, error: 'not_found' }, 404)

      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS(req, env) })
      try {
        const res = pathname === '/ai'
          ? (req.method === 'POST' ? await handleAi(req, env) : json({ ok: false, error: 'method' }, 405))
          : pathname === '/api/health'
            ? json({ ok: true, ai: Boolean(env.GLM_API_KEY), model: env.GLM_MODEL || 'glm-4.7-flash', host: 'api' })
            : await handleApi(req, env, url, pathname)
        // Every API answer names the calling origin (never '*') because it may carry a cookie.
        const headers = new Headers(res.headers)
        for (const [k, v] of Object.entries(CORS_HEADERS(req, env))) headers.set(k, v)
        return new Response(res.body, { status: res.status, headers })
      } catch (err) {
        return json({ ok: false, error: 'server', detail: String(err?.message || err) }, 500, CORS_HEADERS(req, env))
      }
    }

    // The app host: files, and nothing that could hold a session. A stray /api call is told where
    // the API actually is instead of being answered by a second copy of the same code.
    if (isApiPath) {
      return json({ ok: false, error: 'use_api_host', api: `https://${API_HOST}` }, 404, CORS_HEADERS(req, env))
    }
    if (pathname === '/admin') return Response.redirect(`https://${API_HOST}/admin`, 302)

    return env.ASSETS.fetch(req)
  },
}
