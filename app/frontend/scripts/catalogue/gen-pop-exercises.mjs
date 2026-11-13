// 生成 src/lib/known-exercises.js：常见动作加权覆盖表。
// 依据：健身圈最常做的动作（复合/基础动作 + 高频辅助动作）上浮到同肌肉命中档前列。
// 做法：扫描 CATALOGUE 英文动作名，按策展关键词分三档；仅把命中且 boost>0 的写入。
// popBoost 取值刻意很小（0.12 / 0.08 / 0.04），远小于肌肉命中权重（0~1），
// 只在同一肌肉命中档内做微小重排，绝不盖过真正的肌肉匹配。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FE = path.resolve(HERE, '../..')
const dataPath = path.join(FE, 'src/lib/exercises-data.js')

// 动态读取 EXDB（该文件是 ESM export const EXDB=JSON.parse('...')）
const mod = await import('file://' + dataPath)
const EXDB = mod.EXDB

// 档位：关键词（小写名包含即命中）→ boost
const TIERS = [
  { boost: 0.12, keys: [
    'squat', 'bench press', 'deadlift', 'overhead press', 'shoulder press',
    'military press', 'pull-up', 'pullup', 'chin-up', 'chinup',
    'barbell row', 'bent-over row', 'dumbbell row', 'push-up', 'pushup', 'dip',
  ]},
  { boost: 0.08, keys: [
    'lunge', 'leg press', 'hip thrust', 'glute bridge', 'calf raise',
    'bicep curl', 'hammer curl', 'curl', 'tricep', 'triceps', 'lateral raise',
    'chest fly', 'pec fly', 'fly', 'shrug', 'crunch', 'sit-up', 'situp',
    'plank', 'lat pulldown', 'pulldown', 'face pull', 'romanian deadlift',
    'good morning', 'leg curl', 'leg extension',
  ]},
  { boost: 0.04, keys: [
    'russian twist', 'leg raise', 'reverse fly', 'cable crossover', 'pushdown',
    'kickback', 'hip abduction', 'hip adduction', "farmer", 'arnold press',
    'pec deck', 'cable fly', 'incline press', 'decline press',
  ]},
]
function boostFor(name) {
  const n = (name || '').toLowerCase()
  for (let i = 0; i < TIERS.length; i++) {
    if (TIERS[i].keys.some(k => n.includes(k))) return TIERS[i].boost
  }
  return 0
}

const POP = {}
let counts = { 0.12: 0, 0.08: 0, 0.04: 0 }
for (const e of EXDB) {
  const b = boostFor(e.n)
  if (b > 0) { POP[e.id] = b; counts[b]++ }
}
console.log('matched exercises:', Object.keys(POP).length, counts)

// 抽样打印几条例证，确认没误伤
const ex = id => EXDB.find(x => x.id === id)
for (const id of ['0001', '5965', '4209', '5915']) {
  console.log(`  ${id} "${ex(id)?.n}" -> ${POP[id] ?? 0}`)
}
// 确认 squat 系命中
const squatHits = EXDB.filter(e => boostFor(e.n) >= 0.12).slice(0, 8).map(e => e.n)
console.log('tier0 samples:', squatHits)

const out = `// 自动生成（scripts/catalogue/gen-pop-exercises.mjs）—— 常见动作加权覆盖表。
// 让「健身圈最常做的动作」在同肌肉命中档内上浮到前列：复合/基础动作为 0.12，
// 高频辅助 0.08，其它常见 0.04。popBoost 取值远小于肌肉命中权重（0~1），
// 只做档内微小重排，绝不盖过真正的肌肉匹配。修改请改生成脚本后重跑。
export const POP_EXERCISE = ${JSON.stringify(POP, null, 0)}
export function popBoost(e) {
  return POP_EXERCISE[e?.id] || 0
}
`
const outPath = path.join(FE, 'src/lib/known-exercises.js')
fs.writeFileSync(outPath, out)
console.log('wrote', outPath, (fs.statSync(outPath).size / 1024).toFixed(1), 'KB')
