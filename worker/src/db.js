// yuan-Gym — the account store, on D1.
//
// Same jobs as server/accounts.mjs had on the laptop: users, email codes, sessions, one synced
// state per user, an append-only usage log. The difference is that a Worker keeps nothing in
// memory between requests, so every fact lives in a table (schema.sql) and every check is a
// query. No request trusts a client-supplied id, and no endpoint answers "does this account
// exist?" differently from "wrong password".

const CODE_MINUTES = 10
const SESSION_DAYS = 30
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const lower = s => String(s || '').trim().toLowerCase()
export const isEmail = s => EMAIL_RE.test(String(s || '').trim())

const enc = new TextEncoder()
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

/** The salt a client needs before it can derive its verifier — stable per name, never stored. */
export async function saltFor(env, name) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(env.SALT_SECRET || 'yuan-gym')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode('yg1:' + lower(name)))
  return hex(mac).slice(0, 32)
}

export function sameVerifier(a, b) {
  const x = String(a || ''), y = String(b || '')
  if (x.length !== y.length || !x.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

// ---- codes ----------------------------------------------------------------

const codeKey = (email, purpose) => `${purpose}:${lower(email)}`

export async function codeAge(env, email, purpose) {
  const row = await env.DB.prepare('SELECT sent_at FROM codes WHERE key = ?').bind(codeKey(email, purpose)).first()
  return row ? Date.now() - row.sent_at : Infinity
}

export async function issueCode(env, email, purpose) {
  const code = String(Math.floor(100000 + Math.random() * 900000))
  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO codes (key, code, exp, tries, sent_at) VALUES (?, ?, ?, 0, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET code = excluded.code, exp = excluded.exp, tries = 0, sent_at = excluded.sent_at',
  ).bind(codeKey(email, purpose), code, now + CODE_MINUTES * 60000, now).run()
  // Housekeeping, cheap because it touches an index: expired codes are dead weight.
  await env.DB.prepare('DELETE FROM codes WHERE exp < ?').bind(now).run().catch(() => {})
  return code
}

export async function checkCode(env, email, purpose, code) {
  const key = codeKey(email, purpose)
  const row = await env.DB.prepare('SELECT code, exp, tries FROM codes WHERE key = ?').bind(key).first()
  if (!row) return { ok: false, error: '验证码已过期，请重新获取' }
  if (row.exp < Date.now()) {
    await env.DB.prepare('DELETE FROM codes WHERE key = ?').bind(key).run()
    return { ok: false, error: '验证码已过期，请重新获取' }
  }
  if (row.tries >= 5) {
    await env.DB.prepare('DELETE FROM codes WHERE key = ?').bind(key).run()
    return { ok: false, error: '尝试次数过多，请重新获取' }
  }
  if (String(code) !== String(row.code)) {
    await env.DB.prepare('UPDATE codes SET tries = tries + 1 WHERE key = ?').bind(key).run()
    return { ok: false, error: '验证码不对' }
  }
  await env.DB.prepare('DELETE FROM codes WHERE key = ?').bind(key).run()
  return { ok: true }
}

// ---- users ----------------------------------------------------------------

export function validateUser(name, email, verifier) {
  const clean = String(name || '').trim()
  if (!/^[\w\u4e00-\u9fa5.@-]{2,24}$/.test(clean)) return '用户名需 2–24 位，可用中文、字母、数字、_ . - @'
  // Email is optional: an account is a name and a password. When one is given it is only a label
  // to sign in with — nothing is ever sent to it, so it is not proof of anything.
  const mail = String(email || '').trim()
  if (mail && !isEmail(mail)) return '邮箱格式不对'
  if (!/^[0-9a-f]{64,128}$/.test(String(verifier || ''))) return '密码校验值不合法'
  return null
}

export const findByName = (env, name) =>
  env.DB.prepare('SELECT * FROM users WHERE name_lower = ?').bind(lower(name)).first()
export const findByEmail = (env, email) =>
  env.DB.prepare('SELECT * FROM users WHERE email_lower = ?').bind(lower(email)).first()
export const findById = (env, id) =>
  env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()

export async function createUser(env, { name, email = '', verifier, ip = '', ua = '' }) {
  const problem = validateUser(name, email, verifier)
  if (problem) return { error: problem }
  if (await findByName(env, name)) return { error: '这个用户名已经被注册了' }
  // NULL, not '', so several accounts without an email can coexist under the UNIQUE index.
  const mail = String(email || '').trim().toLowerCase() || null
  if (mail && (await findByEmail(env, mail))) return { error: '这个邮箱已经注册过了，可以直接登录' }

  const id = hex(crypto.getRandomValues(new Uint8Array(8)))
  await env.DB.prepare(
    'INSERT INTO users (id, name, name_lower, email, email_lower, verifier, created_at, logins, ip, ua) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
  ).bind(id, String(name).trim(), lower(name), mail, mail, verifier, Date.now(), ip, String(ua).slice(0, 200)).run()
  return { user: await findById(env, id) }
}

export async function verifyVerifier(env, nameOrEmail, verifier) {
  const user = (await findByName(env, nameOrEmail)) || (await findByEmail(env, nameOrEmail))
  if (!user) return null
  return sameVerifier(verifier, user.verifier) ? user : null
}

export const setVerifier = (env, userId, verifier) =>
  env.DB.prepare('UPDATE users SET verifier = ? WHERE id = ?').bind(String(verifier), userId).run()

export async function recordLogin(env, user, meta) {
  await env.DB.prepare('UPDATE users SET logins = logins + 1, last_login_at = ? WHERE id = ?').bind(Date.now(), user.id).run()
  await logEvent(env, { type: 'login', userId: user.id, name: user.name, ...meta })
}

// ---- sessions -------------------------------------------------------------

export async function issueToken(env, userId, meta = {}) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)))
  const now = Date.now()
  await env.DB.prepare('DELETE FROM sessions WHERE exp < ?').bind(now).run().catch(() => {})
  await env.DB.prepare('INSERT INTO sessions (token, user_id, exp, ip, ua, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(token, userId, now + SESSION_DAYS * 86400000, meta.ip || '', String(meta.ua || '').slice(0, 200), now).run()
  return token
}

