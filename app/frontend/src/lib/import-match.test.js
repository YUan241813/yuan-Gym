import { describe, it, expect } from 'vitest'
import { matchExercise, parseWorkoutCSV, detectSource, exerciseCandidates } from './import-csv.js'
import { EXIDX } from './exercises.js'

// The names other apps actually export, and the catalogue entry each has to land on.
// Everything here was reported as arriving in the app as a *custom* exercise (issue #74):
// the alias table is the intended place to fix that, so these pin it.
const MAPS = {
  Treadmill: '3666',
  'Goblet Squat': '1760',
  Cycling: '2331',
  'Cable Core Pallof Press': '0979',
  Elliptical: '2141',
  'Stationary Bike': '2138',
  // Hevy's vocabulary, from a real export. It writes the equipment in parentheses and says
  // "bicep"/"chest fly" where the catalogue says "biceps"/"fly", so the word-bag lands one
  // word off on every one of these and they arrived as custom exercises.
  'Bicep Curl (Dumbbell)': '0294',
  'Bicep Curl (Cable)': '0868',
  'Chest Fly (Machine)': '0596',
  'Butterfly (Pec Deck)': '0596',
  'Incline Chest Fly (Dumbbell)': '0319',
  'Rear Delt Reverse Fly (Dumbbell)': '0383',
  'Face Pull': '0203',
  'Battle Ropes': '0128',
  'Hack Squat (Machine)': '0743',
  'Seated Cable Row - Bar Grip': '0218',
  'Single Arm Lateral Raise (Cable)': '0192',
  // A second real Hevy export: custom exercises before the alias, or a neighbouring lift.
  'Lu Raises': '10858',
  'Dumbbell Squeeze Press': '3681',
  'Triceps Kickback (Dumbbell)': '0333',
  'Single Arm Lat Pulldown': '1204',
  'Lateral Band Walks': '6607',
  'Frog Pumps (Dumbbell)': '3182',
  'Rear Delt Reverse Fly (Cable)': '0225',
  'Single Arm Cross Cable Extension': '8614',
  'Bayesian Curl': '2656',
  'Floor Press (Dumbbell)': '3668',
  Clamshell: '2461',
  'Single Leg Romanian Deadlift (Dumbbell)': '1757',
}

describe('foreign exercise names resolve to the catalogue', () => {
  for (const [name, id] of Object.entries(MAPS)) {
    it(`maps "${name}" to ${id}`, () => {
      expect(matchExercise(name)).toBe(id)
      expect(EXIDX[id]).toBeTruthy()   // an alias pointing at a dropped id is worse than no alias
    })
  }

  // Equipment qualifiers must still beat the bare alias, or an import files years of
  // dumbbell work under the barbell lift.
  it('keeps the qualified variants distinct', () => {
    expect(matchExercise('Kettlebell Goblet Squat')).toBe('0534')
    expect(matchExercise('Dumbbell Goblet Squat')).toBe('1760')
    expect(matchExercise('Lying Leg Curl')).toBe('0586')
    expect(matchExercise('Seated Leg Curl')).toBe('0599')
  })

  // The word-bag is order-insensitive, which is what lets one alias cover the two ways
  // exporters write the same movement.
  it('ignores word order and case', () => {
    expect(matchExercise('Squat (Barbell)')).toBe(matchExercise('Barbell Squat'))
  })

  // Regression guard for the aliases added above: the common lifts must not have moved.
  it('leaves the established aliases alone', () => {
    expect(matchExercise('Bench Press')).toBe('0025')
    expect(matchExercise('Squat')).toBe('0043')
    expect(matchExercise('Barbell Row')).toBe('0027')
    expect(matchExercise('Deadlift')).toBe('0032')
  })

  // SYN rewrote 'machine' -> 'lever' before it ever reached 'smith machine' -> 'smith',
  // so every Smith-machine name arrived as "smith lever ..." and could not match anything
  // in the catalogue. The two rules are order-dependent; this pins the order.
  it('resolves Smith-machine names rather than leaving a stray "lever"', () => {
    expect(matchExercise('Bench Press (Smith Machine)')).toBe('0748')
    expect(matchExercise('Overhead Press (Smith Machine)')).toBe('0766')
    expect(matchExercise('Smith Machine Bench Press')).toBe('0748')
  })

  // The generic machine -> lever rule still has to work on its own.
  it('keeps the plain machine alias working', () => {
    expect(matchExercise('Seated Fly (Machine)')).toBe('0596')
  })

  it('still refuses to guess', () => {
    expect(matchExercise('Some Movement I Invented')).toBe(null)
    expect(matchExercise('')).toBe(null)
  })
})

