// Body weight against training volume, week by week (1.4.13).
//
// Two numbers that move on completely different scales: a week of training is thousands of kilos,
// body weight is seventy. Plotted raw on one axis the weight line is a flat line on the floor, so
// both are turned into an index instead — the first week in the window is 100, every later week
// is where it stands against that. What the chart then answers is the only question worth asking
// of it: is the work going up while the weight holds, or are both climbing.
//
// Volume comes from sessionVolume(), not the cached w.vol, so the warm-up and body-weight
// switches apply to it exactly as they do everywhere else.
import { weekKey, weekStartOf } from './format.js'
import { sessionVolume } from './history.js'
import { weeklyWeights } from './bodyweight.js'

/**
 * The last `weeks` weeks that have a workout, oldest first.
 * @returns {Array<{key: string, volume: number, bw: number|null}>}
 */
export function weeklyTrend(S, { weeks = 12 } = {}) {
  const ws = weekStartOf(S)
  const volume = new Map()
  for (const w of S?.workouts || []) {
    if (!w?.d) continue
    const k = weekKey(w.d, ws)
    volume.set(k, (volume.get(k) || 0) + sessionVolume(w, S))
  }
  if (!volume.size) return []
  const keys = [...volume.keys()].sort().slice(-Math.max(1, weeks))
  // Weigh-ins only exist for the weeks someone stepped on the scale. A week without one carries
  // the last known weight forward (a weight does not vanish), and the very first weeks borrow the
  // first known one backwards rather than starting the line at nothing.
  const weighed = new Map()
  for (const wk of weeklyWeights(S?.bodyweight, ws) || []) {
    if (Number(wk.avg) > 0) weighed.set(wk.key, wk.avg)
  }
  const rows = keys.map(key => ({ key, volume: volume.get(key) || 0, bw: weighed.get(key) ?? null }))
  let last = null
  for (const row of rows) {
    if (row.bw == null) row.bw = last
    else last = row.bw
  }
  const firstKnown = rows.find(r => r.bw != null)?.bw ?? null
  for (const row of rows) if (row.bw == null) row.bw = firstKnown
  return rows
}

/**
 * The same weeks as two index lines, both 100 at the first week, ready for LineChart's `series`.
 * A line is left out when it has nothing to say: no weigh-in anywhere means no weight line, and a
 * first week with no training volume cannot be an index of 100.
 */
export function trendSeries(rows) {
  if (!Array.isArray(rows) || !rows.length) return { points: [], series: [] }
  const base = rows[0]
  const t = key => new Date(key + 'T12:00:00').getTime()
  const idx = (value, baseValue) => (baseValue > 0 ? Math.round((value / baseValue) * 1000) / 10 : null)
  const hasBw = rows.every(r => Number(r.bw) > 0)
  const volPts = rows.map(r => ({ t: t(r.key), y: idx(r.volume, base.volume) ?? 100 }))
  const bwPts = hasBw ? rows.map(r => ({ t: t(r.key), y: idx(r.bw, base.bw) ?? 100 })) : []
  const points = rows.map((r, i) => ({
    t: t(r.key),
    y: volPts[i].y,
    m: hasBw ? Math.min(1, Math.max(0, (bwPts[i].y - 80) / 40)) : undefined,
    note: hasBw
      ? `${r.key} · ${Math.round(r.volume)} kg · ${Math.round(r.bw * 10) / 10} kg`
      : `${r.key} · ${Math.round(r.volume)} kg`,
  }))
  const series = [{ points: volPts, color: 'var(--acc)' }]
  if (bwPts.length) series.push({ points: bwPts, color: 'var(--teal)' })
  return { points, series, hasBw }
}
