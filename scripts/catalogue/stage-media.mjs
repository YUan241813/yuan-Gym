// 把动作媒体从 catalogue/media 搬进构建产物（dist/exercise-media/{clip,still}）。
//
// 用法：node scripts/catalogue/stage-media.mjs [dist 目录] [--webp-dir <动画 webp 库>]
//
// 为什么需要这个脚本：package.json 的 build:mobile 一直指向它，但文件本身不存在，
// 于是「媒体怎么进包的」全靠手工拷贝，结果就是漏——上一版只进去了 728 张静帧，
// 而 catalogue/media/still 里有 3370 张。静帧是动画的兜底，也是列表卡片的缩略图，
// 缺了就是一个个空白块，看起来像"加载不出来"。
//
// 两类来源：
//   still/  catalogue/media/still/*.webp   直接复制（3370 张）
//   clip/   catalogue/media/clip/*.mp4     已经是 MP4，需要转成动画 WebP 才能用（见下）
//
// 动画 WebP 不在这个脚本里现转（2068 个片段要几分钟），而是从一份预先转好的库复制：
//   D:/Self-developedSoftware/tools/media/anim-webp-v2（用 tools/media/anim-smooth.py 生成）
// 没有这份库时，脚本会提示命令并退出 1，而不是悄悄少拷一批文件。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')

const args = process.argv.slice(2)
const webpArg = args.indexOf('--webp-dir')
const WEBP_DIR = path.resolve(webpArg >= 0 ? args[webpArg + 1] : 'D:/Self-developedSoftware/tools/media/anim-webp-v2')
const distArg = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--webp-dir')
const DIST = path.resolve(repo, 'app/frontend', distArg || 'dist')

const SRC = {
  still: path.join(repo, 'catalogue/media/still'),
  clip: path.join(repo, 'catalogue/media/clip'),
}
const DST = {
  still: path.join(DIST, 'exercise-media/still'),
  clip: path.join(DIST, 'exercise-media/clip'),
}

function copyDir(from, to, accept) {
  fs.mkdirSync(to, { recursive: true })
  let n = 0
  let bytes = 0
  for (const name of fs.readdirSync(from)) {
    if (!accept(name)) continue
    const a = path.join(from, name)
    const b = path.join(to, name)
    const st = fs.statSync(a)
    // 同大小同时间的就跳过：重复构建时省掉几百 MB 的拷贝
    if (fs.existsSync(b)) {
      const cur = fs.statSync(b)
      if (cur.size === st.size && Math.abs(cur.mtimeMs - st.mtimeMs) < 1000) continue
    }
    fs.copyFileSync(a, b)
    n++
    bytes += st.size
  }
  return { n, bytes }
}

if (!fs.existsSync(SRC.still)) {
  console.error(`源目录不存在：${SRC.still}`)
  process.exit(1)
}

const OPTS = new Set(args.filter(a => a.startsWith('--')))
const ALIASES_ONLY = OPTS.has('--aliases-only')

console.log(`产物目录：${DIST}${ALIASES_ONLY ? '（只补别名，不重新复制）' : ''}`)

if (!ALIASES_ONLY) {
  const still = copyDir(SRC.still, DST.still, f => f.toLowerCase().endsWith('.webp'))
  console.log(`静帧：复制 ${still.n} 个（${(still.bytes / 1048576).toFixed(1)} MB），目录现在 ${fs.readdirSync(DST.still).length} 个`)

  const haveStillSrc = fs.readdirSync(SRC.still).filter(f => f.toLowerCase().endsWith('.webp')).length
  console.log(`源静帧 ${haveStillSrc} 张；无动画的动作靠这些静帧兜底`)
}

if (!fs.existsSync(WEBP_DIR)) {
  console.error(
    `\n没有动画 WebP 库：${WEBP_DIR}\n` +
    `先跑：\n` +
    `  python D:/Self-developedSoftware/tools/media/anim-smooth.py \\\n` +
    `    --in catalogue/media/clip --out ${WEBP_DIR} --blend 2 --size 180 --jobs 10\n`
  )
  process.exit(1)
}

if (!ALIASES_ONLY) {
  const clip = copyDir(WEBP_DIR, DST.clip, f => f.toLowerCase().endsWith('.webp'))
  console.log(`动画：复制 ${clip.n} 个（${(clip.bytes / 1048576).toFixed(1)} MB）`)
}
// 一部分动作有两个画法编号（正/背面，或同一个动作的另一个视角）：EXALIAS 里
// {"1185":"5265"} 就是这种配对。原素材只给其中一个编号录了片子/画了图，于是切换体型时
// 会有一面变成空白。这里给配对的编号补上同一个文件的副本——放的是同一个动作的另一张画，
// 不是拿别的动作来凑数。补不了的（两边原素材都没有）保持缺失，交给 UI 的占位块。
function fillPairs(outDir, pairs, label) {
  let filled = 0
  for (const [a, b] of pairs) {
    const pa = path.join(outDir, String(a) + '.webp')
    const pb = path.join(outDir, String(b) + '.webp')
    if (!fs.existsSync(pa) && fs.existsSync(pb)) { fs.copyFileSync(pb, pa); filled++ }
    else if (!fs.existsSync(pb) && fs.existsSync(pa)) { fs.copyFileSync(pa, pb); filled++ }
  }
  console.log(`${label}：按别名配对补齐 ${filled} 个文件，目录现在 ${fs.readdirSync(outDir).length} 个`)
  return filled
}

function aliasPairs() {
  const data = fs.readFileSync(path.join(repo, 'app/frontend/src/lib/exercises-data.js'), 'utf8')
  const pick = name => {
    const open = `export const ${name}=JSON.parse('`
    const i = data.indexOf(open)
    const j = i < 0 ? -1 : data.indexOf("')\n", i)
    return i < 0 || j < 0 ? null : JSON.parse(data.slice(i + open.length, j).replace(/\\'/g, "'"))
  }
  const alias = pick('EXALIAS') || {}
  const db = pick('EXDB') || []
  const pairs = Object.entries(alias).map(([a, b]) => [String(a), String(b)])
  for (const ex of db) {
    const main = String(ex.img || '').replace(/\.webp$/, '')
    if (!main) continue
    if (ex.fv) pairs.push([String(ex.fv), main])
    if (ex.mv) pairs.push([String(ex.mv), main])
  }
  return pairs
}

const pairs = aliasPairs()
fillPairs(DST.clip, pairs, '动画')
fillPairs(DST.still, pairs, '静帧')

// 静帧有、动画没有的动作，是数据集本身的空档（原素材就没给这些动作录动画）。
// 报出来是为了让「有些动作没有预览」这件事有据可查，而不是被当成加载 bug。
console.log('\n下一步：node scripts/audit-media-coverage.mjs --dir dist   # 看覆盖率与缺口')
