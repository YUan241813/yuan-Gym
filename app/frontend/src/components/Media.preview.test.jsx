// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Minimal store mock: figure defaults to male, full-size media.
const mocks = vi.hoisted(() => {
  const state = { S: { gifSize: 'full' } }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const n = structuredClone(state.S); mut(n); state.S = n },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})

// IntersectionObserver that reports "intersecting" immediately, so the preview upgrades to the
// clip while the test renders (mirrors a card scrolled into view).
class IO {
  constructor(cb) { this.cb = cb }
  observe(el) { this.cb([{ isIntersecting: true, target: el }]) }
  unobserve() {}
  disconnect() {}
}

const { MediaPreview } = await import('./Media.jsx')

let host, root
beforeEach(() => {
  globalThis.IntersectionObserver = IO
  window.IntersectionObserver = IO
  window.happyDOM?.settings && (window.happyDOM.settings.disableIframePageLoading = true)
  mocks.S = { gifSize: 'full' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = props => act(() => root.render(<MediaPreview {...props} />))

describe('MediaPreview', () => {
  it('overlays the looping clip (not just the still) for an in-view card that has media', () => {
    const ex = { id: 'bench', n: 'bench press', gif: 'bench.mp4', img: 'bench.jpg' }
    mount({ ex })
    const wrap = host.querySelector('.ex-preview')
    expect(wrap).toBeTruthy()
    // the still is the base layer…
    expect(wrap.querySelector('.thumb')).toBeTruthy()
    // …and the animation clip is layered on top, pointing at exercise-media/clip
    const clip = wrap.querySelector('.ex-preview-clip')
    expect(clip).toBeTruthy()
    expect(clip.getAttribute('src')).toContain('exercise-media/clip')
    // exercise-media/clip is the animation; exercise-media/still is the fallback
    expect(clip.getAttribute('src')).not.toContain('exercise-media/still')
  })

  it('falls through to the neutral tile when the exercise has no media at all', () => {
    const ex = { id: 'x', n: 'nothing', gif: null, img: null }
    mount({ ex })
    // no .ex-preview wrapper with a clip; the neutral thumb stands in
    expect(host.querySelector('.ex-preview-clip')).toBeNull()
    expect(host.querySelector('.thumb-x')).toBeTruthy()
  })

  it('does not request the clip when the exercise has no gif field', () => {
    const ex = { id: 'y', n: 'still only', gif: null, img: 'y.jpg' }
    mount({ ex })
    expect(host.querySelector('.ex-preview-clip')).toBeNull()
  })
})
