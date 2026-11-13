#!/usr/bin/env node
/* Run after `npm run build:mobile`'s `cap sync`: is what went into the native shells the phone
 * build, whole?
 *
 * A web `vite build` that runs into the same dist/ between the mobile build and `cap sync` (two
 * builds in one worktree) leaves the web index.html beside the mobile chunks, and the APK then
 * opens the web app: no Android-only settings, a service worker, the passkey login screen. Each
 * copy is checked for
 *   - the flavour tag the mobile build writes into index.html (vite.config.js, `opengym-flavor`),
 *   - every script and stylesheet index.html loads, present beside it,
 *   - a stamped service worker (no `__BUILD__` left in sw.js),
 *   - clip media vs. bundle extension: if the staged clip media is WebP, the bundle must resolve
 *     CLIP_EXT to `.webp` (the 1.4.6 regression: media was WebP but the build dropped
 *     VITE_CLIP_EXT=webp, so every animation 404'd and only a still frame showed).
 *
 * Usage: node scripts/check-mobile-bundle.mjs [frontend dir]   — exit code 1 on any problem. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COPIES = [
  'dist',
  'android/app/src/main/assets/public',
  'ios/App/App/public',
]

export function checkCopy(dir) {
  const problems = []
  const html = join(dir, 'index.html')
  if (!existsSync(html)) return [`${dir}: no index.html`]
  const text = readFileSync(html, 'utf8')
  if (!/<meta\s+name="opengym-flavor"\s+content="mobile"/.test(text))
    problems.push(`${dir}/index.html is not the mobile build (no opengym-flavor meta) — another build ran into dist/?`)
  for (const [, ref] of text.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g))
    if (!existsSync(join(dir, ref))) problems.push(`${dir}/index.html loads ${ref}, which is missing`)
  const sw = join(dir, 'sw.js')
  if (existsSync(sw) && readFileSync(sw, 'utf8').includes('__BUILD__'))
    problems.push(`${dir}/sw.js is not stamped (__BUILD__ left in it)`)
  return problems
}

// Guard against the 1.4.6 regression: the mobile build staged WebP clip media but the bundle
// asked for `.mp4` (VITE_CLIP_EXT dropped from the build env), so every animation 404'd and the
// UI fell back to a still frame. When the staged clip media is WebP, the bundle must resolve
// CLIP_EXT to `.webp` — either because it was told so (VITE_CLIP_EXT:"webp") or because it is a
// mobile build that defaults to WebP (the VITE_MOBILE==="1" → ".webp" fallback in exercises.js).
// A mismatch means a build step forgot VITE_CLIP_EXT=webp.
export function checkClipExt(dir) {
  const clipDir = join(dir, 'exercise-media', 'clip')
  if (!existsSync(clipDir)) return []                              // no media staged here → skip (dev / web build)
  const files = readdirSync(clipDir).filter(f => /\.(webp|mp4)$/i.test(f))
  const webp = files.filter(f => f.toLowerCase().endsWith('.webp')).length
  const mp4 = files.filter(f => f.toLowerCase().endsWith('.mp4')).length
  if (webp === 0 && mp4 === 0) return []                          // empty dir → nothing to judge
  if (webp > 0 && mp4 > 0) return []                              // mixed / unknown → don't guess
  const mediaIsWebp = webp > 0                                   // purely WebP media
  if (!mediaIsWebp) return []

  const assetsDir = join(dir, 'assets')
  if (!existsSync(assetsDir)) return []                           // no bundle to inspect → don't false-fail
  let clipExt = null, mobile = false, mobileFallbackToWebp = false
  for (const f of readdirSync(assetsDir)) {
    if (!f.endsWith('.js')) continue
    const src = readFileSync(join(assetsDir, f), 'utf8')
    if (clipExt === null) {
      // The minifier writes strings with backticks, not quotes: accept all three.
      const m = src.match(/VITE_CLIP_EXT:\s*[`"'](webp|mp4)[`"']/)
      if (m) clipExt = m[1]
    }
    if (!mobile) {
      const m = src.match(/VITE_MOBILE:\s*["']?([^"',}]+)["']?/)
      if (m && m[1] !== '0' && m[1].toLowerCase() !== 'false') mobile = true
    }
    // the new exercises.js fallback: `VITE_MOBILE === '1' ? '.webp' : '.mp4'`
    if (!mobileFallbackToWebp && /VITE_MOBILE\s*===\s*[`"']?1[`"']?\s*\?\s*[`"']\.webp/i.test(src))
      mobileFallbackToWebp = true
    if (clipExt !== null && mobile && mobileFallbackToWebp) break
  }

  const bundleIsWebp = clipExt === 'webp' || (clipExt === null && mobile && mobileFallbackToWebp)
  if (!bundleIsWebp)
    return [`${dir}: clip media is WebP but the bundle resolves CLIP_EXT to .mp4 — the mobile build is missing VITE_CLIP_EXT=webp (animations would 404 and fall back to a still frame)`]
  return []
}

export function checkMobileBundle(root) {
  const copies = COPIES.map(rel => join(root, rel)).filter((dir, i) => i === 0 || existsSync(dir))
  return copies.flatMap(dir => [...checkCopy(dir), ...checkClipExt(dir)])
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..'))
  const problems = checkMobileBundle(root)
  if (problems.length) {
    for (const p of problems) console.error('✗ ' + p)
    process.exit(1)
  }
  console.log('Mobile bundle OK in ' + COPIES.filter(rel => existsSync(join(root, rel))).join(', ') + '.')
}
