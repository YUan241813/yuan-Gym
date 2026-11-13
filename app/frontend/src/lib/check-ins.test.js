// 双类型每日签到数据模型（2026-11-11 改版）的自测。覆盖 Task A 的 7 个场景里属于「数据层」的
// 部分（1–6）；第 7 个（两份 STAMPED_MAPS / OWN_MERGE 一致）在 sync-stamps-parity.test.js。
//
// 关键不变量：
//   · 普通签到只写 S.checkIns；拍照签到既写 dayPhotos 又写 checkIns；
//   · 删照片只动 dayPhotos（tombstone），绝不动 checkIns —— 那天仍然算签到；
//   · 删除照片后的 Undo（restoreDayPhoto）把那天升级回「拍照签到」；
//   · 历史照片天（S 里没有 checkIns）通过读取层 union + 首次挂载幂等回填算作已签到；
//   · checkIns 在 sync-merge.js / sync-stamps.js 的 STAMPED_MAPS（按天独立合并）里，所以两台
//     设备各签各的天都留得下；而 mergeStampedMap 是「_ts 大者胜」，一旦对某天做负戳删除会被
//     另一台复活 —— 所以代码里绝不能 delete map[date]。
import { describe, expect, it } from 'vitest'
import { checkedDays, markCheckIn, backfillCheckIns, photoCheckinDays, streakOf } from './check-ins.js'
import { removeDayPhoto, restoreDayPhoto, fileProgressPhoto } from './day-photos.js'
import { mergeStampedMap } from './sync-merge.js'

const TODAY = '2026-11-11'
const YESTERDAY = '2026-11-10'
// 一个通过 normalizeMediaRef 校验的合法 MediaRef（HASH_RE 要求 64 位十六进制 hash）。
const ref = h => ({ kind: 'image', mime: 'image/jpeg', hash: h.repeat(64).slice(0, 64), size: 12345, width: 200, height: 150 })
const hashOf = h => ref(h).hash

describe('双类型签到 — 数据模型', () => {
  it('场景1：普通签到写入 checkIns，并计入连续天数', () => {
    const S = {}
    const added = markCheckIn(S, TODAY)
    expect(added).toBe(true)
    expect(S.checkIns[TODAY]).toEqual({ at: expect.any(Number), _ts: expect.any(Number) })
    const days = checkedDays(S)
    expect(days.has(TODAY)).toBe(true)
    expect(streakOf(days, TODAY)).toBe(1)
  })

  it('普通签到当天已有记录则幂等，不覆盖', () => {
    const S = {}
    markCheckIn(S, TODAY, 100)
    const added = markCheckIn(S, TODAY, 200)
    expect(added).toBe(false)
    expect(S.checkIns[TODAY]._ts).toBe(100)
  })

  it('场景2：拍照签到同时写 dayPhotos 和 checkIns', () => {
    const S = {}
    const res = fileProgressPhoto(S, TODAY, ref('1'), { canDay: true })
    expect(res).toBe('day')
    markCheckIn(S, TODAY)
    expect(S.dayPhotos[hashOf('1')]).toBeTruthy()
    expect(S.checkIns[TODAY]).toBeTruthy()
  })

  it('场景3：删掉当天的照片，checkIns 不动 —— 那天仍然算签到（普通签到降级）', () => {
    const S = { checkIns: { [TODAY]: { at: 1, _ts: 1 } } }
    fileProgressPhoto(S, TODAY, ref('2'), { canDay: true })
    const h = hashOf('2')
    removeDayPhoto(S, h)
    expect(S.checkIns[TODAY]).toBeTruthy()           // 删照片不碰 checkIns
    expect(photoCheckinDays(S).has(TODAY)).toBe(false) // 照片天没了
    expect(checkedDays(S).has(TODAY)).toBe(true)     // 仍计入已签到
    expect(streakOf(checkedDays(S), TODAY)).toBe(1)  // 连续天数保住
  })

  it('场景4：删照片后的 Undo（restoreDayPhoto）把那天升级回拍照签到', () => {
    const S = { checkIns: { [TODAY]: { at: 1, _ts: 1 } } }
    fileProgressPhoto(S, TODAY, ref('3'), { canDay: true })
    const h = hashOf('3')
    const entry = S.dayPhotos[h]
    removeDayPhoto(S, h)
    expect(photoCheckinDays(S).has(TODAY)).toBe(false)
    const ok = restoreDayPhoto(S, h, entry)
    expect(ok).toBe(true)
    expect(photoCheckinDays(S).has(TODAY)).toBe(true) // 升级回拍照签到
  })

  it('场景5：历史照片天（没有 checkIns）靠读取层 union 算作已签到', () => {
    const S = { dayPhotos: { hx: { d: YESTERDAY, m: { hash: 'hx' }, _ts: 1 } } }
    expect(S.checkIns).toBeUndefined()
    const days = checkedDays(S)
    expect(days.has(YESTERDAY)).toBe(true)
    expect(days.has(TODAY)).toBe(false)
  })

  it('场景5b：首次挂载幂等回填历史照片天进 checkIns，且不覆盖已有记录', () => {
    const S = { dayPhotos: { hx: { d: YESTERDAY, m: { hash: 'hx' }, _ts: 1 } } }
    expect(backfillCheckIns(S)).toBe(1)
    expect(S.checkIns[YESTERDAY]).toBeTruthy()
    expect(backfillCheckIns(S)).toBe(0) // 再跑一次：幂等
    // 已有记录不被覆盖
    const S2 = { checkIns: { [YESTERDAY]: { at: 9, _ts: 9 } }, dayPhotos: { hx: { d: YESTERDAY, m: { hash: 'hx' }, _ts: 1 } } }
    expect(backfillCheckIns(S2)).toBe(0)
    expect(S2.checkIns[YESTERDAY]._ts).toBe(9)
  })

  it('场景6：两台设备各签各的天，mergeStampedMap 按天都留得下（STAMPED_MAPS 生效）', () => {
    const A = { checkIns: { [TODAY]: { at: 10, _ts: 10 } } }
    const B = { checkIns: { [YESTERDAY]: { at: 20, _ts: 20 } } }
    const m = mergeStampedMap(A.checkIns, B.checkIns)
    expect(m[TODAY]).toBeTruthy()
    expect(m[YESTERDAY]).toBeTruthy()
  })

  it('场景6b：对某天做负戳「删除」会被另一台复活 —— 故代码里绝不能 delete map[date]', () => {
    // A 是「较新」的一端，把 D 用负戳删了；B 仍持有正的 D。
    const A = { checkIns: { D: { _ts: -50 } } }   // 视作已删除
    const B = { checkIns: { D: { at: 5, _ts: 5 } } } // 仍签到
    const m = mergeStampedMap(A.checkIns, B.checkIns)
    // B 的正戳胜出 → 删除不生效（被复活）。这正是「绝不删除 checkIns」的原因。
    expect(m.D).toEqual({ at: 5, _ts: 5 })
  })

  it('checkIns 是可选字段，整对象 JSON 序列化即可保留，无需在 store 注册', () => {
    const S = { checkIns: { [TODAY]: { at: 1, _ts: 1 } }, dayPhotos: { h: { d: TODAY, m: { hash: 'h' }, _ts: 1 } } }
    const round = JSON.parse(JSON.stringify(S))
    expect(round.checkIns[TODAY]).toBeTruthy()
  })
})
