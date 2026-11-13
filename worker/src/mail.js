// yuan-Gym — sending the one email this app has to send.
//
// A Worker cannot open an SMTP connection, so the verification code leaves through an HTTPS mail
// API instead. Three providers are supported, chosen by the MAIL_PROVIDER secret:
//
//   brevo       POST https://api.brevo.com/v3/smtp/email      header: api-key
//   resend      POST https://api.resend.com/emails            header: Authorization: Bearer
//   cloudflare  the send_email binding (env.EMAIL)            no key, no third party
//
// Secrets: MAIL_PROVIDER, MAIL_KEY, MAIL_FROM ("yuan-Gym <noreply@yuanzq.top>").
// With none of them set, no code is ever returned to the caller — the endpoint answers 503 and
// says so, because a code handed back in the response would let anyone claim any address.
//
// On the cloudflare provider there is no MAIL_KEY: the binding carries the credential, and the
// domain has to be onboarded under Compute > Email Service > Email Sending first (Cloudflare adds
// the SPF/DKIM/DMARC/MX records itself). Note that sending to arbitrary recipients needs a paid
// Workers plan; on the free plan only verified destination addresses in the same account receive.

const parseFrom = from => {
  const m = String(from || '').match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return m ? { name: m[1] || 'yuan-Gym', email: m[2] } : { name: 'yuan-Gym', email: String(from || '') }
}

export const mailConfigured = env => {
  const provider = String(env.MAIL_PROVIDER || '').toLowerCase()
  if (!provider || !env.MAIL_FROM) return false
  // The binding is the credential on Cloudflare; the other two need a key.
  if (provider === 'cloudflare') return Boolean(env.EMAIL)
  return Boolean(env.MAIL_KEY)
}

export async function sendCode(env, { to, code, minutes }) {
  if (!mailConfigured(env)) return { ok: false, reason: 'no_mail' }

  const provider = String(env.MAIL_PROVIDER).toLowerCase()
  const from = parseFrom(env.MAIL_FROM)
  const subject = `yuan-Gym 验证码 ${code}`
  const text = `你的 yuan-Gym 验证码是 ${code}，${minutes} 分钟内有效。`
  const html = verifyEmailTemplate(code, minutes)

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    let res
    if (provider === 'brevo') {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.MAIL_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: from,
          to: [{ email: to }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
        signal: ctrl.signal,
      })
    } else if (provider === 'resend') {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.MAIL_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
        signal: ctrl.signal,
      })
    } else if (provider === 'cloudflare') {
      // The binding answers with a messageId or throws; there is no HTTP status to read.
      const sent = await env.EMAIL.send({ to, from: from.email, subject, html, text })
      clearTimeout(timer)
      return sent && sent.messageId ? { ok: true } : { ok: false, reason: 'no_message_id', detail: JSON.stringify(sent || {}).slice(0, 200) }
    } else {
      return { ok: false, reason: 'unknown_provider', detail: provider }
    }

    const body = await res.text()
    if (!res.ok) return { ok: false, reason: 'rejected', detail: body.slice(0, 300) }
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: 'network', detail: String(err?.message || err) }
  } finally {
    clearTimeout(timer)
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
