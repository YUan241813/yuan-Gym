#!/usr/bin/env node
/* The alternate home-screen icons (Settings → Look & Home → App icon), all drawn from the
 * user's own illustration in design/icons/icon-1024.png (a blue-haired lifter), composited
 * onto a dark-blue background tinted per variant.
 *
 * The old generator drew an upstream green-dumbbell glyph from rectangles in resources/icon.svg.
 * It is gone: every launcher PNG now comes from the same master illustration, decoded here with
 * a small pure-Node PNG reader (node:zlib only, no sharp/resvg) and downsampled by area
 * averaging — deterministic bytes on every machine, which scripts/app-icons.test.mjs checks.
 *
 * Written per variant:
 *   resources/icons/<id>.svg                                  a pointer to the master artwork
 *   public/app-icons/<id>.png                                 112 px preview for the settings row
 *   ios/App/App/Assets.xcassets/AppIcon-<Name>.appiconset/    1024 px, opaque (Apple refuses alpha)
 *   android/app/src/main/res/mipmap-<dpi>/ic_launcher_<id>{,_round,_foreground}.png
 *   android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_<id>{,_round}.xml
 *   android/app/src/main/res/values/app_icons.xml             the adaptive icons' background colours
 * The default launcher icon (ic_launcher*) is generated here too, so the home-screen icon is
 * the user's illustration as well — not the upstream green dumbbell @capacitor/assets shipped.
 *
 * The hand-made SVGs (Halloween / Christmas) and the scene()/drawArt() renderer are kept as
 * historical sources for the tests, but no longer feed any shipped PNG.
 *
 * Usage: node scripts/app-icons.mjs            write everything
 *        node scripts/app-icons.mjs --check    exit 1 when a committed file differs from a fresh draw */
import { deflateSync, inflateSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_ICON_VARIANTS } from '../src/lib/app-icon-variants.js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RES = 'android/app/src/main/res'

// Launcher icon in px per density (48 dp), and the adaptive layer (108 dp) beside it.
export const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
export const PREVIEW = 112
export const IOS_SIZE = 1024