// Hevy exports no category column, so every invented exercise took the 'upper legs' default
// and a third of an imported history was attributed to the legs in the muscle map. With no
// category to read, the body part comes off the name instead.
describe('invented exercises get a body part from their name', () => {
  const HEAD = 'Date,Exercise,Weight,Reps'
  const row = name => `2025-10-09,${name},40,10`
  const bpOf = name => {
    const r = parseWorkoutCSV([HEAD, row(name)].join('\n'), { unit: 'kg' })
    return r.customEx[0] && r.customEx[0].bp
  }

  it('reads the body part off names the catalogue does not have', () => {
    expect(bpOf('Kirk Shrug Machine Thing')).toBe('back')
    expect(bpOf('Bicep Curl Contraption')).toBe('upper arms')
    expect(bpOf('Standing Calf Thing')).toBe('lower legs')
  })

  it('no longer files everything under the legs', () => {
    expect(bpOf('Some Chest Contraption')).not.toBe('upper legs')
    expect(bpOf('Some Chest Contraption')).toBe('chest')
  })

  it('leaves a genuine leg movement on the legs', () => {
    expect(bpOf('Bulgarian Split Squat Machine v9')).toBe('upper legs')
  })

  it('still prefers an explicit category column when the file has one', () => {
    const head = 'Date,Exercise,Category,Weight,Reps'
    const r = parseWorkoutCSV([head, '2025-10-09,Some Invented Lift,Shoulders,40,10'].join('\n'), { unit: 'kg' })
    expect(r.customEx[0].bp).toBe('shoulders')
  })
})

describe('exerciseCandidates: what a name could mean, for a caller that must not guess', () => {
  it('a curated alias or a unique exact name is the answer', () => {
    expect(exerciseCandidates('dumbbell curl')).toEqual({ id: '0294', candidates: [], kind: 'alias' })
    expect(exerciseCandidates('Bench Press (Barbell)')).toEqual({ id: '0025', candidates: [], kind: 'alias' })
  })
  it('an exact name the catalogue spells twice is every entry, not the first (matchExercise keeps the first)', () => {
    expect(exerciseCandidates('lever chest press')).toEqual({ id: null, candidates: ['0576', '0577'], kind: 'exact' })
    expect(matchExercise('lever chest press')).toBe('0576')
  })
  it('several equally near entries are candidates, the closest first', () => {
    // ("plank" was the example until the 1.4.4 importers gave it an alias: the front plank.)
    const r = exerciseCandidates('good morning')
    expect(r).toMatchObject({ id: null, kind: 'near' })
    expect(r.candidates.length).toBeGreaterThan(1)
    expect(r.candidates.every(id => EXIDX[id].n.includes('good morning'))).toBe(true)
  })
  it('nothing near: the entries sharing the most words, at most the limit; nothing at all for no words', () => {
    const r = exerciseCandidates('zercher frobnicate curl', 3)
    expect(r).toMatchObject({ id: null, kind: 'none' })
    expect(r.candidates.length).toBeLessThanOrEqual(3)
    expect(exerciseCandidates('  ')).toMatchObject({ id: null, candidates: [] })
  })
})
