// yuan-Gym — the body profile that drives the 3D model and the plan engine.
//
// Kept in the app's own storage under a versioned key and read through one small store, so
// every surface (anatomy, planner, AI prompt) sees the same numbers and a change on one
// screen is visible on the next without a reload.

const KEY = 'yuangym_anatomy_v1'

export const EMPTY_PROFILE = {
  sex: 'male',
  age: null,
  height: 175,
  weight: 70,
  bodyFat: null,
  chest: null,
  waist: null,
  arm: null,
  thigh: null,
  experience: '新手（不足 1 年）',
  goal: 'hypertrophy',
  days: 4,
  minutes: 60,
  equipment: 'full',
  weak: [],
}

const listeners = new Set()
let cache = null

function read() {
  if (cache) return cache
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    cache = { ...EMPTY_PROFILE, ...raw }
  } catch {
    cache = { ...EMPTY_PROFILE }
  }
  return cache
}

function write(next) {
  cache = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: this session only */ }
  listeners.forEach(fn => fn(next))
}

export function getProfile() {
  return read()
}

export function updateProfile(patch) {
  write({ ...read(), ...patch })
  return read()
}

export function subscribeProfile(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// React binding kept dependency-free on purpose (this runs inside the big app bundle).
import { useEffect, useState } from 'react'

export function useAnatomyProfile() {
  const [profile, setProfile] = useState(read)
  useEffect(() => subscribeProfile(setProfile), [])
  return [profile, updateProfile]
}

/** Only the fields the model actually reshapes on, so unrelated edits do not rebuild geometry. */
export const shapeKey = p => [p.sex, p.height, p.weight, p.bodyFat, p.chest, p.waist, p.arm, p.thigh].join('|')
