#!/usr/bin/env node
/**
 * pack-source.mjs — 生成随 App 分发的「完整对应源码」包（GNU AGPL v3 §1 / §6）
 *
 *   npm run pack:source        （等价于 node scripts/pack-source.mjs）
 *
 * 产物：app/frontend/public/source/yuan-Gym-source.zip
 * vite build 会把 public/ 原样拷进 dist，再由 syncpub.mjs 打进 APK；设置页
 * 「关于与更新 → 开源与法律 → 源代码」通过 src/lib/legal.js 的 SOURCE_BUNDLE
 * 指向它。拿到 APK 的人离线即可取得源码，不需要 GitHub / 任何账号。
 *
 * ── 为什么是白名单，而不是整目录打包 ──────────────────────────────────
 * 这个工作目录不是干净的 git 检出：app/frontend/ 约 9.8 GB，其中
 *   - android/app/src/main/assets/public/ ≈ 691 MB 是 syncpub 拷进去的 dist，
 *     内含约 634 MB 第三方动作媒体（Gym visual，NOTICE.md 禁止第三方再分发）；
 *   - dist* / db* / _* 调试副本、截图、*.log、.src.zip (222 MB)、APK 若干。
 * 所以只收：源码、构建/安装脚本、依赖锁、配置模板、自有静态资产与法律文本。
 * 并在写盘前对「最终收集到的文件列表」再扫一遍，命中凭据或二进制媒体就中止，
 * 绝不产出夹带私钥的半成品（fail-closed）。
 *
 * 排除清单与理由见 public/SOURCE-README.md 第四节；两处必须保持一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, unzipSync } from 'fflate'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.resolve(HERE, '..')          // app/frontend
const ROOT = path.resolve(FRONTEND, '../..')       // 仓库根（yuan-Gym/）
const OUT_DIR = path.join(FRONTEND, 'public', 'source')
const OUT_FILE = path.join(OUT_DIR, 'yuan-Gym-source.zip')
const PREFIX = 'yuan-Gym'                          // zip 内顶层目录
const LEVEL = 6

// ── 目录规则 ───────────────────────────────────────────────────────────────
// 全局按目录名排除：依赖、缓存、构建产物、调试副本、媒体二进制目录。
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.gradle', '.kotlin', '.wrangler', '.idea', '.vscode',
  '.cache', 'coverage', 'build', 'Pods', 'DerivedData', 'keystore',
  'clip', 'still', 'exercise-media',
  'dist', 'dist-broken', 'dist-check', 'dist-old147', 'dist-qr',
  'dist_old', 'dist_prev', 'distbuild', '_dist_prev',
  'db3d', 'db4', 'db5', 'db6', 'dbcheck',
  '.check', '.shot', '.shots', '_shots', '.seam-check', '.media-pack',
  'releases', 'yuan-gym',
  'capacitor-cordova-android-plugins', 'capacitor-cordova-ios-plugins',
])

// 精确相对路径排除（POSIX 风格，相对仓库根）。
const SKIP_DIR_PATHS = new Set([
  'design/anatomy-model',                      // 第三方原始素材，非本项目源码
  'catalogue',                                 // 根级目录副本（主要是媒体二进制）；正式数据在 app/catalogue/
  'app/frontend/public/source',                // 本脚本输出目录，避免自包含
  'app/frontend/models-src',                   // 两份 ~10 MB 原始建模 HTML（用户提供的源素材），非本项目源码，不进源码包
  'app/frontend/android/app/src/main/assets',  // 691 MB 的构建产物 dist（含 634 MB 第三方媒体）
  'app/frontend/ios/App/App/public',           // 同上，iOS 侧
  'server/data',                               // 运行时用户数据
  'app/catalogue/media/clip', 'app/catalogue/media/still',
])

// 各层目录白名单：只有这些目录会被递归，其余一律跳过。
const ROOT_DIRS = new Set(['app', 'server', 'worker', 'scripts', 'tools', '.github', '.gitlab'])
const APP_DIRS = new Set([
  'api', 'assets', 'catalogue', 'cloudflare', 'contrib', 'docs', 'fastlane',
  'frontend', 'helm', 'kubernetes', 'mcp', 'scripts', 'watch-zepp', 'web',
  'website', '.github', '.gitlab',
])
const FE_DIRS = new Set(['src', 'public', 'scripts', 'android', 'ios', 'resources', 'garmin'])

// app/frontend/ 根目录文件：只收构建入口与依赖锁，其余 *_*.log / _*.txt /
// 截图 / UI dump / 一次性探针脚本全部排除。
const FE_FILES = new Set([
  'package.json', 'package-lock.json', 'vite.config.js', 'index.html',
  'capacitor.config.json', 'syncpub.mjs', 'merge-dist.mjs',
  'build-1410.sh', 'build-148.sh', 'build-148-retry.sh', 'build-149.sh',
])

// 根目录里不属于源码的内部调研 / 商业评估文档（含内部判断，不随包分发）。
const ROOT_DENY_FILES = new Set([
  'MEDIA-REPLACEMENT-调研.md', 'SELL-OR-CLAIM-评估.md',
])

// ── 文件规则 ───────────────────────────────────────────────────────────────
// 真实凭据 / 私钥 / 本机路径：精确排除，并在自检里再兜一次。
const DENY_FILE_PATHS = new Set([
  'worker/.secrets.env', 'worker/.cf-token',
  'server/config.json',                                  // adminToken / glmApiKey / SMTP 密码
  'app/frontend/android/keystore.properties',           // 签名明文口令
  'app/frontend/android/local.properties',              // 本机 SDK 绝对路径
])

// 允许的文本/源码扩展名（白名单之外的二进制一律不收）。
const KEEP_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.json5', '.jsonld',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.md', '.mdx', '.txt',
  '.yml', '.yaml', '.xml', '.sql', '.gradle', '.properties', '.pro',
  '.sh', '.bash', '.bat', '.cmd', '.ps1', '.py', '.toml', '.svg', '.lock',
  '.cfg', '.conf', '.ini', '.rb', '.java', '.kt', '.kts', '.swift',
  '.m', '.mm', '.h', '.hpp', '.c', '.cpp', '.plist', '.entitlements',
  '.pbxproj', '.xcconfig', '.storyboard', '.xib', '.podspec', '.jungle',
  '.webmanifest', '.tf', '.hcl', '.proto', '.graphql', '.gql', '.vue', '.svelte',
])

// 无扩展名但必须保留的文件（LICENSE / gradlew / Dockerfile …）。
const KEEP_BASENAME = new Set([
  'LICENSE', 'NOTICE', 'README', 'CHANGELOG', 'COPYING', 'AUTHORS', 'CONTRIBUTORS',
  'Dockerfile', 'Makefile', 'gradlew', 'Gemfile', 'Podfile', 'Procfile', 'Rakefile',
])

// 允许的隐藏配置文件（以 . 开头）。其余隐藏文件默认排除，
// 例如 .dev.log / .tunnel.log / .cf-login.log / .src.zip 一律不进包。
const HIDDEN_OK = new Set([
  '.env.example', '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig',
  '.gitlab-ci.yml', '.prettierrc', '.eslintrc', '.eslintrc.json', '.babelrc',
  '.nvmrc', '.ruby-version', '.watchmanconfig',
])

const posix = p => p.split(path.sep).join('/')

function skipDir(childRel, name) {
  if (SKIP_DIR_PATHS.has(childRel) || SKIP_DIR_NAMES.has(name)) return true
  if (childRel.indexOf('/') === -1) return !ROOT_DIRS.has(name)
  if (/^app\/[^/]+$/.test(childRel)) return !APP_DIRS.has(name)
  if (/^app\/frontend\/[^/]+$/.test(childRel)) return !FE_DIRS.has(name)
  return false
}

function skipFile(rel, name) {
  if (DENY_FILE_PATHS.has(rel)) return true
  const parent = rel.slice(0, rel.lastIndexOf('/'))
  if (parent === 'app/frontend' && !FE_FILES.has(name)) return true
  if (parent === '' && ROOT_DENY_FILES.has(name)) return true
  // public/ 是自有的静态源：图标、3D 模型(.bin/.json)、sw.js、法律文本全收。
  // 输出目录 public/source/ 已由 SKIP_DIR_PATHS 排除，不会自包含。
  if (rel.startsWith('app/frontend/public/')) return false
  if (name.startsWith('_')) return true                       // 一次性调试脚本/输出
  if (name.startsWith('.')) return !HIDDEN_OK.has(name)
  if (/\.log$/i.test(name)) return true
  const ext = path.extname(name).toLowerCase()
  return !(KEEP_EXT.has(ext) || KEEP_BASENAME.has(name))
}

// ── 遍历 ───────────────────────────────────────────────────────────────────
const files = []
let skippedDirs = 0
let skippedFiles = 0

function walk(rel) {
  const abs = rel ? path.join(ROOT, rel) : ROOT
  const entries = fs.readdirSync(abs, { withFileTypes: true })
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) {
      if (skipDir(childRel, e.name)) { skippedDirs++; continue }
      walk(childRel)
    } else if (e.isFile()) {
      if (skipFile(childRel, e.name)) { skippedFiles++; continue }
      files.push(childRel)
    }
  }
}
walk('')

// ── fail-closed 自检：写盘前再扫一次最终清单 ───────────────────────────────
const FORBIDDEN = [
  { re: /\.secrets\.env$/, why: 'Cloudflare 密钥' },
  { re: /\.cf-token$/, why: 'Cloudflare API token' },
  { re: /keystore\.properties$/, why: '签名明文口令' },
  { re: /local\.properties$/, why: '本机 SDK 绝对路径' },
  { re: /\.(jks|keystore|p12|pfx|pem|p8|key|mobileprovision)$/i, why: '私钥 / 签名证书' },
  { re: /(^|\/)server\/config\.json$/, why: '服务端凭据' },
  { re: /(^|\/)server\/data\//, why: '运行时用户数据' },
  { re: /(^|\/)exercise-media\//, why: '第三方动作媒体' },
  { re: /(^|\/)(clip|still)\//, why: '第三方动作媒体目录' },
  { re: /\.(apk|aab|ipa|zip|log)$/i, why: '构建产物 / 日志' },
  // public/ 是自有的静态源（图标、3D 模型 .bin/.json、favicon）；这些扩展名
  // 只允许出现在那里。出现在其他路径 = 夹带了媒体或截图，一律拒绝。
  { re: /\.(webp|mp4|webm|png|jpe?g|gif|ico|bin|glb|gltf)$/i,
    why: '二进制媒体 / 图片 / 模型（仅允许 app/frontend/public/）', publicOk: true },
]
for (const rel of files) {
  const inPublic = rel.startsWith('app/frontend/public/')
  for (const { re, why, publicOk } of FORBIDDEN) {
    if (publicOk && inPublic) continue
    if (re.test(rel)) {
      throw new Error(`[pack-source] 拒绝打包：${rel}（${why}）。未写出任何文件。`)
    }
  }
}

// 关键文件必须存在，否则说明白名单写错了或工作区布局变了。
const REQUIRED = [
  'LICENSE', 'NOTICE.md', 'DIFF-vs-openGym.md',
  'app/frontend/package.json', 'app/frontend/package-lock.json',
  'app/frontend/vite.config.js', 'app/frontend/src/lib/legal.js',
  'app/frontend/src/views/Settings.jsx', 'app/frontend/scripts/pack-source.mjs',
  'app/frontend/android/app/src/main/AndroidManifest.xml',
  'app/catalogue/exercises/0001.json', 'app/catalogue/media/NOTICE.md',
]
const missing = REQUIRED.filter(r => !files.includes(r))
if (missing.length) throw new Error(`[pack-source] 缺少关键源码：\n  ${missing.join('\n  ')}`)

// ── 组装 zip ───────────────────────────────────────────────────────────────
const u8 = p => new Uint8Array(fs.readFileSync(p))
const entries = Object.create(null)
let raw = 0
for (const rel of files) {
  const data = u8(path.join(ROOT, rel))
  entries[`${PREFIX}/${rel}`] = data
  raw += data.length
}

// §5(a) 修改声明与源码说明也放一份到 zip 根目录，解压即可看到。
// （App 内的原件在 app/frontend/public/，两处内容相同。）
for (const name of ['MODIFICATIONS.txt', 'SOURCE-README.md']) {
  const src = path.join(FRONTEND, 'public', name)
  if (fs.existsSync(src)) {
    const data = u8(src)
    entries[`${PREFIX}/${name}`] = data
    raw += data.length
  } else {
    console.warn(`[pack-source] 警告：缺少 public/${name}，zip 根目录将不含该文件`)
  }
}

const zipped = zipSync(entries, { level: LEVEL })

// 回读校验：证明产物是能被标准 unzip 解开的合法 zip，且条目无丢失。
const back = unzipSync(zipped)
const nEntries = Object.keys(entries).length
if (Object.keys(back).length !== nEntries) {
  throw new Error('[pack-source] zip 回读条目数不一致，放弃写出')
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT_FILE, zipped)

const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB'
console.log(`[pack-source] 仓库根 : ${ROOT}`)
console.log(`[pack-source] 收集   : ${files.length} 个文件，原始 ${mb(raw)}；跳过 ${skippedDirs} 个目录 / ${skippedFiles} 个文件`)
console.log(`[pack-source] zip    : ${nEntries} 个条目，${mb(zipped.length)}（level ${LEVEL}，压缩率 ${(100 - zipped.length / raw * 100).toFixed(1)}%）`)
console.log(`[pack-source] 回读   : 通过（${Object.keys(back).length} 个条目）`)
console.log(`[pack-source] 已写出 : ${OUT_FILE}`)
