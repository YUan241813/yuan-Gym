// 双类型每日签到（2026-11-11 改版）——「普通签到」与「拍照签到」的统一记录。
//
// 数据只存一份极薄的记录，不存「类型」也不存「照片」引用：
//
//   S.checkIns = { 'YYYY-MM-DD': { at: <epoch ms>, _ts: <epoch ms> } }
//
// 「今天是不是拍照签到」由「当天还有没有未删除的照片」实时推导（lib/day-photos.js 的
// dayPhotosOf / 训练 media），所以删照片 / Undo 自动把当天在「普通」和「拍照」之间升降级，
// 而且完全不碰媒体 GC 管线（GC 只按 dayPhotos / 训练 media 的引用扫描）。
//
// 这样 checkIns 本身永远只增不删（将来要清签到也必须用 stamped tombstone，绝不能 delete
// map[date]，否则 mergeStampedMap 的 key union 会在同步时把记录复活）。
//
// 旧档案没有这个字段也能跑：读取一律 `S.checkIns || {}` 兜底，不在 DEF 里注册。历史照片天
// 通过「读取层 union 兜底」+「首次挂载幂等回填」两条保险算作已签到（见 backfillCheckIns）。
import { isoOf, todayISO } from './format.js'

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

// 日期前后挪 n 天。中午 12 点算，躲开夏令时和时区边界。
const shiftDay = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

/**
 * 连续签到天数：从今天往前数连续已签到的天数（checkIns ∪ 历史照片天，见 checkedDays）。
 * 今天还没签就从昨天开始数 —— 早上起来还没签到，不该把昨天的连续记录清零。
 * 接收 Set 或任意可迭代的日期字符串。
 */
export function streakOf(days, today = todayISO()) {
  const have = days instanceof Set ? days : new Set(days)
  let day = have.has(today) ? today : shiftDay(today, -1)
  let n = 0
  while (have.has(day)) { n++; day = shiftDay(day, -1) }
  return n
}

/**
 * 历史上「有照片的天」：早于 checkIns 上线、靠照片推导签到的那些天。返回
 * Map<日期, 该天照片的最晚时间戳>——训练 media 的天也算（那也是拍照签到），时间戳取训练 start。
 */
export function photoCheckinDays(S) {
  const out = new Map()
  const day = (S && S.dayPhotos) || {}
  for (const [hash, e] of Object.entries(day)) {
    if (e && typeof e.d === 'string' && e._ts) {
      const cur = out.get(e.d)
      if (cur == null || Number(e._ts) > cur) out.set(e.d, Number(e._ts))
    }
  }
  for (const w of (S && S.workouts) || []) {
    if (!w || typeof w.d !== 'string') continue
    const ts = Number(w.start) || 0
    const cur = out.get(w.d)
    if (cur == null || ts > cur) out.set(w.d, ts)
  }
  return out
}

/**
 * 所有「已签到」的天（Set<日期>）：checkIns 里有的，并上历史照片天（union 兜底，覆盖还没回填
 * 的旧档案）。删掉历史某天的最后一张照片后，那天仍因 backfill 写进的 checkIns 而算签到。
 */
export function checkedDays(S) {
  const map = S?.checkIns || {}
  // A tombstone ({ _ts } and no at) reads as not checked in, as lib/day-notes.js reads one.
  const set = new Set(Object.keys(map).filter(d => map[d] && map[d].at))
  for (const d of photoCheckinDays(S).keys()) set.add(d)
  return set
}

/**
 * 写一条普通签到。当天已有记录则不动（幂等），返回是否新写入。Mutates `state`。
 * `now` 同时是签到的时刻 `at` 和同步戳 `_ts`。
 */
export function markCheckIn(state, d, now = Date.now()) {
  if (typeof d !== 'string') return false
  const map = isMap(state.checkIns) ? state.checkIns : {}
  if (map[d] && map[d].at) return false
  state.checkIns = { ...map, [d]: { at: now, _ts: now } }
  return true
}

/**
 * 幂等回填：把历史照片天补进 checkIns（只补缺失的天，不覆盖已有记录），`_ts` / `at` 取该天照片
 * 的时间戳。返回补了多少天。Mutates `state`。目的是「删掉历史某天最后一张照片后，那天仍然算签到」。
 */
export function backfillCheckIns(state, now = Date.now()) {
  const map = isMap(state.checkIns) ? { ...state.checkIns } : {}
  let added = 0
  for (const [d, ts] of photoCheckinDays(state)) {
    if (!map[d] || !map[d].at) { map[d] = { at: ts || now, _ts: ts || now }; added++ }
  }
  if (added) state.checkIns = map
  return added
}
