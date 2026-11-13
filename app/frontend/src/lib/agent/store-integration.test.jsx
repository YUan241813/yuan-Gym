// @vitest-environment happy-dom

// 小G 的 write 动作是跑在 useStore.update 的草稿上的（views/Assistant.jsx 的 runActions）。
// 单元测试直接改普通对象，测不出「草稿」这层的坑：切单位时要把 convertStateUnit 的结果整份
// 铺回草稿，万一铺错了，update 的「不能改上一份 state」检查会当场抛错（MODE==='test' 时生效）。
// 这个文件就是走真 store 跑一遍，证明三条路都通：切单位、改普通设置、开关模块。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { DEF, useStore } from '../../store/useStore.js'
import { applyActions } from './actions.js'

const clone = v => JSON.parse(JSON.stringify(v))
const seed = () => {
  const S = clone(DEF)
  S.unit = 'kg'
  S.bodyweight = [{ date: '2026-11-01', w: 100 }]
  S.workouts = [{ date: '2026-11-01', entries: [{ id: '0025', sets: [{ w: 100, reps: 5 }] }] }]
  useStore.setState({ S, user: null, ready: false, sync: { offline: true, pending: false, lastSynced: 0 } })
  return S
}

const run = actions => {
  let out = null
  useStore.getState().update(s => { out = applyActions(s, actions) })
  return out
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('小G 的动作走真 store（草稿 + 事务）', () => {
  it('切单位：整份换算铺回草稿，不触发「改了上一份 state」的检查', () => {
    const before = seed()
    const out = run([{ type: 'set-setting', key: 'unit', value: 'lb' }])

    const S = useStore.getState().S
    expect(out.applied).toBe(1)
    expect(S.unit).toBe('lb')
    expect(S.bodyweight[0].w).toBeCloseTo(220.5, 1)
    expect(S.workouts[0].entries[0].sets[0].w).toBeCloseTo(220.5, 1)
    expect(S.unitSet.convert).toBe(true)
    // 上一份还是 kg 的 100，没被就地改掉
    expect(before.unit).toBe('kg')
    expect(before.bodyweight[0].w).toBe(100)
  })

  it('普通设置落进 state', () => {
    seed()
    run([{ type: 'set-setting', key: 'restSec', value: 150 }])
    expect(useStore.getState().S.restSec).toBe(150)
  })

  it('模块开关写进 S.modules', () => {
    seed()
    run([{ type: 'set-module', id: '签到', on: false }])
    expect(useStore.getState().S.modules.checkin).toBe(false)
  })

  it('一轮里改设置 + 排日程一起写，谁也不盖谁', () => {
    const S0 = seed()
    S0.routines = [{ id: 'r1', name: '推日', emoji: 'arm', ex: [] }]
    useStore.setState({ S: S0 })
    run([
      { type: 'set-setting', key: 'theme', value: 'light' },
      { type: 'schedule-week', days: { 1: '推日' } },
    ])
    const S = useStore.getState().S
    expect(S.theme).toBe('light')
    expect(S.week[1]).toEqual(['r1'])
    expect(S.scheduleMode).toBe('week')
  })
})
