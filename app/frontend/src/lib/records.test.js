import { describe, expect, it } from 'vitest'
import { recordsFor, recentRecords } from './records.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const wk = (d, id, sets, extra = {}) => ({ id: d + id, d, start: 1, entries: [{ id, sets, ...extra }] })

describe('recordsFor', () => {
  it('reads the heaviest set, the best rep set and the estimated 1RM from the history', () => {
    const S = {
      unit: 'kg',
      workouts: [
        wk('2026-10-01', 'BENCH', [set(60, 8), set(62.5, 6)]),
        wk('2026-10-08', 'BENCH', [set(65, 5), set(60, 10)]),
      ],
    }
    const r = recordsFor(S, 'BENCH')
    expect(r.heaviest).toEqual({ w: 65, r: 5, d: '2026-10-08' })
    expect(r.maxReps).toEqual({ w: 60, r: 10, d: '2026-10-08' })
    expect(r.e1rm.est).toBeGreaterThan(65)
    expect(r.e1rm.d).toBe('2026-10-08')
  })

  it('ignores warm-up rows and unfinished sets', () => {
    const S = {
      unit: 'kg',
      workouts: [wk('2026-10-01', 'SQUAT', [
        set(100, 5, { phase: 'warmup' }),
        set(140, 3),
        set(200, 1, { done: false }),
      ])],
    }
    const r = recordsFor(S, 'SQUAT')
    expect(r.heaviest).toEqual({ w: 140, r: 3, d: '2026-10-01' })
    expect(r.maxReps.w).toBe(140)
  })

  it('counts the heavier limb of a per-side set, never both added together', () => {
    const S = {
      unit: 'kg',
      workouts: [wk('2026-10-01', 'CURL', [
        { done: true, sides: { L: { w: 20, r: 8, done: true }, R: { w: 22, r: 6, done: true } } },
      ])],
    }
    expect(recordsFor(S, 'CURL').heaviest).toEqual({ w: 22, r: 6, d: '2026-10-01' })
  })

  it('is null for an exercise never logged with a load', () => {
    expect(recordsFor({ workouts: [] }, 'BENCH')).toBeNull()
    expect(recordsFor({ workouts: [wk('2026-10-01', 'PUSHUP', [{ w: 0, r: 20, done: true }])] }, 'PUSHUP')).toBeNull()
  })
})

describe('recentRecords', () => {
  it('walks the newest workouts first, one row per exercise, up to the limit', () => {
    const S = {
      unit: 'kg',
      workouts: [
        wk('2026-10-01', 'BENCH', [set(60, 8)]),
        wk('2026-10-02', 'ROW', [set(50, 10)]),
        wk('2026-10-03', 'BENCH', [set(65, 6)]),
        wk('2026-10-04', 'SQUAT', [set(100, 5)]),
      ],
    }
    const rows = recentRecords(S, 2)
    expect(rows.map(r => r.id)).toEqual(['SQUAT', 'BENCH'])
    expect(rows[1].heaviest.w).toBe(65)
  })
})
