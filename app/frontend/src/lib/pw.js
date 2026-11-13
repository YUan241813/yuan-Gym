// yuan-Gym — how a password becomes something the server can check without ever seeing it.
//
// The account server runs on Cloudflare Workers, where a request may only burn a few
// milliseconds of CPU. PBKDF2 over 200 000 rounds is tens of milliseconds — the request would be
// killed. So the stretching happens here, in the browser (or on the phone), where the CPU is the
// user's own and a quarter of a second costs nothing:
//
//   salt     = HMAC-SHA256(SALT_SECRET, "yg1:" + lowercased name)   ← the server hands this out
//   verifier = PBKDF2-SHA512(password, salt, 210000, 64 bytes)      ← this is what we send
//
// The server stores the verifier, never the password, and compares it in constant time. Two
// consequences worth stating plainly: the salt is derived from the name rather than stored, so a
// login can start from just the name and an unknown name still returns a salt (no account
// enumeration); and the verifier is, in effect, the password as far as this server is concerned —
// which is the usual trade for client-side derivation, and why the API is HTTPS-only.

const TEXT = new TextEncoder()

const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

export const bytesOfHex = hex => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** The verifier for a password and the salt the server gave out for that name. */
export async function verifierOf(password, saltHex, { iterations = 210_000 } = {}) {
  const key = await crypto.subtle.importKey('raw', TEXT.encode(String(password)), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt: bytesOfHex(String(saltHex)), iterations },
    key,
    512,
  )
  return toHex(bits)
}

/** A stable, non-reversible "this password is the same one" check, for the rare local comparison. */
export const sameVerifier = (a, b) => {
  const x = String(a || ''), y = String(b || '')
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}
