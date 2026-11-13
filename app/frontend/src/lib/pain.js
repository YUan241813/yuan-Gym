// Sore or injured muscles.
//
// The user points at a muscle on the 3D body and says it hurts (a tweak, a strain, a bruise). From
// then on the app keeps that muscle out of what it *suggests* — substitute exercises, "what trains
// this" picks — and says so on a planned exercise that would load it. It never deletes or rewrites
// a workout the user already has: a warning is information, and silently changing a session the
// user built would be worse than the soreness.
//
// Stored on the 18 training slugs (lib/muscles.js), not the 210 fine units the model picks: the
// catalogue is tagged on the training slugs, so that is where an exercise can be matched against.
// `S.pains = { '<slug>': <epoch ms it was marked> }` — a plain object, absent means none, so an
// older profile needs no migration.
import { MUSCLES, musclesOf } from './muscles.js'

/** The map of marked muscles, tolerating an absent or malformed field. */
export function painsOf(S) {
  const p = S?.pains
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
}

/** True when this training slug is marked as hurting. */
export function isPained(S, slug) {
  return !!slug && !!painsOf(S)[slug]
}

/** The marked slugs, newest first — what a summary or 小G reads. */
export function painSlugs(S) {
  const p = painsOf(S)
  return Object.keys(p).filter(s => MUSCLES.includes(s)).sort((a, b) => (p[b] || 0) - (p[a] || 0))
}

/** The marked slugs this exercise loads, in muscle order — the same map the coverage view uses. */
export function exercisePains(S, ex) {
  if (!ex) return []
  const p = painsOf(S)
  const marked = MUSCLES.filter(m => !!p[m])
  if (!marked.length) return []
  const hit = musclesOf(ex)
  return marked.filter(m => (hit[m] || 0) > 0)
}

/** True when this exercise loads a muscle the user marked as hurting. */
export function hitsPain(S, ex) {
  return exercisePains(S, ex).length > 0
}

/** Marks (or clears) every given slug at once. Returns the new map, for use inside update(s => ...). */
export function setPains(pains, slugs, on, at = Date.now()) {
  const next = { ...(pains && typeof pains === 'object' ? pains : {}) }
  for (const s of slugs || []) {
    if (!MUSCLES.includes(s)) continue
    if (on) next[s] = at
    else delete next[s]
  }
  return next
}
