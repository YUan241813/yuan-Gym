// yuan-Gym — end-to-end smoke test against the live Worker.
//
// What it proves, in the order a real client does it:
//   1. GET  /api/auth/salt      a device gets a salt for its name
//   2. (the code is inserted into D1 out of band — see run-smoke.sh; no mail is sent)
//   3. POST /api/auth/register  creates the account and returns a session token
//   4. PUT  /api/sync           pushes a state blob
//   5. GET  /api/sync           reads it back
//   6. POST /api/auth/login     a second sign-in with the same password succeeds
//   7. GET  /api/auth/me        the token names the right user
//   8. DELETE /api/admin/user/… cleans up
//
// Usage: node test/smoke.mjs <name> <email> <password>
// The verifier is derived exactly as the browser does it (PBKDF2-SHA512, 210k rounds), so a
// pass here means the real front end will pass too.

import crypto from 'node:crypto'

const API = process.env.API_BASE || 'https://api.yuanzq.top'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''

const [, , name = 'smoketest', email = 'smoke@example.com', password = 'smoke-Passw0rd'] = process.argv

const j = async (res) => {
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: text } }
}

const verifierFor = async (password, saltHex, iterations) => {
  const salt = Buffer.from(saltHex, 'hex')
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, 64, 'sha512', (err, key) => {
      if (err) reject(err)
      else resolve(key.toString('hex'))
    })
  })
}

const step = (n, ok, extra = '') =>
  console.log(`${ok ? '  ok ' : '  FAIL'} ${n}${extra ? '  ' + extra : ''}`)

let failures = 0
const check = (n, ok, extra) => { if (!ok) failures++; step(n, ok, extra) }

async function main() {
  console.log(`smoke: ${API} as ${name} <${email}>`)

  const saltRes = await j(await fetch(`${API}/api/auth/salt?name=${encodeURIComponent(name)}`))
  check('salt', saltRes.status === 200 && saltRes.body.ok && /^[0-9a-f]{32,64}$/.test(saltRes.body.salt), saltRes.body.salt)

  const verifier = await verifierFor(password, saltRes.body.salt, saltRes.body.iterations || 210000)

  const regRes = await j(await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, code: process.env.CODE, verifier }),
  }))
  check('register', regRes.status === 200 && regRes.body.ok, JSON.stringify(regRes.body).slice(0, 160))
  const token = regRes.body?.token
  if (!token) { console.log('\ntoken missing, stopping'); process.exit(1) }

  const state = { workouts: [{ day: '2026-11-09', done: true }], note: 'smoke' }
  const putRes = await j(await fetch(`${API}/api/sync`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ state }),
  }))
  check('sync put', putRes.status === 200 && putRes.body.ok, `rev=${putRes.body.rev}`)

  const getRes = await j(await fetch(`${API}/api/sync`, { headers: { authorization: `Bearer ${token}` } }))
  const same = JSON.stringify(getRes.body?.state) === JSON.stringify(state)
  check('sync get', getRes.status === 200 && same, `rev=${getRes.body.rev}`)

  const loginRes = await j(await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, verifier }),
  }))
  check('login', loginRes.status === 200 && loginRes.body.ok, loginRes.body?.error || '')

  const meRes = await j(await fetch(`${API}/api/auth/me`, {
    headers: { authorization: `Bearer ${loginRes.body?.token || token}` },
  }))
  check('me', meRes.status === 200 && meRes.body?.user?.name === name, meRes.body?.user?.email || '')

  if (ADMIN_TOKEN && token) {
    const id = meRes.body?.user?.id
    if (id) {
      const delRes = await j(await fetch(`${API}/api/admin/user/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      }))
      check('cleanup', delRes.status === 200 && delRes.body.ok)
    }
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })
