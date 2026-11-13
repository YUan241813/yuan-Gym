// 把 useStore 的 S 投影成一份紧凑、可塞进 prompt 的「App 数据快照」。
// 只读，不做任何写入；字段都做了截断，避免长历史把上下文撑爆。
//
// 2026-11-11：为了让小G 能真的排日程，快照里给的东西必须是「名字」而不是内部 id ——
// S.week / S.dayPlan 存的都是 routine id，模型看不懂，也就没法照着写 schedule-week。

import { EXIDX } from '../exercises.js'
import { exerciseNameFor } from '../i18n-core.js'
import { isoOf, todayISO } from '../format.js'
import { MODULE_IDS } from '../modules.js'
import { painSlugs } from '../pain.js'
import { MUSCLE_FACTS } from '../muscle-facts.js'

// 用本地化名（中文）喂给模型，和用户在界面上看到的一致。
const exName = id => {
  const ex = EXIDX[id]
  if (!ex) return id || ''
  return String(exerciseNameFor(ex)).split(' (')[0]
}
const bpOf = id => EXIDX[id]?.bp || ''

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null)
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

export function buildSnapshot(S) {
  const routines = (S?.routines || []).slice(0, 20).map(r => ({
    name: r.name || '',
    exercises: (r.ex || []).slice(0, 30).map(e => {
      const name = exName(e.id)
      const bp = bpOf(e.id)
      const mode = e.mode || 'reps'
      return {
        name,
        bp,
        mode,
        sets: num(e.sets),
        reps: num(e.reps),
        sec: num(e.sec),
      }
    }),
  }))

  const recentWorkouts = (S?.workouts || []).slice(-12).map(w => {
    const entries = Array.isArray(w?.entries) ? w.entries : []
    const parts = [...new Set(entries.map(e => bpOf(e?.id)).filter(Boolean))]
    return {
      date: w?.date || w?.at || w?.finished || '',
      volume: Math.round(Number(w?.vol) || 0),
      exercises: entries.map(e => exName(e?.id)).filter(Boolean).slice(0, 20),
      bodyParts: parts,
    }
  })

  const bw = Array.isArray(S?.bodyweight) ? S.bodyweight : []
  const lastWeight = bw.length
    ? { kg: num(bw[bw.length - 1]?.kg ?? bw[bw.length - 1]?.w), date: bw[bw.length - 1]?.date || bw[bw.length - 1]?.at || '' }
    : null

  // 动作组名字表：id → 名字，下面两处排期换算都用它。
  const nameOf = new Map((S?.routines || []).map(r => [r.id, r.name || '']))

  // 星期排期：{ '1': ['推日'], '5': ['腿日'] }，没有的那天就是休息。
  const schedule = {}
  for (const k of ['1', '2', '3', '4', '5', '6', '0']) {
    const names = [].concat(S?.week?.[k] || []).map(id => nameOf.get(id)).filter(Boolean)
    if (names.length) schedule[k] = names
  }

  // 未来 14 天的一次性覆盖（S.dayPlan 是 date → routineId | 'rest'）。
  const today = todayISO()
  const dayPlan = {}
  for (let i = 0; i < 14; i++) {
    const iso = addDays(today, i)
    const v = isMap(S?.dayPlan) ? S.dayPlan[iso] : undefined
    if (v === undefined || v === null || v === '') continue
    dayPlan[iso] = v === 'rest' ? 'rest' : (nameOf.get(v) || null)
  }

  return {
    today,
    weekday: new Date(today + 'T12:00:00').getDay(),   // 0 = 周日
    scheduleMode: S?.queue ? 'rotation' : 'week',      // rotation = 循环排队，week = 按星期
    profile: {
      unit: S?.unit || 'kg',
      body: S?.body || 'male',
      targetWeight: num(S?.targetW),
      weeklyTrainingDays: Object.keys(schedule).length || null,
    },
    // 现在这些设置是什么 —— 小G 要能答「现在是磅还是公斤」，也要知道「已经就是这样了」。
    settings: {
      lang: S?.lang || 'en',
      theme: S?.theme || 'dark',
      accent: S?.accent || 'yuan',
      restSec: num(S?.restSec) ?? 90,
      speedUnit: S?.speedUnit || 'auto',
      weekStart: S?.weekStart === 0 ? 'sunday' : 'monday',
      workoutView: S?.workoutView || 'cards',
      warmupAuto: S?.warmupAuto || 'off',
      progDefault: S?.progDefault || 'linear',
      wdec: S?.wdec === 2 ? 2 : 1,
    },
    // 关掉的模块。缺省是「全开」，所以只列关着的，省字数。
    modulesOff: MODULE_IDS.filter(id => S?.modules?.[id] === false),
    // 标成疼痛的肌肉（lib/pain.js）：小G 得知道，不然它推荐的正好是用户不能练的部位。
    soreMuscles: painSlugs(S).map(m => MUSCLE_FACTS[m]?.cn || m),
    // 签到：最近一次是哪天，方便回答「我上次什么时候来的」。
    lastCheckIn: (() => {
      const keys = Object.keys(isMap(S?.checkIns) ? S.checkIns : {}).sort()
      return keys.length ? keys[keys.length - 1] : null
    })(),
    routines,
    schedule,
    dayPlan,
    recentWorkouts,
    lastWeight,
  }
}
