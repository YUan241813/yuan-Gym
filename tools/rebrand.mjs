// One-shot rebrand: strip every trace of the upstream project name and drop in the
// yuan-Gym identity. Idempotent — safe to run again after upstream-style strings reappear.
//
//   node tools/rebrand.mjs
//
// Text pass: src/**, index.html, public/*.json, package.json, capacitor.config.json,
// vite.config.js. Test files are skipped (they assert on internals we do not ship).
// Asset pass: design/icons/* -> public/ (PWA, apple touch, favicon, every in-app icon variant).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const APP = path.join(ROOT, 'app', 'frontend')

const BRAND = 'yuan-Gym'
const BRAND_SLUG = 'yuan-gym'

// Longest / most specific first so "openGym.ch" never becomes "yuan-Gym.ch".
const RULES = [
  [/opengym\.ch/gi, 'yuanzq.top'],
  [/OpenGym/g, BRAND],
  [/openGym/g, BRAND],
  [/OPEN_GYM/g, 'YUAN_GYM'],
  [/open-gym/g, BRAND_SLUG],
  [/opengym/gi, BRAND_SLUG],
  [/gym_state_v1/g, 'yuangym_state_v1'],
]

const TEXT_EXT = new Set(['.js', '.jsx', '.json', '.html', '.css', '.md', '.mjs', '.ts', '.tsv', '.webmanifest'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'android', 'ios'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walk(p, out)
    } else out.push(p)
  }
  return out
}

let touched = 0
let replaced = 0

function rebrandText(file) {
  if (/\.test\.(js|jsx)$/.test(file)) return
  let src
  try { src = fs.readFileSync(file, 'utf8') } catch { return }
  let out = src
  for (const [re, to] of RULES) out = out.replace(re, to)
  if (out !== src) {
    fs.writeFileSync(file, out)
    touched++
    replaced += (src.match(/openGym|OpenGym|opengym|OPEN_GYM|open-gym/g) || []).length
  }
}

const files = [
  ...walk(path.join(APP, 'src')),
  ...walk(path.join(APP, 'public')),
  path.join(APP, 'index.html'),
  path.join(APP, 'vite.config.js'),
  path.join(APP, 'capacitor.config.json'),
  path.join(APP, 'package.json'),
]
for (const f of files) if (TEXT_EXT.has(path.extname(f).toLowerCase())) rebrandText(f)

// Manifest is rewritten rather than patched: the old one carries the upstream theme colour.
const manifest = {
  name: BRAND,
  short_name: BRAND,
  description: '实时肌肉建模 · AI 训练计划 · 训练记录',
  lang: 'zh-CN',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#080B14',
  theme_color: '#080B14',
  categories: ['health', 'fitness', 'sports'],
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
fs.writeFileSync(path.join(APP, 'public', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')

// ---- assets ----
const ICON_SRC = path.join(ROOT, 'design', 'icons')
const copy = (from, to) => fs.copyFileSync(path.join(ICON_SRC, from), path.join(APP, 'public', to))
copy('icon-192.png', 'icon-192.png')
copy('icon-512.png', 'icon-512.png')
copy('icon-180.png', 'icon-180.png')
copy('apple-touch-icon.png', 'apple-touch-icon.png')
copy('favicon.ico', 'favicon.ico')

// The in-app icon picker lists these; one artwork for every slot keeps it working.
const APP_ICON_DIR = path.join(APP, 'public', 'app-icons')
if (fs.existsSync(APP_ICON_DIR)) {
  for (const name of fs.readdirSync(APP_ICON_DIR)) {
    if (name.endsWith('.png') || name.endsWith('.webp')) {
      fs.copyFileSync(path.join(ICON_SRC, 'icon-256.png'), path.join(APP_ICON_DIR, name))
    }
  }
}

console.log(`rebrand: ${touched} files rewritten, ${replaced} brand strings replaced`)
