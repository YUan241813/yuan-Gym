// @vitest-environment happy-dom
// Issue #71 (the same rule Library and the exercise picker already keep): choosing a body part
// after picking an equipment type must not reset the equipment filter back to "any equipment"
// when the new body part still has exercises under it. MuscleExplorer used to clear it on every
// body-part tap regardless — the only one of the three exercise browsers that did.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The first render indexes all 5,600+ catalogue exercises for search and the muscle map, which
// takes over a second here on its own and longer on a busy runner.
vi.setConfig({ testTimeout: 15000 })
import { createRoot } from 'react-dom/client'
import MuscleExplorer from './MuscleExplorer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})

const mounted = []
function render(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MuscleExplorer {...props} />))
  return host
}
const chipByText = (host, text) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const muscleChip = (host, label) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.startsWith(label))
const isOn = el => el.className.split(/\s+/).includes('on')

beforeEach(() => {
  mocks.S = {
    unit: 'kg', lang: 'en', body: 'male', routines: [], workouts: [], customEx: [], exWeights: {},
    equipProfiles: [], activeEquipId: null, equipFilterOn: false, favEx: [],
  }
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('MuscleExplorer body-part chips keep the equipment filter', () => {
  // Biceps has dumbbell exercises under both "lower arms" and "upper arms" in the catalog, the
  // same shape as issue #71's original repro (lower arms/upper arms + dumbbell).
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })

    act(() => { chipByText(host, 'lower arms').click() })
    const dumbbell = chipByText(host, 'dumbbell')
    expect(dumbbell, 'dumbbell chip should be offered under lower arms').toBeTruthy()
    act(() => { dumbbell.click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'upper arms').click() })
    expect(isOn(chipByText(host, 'upper arms'))).toBe(true)
    const dumbbellAfter = chipByText(host, 'dumbbell')
    expect(dumbbellAfter, 'dumbbell chip should still be present under upper arms').toBeTruthy()
    expect(isOn(dumbbellAfter)).toBe(true)
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(false)
  })

  // "All" body parts is the one chip that does clear the equipment filter — it spans every
  // body part, so there is no "still valid here" question to answer.
  it('"All" body parts still clears the equipment filter', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    act(() => { chipByText(host, 'lower arms').click() })
    act(() => { chipByText(host, 'dumbbell').click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'All').click() })
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(true)
  })
})

describe('MuscleExplorer search: the × and live count the Library has (#338)', () => {
  function type(el, value) {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  it('shows a count while narrowed and a × that empties only the text', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    // 两个 .search：第一个是「搜索肌肉」框，带实时计数与 × 的是第二个（运动搜索框）。
    const search = () => host.querySelectorAll('.search')[1]
    const input = () => search().querySelector('input')
    const count = () => search().querySelector('.search-count')
    const clear = () => search().querySelector('.clear')
    const rows = () => host.querySelectorAll('.list .item').length
    expect(count()).toBeNull()
    expect(clear()).toBeNull()
    act(() => type(input(), 'curl'))
    expect(clear().getAttribute('aria-label')).toBe('Clear')
    expect(Number(count().textContent)).toBeGreaterThan(0)
    expect(rows()).toBe(Math.min(40, Number(count().textContent)))
    act(() => clear().click())
    expect(input().value).toBe('')
    expect(clear()).toBeNull()
    expect(count()).toBeNull()
    act(() => { chipByText(host, 'upper arms').click() })
    expect(count()).toBeTruthy()
    expect(clear()).toBeNull()
  })
})

// #553: Stats' untrained muscles open the explorer on that muscle.
describe('MuscleExplorer opened on a muscle', () => {
  it('starts with it chosen and its exercises listed', () => {
    // initial 传具体细束 id：'biceps' 是 slug，会展开成整组、走「已选 N 处肌肉」分支；
    // 单个细束才保持 picked.length===1 并显示 'Exercises for {细束名}'。
    const host = render({ initial: 'biceps_brachii_long__L', onDetail: vi.fn() })
    expect(isOn(muscleChip(host, 'Biceps'))).toBe(true)
    expect(host.textContent).toContain('Exercises for Long Head of Biceps')
  })
})

