// Per-exercise records for the Stats panel (1.4.13): the heaviest set ever logged, the most reps
// at that weight, and the best estimated 1RM. Read-only — everything is derived from the workouts
// already on the device, so a record cannot drift away from the history that made it.
//
// Two things are deliberately left out:
//   · assistance machines (isAssisted): the load is the help given, so "heaviest" and Epley both
//     climb as you get weaker (issue #232, the same rule onerm.js follows);
//   · warm-up rows: a ramped 60 kg is not a record, it is a step on the way to one.
import { entriesForExercise } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { isAssisted } from './exercises.js'
import { best1RM } from './onerm.js'

/** Completed working rows of one entry, per-side rows read as their heavier limb. */
function workRows(entry) {
  const out = []
  for (const s of entry?.sets || []) {
    if (!s || s.done !== true || isWarmupRow(s)) continue
    if (s.sides && (s.sides.L || s.sides.R)) {
      for (const side of ['L', 'R']) {
        const row = s.sides[side]
        if (row?.done === true && Number(row.w) > 0) out.push({ w: Number(row.w), r: Number(row.r) || 0 })
      }
      continue
    }
    if (Number(s.w) > 0) out.push({ w: Number(s.w), r: Number(s.r) || 0 })
  }
  return out
}

/**
 * The records of one exercise as this device has them, or null when it was never logged with a
 * load (a bodyweight movement, a cardio machine, an assistance stack).
 * @returns {null | {heaviest: {w:number, r:number, d:string}, maxReps: {w:number, r:number, d:string}, e1rm: {est:number, w:number, r:number, d:string}|null}}
 */
export function recordsFor(S, exId) {
  if (!S || exId == null || exId === '') return null
  if (isAssisted(exId)) return null
  let heaviest = null
  let maxReps = null
  for (const w of S.workouts || []) {
    for (const entry of entriesForExercise(w, exId)) {
      for (const row of workRows(entry)) {
        if (!heaviest || row.w > heaviest.w || (row.w === heaviest.w && row.r > heaviest.r)) {
          heaviest = { w: row.w, r: row.r, d: w.d }
        }
        // Most reps in a single set, with the weight it was done at — a rep record is only
        // meaningful next to its load, so both travel together.
        if (!maxReps || row.r > maxReps.r) maxReps = { w: row.w, r: row.r, d: w.d }
      }
    }
  }
  if (!heaviest) return null
  const best = best1RM(S, exId)
  return {
    heaviest,
    maxReps,
    e1rm: best ? { est: best.est, w: best.w, r: best.r, d: best.d } : null,
  }
}

/**
 * The records of the exercises trained most recently, newest first — what the Stats card shows
 * without asking anyone to pick one. `limit` counts exercises, not workouts.
 */
export function recentRecords(S, limit = 6) {
  const seen = new Set()
  const out = []
  const workouts = [...(S?.workouts || [])].reverse()
  for (const w of workouts) {
    for (const entry of [...(w.entries || [])].reverse()) {
      const id = entry?.id
      if (!id || seen.has(id)) continue
      const rec = recordsFor(S, id)
      if (!rec) continue
      seen.add(id)
      out.push({ id, d: w.d, ...rec })
      if (out.length >= limit) return out
    }
  }
  return out
}
