// The seam between "any 3D model" and the anatomy canvas. These tests pin the contract
// BodyModel3D relies on, so a replacement model is caught by the test suite instead of by
// a blank screen on someone's phone.

import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { normalizeBuiltModel, slugOf, MUSCLE_BASE } from './normalize.js'
import { PICKABLE_MUSCLES, buildBody } from './index.js'

/** A box standing in for one muscle. Height in model units, feet of the box at `y`. */
function part(name, { y = 0, height = 1, z = 0, color = 0x334455, material } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, height, 0.1), material || new THREE.MeshBasicMaterial({ color }))
  mesh.name = name
  mesh.position.set(0, y, z)
  return mesh
}

describe('slugOf', () => {
  it('reads plain slugs', () => {
    expect(slugOf('chest')).toBe('chest')
    expect(slugOf('upper-back')).toBe('upper-back')
    expect(slugOf('hip-flexors')).toBe('hip-flexors')
  })

  it('reads the names modelling tools actually produce', () => {
    expect(slugOf('Biceps_L')).toBe('biceps')
    expect(slugOf('quadriceps.001')).toBe('quadriceps')
    expect(slugOf('triceps-right')).toBe('triceps')
    expect(slugOf('Muscle_Chest')).toBe('chest')
    expect(slugOf('deltoids 2')).toBe('deltoids')
  })

  it('reads the Chinese and English labels from muscle-facts', () => {
    expect(slugOf('肱三头肌')).toBe('triceps')
    expect(slugOf('Pectorals')).toBe('chest')
  })

  it('does not eat a slug that simply ends in l', () => {
    expect(slugOf('gluteal')).toBe('gluteal')
  })

  it('returns null for things that are not muscles', () => {
    expect(slugOf('Cube')).toBeNull()
    expect(slugOf('')).toBeNull()
    expect(slugOf(undefined)).toBeNull()
  })
})

describe('normalizeBuiltModel', () => {
  it('registers meshes by slug and tags the side of the body they belong to', () => {
    const root = new THREE.Group()
    root.add(part('chest', { y: 1.4, height: 0.3 }))
    root.add(part('upper-back', { y: 1.4, height: 0.3 }))
    root.add(part('Cube', { y: 1.0, height: 0.5 }))

    const built = normalizeBuiltModel({ root, autoFit: false })

    expect(Object.keys(built.muscleMeshes).sort()).toEqual(['chest', 'upper-back'])
    expect(built.muscleMeshes.chest[0].userData.muscle).toBe('chest')
    expect(built.muscleMeshes.chest[0].userData.facing).toBe('front')
    expect(built.muscleMeshes['upper-back'][0].userData.facing).toBe('back')
    expect(built.pickMeshes).toHaveLength(2)
  })

  it('makes every muscle material glow-capable, keeping the original colour', () => {
    const root = new THREE.Group()
    root.add(part('abs', { material: new THREE.MeshLambertMaterial({ color: 0x123456 }) }))

    const built = normalizeBuiltModel({ root, autoFit: false })
    const mat = built.muscleMeshes.abs[0].material

    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(mat.color.getHex()).toBe(0x123456)
    expect(mat.emissive.getHex()).toBe(0x000000)
  })

  it('hides and un-picks the far side in the chart view', () => {
    const root = new THREE.Group()
    root.add(part('chest', { y: 1.4, height: 0.3 }))
    root.add(part('upper-back', { y: 1.4, height: 0.3 }))

    const front = normalizeBuiltModel({ root, half: 'front', autoFit: false })

    expect(front.muscleMeshes.chest[0].visible).toBe(true)
    expect(front.muscleMeshes['upper-back'][0].visible).toBe(false)
    expect(front.pickMeshes.map(m => m.userData.muscle)).toEqual(['chest'])
    // Both are still addressable, so heat and selection do not throw on the hidden side.
    expect(front.muscleMeshes['upper-back']).toHaveLength(1)
  })

  it('respects a restricted pick list', () => {    const root = new THREE.Group()
    root.add(part('chest', { y: 1.4, height: 0.3 }))
    root.add(part('biceps', { y: 1.2, height: 0.3 }))

    const built = normalizeBuiltModel({ root, pickable: ['chest'], autoFit: false })

    expect(built.pickMeshes.map(m => m.userData.muscle)).toEqual(['chest'])
    expect(built.muscleMeshes.biceps).toHaveLength(1)
  })

  it('accepts an explicit name map for models whose meshes are named "Object_12"', () => {
    const root = new THREE.Group()
    root.add(part('Object_12', { y: 1.4, height: 0.3 }))
    root.add(part('Object_13', { y: 1.2, height: 0.3 }))

    const built = normalizeBuiltModel({ root, autoFit: false, nameMap: { Object_12: 'chest', Object_13: 'biceps' } })

    expect(built.muscleMeshes.chest[0].name).toBe('Object_12')
    expect(built.muscleMeshes.biceps[0].name).toBe('Object_13')
    expect(built.pickMeshes).toHaveLength(2)
  })

  it('scales an off-unit model to the app height and stands it on the floor', () => {
    // Authored 180 units tall with its feet at y = 0 but shifted on x/z, the way a Blender
    // export often arrives.
    const root = new THREE.Group()
    const body = part('chest', { y: 90, height: 180 })
    body.position.x = 12
    body.position.z = -7
    root.add(body)

    const built = normalizeBuiltModel({ root, height: 1.8 })

    const box = new THREE.Box3().setFromObject(built.group)
    expect(box.max.y - box.min.y).toBeCloseTo(1.8, 3)
    expect(box.min.y).toBeCloseTo(0, 5)
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5)
  })

  it('always hands back a skin and a bones node, even when the model has neither', () => {
    const root = new THREE.Group()
    root.add(part('chest', { y: 1.4, height: 0.3 }))

    const built = normalizeBuiltModel({ root, autoFit: false })

    expect(built.skin).toBeInstanceOf(THREE.Object3D)
    expect(built.bones).toBeInstanceOf(THREE.Object3D)
    // The canvas dims the skin by setting opacity on this material.
    expect(typeof built.materials.skin.opacity).toBe('number')
    expect(built.custom).toBe(true)
  })
})

describe('the facade', () => {
  it('falls back to the built-in figure while no custom model is configured', () => {
    const built = buildBody({ profile: {}, gender: 'male', half: 'all' })

    expect(built.custom).toBeUndefined()
    expect(built.muscleMeshes.chest.length).toBeGreaterThan(0)
    // The canvas raycasts this flat list.
    expect(built.pickMeshes.length).toBeGreaterThan(0)
    expect(built.pickMeshes.every(m => m.userData.muscle)).toBe(true)
  })

  it('exposes the 18 pickable muscles the pages talk about', () => {
    expect(PICKABLE_MUSCLES).toHaveLength(18)
    expect(PICKABLE_MUSCLES).toContain('chest')
    expect(PICKABLE_MUSCLES).toContain('tibialis')
  })

  it('keeps the muscle base colour in step with the canvas', () => {
    expect(MUSCLE_BASE).toBe(0xb84a42)
  })
})
