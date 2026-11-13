// 媒体覆盖率审计：数据集里的每个动作 × 正/背面，检查动图与静帧是否真在包里。
//
// 用法：node scripts/audit-media.mjs [--dir public] [--ext .webp]
// 退出码：0 = 全部齐全；1 = 有缺失（明细打到 stdout）。
//
// 为什么需要它：文件名不是直接用 ex.gif，而是 drawing(ex, figure) 优先——正/背面各有一套
// 片子（mv / fv）。任何一处命名规则和实际入库文件对不上，卡片上就是一个空块，而 App 里
// 只表现为"有些动作没有预览"，很容易被当成加载慢。

import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const argOf = (name, dflt) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const mediaDir = path.join(root, argOf('--dir', 'public'), 'exercise-media')
const ext = argOf('--ext', '.webp')

const src = fs.readFileSync(path.join(root, 'src/lib/exercises-data.js'), 'utf8')
// 别用正则贪婪匹配整个 JSON：文件里 EXDB 之后还有别的导出，`([\s\S]*)` 会一路吃到文件末尾。
// 直接按 "JSON.parse('" 和随后的 "')" 夹出那段字面量。
const OPEN = "JSON.parse('"
const start = src.indexOf(OPEN)
const end = start < 0 ? -1 : src.indexOf("')\n", start)
if (start < 0 || end < 0) throw new Error('EXDB 没找到，exercises-data.js 的格式变了')
// 字面量里的 `\'` 还原成 `'` 之后就是合法 JSON
const db = JSON.parse(src.slice(start + OPEN.length, end).replace(/\\'/g, "'"))

const clipDir = path.join(mediaDir, 'clip')
const stillDir = path.join(mediaDir, 'still')
const has = (dir, f) => fs.existsSync(path.join(dir, f))

// 与 src/lib/exercises.js 的 drawing()/clipFile() 保持一致
const drawing = (ex, figure) => (figure === 'female' ? ex.fv : ex.mv) || null
const clipName = (ex, figure) => {
  const d = drawing(ex, figure)
  const base = d ? d + '.mp4' : ex.gif
  return base.endsWith('.mp4') ? base.slice(0, -4) + ext : base
}
const stillName = (ex, figure) => {
  const d = drawing(ex, figure)
  return d ? d + '.webp' : ex.img
}

const rows = []
for (const ex of db) {
  for (const figure of ['male', 'female']) {
    // 只有一套片子时不重复统计（figure 不影响结果）
    if (figure === 'female' && !ex.fv) continue
    rows.push({
      id: ex.id,
      name: ex.n,
      figure,
      clip: clipName(ex, figure),
      still: stillName(ex, figure),
      hasClip: has(clipDir, clipName(ex, figure)),
      hasStill: has(stillDir, stillName(ex, figure)),
    })
  }
}

const missClip = rows.filter(r => !r.hasClip)
const missStill = rows.filter(r => !r.hasStill)
const bad = rows.filter(r => !r.hasClip || !r.hasStill)

console.log(`动作 ${db.length} 个，按正/背面展开 ${rows.length} 条`)
console.log(`  动图缺失 ${missClip.length} 条（${(missClip.length / rows.length * 100).toFixed(1)}%）`)
console.log(`  静帧缺失 ${missStill.length} 条（${(missStill.length / rows.length * 100).toFixed(1)}%）`)
console.log(`  至少缺一个 ${bad.length} 条`)

if (bad.length) {
  console.log('\n前 25 条：')
  for (const r of bad.slice(0, 25)) {
    console.log(`  ${r.id} [${r.figure}] ${r.name}  clip=${r.hasClip ? 'ok' : 'MISSING:' + r.clip}  still=${r.hasStill ? 'ok' : 'MISSING:' + r.still}`)
  }
  // 归类：整个动作都缺 vs 只有某个 figure 缺
  const byId = new Map()
  for (const r of bad) {
    const e = byId.get(r.id) || []
    e.push(r.figure)
    byId.set(r.id, e)
  }
  const femaleOnly = [...byId].filter(([, figs]) => figs.length === 1 && figs[0] === 'female')
  const maleOnly = [...byId].filter(([, figs]) => figs.length === 1 && figs[0] === 'male')
  console.log(`\n归类：`)
  console.log(`  只有女性版缺失（fv 指向的文件不存在）：${femaleOnly.length} 个动作`)
  if (femaleOnly.length) console.log('    ' + femaleOnly.slice(0, 10).map(([id]) => id).join(', '))
  console.log(`  只有男性版缺失（mv 指向的文件不存在）：${maleOnly.length} 个动作`)
  if (maleOnly.length) console.log('    ' + maleOnly.slice(0, 10).map(([id]) => id).join(', '))
  console.log(`  两个版本都缺（本身就没有片子）：${bad.length ? [...byId].filter(([, figs]) => figs.length === 2).length : 0} 个动作`)
  process.exitCode = 1
}