export async function userOfToken(env, token) {
  if (!token) return null
  const row = await env.DB.prepare('SELECT user_id, exp FROM sessions WHERE token = ?').bind(token).first()
  if (!row) return null
  if (row.exp < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run().catch(() => {})
    return null
  }
  return findById(env, row.user_id)
}

export const revokeToken = (env, token) =>
  token ? env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run() : Promise.resolve()
export const revokeAll = (env, userId) =>
  env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run()

// ---- synced state ---------------------------------------------------------

export async function getState(env, userId) {
  const row = await env.DB.prepare('SELECT rev, state, updated_at FROM states WHERE user_id = ?').bind(userId).first()
  if (!row) return { rev: 0, state: null, updatedAt: null }
  let state = null
  try { state = row.state ? JSON.parse(row.state) : null } catch { state = null }
  return { rev: row.rev, state, updatedAt: row.updated_at }
}

export async function putState(env, userId, state, baseRev) {
  const current = await getState(env, userId)
  if (baseRev != null && Number(baseRev) !== current.rev) {
    return { conflict: true, rev: current.rev, state: current.state, updatedAt: current.updatedAt }
  }
  const next = { rev: current.rev + 1, state, updatedAt: Date.now() }
  await env.DB.prepare(
    'INSERT INTO states (user_id, rev, state, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(user_id) DO UPDATE SET rev = excluded.rev, state = excluded.state, updated_at = excluded.updated_at',
  ).bind(userId, next.rev, JSON.stringify(state), next.updatedAt).run()
  return next
}

// ---- usage log ------------------------------------------------------------

export function logEvent(env, e) {
  return env.DB.prepare('INSERT INTO events (t, type, user_id, name, ip, ua, meta) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), String(e.type || 'event'), e.userId || null, e.name || null,
      e.ip || null, String(e.ua || '').slice(0, 200), e.meta ? JSON.stringify(e.meta) : null)
    .run().catch(() => { /* a log write must never fail a request */ })
}

export async function readEvents(env, limit = 300) {
  const { results } = await env.DB.prepare(
    'SELECT t, type, user_id, name, ip, ua, meta FROM events ORDER BY id DESC LIMIT ?',
  ).bind(Math.min(Number(limit) || 300, 1000)).all()
  return (results || []).map(r => ({
    t: r.t, type: r.type, userId: r.user_id, name: r.name, ip: r.ip, ua: r.ua,
    meta: r.meta ? JSON.parse(r.meta) : null,
  }))
}

export async function listUsers(env) {
  const { results } = await env.DB.prepare(
    'SELECT u.id, u.name, u.email, u.created_at, u.last_login_at, u.logins, ' +
    '       s.rev, s.updated_at ' +
    'FROM users u LEFT JOIN states s ON s.user_id = u.id ORDER BY u.created_at DESC',
  ).all()
  return (results || []).map(r => ({
    id: r.id, name: r.name, email: r.email, createdAt: r.created_at,
    lastLoginAt: r.last_login_at, logins: r.logins || 0,
    rev: r.rev || 0, updatedAt: r.updated_at || null,
  }))
}

export async function deleteUser(env, id) {
  const user = await findById(env, id)
  if (!user) return false
  await env.DB.batch([
    env.DB.prepare('DELETE FROM states WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ])
  return true
}

// ---- attempt limits (stands in for the Node server's in-memory map) -------

export async function isLimited(env, action, ip) {
  const row = await env.DB.prepare('SELECT n, until FROM limits WHERE key = ?').bind(`${action}:${ip}`).first()
  return Boolean(row && row.until > Date.now())
}

export async function noteAttempt(env, action, ip, ok) {
  const key = `${action}:${ip}`
  if (ok) {
    await env.DB.prepare('DELETE FROM limits WHERE key = ?').bind(key).run().catch(() => {})
    return
  }
  const row = await env.DB.prepare('SELECT n FROM limits WHERE key = ?').bind(key).first()
  const n = (row?.n || 0) + 1
  const until = n >= 5 ? Date.now() + 10 * 60000 : 0
  await env.DB.prepare(
    'INSERT INTO limits (key, n, until) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET n = ?, until = ?',
  ).bind(key, n >= 5 ? 0 : n, until, n >= 5 ? 0 : n, until).run().catch(() => {})
}
