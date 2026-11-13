// AI 训练计划 ↔ App 数据的桥：把近 4 周训练记录读成摘要，把生成的周计划转成
// 可以直接写进 S.routines 的结构。抽成纯函数是为了能脱离 React 单独测——
// "生成的计划真的落库了"是这个页面最不能 regressions 的承诺。

import { MUSCLES, MUSCLE_NAME, loadOfWorkouts, muscleBalanceWindow } from './muscles.js'
import { canonicalExId } from './exercises.js'
import { uid } from './format.js'

const CN = {
  trapezius: '斜方肌', deltoids: '三角肌', chest: '胸大肌', 'upper-back': '背阔肌', serratus: '前锯肌',
  biceps: '二头', triceps: '三头', forearm: '前臂', abs: '腹肌', obliques: '腹斜肌',
  'lower-back': '下背', gluteal: '臀', quadriceps: '股四头', hamstring: '腘绳肌',
  adductors: '内收肌', 'hip-flexors': '髂腰肌', calves: '小腿', tibialis: '胫前肌',
}
export const cnMuscle = m => CN[m] || MUSCLE_NAME[m] || m

/**
 * 近 `days` 天里用户真正练了什么。只统计勾选完成、且不是热身的有效组，
 * 口径与肌肉平衡页完全一致（复用 loadOfWorkouts）。
 * `now` 可注入，便于离线/测试用固定时间。
 */
export function historySummary(workouts, { days = 28, now = Date.now() } = {}) {
  const all = Array.isArray(workouts) ? workouts : []
  const recent = muscleBalanceWindow(all, days, now)
  const load = loadOfWorkouts(recent)
  const total = Object.values(load).reduce((a, b) => a + b, 0)
  const average = total / MUSCLES.length
  const low = MUSCLES.filter(m => (load[m] || 0) < average * 0.45)
  const top = Object.entries(load).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const last = recent.reduce((d, w) => (w.d && w.d > d ? w.d : d), '')
  return {
    count: recent.length, load, total, low, top, last,
    text: top.map(([m, n]) => `${cnMuscle(m)} ${Math.round(n)} 组`).join('、'),
  }
}

/**
 * buildWeek 的结果 → routines 条目。字段形状对齐 coach.js 的 'add-routine'：
 * { id, name, emoji, ex: [{ id, sets, mode, reps, weight? }] }。
 * 动作 id 走 canonicalExId，避免别名动作在计划页查不到。
 */
export function planToRoutines(plan) {
  if (!plan?.sessions?.length) return []
  return plan.sessions.map(session => ({
    id: uid(),
    name: session.name,
    emoji: '🏋️',
    ex: (session.exercises || []).map(e => {
      const w = Number(e.load)
      return {
        id: canonicalExId(e.exId),
        sets: e.sets || 3,
        mode: 'reps',
        reps: Number.parseInt(e.reps, 10) || 10,
        ...(Number.isFinite(w) && w > 0 ? { weight: w } : {}),
      }
    }),
  }))
}
