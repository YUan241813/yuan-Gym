// yuan-Gym — plan engine.
//
// Turns a body profile plus a goal into a concrete week: which split, which exercises, how
// many sets, how heavy, how long to rest. It runs entirely offline, which makes it both the
// fallback when the AI coach is unavailable and the skeleton the AI is asked to refine —
// so the AI can never invent an exercise that is not in the catalogue.
//
// Programming model: a split chosen from days-per-week, exercises scored per muscle from
// the coaching layer (lib/exercise-guide.js), volume set per muscle per week, then a
// four-week block with a deload. Long horizons (quarter / year) are blocks stacked.

import { CATALOGUE } from './exercises.js'
import { guideFor, muscleKeyOf } from './exercise-guide.js'
import { MUSCLES, musclesOf } from './muscles.js'

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const GOALS = {
  hypertrophy: {
    label: '增肌',
    sets: [3, 4], reps: [8, 12], rest: 90, weeklySets: [10, 20],
    note: '每组最后 2 次吃力但仍能保持动作（RIR 1–2）。',
  },
  strength: {
    label: '力量',
    sets: [4, 5], reps: [3, 5], rest: 180, weeklySets: [8, 15],
    note: '主项用 RPE 7–8，留 2 次余力；技术优先于重量。',
  },
  fatloss: {
    label: '减脂',
    sets: [3, 4], reps: [12, 15], rest: 45, weeklySets: [12, 22],
    note: '组间休息短，动作之间可做超级组；配合每周 3 次有氧。',
  },
  general: {
    label: '综合体能',
    sets: [3, 3], reps: [8, 12], rest: 75, weeklySets: [8, 16],
    note: '动作质量优先，重量以能稳定完成每组为准。',
  },
  posture: {
    label: '改善体态',
    sets: [3, 4], reps: [12, 15], rest: 60, weeklySets: [10, 18],
    note: '加强背部与臀部，拉伸胸与髋屈肌；重量中等、控制慢。',
  },
}

const EQUIP_SETS = {
  full: null,          // anything
  home: ['body weight', 'dumbbell', 'band', 'kettlebell', 'stability ball', 'pullup bar'],
  bodyweight: ['body weight'],
}

const DAY_SPLITS = {
  2: [
    { name: '全身 A', groups: ['quadriceps', 'chest', 'upper-back', 'deltoids', 'abs'] },
    { name: '全身 B', groups: ['hamstring', 'upper-back', 'chest', 'gluteal', 'obliques'] },
  ],
  3: [
    { name: '推（胸肩三头）', groups: ['chest', 'deltoids', 'triceps', 'serratus'] },
    { name: '拉（背二头）', groups: ['upper-back', 'trapezius', 'biceps', 'forearm'] },
    { name: '腿与核心', groups: ['quadriceps', 'hamstring', 'gluteal', 'calves', 'abs'] },
  ],
  4: [
    { name: '上肢 A（推为主）', groups: ['chest', 'deltoids', 'triceps', 'upper-back'] },
    { name: '下肢 A（股四头主导）', groups: ['quadriceps', 'gluteal', 'calves', 'abs'] },
    { name: '上肢 B（拉为主）', groups: ['upper-back', 'biceps', 'trapezius', 'deltoids'] },
    { name: '下肢 B（后链主导）', groups: ['hamstring', 'gluteal', 'adductors', 'obliques'] },
  ],
  5: [
    { name: '胸与三头', groups: ['chest', 'triceps', 'serratus'] },
    { name: '背与二头', groups: ['upper-back', 'biceps', 'trapezius'] },
    { name: '腿（股四头主导）', groups: ['quadriceps', 'calves', 'abs'] },
    { name: '肩与手臂', groups: ['deltoids', 'biceps', 'triceps', 'forearm'] },
    { name: '腿与核心（后链）', groups: ['hamstring', 'gluteal', 'lower-back', 'obliques'] },
  ],
  6: [
    { name: '推 A', groups: ['chest', 'deltoids', 'triceps'] },
    { name: '拉 A', groups: ['upper-back', 'biceps', 'trapezius'] },
    { name: '腿 A', groups: ['quadriceps', 'calves', 'abs'] },
    { name: '推 B', groups: ['deltoids', 'chest', 'triceps'] },
    { name: '拉 B', groups: ['upper-back', 'forearm', 'biceps'] },
    { name: '腿 B', groups: ['hamstring', 'gluteal', 'lower-back'] },
  ],
}

// ---------------------------------------------------------------------------
// Exercise selection
// ---------------------------------------------------------------------------

const norm = s => String(s || '').toLowerCase()
const isCompound = ex => (ex?.sm?.length || 0) >= 2 && /barbell|dumbbell|body weight/.test(norm(ex?.eq))

let INDEX = null
function index() {
  if (INDEX) return INDEX
  INDEX = new Map()
  for (const ex of CATALOGUE) {
    const m = muscleKeyOf(ex)
    if (!m) continue
    if (!INDEX.has(m)) INDEX.set(m, [])
    INDEX.get(m).push(ex)
  }
  return INDEX
}

