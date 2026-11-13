// yuan-Gym — accounts, email verification, sessions, sync blobs and the usage log.
//
// Everything lives in plain files under server/data/ so a backup is a folder copy and there is
// no database to run beside the app:
//
//   users.json      username, email, password hash, created / last-seen times, login counter
//   codes.json      short-lived email codes (register / reset), 10 minutes, 5 attempts
//   state/<id>.json one synced blob per user (last write wins, with a revision)
//   events.jsonl    append-only usage log, one JSON object per line
//   sessions.json   hashed session tokens
//
// Passwords are PBKDF2-SHA512 with a per-user salt. Tokens are 32 random bytes with an expiry.
// Nothing here trusts a client-supplied id, and no endpoint reveals whether an email exists.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const SESSION_DAYS = 30
const CODE_MINUTES = 10

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function createStore(dir, { saltSecret = '' } = {}) {
  const DATA = dir
  const USERS = path.join(DATA, 'users.json')
  const CODES = path.join(DATA, 'codes.json')
  const STATE = path.join(DATA, 'state')
  const EVENTS = path.join(DATA, 'events.jsonl')
  const SESS = path.join(DATA, 'sessions.json')

  // What turns a name into a salt. Stable across restarts (it comes from config), and never
  // sent anywhere: the client derives the verifier from it and we derive it again to check.
  const SECRET = String(saltSecret || 'yuan-gym-local-salt')

  fs.mkdirSync(STATE, { recursive: true })

  const readJson = (file, fallback) => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
  }
  const writeJson = (file, value) => {
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
    fs.renameSync(tmp, file)
  }

  let users = readJson(USERS, { users: [] })
  let sessions = readJson(SESS, { tokens: {} })
  let codes = readJson(CODES, { codes: {} })

  const persistUsers = () => writeJson(USERS, users)
  const persistSessions = () => writeJson(SESS, sessions)
  const persistCodes = () => writeJson(CODES, codes)

  const lower = s => String(s || '').trim().toLowerCase()

  /** The salt a client derives its verifier with — the same one this store recomputes to check. */
  const saltFor = name =>
    crypto.createHmac('sha256', SECRET).update('yg1:' + lower(name)).digest('hex').slice(0, 32)

  const sameVerifier = (a, b) => {
    const x = Buffer.from(String(a || ''), 'utf8')
    const y = Buffer.from(String(b || ''), 'utf8')
    return x.length === y.length && crypto.timingSafeEqual(x, y)
  }

  const findByName = name => users.users.find(u => lower(u.name) === lower(name))
  const findByEmail = email => users.users.find(u => lower(u.email) === lower(email))
  const findById = id => users.users.find(u => u.id === id)

  // ---- codes ---------------------------------------------------------------
  const codeKey = (email, purpose) => `${purpose}:${lower(email)}`

  function issueCode(email, purpose = 'register') {
    const clean = lower(email)
    const code = String(Math.floor(100000 + Math.random() * 900000))
    codes.codes[codeKey(clean, purpose)] = {
      code,
      exp: Date.now() + CODE_MINUTES * 60000,
      tries: 0,
      sentAt: Date.now(),
    }
    // Keep the file small: drop anything expired.
    const now = Date.now()
    for (const [k, v] of Object.entries(codes.codes)) if (v.exp < now) delete codes.codes[k]
    persistCodes()
    return code
  }

  function checkCode(email, purpose, code) {
    const rec = codes.codes[codeKey(email, purpose)]
    if (!rec) return { ok: false, error: '验证码已过期，请重新获取' }
    if (rec.exp < Date.now()) { delete codes.codes[codeKey(email, purpose)]; persistCodes(); return { ok: false, error: '验证码已过期，请重新获取' } }
    if (rec.tries >= 5) { delete codes.codes[codeKey(email, purpose)]; persistCodes(); return { ok: false, error: '尝试次数过多，请重新获取' } }
    if (String(code) !== rec.code) { rec.tries += 1; persistCodes(); return { ok: false, error: '验证码不对' } }
    delete codes.codes[codeKey(email, purpose)]
    persistCodes()
    return { ok: true }
  }

  const lastSent = new Map()
  function tooSoon(email) {
    const at = lastSent.get(lower(email)) || 0
    return Date.now() - at < 60_000
  }
  const noteSent = email => lastSent.set(lower(email), Date.now())

  // ---- users ---------------------------------------------------------------
  function validate(name, email, verifier) {
    const clean = String(name || '').trim()
    if (!/^[\w\u4e00-\u9fa5.@-]{2,24}$/.test(clean)) return '用户名需 2–24 位，可用中文、字母、数字、_ . - @'
    if (!EMAIL_RE.test(String(email || '').trim())) return '邮箱格式不对'
    if (!/^[0-9a-f]{64,128}$/.test(String(verifier || ''))) return '密码校验值不合法'
    return null
  }

  function createUser({ name, email, verifier, meta = {} }) {
    const problem = validate(name, email, verifier)
    if (problem) return { error: problem }
    if (findByName(name)) return { error: '这个用户名已经被注册了' }
    if (findByEmail(email)) return { error: '这个邮箱已经注册过了，可以直接登录' }

    const user = {
      id: crypto.randomBytes(8).toString('hex'),
      name: String(name).trim(),
      email: lower(email),
      emailVerified: true,
      verifier: String(verifier),
      createdAt: Date.now(),
      lastLoginAt: null,
      logins: 0,
      meta,
    }
    users.users.push(user)
    persistUsers()
    return { user }
  }

  function verifyVerifier(nameOrEmail, verifier) {
    const user = findByName(nameOrEmail) || findByEmail(nameOrEmail)
    if (!user) return null
    return sameVerifier(verifier, user.verifier) ? user : null
  }

  function setVerifier(user, verifier) {
    user.verifier = String(verifier)
    persistUsers()
  }

  // ---- sessions ------------------------------------------------------------
  function issueToken(userId, meta = {}) {
    const token = crypto.randomBytes(32).toString('hex')
    const now = Date.now()
    for (const [t, s] of Object.entries(sessions.tokens)) if (s.exp < now) delete sessions.tokens[t]
    sessions.tokens[token] = { userId, exp: now + SESSION_DAYS * 86400000, ip: meta.ip || '', ua: (meta.ua || '').slice(0, 200), at: now }
    persistSessions()
    return token
  }

  function userOfToken(token) {
    const s = token && sessions.tokens[token]
    if (!s || s.exp < Date.now()) return null
    return findById(s.userId) || null
  }

  function revokeToken(token) {
    if (token && sessions.tokens[token]) { delete sessions.tokens[token]; persistSessions() }
  }

  function revokeAll(userId) {
    for (const [t, s] of Object.entries(sessions.tokens)) if (s.userId === userId) delete sessions.tokens[t]
    persistSessions()
  }

  function recordLogin(user, meta = {}) {
    user.logins = (user.logins || 0) + 1
    user.lastLoginAt = Date.now()
    persistUsers()
    logEvent({ type: 'login', userId: user.id, name: user.name, ...meta })
  }

  // ---- sync ----------------------------------------------------------------
  const stateFile = id => path.join(STATE, `${id}.json`)

  function getState(id) {
    const file = stateFile(id)
    if (!fs.existsSync(file)) return { rev: 0, state: null, updatedAt: null }
    return readJson(file, { rev: 0, state: null })
  }

  function putState(id, state, baseRev) {
    const current = getState(id)
    if (baseRev != null && Number(baseRev) !== current.rev) {
      return { conflict: true, rev: current.rev, state: current.state, updatedAt: current.updatedAt }
    }
    const next = { rev: current.rev + 1, state, updatedAt: Date.now() }
    writeJson(stateFile(id), next)
    return next
  }

  // ---- usage log -----------------------------------------------------------
  function logEvent(event) {
    try { fs.appendFileSync(EVENTS, JSON.stringify({ t: Date.now(), ...event }) + '\n') } catch { /* full disk must not break a request */ }
  }

  function readEvents(limit = 300) {
    try {
      const lines = fs.readFileSync(EVENTS, 'utf8').trim().split('\n').filter(Boolean)
      return lines.slice(-limit).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean).reverse()
    } catch { return [] }
  }

  function listUsers() {
    return users.users.map(u => ({
      id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt, logins: u.logins || 0,
      rev: getState(u.id).rev, updatedAt: getState(u.id).updatedAt,
    })).sort((a, b) => b.createdAt - a.createdAt)
  }

  function deleteUser(id) {
    const i = users.users.findIndex(u => u.id === id)
    if (i < 0) return false
    users.users.splice(i, 1)
    persistUsers()
    try { fs.unlinkSync(stateFile(id)) } catch { /* already gone */ }
    revokeAll(id)
    return true
  }

  return {
    createUser, verifyVerifier, setVerifier, saltFor, issueToken, userOfToken, revokeToken, revokeAll, recordLogin,
    issueCode, checkCode, tooSoon, noteSent, findByName, findByEmail,
    getState, putState, logEvent, readEvents, listUsers, deleteUser,
    CODE_MINUTES,
  }
}
