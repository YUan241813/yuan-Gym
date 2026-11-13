import { describe, it, expect } from 'vitest'
import { musclesOf } from './muscles.js'
import { allExercises } from './exercises.js'
import { painsOf, isPained, painSlugs, exercisePains, hitsPain, setPains } from './pain.js'

const catalogue = allExercises({})
const chestEx = catalogue.find(e => (musclesOf(e).chest || 0) > 0)
const calfOnly = catalogue.filter(e => (musclesOf(e).chest || 0) === 0 && (musclesOf(e).calves || 0) > 0)[0]

describe('sore muscles', () => {
  it('reads an absent, empty or malformed field as "nothing marked"', () => {
    expect(painsOf(undefined)).toEqual({})
    expect(painsOf({})).toEqual({})
    expect(painsOf({ pains: null })).toEqual({})
    expect(painsOf({ pains: [] })).toEqual({})
    expect(isPained({}, 'chest')).toBe(false)
  })

  it('marks and clears by training slug, and ignores names that are not muscles', () => {
    const once = setPains({}, ['chest', 'nonsense'], true, 111)
    expect(once).toEqual({ chest: 111 })
    expect(isPained({ pains: once }, 'chest')).toBe(true)
    expect(setPains(once, ['chest'], false)).toEqual({})
  })

  it('lists the marked muscles newest first', () => {
    expect(painSlugs({ pains: { chest: 10, calves: 30 } })).toEqual(['calves', 'chest'])
  })

  it('finds an exercise that loads the marked muscle, and one that does not', () => {
    const S = { pains: { chest: 1 } }
    expect(chestEx).toBeTruthy()
    expect(hitsPain(S, chestEx)).toBe(true)
    expect(exercisePains(S, chestEx)).toEqual(['chest'])
    if (calfOnly) {
      expect(hitsPain(S, calfOnly)).toBe(false)
      expect(exercisePains(S, calfOnly)).toEqual([])
    }
  })

  it('says nothing about any exercise while nothing is marked', () => {
    const S = { pains: {} }
    expect(hitsPain(S, chestEx)).toBe(false)
    expect(exercisePains(S, undefined)).toEqual([])
  })
})
