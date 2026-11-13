// Multi-select recommendations: the ranking must reward movements that train what was
// picked and punish movements that spend effort elsewhere. These assertions are about
// behaviour, not about a frozen list — the catalogue is allowed to grow.

import { describe, it, expect } from 'vitest'
import { candidatesForMany } from './plan-engine.js'
import { musclesOf } from './muscles.js'

describe('candidatesForMany', () => {
  it('returns nothing when nothing is picked', () => {
    expect(candidatesForMany([])).toEqual([])
    expect(candidatesForMany(['not-a-muscle'])).toEqual([])
  })

  it('puts a movement that loads the picked part first', () => {
    const top = candidatesForMany(['biceps'], { limit: 3 })
    expect(top.length).toBeGreaterThan(0)
    // "Primary" in this app's weighting is 1.0; anything less is support work.
    expect(musclesOf(top[0].ex).biceps || 0).toBeGreaterThanOrEqual(1)
  })

  it('finds movements that cover two picked parts at once', () => {
    const top = candidatesForMany(['chest', 'triceps'], { limit: 8 })
    const both = top.filter(({ ex }) => {
      const m = musclesOf(ex)
      return (m.chest || 0) > 0 && (m.triceps || 0) > 0
    })
    expect(both.length).toBeGreaterThan(0)
    // And the very best answer should not be a pure-triceps isolation movement.
    const first = musclesOf(top[0].ex)
    expect(first.chest || 0).toBeGreaterThan(0)
  })

  it('every result trains at least one of the picked parts', () => {
    const picked = ['quadriceps', 'calves']
    for (const { ex } of candidatesForMany(picked, { limit: 12 })) {
      const m = musclesOf(ex)
      expect(picked.some(slug => (m[slug] || 0) > 0)).toBe(true)
    }
  })

  it('does not repeat a movement and respects the limit', () => {
    const list = candidatesForMany(['upper-back', 'biceps'], { limit: 6 })
    expect(list.length).toBeLessThanOrEqual(6)
    const ids = list.map(({ ex }) => ex.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prefers the focused movement over the scattershot one', () => {
    // With biceps + upper-back chosen, a chin-up-style movement (both) should outrank a
    // movement that also drags in five unrelated parts.
    const top = candidatesForMany(['biceps', 'upper-back'], { limit: 5 })
    const coverage = top.map(({ ex }) => {
      const m = musclesOf(ex)
      return (m.biceps || 0) + (m['upper-back'] || 0)
    })
    expect(coverage[0]).toBeGreaterThanOrEqual(coverage[coverage.length - 1])
  })
})
