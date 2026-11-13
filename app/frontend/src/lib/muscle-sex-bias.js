// Gender-aware exercise recommendation bias.
//
// Why this file exists
// --------------------
// The 3D anatomy atlas ships a curated per-muscle exercise list (unit.ex) that is
// IDENTICAL for the male and female figures — verified by diffing the 210 male
// groups against the 210 female groups (0 differences). The upstream catalogue's
// `femaleVariant` field only swaps the illustration drawing, not the training
// targets, and the runtime keeps no sex-specific training data at all. So
// "recommend exercises by sex" cannot come from the data — it is a curated,
// editable heuristic that gently nudges the existing muscle-match ranking toward
// the movements each sex tends to emphasise (a McGill-style gender bias).
//
// Two additive signals
// --------------------
//   1. Muscle-group bias — weighted by how hard the exercise actually loads that
//      muscle (primary = 1, secondary = 0.4). Data-driven and language-independent.
//   2. Signature-movement nudge — a short, unambiguous list of sex-coded moves
//      matched on the canonical English name (ex.n). ex.n never changes with the
//      UI language (exerciseNameFor returns ex.n when no translation pack is set),
//      so the nudge survives a Chinese/German/etc. UI.
//
// The bias is ADDITIVE and positive only: it lifts sex-appropriate moves, never
// penalises the other sex. It is meant to nudge, not override — an exercise that
// does not load the chosen muscle keeps its plain muscle-match rank.

import { musclesOf } from './muscles.js'

// Per-muscle weight each sex's typical emphasis gives. Numbers are a curated
// heuristic (not measured data) — tune freely. They are applied per exercise as
//   sum(muscleWeight * MUSCLE_BIAS[sex][slug])   // only muscles present in the table
const MUSCLE_BIAS = {
  // Women: glutes, hamstrings, hip abductors/adductors, lower-leg finishing.
  female: {
    gluteal: 0.45,
    hamstring: 0.30,
    adductors: 0.30,
    'hip-flexors': 0.20,
    quadriceps: 0.10,
    calves: 0.15,
    tibialis: 0.10,
  },
  // Men: chest, shoulders, upper back/traps, arms.
  male: {
    chest: 0.45,
    deltoids: 0.40,
    trapezius: 0.30,
    'upper-back': 0.25,
    biceps: 0.30,
    triceps: 0.25,
    forearm: 0.15,
    abs: 0.10,
    'lower-back': 0.10,
  },
}

// Short, unambiguous signature movements (substring match on the canonical ex.n).
// Keep this list tight — broad terms would bias unrelated exercises.
const SIGNATURE = {
  female: [
    ['hip thrust', 0.25],
    ['glute bridge', 0.20],
    ['romanian', 0.15], // Romanian deadlift — hamstring/glute
    ['bulgarian', 0.20], // Bulgarian split squat
    ['abduction', 0.20], // hip abduction
    ['hip extension', 0.15],
    ['kickback', 0.15],
    ['donkey kick', 0.15],
    ['clamshell', 0.15],
  ],
  male: [
    ['bench press', 0.25],
    ['overhead press', 0.20],
    ['shoulder press', 0.15],
    ['pull-up', 0.20],
    ['dip', 0.20],
    ['bicep curl', 0.25],
    ['hammer curl', 0.20],
    ['lateral raise', 0.20],
    ['chest fly', 0.15],
    ['push-up', 0.15],
  ],
}

// Upper bound so a multi-muscle movement cannot swamp the muscle-match score.
const MAX_BIAS = 0.7

// Positive additive bias for one exercise under a given sex. Returns 0 for an
// unknown sex or an exercise that trains no biased muscle.
export function sexBiasFor(ex, gender) {
  if (gender !== 'female' && gender !== 'male') return 0
  const muscleBias = muscleBiasOf(ex, MUSCLE_BIAS[gender])
  const signatureBias = signatureBiasOf(ex, SIGNATURE[gender])
  const total = muscleBias + signatureBias
  return total > MAX_BIAS ? MAX_BIAS : total
}

function muscleBiasOf(ex, table) {
  const m = musclesOf(ex)
  let sum = 0
  for (const slug in m) {
    const w = table[slug]
    if (w) sum += (m[slug] || 0) * w
  }
  return sum
}

function signatureBiasOf(ex, list) {
  const name = (ex && ex.n) || ''
  if (!name) return 0
  const lower = name.toLowerCase()
  let best = 0
  for (const [needle, weight] of list) {
    if (lower.includes(needle)) best = Math.max(best, weight)
  }
  return best
}

export default sexBiasFor
