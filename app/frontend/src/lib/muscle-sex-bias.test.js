import { describe, it, expect } from 'vitest'
import { sexBiasFor } from './muscle-sex-bias.js'
import { EXDB } from './exercises-data.js'

// Synthetic exercise with explicit muscle weights (mirrors how musclesOf reads them).
const ex = (n, muscleWeights) => ({ n, muscleWeights })
const hipThrust = ex('Barbell Hip Thrust', { gluteal: 1, hamstring: 0.4 })
const benchPress = ex('Barbell Bench Press', { chest: 1, deltoids: 0.4, triceps: 0.4 })

describe('sexBiasFor', () => {
  it('returns 0 for an unknown sex', () => {
    expect(sexBiasFor(hipThrust, 'other')).toBe(0)
    expect(sexBiasFor(hipThrust, null)).toBe(0)
  })

  it('boosts female-coded glute moves for women but not for men', () => {
    expect(sexBiasFor(hipThrust, 'female')).toBeGreaterThan(sexBiasFor(hipThrust, 'male'))
    expect(sexBiasFor(hipThrust, 'female')).toBeGreaterThan(0)
  })

  it('boosts male-coded pressing moves for men but not for women', () => {
    expect(sexBiasFor(benchPress, 'male')).toBeGreaterThan(sexBiasFor(benchPress, 'female'))
    expect(sexBiasFor(benchPress, 'male')).toBeGreaterThan(0)
  })

  it('signature nudge is language-independent (keyed on canonical ex.n)', () => {
    const gBridge = ex('Glute Bridge', { gluteal: 1 })
    expect(sexBiasFor(gBridge, 'female')).toBeGreaterThan(0)
    const curl = ex('Bicep Curl', { biceps: 1 })
    expect(sexBiasFor(curl, 'male')).toBeGreaterThan(0)
  })

  it('is bounded by the MAX_BIAS cap even for a maximally biased exercise', () => {
    const everything = ex('Hip Thrust Glute Bridge Romanian Bulgarian Abduction Kickback Donkey Kick Clamshell', {
      gluteal: 1, hamstring: 1, adductors: 1, 'hip-flexors': 1, quadriceps: 1, calves: 1, tibialis: 1,
    })
    expect(sexBiasFor(everything, 'female')).toBeLessThanOrEqual(0.7)
  })
})

describe('sexBiasFor against the real catalogue', () => {
  const byName = sub => EXDB.find(e => e.n && e.n.toLowerCase().includes(sub))
  const ht = byName('hip thrust')
  const bp = byName('bench press')

  it('a real hip-thrust exercise favours female over male', () => {
    expect(ht).toBeTruthy()
    expect(sexBiasFor(ht, 'female')).toBeGreaterThan(sexBiasFor(ht, 'male'))
  })

  it('a real bench-press exercise favours male over female', () => {
    expect(bp).toBeTruthy()
    expect(sexBiasFor(bp, 'male')).toBeGreaterThan(sexBiasFor(bp, 'female'))
  })
})