// #669: the Add exercise picker's "By muscle" lost the Favourites chip its list view has.
describe('MuscleExplorer Favourites chip', () => {
  it('lists the favourites that train the chosen muscle', async () => {
    const { EXDB } = await import('../lib/exercises.js')
    const { musclesOf } = await import('../lib/muscles.js')
    const curl = EXDB.find(e => musclesOf(e).biceps === 1)
    const press = EXDB.find(e => !musclesOf(e).biceps && e.bp === 'chest')
    mocks.S.favEx = [curl.id, press.id]
    const onPick = vi.fn()
    const host = render({ onPick })
    act(() => { muscleChip(host, 'Biceps').click() })
    const fav = muscleChip(host, 'Favourites')
    expect(fav, 'a Favourites chip next to All').toBeTruthy()
    expect(fav.textContent).toContain('(1)')
    act(() => { fav.click() })
    expect(isOn(muscleChip(host, 'Favourites'))).toBe(true)
    const rows = [...host.querySelectorAll('.list .item')]
    expect(rows).toHaveLength(1)
    act(() => { rows[0].querySelector('.tap-main').click() })
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: curl.id }))
    act(() => { chipByText(host, 'All').click() })
    expect(host.querySelectorAll('.list .item').length).toBeGreaterThan(1)
  })

  it('is not there without favourites', () => {
    const host = render({ onPick: vi.fn() })
    act(() => { muscleChip(host, 'Biceps').click() })
    expect(muscleChip(host, 'Favourites')).toBeUndefined()
  })
})

// 1.4.8: precise academic names + multi-select on the Muscles page (/muscles → MuscleExplorer
// → BodyMap3D). enableMulti is opt-in, so every existing caller that omits it keeps the old
// single-select behaviour; only Muscles.jsx passes it.
describe('MuscleExplorer academic names + multi-select (1.4.8)', () => {
  it('single-select behaviour is unchanged when enableMulti is not passed', () => {
    const host = render()
    act(() => { muscleChip(host, 'Pectorals').click() })
    expect(isOn(muscleChip(host, 'Pectorals'))).toBe(true)
    act(() => { muscleChip(host, 'Deltoids').click() })
    expect(isOn(muscleChip(host, 'Pectorals'))).toBe(false)
    expect(isOn(muscleChip(host, 'Deltoids'))).toBe(true)
  })

  it('shows academic Chinese names on chips, not the colloquial ones', () => {
    mocks.S = { ...mocks.S, lang: 'zh' }
    const host = render({ enableMulti: true })
    expect(muscleChip(host, '胸大肌'), '应显示胸大肌').toBeTruthy()
    expect(muscleChip(host, '三角肌'), '应显示三角肌').toBeTruthy()
    expect(muscleChip(host, '胸部'), '不应再显示口语名 胸部').toBeUndefined()
    expect(muscleChip(host, '肩部'), '不应再显示口语名 肩部').toBeUndefined()
  })

  it('shows English academic names when the language is en', () => {
    mocks.S = { ...mocks.S, lang: 'en' }
    const host = render({ enableMulti: true })
    expect(muscleChip(host, 'Pectorals'), '应显示 Pectorals').toBeTruthy()
  })

  it('exposes a 多选 switch; two chips can stay on; Clear empties all', () => {
    const host = render({ enableMulti: true })
    const toggle = [...host.querySelectorAll('.chip')].find(b => b.textContent.includes('多选'))
    expect(toggle, '多选开关应存在').toBeTruthy()
    act(() => { toggle.click() })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')

    act(() => { muscleChip(host, 'Pectorals').click() })
    act(() => { muscleChip(host, 'Deltoids').click() })
    expect(isOn(muscleChip(host, 'Pectorals'))).toBe(true)
    expect(isOn(muscleChip(host, 'Deltoids'))).toBe(true)

    const clearBtn = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Clear selection'))
    expect(clearBtn, 'Clear selection 按钮应存在').toBeTruthy()
    act(() => { clearBtn.click() })
    expect(isOn(muscleChip(host, 'Pectorals'))).toBe(false)
    expect(isOn(muscleChip(host, 'Deltoids'))).toBe(false)
  })
})