/** The glyph's rectangles, in the 512 grid of resources/icon.svg: one source for every icon. */
export function glyph(svg = readFileSync(join(ROOT, 'resources/icon.svg'), 'utf8')) {
  const g = svg.match(/<g[^>]*>([\s\S]*?)<\/g>/)?.[1] || ''
  return [...g.matchAll(/<rect\s+x="(\d+)"\s+y="(\d+)"\s+width="(\d+)"\s+height="(\d+)"/g)]
    .map(m => m.slice(1, 5).map(Number))
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const byte = n => n < 0 ? 0 : n > 255 ? 255 : Math.round(n)

/** A dark-blue ground that matches the illustration (its own corners are transparent). */
const MASTER_BG = [14, 32, 56]        // #0E2038
const MASTER_FILE = join(ROOT, '..', '..', 'design', 'icons', 'icon-1024.png')

/** Minimal PNG reader: 8-bit non-interlaced, filters 0-4, colour types 0/2/4/6 → RGBA. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('icon master: not a PNG')
  let off = 8, w = 0, h = 0, depth = 0, color = 0, interlace = 0
  const idat = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      depth = data[8]; color = data[9]; interlace = data[12]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (depth !== 8 || interlace !== 0) throw new Error('icon master: need 8-bit non-interlaced PNG')
  const chans = { 0: 1, 2: 3, 4: 2, 6: 4 }[color]
  if (!chans) throw new Error('icon master: unsupported colour type ' + color)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * chans
  const lines = new Uint8Array(stride * h)
  let prev = new Uint8Array(stride)
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = lines.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? cur[i - chans] : 0
      const b = prev[i]
      const c = i >= chans ? prev[i - chans] : 0
      let v = src[i]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      }
      cur[i] = v & 255
    }
    prev = cur
  }
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const s = i * chans, d = i * 4
    if (chans === 4) { rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2]; rgba[d + 3] = lines[s + 3] }
    else if (chans === 3) { rgba[d] = lines[s]; rgba[d + 1] = lines[s + 1]; rgba[d + 2] = lines[s + 2]; rgba[d + 3] = 255 }
    else if (chans === 2) { rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s]; rgba[d + 3] = lines[s + 1] }
    else { rgba[d] = rgba[d + 1] = rgba[d + 2] = lines[s]; rgba[d + 3] = 255 }
  }
  return { w, h, rgba }
}

let MASTER = null
function master() {
  if (!MASTER) {
    const { w, h, rgba } = decodePng(readFileSync(MASTER_FILE))
    // Four prefix sums (premultiplied r/g/b + alpha). Built once: --check draws ~180 files.
    const IW = w + 1
    const S = [new Uint32Array(IW * (h + 1)), new Uint32Array(IW * (h + 1)),
               new Uint32Array(IW * (h + 1)), new Uint32Array(IW * (h + 1))]
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, a = rgba[s + 3]
      const vals = [rgba[s] * a, rgba[s + 1] * a, rgba[s + 2] * a, a]
      for (let c = 0; c < 4; c++) {
        S[c][(y + 1) * IW + x + 1] = vals[c] + S[c][y * IW + x + 1] + S[c][(y + 1) * IW + x] - S[c][y * IW + x]
      }
    }
    MASTER = { w, h, IW, S }
  }
  return MASTER
}

/** The illustration's ground, tinted a little by each variant (never a different picture). */
function bgFor(v) {
  const c = rgb(v.bg)
  return MASTER_BG.map((base, i) => byte(base * 0.86 + c[i] * 0.14))
}

/** One icon `size` px square, downsampled from the master illustration by area averaging.
 *  An integer summed-area table keeps it O(1) per output pixel and byte-identical everywhere. */
export function draw(v, size, { round = false } = {}) {
  const { w, h, IW, S } = master()
  const bg = bgFor(v)
  const ch = round ? 4 : 3
  const out = Buffer.alloc(size * size * ch)

  const box = (c, x0, y0, x1, y1) =>
    S[c][y1 * IW + x1] - S[c][y0 * IW + x1] - S[c][y1 * IW + x0] + S[c][y0 * IW + x0]

  const mono = v.id === 'mono', light = v.id === 'light'
  for (let y = 0; y < size; y++) {
    const y0 = Math.floor(y * h / size), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) * h / size)))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * w / size), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) * w / size)))
      const n = (x1 - x0) * (y1 - y0) * 255
      const sa = box(3, x0, y0, x1, y1)
      let R = (box(0, x0, y0, x1, y1) + bg[0] * (n - sa)) / n
      let G = (box(1, x0, y0, x1, y1) + bg[1] * (n - sa)) / n
      let B = (box(2, x0, y0, x1, y1) + bg[2] * (n - sa)) / n
      if (mono) { const l = (R + G + B) / 3; R = G = B = l }
      else if (light) { R = Math.min(255, R * 1.08); G = Math.min(255, G * 1.08); B = Math.min(255, B * 1.08) }
      const o = (y * size + x) * ch
      out[o] = byte(R); out[o + 1] = byte(G); out[o + 2] = byte(B)
      if (round) {
        let inside = 0
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
          const dx = x + (sx + 0.5) / 4 - size / 2, dy = y + (sy + 0.5) / 4 - size / 2
          if (dx * dx + dy * dy <= (size / 2) * (size / 2)) inside++
        }
        out[o + 3] = Math.round(255 * inside / 16)
      }
    }
  }
  return png(size, size, out, ch)
}

// --- the hand-made icons: a renderer for the little SVG they are allowed to use ---
// Painted back to front like SVG: each sample takes the colour of the topmost shape covering it.
// Strokes are capsules (round caps and joins), polygons fill even-odd, and a fill may be the one
// userSpaceOnUse radialGradient with two stops. Coordinates in the 512 viewBox.

const num = (a, k, d = 0) => (a[k] === undefined ? d : Number(a[k]))
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]))
const pts = s => s.trim().split(/[\s,]+/).map(Number).reduce((o, n, i) => (i % 2 ? o[o.length - 1].push(n) : o.push([n]), o), [])

