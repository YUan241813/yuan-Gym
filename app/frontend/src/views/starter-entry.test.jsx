// @vitest-environment happy-dom
// 1-B: Home's empty state now only nudges you to build your own plan — Plan is the remaining
// entry that offers the starter plan. Plan used to wire the button straight to the loader,
// which quietly handed the click event in as the plan id and loaded nothing at all, so that
// entry point stays pinned here alongside Home's new "no blind load" shape.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { starterPlanSheet } from '../sheets.jsx'
import Home from './Home.jsx'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), bwSheet: vi.fn(), goalSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  calendarSheet: vi.fn(), startFlow: vi.fn(), bwDeltaColor: () => '', weighInsSheet: vi.fn(),
  dayAssignSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  starterPlanSheet.mockClear()
  useStore.setState(s => ({ S: { ...s.S, routines: [], week: {}, active: null }, user: null }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const starterButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Load starter plan')
const buildOwnButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Build my own plan')

describe.each([['Home', Home], ['Plan', Plan]])('%s empty state', (name, View) => {
  // 1-B 后只有 Plan 还保留 "Load starter plan" 入口；Home 空状态已改成只引导自建。
  if (name === 'Plan') {
    it('opens the starter plan chooser instead of loading one plan blind', () => {
      act(() => root.render(<View />))
      const button = starterButton()
      expect(button).toBeTruthy()

      act(() => { button.click() })
      expect(starterPlanSheet).toHaveBeenCalledTimes(1)
    })
  }

  it('drops the offer once the user has routines', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'r', name: 'Mine', emoji: 'star', ex: [] }] } }))
    act(() => root.render(<View />))
    expect(starterButton()).toBeFalsy()
  })
})

// 1-B: Home no longer loads a starter plan blind — it only offers to build your own.
describe('Home empty state after 1-B', () => {
  it('has no "Load starter plan" button and offers "Build my own plan" instead', () => {
    act(() => root.render(<Home />))
    expect(starterButton()).toBeFalsy()
    expect(buildOwnButton()).toBeTruthy()
  })
})
