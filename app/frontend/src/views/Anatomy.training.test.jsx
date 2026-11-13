// @vitest-environment happy-dom
// The /anatomy page: the training-effect slider and the before/after comparison are gone
// (2026-11: the page is muscle selection only — the model must keep its natural shape).
// BodyModel3D is a stub: WebGL is not available here, what matters is the props the page
// hands it (no levels inflation, no compareProfile ghost).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { seen } = vi.hoisted(() => ({ seen: [] }))
vi.mock('../components/BodyModel3D.jsx', () => ({
  default: props => { seen.push(props); return null },
}))

import Anatomy from './Anatomy.jsx'

let root, host
const render = (entry = '/anatomy') => {
  act(() => root.render(
    <MemoryRouter initialEntries={[entry]}><Anatomy /></MemoryRouter>,
  ))
}
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const lastProps = () => seen[seen.length - 1]

/** The muscles live inside the WebGL canvas, which is stubbed here: call the same onToggle
 *  callback the real model would fire when the user taps a muscle, in multi-select mode. */
function select(...slugs) {
  act(() => btn('多选').click())
  for (const slug of slugs) act(() => lastProps().onToggle(slug))
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  seen.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('前后对比已移除', () => {
  it('不再有锻炼效果滑块 / 体态快照 / 关闭对比', () => {
    render()
    expect(host.querySelector('input[type="range"]')).toBeNull()
    expect(btn('锻炼效果')).toBeUndefined()
    expect(btn('体态快照')).toBeUndefined()
    expect(btn('记录当前体态')).toBeUndefined()
    expect(host.textContent).not.toContain('蓝色线框')
    expect(host.textContent).not.toContain('关闭对比')
  })

  it('模型拿到的是原始体态：没有 levels 充气，也没有 compareProfile 幽灵', () => {
    render()
    expect(lastProps().levels).toBeUndefined()
    expect(lastProps().compareProfile).toBeUndefined()
  })

  it('多选肌肉照常工作，选中部位不再充气', () => {
    render()
    select('chest', 'biceps')
    expect(lastProps().selected).toEqual(expect.arrayContaining(['chest', 'biceps']))
    expect(lastProps().levels).toBeUndefined()
    expect(lastProps().multi).toBe(true)
  })
})