/**
 * Best exercises for one muscle, filtered by equipment and ranked for programme use.
 * @param {string} muscle slug from MUSCLES
 * @param {{equipment?: string, limit?: number, exclude?: Set<string>, preferCompound?: boolean}} opts
 */
export function candidatesFor(muscle, { equipment = 'full', limit = 12, exclude = new Set(), preferCompound = false } = {}) {
  const allow = EQUIP_SETS[equipment] || EQUIP_SETS.full
  const pool = (index().get(muscle) || []).filter(ex => {
    if (exclude.has(ex.id)) return false
    if (!allow) return true
    return allow.includes(norm(ex.eq))
  })

  const scored = pool.map(ex => {
    const g = guideFor(ex)
    let score = g.rating * 10
    if (isCompound(ex)) score += preferCompound ? 12 : 5
    if (/machine|cable/.test(norm(ex.eq))) score += 2
    // Names with a wall of qualifiers are usually niche variations of a movement
    // already ranked above them.
    score -= Math.min(6, (norm(ex.n).match(/\bwith\b|\band\b/g) || []).length * 2)
    return { ex, score, guide: g }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

/**
 * Best exercises for *several* muscles at once — the anatomy page's multi-select.
 *
 * Ranking is deliberately not "sum of per-muscle rankings", which would flood the list
 * with exercises that are excellent for one chosen part and irrelevant to the rest.
 * It rewards three things, in this order:
 *   1. how much of the chosen set the movement actually loads (coverage),
 *   2. how little it spends on muscles you did not choose (purity — the difference
 *      between a chin-up and a barbell curl when you picked biceps + upper back),
 *   3. the coaching layer's own rating, so a good movement still beats a mediocre one.
 *
 * @param {string[]} muscles slugs from MUSCLES
 * @param {{equipment?: string, limit?: number, exclude?: Set<string>}} opts
 * @returns {{ex: object, score: number, guide: object, coverage: number, purity: number}[]}
 */
export function candidatesForMany(muscles = [], { equipment = 'full', limit = 12, exclude = new Set() } = {}) {
  const want = new Set(muscles.filter(m => MUSCLES.includes(m)))
  if (!want.size) return []
  const allow = EQUIP_SETS[equipment] || EQUIP_SETS.full

  const scored = []
  for (const ex of CATALOGUE) {
    if (exclude.has(ex.id)) continue
    if (allow && !allow.includes(norm(ex.eq))) continue

    const weights = musclesOf(ex)
    let hit = 0
    let miss = 0
    for (const slug in weights) {
      if (want.has(slug)) hit += weights[slug]
      else miss += weights[slug]
    }
    if (hit <= 0) continue

    // Coverage is measured against the chosen parts, not against the exercise: picking
    // three parts and hitting two of them is a good answer, not a two-thirds failure.
    const coverage = Math.min(1, hit / Math.min(want.size, 3))
    const purity = hit / (hit + miss)
    const g = guideFor(ex)
    let score = coverage * 46 + purity * 26 + g.rating * 5
    if (isCompound(ex)) score += 4

    scored.push({ ex, score, guide: g, coverage, purity })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Weight suggestion
// ---------------------------------------------------------------------------

/**
 * A starting load, expressed as a fraction of bodyweight for the movement pattern.
 * Deliberately conservative: the first session is for finding the working weight.
 */
const LOAD_RATIO = [
  [/barbell bench|bench press/, 0.6], [/squat/, 0.7], [/deadlift/, 0.9],
  [/overhead press|shoulder press/, 0.35], [/barbell row/, 0.5],
  [/dumbbell.*press/, 0.22], [/curl/, 0.12], [/raise/, 0.08],
  [/pushdown|extension/, 0.2], [/lunge|split squat/, 0.25], [/hip thrust/, 0.8],
  [/calf raise/, 0.6], [/lat pulldown/, 0.5], [/pull-up/, 0],
]

export function suggestLoad(ex, profile = {}) {
  const bw = Number(profile.weight) || 70
  const name = norm(ex?.n)
  const ratio = (LOAD_RATIO.find(([re]) => re.test(name)) || [null, 0])[1]
  if (!ratio) return null
  const kg = Math.round(bw * ratio * 0.9 / 2.5) * 2.5
  return kg > 0 ? kg : null
}

// ---------------------------------------------------------------------------
// Week builder
// ---------------------------------------------------------------------------

function sessionFor(day, { goal, equipment, minutes, used }) {
  const cfg = GOALS[goal] || GOALS.hypertrophy
  const perSession = minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 6 : 7
  const picked = []

  for (const muscle of day.groups) {
    if (picked.length >= perSession) break
    const preferCompound = picked.length < Math.ceil(perSession / 2)
    const [best] = candidatesFor(muscle, { equipment, limit: 4, exclude: used, preferCompound })
    if (best) {
      used.add(best.ex.id)
      picked.push({ ...best, muscle })
    }
  }

  // Fill any remaining slots with the biggest remaining muscles of the day.
  let guard = 0
  while (picked.length < perSession && guard++ < 12) {
    const muscle = day.groups[picked.length % day.groups.length]
    const [next] = candidatesFor(muscle, { equipment, limit: 6, exclude: used })
    if (!next) break
    used.add(next.ex.id)
    picked.push({ ...next, muscle })
  }

  return {
    name: day.name,
    groups: day.groups,
    exercises: picked.map((p, i) => {
      const compound = isCompound(p.ex)
      const sets = compound ? cfg.sets[1] : cfg.sets[0]
      const [rLo, rHi] = cfg.reps
      const reps = compound ? `${rLo}–${rHi - 2 > rLo ? rHi - 2 : rHi}` : `${rLo + 2}–${rHi}`
      return {
        exId: p.ex.id,
        name: p.ex.n,
        muscle: p.muscle,
        sets,
        reps,
        rest: compound ? cfg.rest : Math.max(45, cfg.rest - 30),
        load: suggestLoad(p.ex, {}),
        note: i === 0 ? '首个动作，充分热身 2 组后开始正式组' : '',
      }
    }),
  }
}

/**
 * Build a week.
 * @param {{goal: string, days: number, minutes?: number, equipment?: 'full'|'home'|'bodyweight',
 *          profile?: object, weak?: string[]}} options
 */
export function buildWeek({ goal = 'hypertrophy', days = 3, minutes = 60, equipment = 'full', profile = {}, weak = [] } = {}) {
  const n = Math.min(6, Math.max(2, days))
  const base = DAY_SPLITS[n]
  const used = new Set()

  // Weak points get their own slot at the front of the day that already trains them.
  const daysOut = base.map(day => {
    const groups = [...day.groups]
    for (const w of weak) if (!groups.includes(w)) groups.unshift(w)
    return { ...day, groups }
  })

  const week = daysOut.map(day => sessionFor(day, { goal, equipment, minutes, used }))
  const weeklySets = {}

  for (const s of week) {
    for (const e of s.exercises) {
      weeklySets[e.muscle] = (weeklySets[e.muscle] || 0) + e.sets
    }
  }

  const coverage = MUSCLES.map(m => ({ muscle: m, sets: weeklySets[m] || 0 }))
  const neglected = coverage.filter(c => c.sets === 0).map(c => c.muscle)

  return {
    goal, days: n, minutes, equipment,
    sessions: week,
    coverage, neglected,
    volume: Object.values(weeklySets).reduce((a, b) => a + b, 0),
  }
}

// ---------------------------------------------------------------------------
// Long horizons
// ---------------------------------------------------------------------------

const BLOCK_FOCUS = [
  { name: '基础适应', detail: '动作模式与技术，容量中等，RIR 2–3', volume: 0.85 },
  { name: '容量积累', detail: '容量逐周提升，RIR 1–2', volume: 1.0 },
  { name: '强度提升', detail: '重量上调，次数下降，RIR 0–1', volume: 0.95 },
  { name: '减载恢复', detail: '容量降到 60%，让身体吸收前 3 周', volume: 0.6 },
]

/** A 12-week mesocycle: three loading blocks and a deload. */
export function buildMesocycle(weeks = 12) {
  const out = []
  for (let w = 1; w <= weeks; w++) {
    const block = BLOCK_FOCUS[(w - 1) % 4]
    out.push({
      week: w,
      block: block.name,
      detail: block.detail,
      volumeFactor: block.volume,
      deload: block.name === '减载恢复',
    })
  }
  return out
}

/**
 * A year, as three mesocycles with a different emphasis each: build, intensify, then
 * a maintenance phase that is easier to keep through holidays and busy weeks.
 */
export function buildMacro() {
  const phases = [
    { months: '第 1–4 月', name: '打基础', goal: 'hypertrophy', detail: '全身动作模式 + 肌肉量，容量从 0.85 爬到 1.0', weeks: 16 },
    { months: '第 5–8 月', name: '上强度', goal: 'strength', detail: '主项力量优先，次数降到 3–6，重量逐周上调', weeks: 16 },
    { months: '第 9–12 月', name: '精修与保持', goal: 'hypertrophy', detail: '补弱项、控体脂，容量维持，每 4 周减载一次', weeks: 16 },
  ]
  return phases.map(p => ({ ...p, meso: buildMesocycle(4) }))
}

/** Everything the UI and the AI prompt need to describe a body without guessing. */
export function bodySummary(profile = {}) {
  const bits = []
  if (profile.height) bits.push(`身高 ${profile.height} cm`)
  if (profile.weight) bits.push(`体重 ${profile.weight} kg`)
  if (profile.bodyFat) bits.push(`体脂 ${profile.bodyFat}%`)
  const bmi = profile.height && profile.weight ? (profile.weight / Math.pow(profile.height / 100, 2)) : null
  if (bmi) bits.push(`BMI ${bmi.toFixed(1)}`)
  if (profile.age) bits.push(`${profile.age} 岁`)
  if (profile.sex) bits.push(profile.sex === 'female' ? '女' : '男')
  if (profile.experience) bits.push(`训练经验 ${profile.experience}`)
  return bits.join('，') || '未填写身体数据'
}
