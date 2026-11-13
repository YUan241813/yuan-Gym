// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { setBodySex } from './body-sex.js'
import { useStore } from '../store/useStore.js'
import { getProfile } from './anatomy-profile.js'

// setBodySex is the single writer for "which sex": it must keep S.body (recommendations,
// figure) and profile.sex (3D model geometry) in lockstep, or the model and the exercise
// list would disagree about the user's sex.
describe('setBodySex', () => {
  afterEach(() => { setBodySex('male') })

  it('moves both S.body and profile.sex to male', () => {
    setBodySex('male')
    expect(useStore.getState().S.body).toBe('male')
    expect(getProfile().sex).toBe('male')
  })

  it('moves both S.body and profile.sex to female', () => {
    setBodySex('female')
    expect(useStore.getState().S.body).toBe('female')
    expect(getProfile().sex).toBe('female')
  })

  it('normalizes any non-female value to male', () => {
    setBodySex('female')
    setBodySex('whatever')
    expect(useStore.getState().S.body).toBe('male')
    expect(getProfile().sex).toBe('male')
  })

  it('keeps the two stores in lockstep on every write', () => {
    setBodySex('female')
    expect(useStore.getState().S.body).toBe(getProfile().sex)
    setBodySex('male')
    expect(useStore.getState().S.body).toBe(getProfile().sex)
  })
})