/** The SVG as a list of shapes, each { hit(x, y), color(x, y), box }: what drawArt paints. */
export function scene(svg) {
  const grads = {}
  for (const m of svg.matchAll(/<radialGradient\b([^>]*)>([\s\S]*?)<\/radialGradient>/g)) {
    const a = attrs(m[1])
    const stops = [...m[2].matchAll(/<stop\b([^>]*)\/>/g)].map(s => attrs(s[1]))
    grads[a.id] = { cx: num(a, 'cx'), cy: num(a, 'cy'), r: num(a, 'r'), c0: rgb(stops[0]['stop-color']), c1: rgb(stops[stops.length - 1]['stop-color']) }
  }
  const paint = f => {
    const g = /^url\(#(.+)\)$/.exec(f)
    if (!g) { const c = rgb(f); return () => c }
    const { cx, cy, r, c0, c1 } = grads[g[1]]
    return (x, y) => {
      const t = Math.min(1, Math.hypot(x - cx, y - cy) / r)
      return [0, 1, 2].map(i => c0[i] + (c1[i] - c0[i]) * t)
    }
  }
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const stack = [{}]
  const shapes = []
  for (const m of body.matchAll(/<(\/?)(\w+)\b([^>]*?)(\/?)>/g)) {
    const [, close, name, raw, self] = m
    if (name === 'svg') continue
    if (name === 'g') { close ? stack.pop() : stack.push({ ...stack[stack.length - 1], ...attrs(raw) }); continue }
    if (close) continue
    const a = { ...stack[stack.length - 1], ...attrs(raw) }
    if (!self) throw new Error(`app icon art: <${name}> must close itself`)
    if (name === 'rect') {
      const x = num(a, 'x'), y = num(a, 'y'), w = num(a, 'width'), h = num(a, 'height')
      shapes.push({ box: [x, y, x + w, y + h], hit: (px, py) => px >= x && px < x + w && py >= y && py < y + h, color: paint(a.fill) })
    } else if (name === 'circle') {
      const cx = num(a, 'cx'), cy = num(a, 'cy'), r = num(a, 'r')
      shapes.push({ box: [cx - r, cy - r, cx + r, cy + r], hit: (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r, color: paint(a.fill) })
    } else if (name === 'line' || name === 'polyline') {
      const p = name === 'line' ? [[num(a, 'x1'), num(a, 'y1')], [num(a, 'x2'), num(a, 'y2')]] : pts(a.points)
      const hw = num(a, 'stroke-width', 1) / 2
      const segs = p.slice(1).map((q, i) => [p[i], q])
      const xs = p.map(q => q[0]), ys = p.map(q => q[1])
      shapes.push({
        box: [Math.min(...xs) - hw, Math.min(...ys) - hw, Math.max(...xs) + hw, Math.max(...ys) + hw],
        hit: (px, py) => segs.some(([[x1, y1], [x2, y2]]) => {
          const dx = x2 - x1, dy = y2 - y1
          const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)))
          return (px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2 <= hw * hw
        }),
        color: paint(a.stroke),
      })
    } else if (name === 'polygon') {
      const p = pts(a.points)
      const xs = p.map(q => q[0]), ys = p.map(q => q[1])
      shapes.push({
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        hit: (px, py) => {
          let inside = false
          for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
            const [xi, yi] = p[i], [xj, yj] = p[j]
            if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside
          }
          return inside
        },
        color: paint(a.fill),
      })
    } else throw new Error(`app icon art: no <${name}> in the renderer`)
  }
  return shapes.reverse()   // topmost first
}

/** A hand-made icon `size` px square, 4x4 samples per pixel: opaque (iOS, Android square and
 *  adaptive layer), or cut to a circle with alpha at the edge (Android round). */
export function drawArt(svg, size, { round = false } = {}) {
  const shapes = scene(svg)
  const k = 4, scale = 512 / size
  const ch = round ? 4 : 3
  const out = Buffer.alloc(size * size * ch)
  for (let y = 0; y < size; y++) {
    // Only the shapes this pixel row can touch.
    const y0 = y * scale, y1 = (y + 1) * scale
    const row = shapes.filter(s => s.box[1] <= y1 && s.box[3] >= y0)
    for (let x = 0; x < size; x++) {
      const x0 = x * scale, x1 = (x + 1) * scale
      const here = row.filter(s => s.box[0] <= x1 && s.box[2] >= x0)
      const sum = [0, 0, 0]
      let inside = 0
      for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
        if (round) {
          const dx = x + (sx + 0.5) / k - size / 2, dy = y + (sy + 0.5) / k - size / 2
          if (dx * dx + dy * dy > (size / 2) * (size / 2)) continue
        }
        inside++
        const px = (x + (sx + 0.5) / k) * scale, py = (y + (sy + 0.5) / k) * scale
        const s = here.find(sh => sh.hit(px, py))
        const c = s ? s.color(px, py) : [0, 0, 0]
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]
      }
      const o = (y * size + x) * ch
      for (let c = 0; c < 3; c++) out[o + c] = inside ? Math.round(sum[c] / inside) : 0
      if (round) out[o + 3] = Math.round(255 * inside / (k * k))
    }
  }
  return png(size, size, out, ch)
}

