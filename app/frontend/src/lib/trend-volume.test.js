import { describe, expect, it } from 'vitest'
import { weeklyTrend, trendSeries } from './trend-volume.js'

const wk = (d, sets) => ({ id: d, d, start: 1, entries: [{ id: 'BENCH', sets, target: { mode: 'reps' } }] })
const work = n => Array.from({ length: n }, () => ({ w: 100, r: 5, done: true }))

describe('weeklyTrend', () => {
  it('adds the week up with sessionVolume and carries a weight forward', () => {
    const S = {
      unit: 'kg',
      weekStart: 1,
      workouts: [wk('2026-10-05', work(2)), wk('2026-10-12', work(4))],
      bodyweight: [{ d: '2026-10-05', w: 80 }],
    }
    const rows = weeklyTrend(S)
    expect(rows.length).toBe(2)
    expect(rows[0].volume).toBe(1000)
    expect(rows[1].volume).toBe(2000)
    expect(rows[1].bw).toBe(80)          // carried forward, not null
  })

  it('is empty without workouts', () => {
    expect(weeklyTrend({ workouts: [] })).toEqual([])
  })
})

describe('trendSeries', () => {
  it('indexes both lines to 100 at the first week, and leaves weight out when none was logged', () => {
    const withBw = trendSeries([
      { key: '2026-10-05', volume: 1000, bw: 80 },
      { key: '2026-10-12', volume: 1500, bw: 82 },
    ])
    expect(withBw.points[0].y).toBe(100)
    expect(withBw.series.length).toBe(2)
    expect(withBw.series[0].points[1].y).toBe(150)
    expect(withBw.series[1].points[1].y).toBeCloseTo(102.5, 1)

    const noBw = trendSeries([{ key: '2026-10-05', volume: 1000, bw: null }])
    expect(noBw.series.length).toBe(1)
  })
})
