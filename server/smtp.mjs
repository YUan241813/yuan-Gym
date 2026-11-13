// yuan-Gym — minimal SMTP sender.
//
// Enough SMTP to deliver one verification mail: EHLO, STARTTLS when offered, AUTH LOGIN,
// MAIL FROM / RCPT TO / DATA. No dependencies, because the server has none.
//
// Configure in server/config.json (or env):
//   { "smtp": { "host": "smtp.qq.com", "port": 465, "secure": true,
//               "user": "noreply@yuanzq.top", "pass": "授权码", "from": "yuan-Gym <noreply@yuanzq.top>" } }
//
// Port 465 is implicit TLS; 587 upgrades with STARTTLS. If nothing is configured, sendMail
// returns { ok:false, reason:'no_smtp' } and the caller decides what to do (the dev flow
// prints the code instead).

import net from 'node:net'
import tls from 'node:tls'

function readReply(socket, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = chunk => {
      buf += chunk.toString('utf8')
      // A multiline reply ends with "250 " (space) rather than "250-".
      const lines = buf.split(/\r?\n/).filter(Boolean)
      const last = lines[lines.length - 1] || ''
      if (/^\d{3} /.test(last)) {
        cleanup()
        resolve({ code: Number(last.slice(0, 3)), text: buf })
      }
    }
    const onErr = err => { cleanup(); reject(err) }
    const timer = setTimeout(() => { cleanup(); reject(new Error('smtp timeout')) }, timeout)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onErr)
    }
    socket.on('data', onData)
    socket.on('error', onErr)
  })
}

const cmd = async (socket, line, expect = 200) => {
  socket.write(line + '\r\n')
  const r = await readReply(socket)
  if (r.code >= expect + 100 || r.code < 200) throw new Error(`smtp ${r.code}: ${r.text.slice(0, 160)}`)
  return r
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64')

// RFC 5321 caps a line at 998 octets, and a base64 body must break at 76 characters anyway
// (RFC 2045). One long line is rejected outright by QQ — and by most servers.
const wrap76 = s => (s.match(/.{1,76}/g) || []).join('\r\n')

export async function sendMail({ host, port = 465, secure = true, user, pass, from, to, subject, text, html }) {
  if (!host || !user || !pass) return { ok: false, reason: 'no_smtp' }

  let socket
  try {
    socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port })

    await new Promise((resolve, reject) => {
      socket.once(secure ? 'secureConnect' : 'connect', resolve)
      socket.once('error', reject)
      setTimeout(() => reject(new Error('smtp connect timeout')), 15000)
    })

    await readReply(socket)
    await cmd(socket, `EHLO yuan-gym`, 250)

    if (!secure) {
      const r = await cmd(socket, 'STARTTLS', 200).catch(() => null)
      if (r && r.code === 220) {
        const upgraded = tls.connect({ socket, servername: host })
        await new Promise((res, rej) => { upgraded.once('secureConnect', res); upgraded.once('error', rej) })
        socket = upgraded
        await cmd(socket, `EHLO yuan-gym`, 250)
      }
    }

    await cmd(socket, 'AUTH LOGIN', 300)
    await cmd(socket, b64(user), 300)
    await cmd(socket, b64(pass), 200)
    await cmd(socket, `MAIL FROM:<${(from.match(/<(.+)>/) || [null, from])[1]}>`, 200)
    await cmd(socket, `RCPT TO:<${to}>`, 200)
    await cmd(socket, 'DATA', 300)

    const boundary = 'yg' + Date.now().toString(16)
    const body = [
      `From: ${from}`,
      `To: ${to}`,
      `Subject: =?UTF-8?B?${b64(subject)}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(text) === '' ? '' : wrap76(b64(text)),
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(b64(html || `<pre style="font:15px/1.7 -apple-system,system-ui,sans-serif">${text}</pre>`)),
      `--${boundary}--`,
      '',
    ].join('\r\n')

    socket.write(body + '\r\n.\r\n')
    const done = await readReply(socket)
    await cmd(socket, 'QUIT', 200).catch(() => null)
    if (done.code !== 250) return { ok: false, reason: 'smtp_rejected', detail: done.text.slice(0, 200) }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'smtp_error', detail: String(err?.message || err) }
  } finally {
    try { socket?.destroy() } catch { /* already gone */ }
  }
}

export const verifyEmailTemplate = (code, minutes) => `<!doctype html><html><body style="margin:0;background:#070b14;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC',sans-serif">
  <div style="max-width:440px;margin:0 auto;background:#0e1526;border:1px solid #1e2b45;border-radius:18px;padding:28px 26px;color:#e8eefb">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <div style="width:34px;height:34px;border-radius:10px;background:linear-gradient(145deg,#3b7bf5,#49d8ff)"></div>
      <div style="font-weight:700;font-size:16px">yuan-Gym</div>
    </div>
    <div style="font-size:15px;line-height:1.7">你的验证码是</div>
    <div style="font-size:34px;font-weight:800;letter-spacing:.16em;margin:12px 0 6px;color:#4c8dff">${code}</div>
    <div style="font-size:13px;color:#8ea3c4;line-height:1.7">${minutes} 分钟内有效。如果不是你本人操作，忽略这封邮件即可。</div>
  </div>
</body></html>`