// --- PNG, the bare minimum: IHDR, one IDAT, IEND; filter 0 on every row ---
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(w, h, pixels, ch) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2   // 8 bit, RGBA or RGB
  const raw = Buffer.alloc(h * (w * ch + 1))
  for (let y = 0; y < h; y++) pixels.copy(raw, y * (w * ch + 1) + 1, y * w * ch, (y + 1) * w * ch)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Width, height and whether the PNG has an alpha channel, read from its header. */
export function pngInfo(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: buf[25] === 6 || buf[25] === 4 }
}

const svgOf = v => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 512 512">
  <!-- openGym app icon "${v.id}", written by scripts/app-icons.mjs.
       Shipped PNGs are drawn from design/icons/icon-1024.png (the user's own artwork).
       This file is a placeholder pointer only and is not bundled into the APK. -->
  <rect width="512" height="512" fill="${v.bg}"/>
</svg>
`

// The same layers as the default icon's (mipmap-anydpi-v26/ic_launcher.xml): the whole square icon
// as the foreground, inset to the 72 dp the launcher's mask shows, so every variant sits exactly
// where the original does. The colour behind it only shows where a launcher moves the layers.
const adaptive = id => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/app-icons.mjs. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_${id}_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_${id}_foreground" android:inset="16.7%" />
    </foreground>
</adaptive-icon>
`

const iosContents = `{
  "images" : [
    {
      "filename" : "icon-1024.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`

/** Every file this script owns, as [path relative to frontend/, () => contents]: drawn on demand. */
export function files(rects = glyph()) {
  const out = []
  const colors = []
  for (const v of APP_ICON_VARIANTS) {
    out.push([`public/app-icons/${v.id}.png`, () => draw(v, PREVIEW, { rects })])
    if (v.id === 'default') continue
    if (!v.art) out.push([`resources/icons/${v.id}.svg`, () => svgOf(v)])
    const set = `ios/App/App/Assets.xcassets/${v.ios}.appiconset`
    out.push([`${set}/Contents.json`, () => iosContents])
    out.push([`${set}/icon-1024.png`, () => draw(v, IOS_SIZE, { rects })])
    for (const [dpi, f] of Object.entries(DENSITIES)) {
      out.push([`${RES}/mipmap-${dpi}/ic_launcher_${v.id}.png`, () => draw(v, Math.round(48 * f), { rects })])
      out.push([`${RES}/mipmap-${dpi}/ic_launcher_${v.id}_round.png`, () => draw(v, Math.round(48 * f), { rects, round: true })])
      out.push([`${RES}/mipmap-${dpi}/ic_launcher_${v.id}_foreground.png`, () => draw(v, Math.round(108 * f), { rects })])
    }
    out.push([`${RES}/mipmap-anydpi-v26/ic_launcher_${v.id}.xml`, () => adaptive(v.id)])
    out.push([`${RES}/mipmap-anydpi-v26/ic_launcher_${v.id}_round.xml`, () => adaptive(v.id)])
    colors.push(`    <color name="ic_launcher_${v.id}_background">${v.bg}</color>`)
  }
  out.push([`${RES}/values/app_icons.xml`, () => `<?xml version="1.0" encoding="utf-8"?>
<!-- Written by scripts/app-icons.mjs: behind each alternate launcher icon. -->
<resources>
${colors.join('\n')}
</resources>
`])
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check')
  const bad = []
  for (const [rel, make] of files()) {
    const p = join(ROOT, rel)
    const body = make()
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
    if (check) {
      if (!existsSync(p) || !readFileSync(p).equals(buf)) bad.push(rel)
      continue
    }
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, buf)
  }
  if (bad.length) { console.error('app icons out of date (run node scripts/app-icons.mjs):\n  ' + bad.join('\n  ')); process.exit(1) }
  console.log(check ? 'app icons up to date' : 'app icons written')
}
