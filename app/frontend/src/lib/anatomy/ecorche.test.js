// The Écorché decode, checked against the shipped asset rather than a fixture: if the
// packing ever changes, this fails before the anatomy page goes blank on a phone.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'fflate'
import { decodeEcorche } from './ecorche.js'

const meta = JSON.parse(readFileSync(new URL('../../../public/models/ecorche.json', import.meta.url), 'utf8'))
const gz = new Uint8Array(readFileSync(new URL('../../../public/models/ecorche-male.bin', import.meta.url)))
const data = decodeEcorche(meta, gz)

describe('decodeEcorche', () => {
  it('inflates to exactly the byte count the gzip trailer promises', () => {
    const isize = gz[gz.length - 4] | (gz[gz.length - 3] << 8) | (gz[gz.length - 2] << 16) | (gz[gz.length - 1] << 24)
    expect(gunzipSync(gz).length).toBe(isize >>> 0)
  })

  it('yields one mesh per training part', () => {
    // 18 个训练部位（见 muscle-facts.js）之外，图谱还带了 foot/neck/face 三块仅用于显示的网格，
    // 所以部件数 = 21；用「>= 18 且 18 个训练部位齐全」表达契约，比写死数字更抗改动。
    const TRAINING = ['trapezius', 'deltoids', 'chest', 'upper-back', 'serratus', 'biceps',
      'triceps', 'forearm', 'abs', 'obliques', 'lower-back', 'gluteal', 'quadriceps',
      'hamstring', 'adductors', 'hip-flexors', 'calves', 'tibialis']
    expect(data.parts.size).toBeGreaterThanOrEqual(18)
    for (const slug of TRAINING) expect(data.parts.has(slug)).toBe(true)
    for (const slug of data.parts.keys()) {
      expect(typeof slug).toBe('string')
      expect(slug).not.toBe('_bone')
    }
  })

  it('lands the body at life size, feet on the floor, facing +Z', () => {
    // Height and floor contact are what the camera framing assumes.
    expect(data.height).toBeGreaterThan(1.6)
    expect(data.height).toBeLessThan(1.8)
    expect(data.box.min.y).toBeGreaterThan(-0.02)
    expect(data.box.min.y).toBeLessThan(0.03)
    // Arms hang at the sides: the widest axis is x, not z.
    expect(data.box.max.x - data.box.min.x).toBeGreaterThan(data.box.max.z - data.box.min.z)
    expect(data.box.max.z).toBeGreaterThan(0.05)
  })

  it('keeps every muscle bundle addressable through its triangle range', () => {
    let triangles = 0
    for (const [slug, part] of data.parts) {
      const tris = part.geo.index.count / 3
      triangles += tris
      expect(tris).toBeGreaterThan(0)
      expect(part.units.length).toBeGreaterThan(0)

      let cursor = 0
      for (const u of part.units) {
        // Ranges must tile the buffer with no gaps, or a tap could hit nothing.
        expect(u.start).toBe(cursor)
        expect(u.count).toBeGreaterThan(0)
        expect(u.cn).toBeTruthy()
        cursor += u.count
      }
      expect(cursor).toBe(tris)

      // The canvas reads all three attributes; a missing one is an invisible mesh.
      expect(part.geo.attributes.position.count).toBeGreaterThan(0)
      expect(part.geo.attributes.normal.count).toBe(part.geo.attributes.position.count)
      expect(part.geo.attributes.position.itemSize).toBe(3)
    }
    expect(triangles).toBeGreaterThan(500_000)
  })

  it('decodes positions in metres, not quantised units', () => {
    const chest = data.parts.get('chest')
    const pos = chest.geo.attributes.position.array
    // A chest sits between half a metre and the top of the head.
    let min = Infinity
    let max = -Infinity
    for (let i = 1; i < pos.length; i += 3) {
      if (pos[i] < min) min = pos[i]
      if (pos[i] > max) max = pos[i]
    }
    expect(min).toBeGreaterThan(0.6)
    expect(max).toBeLessThan(1.8)
  })

  it('carries the skeleton as its own layer', () => {
    expect(data.bone).toBeTruthy()
    expect(data.bone.geo.index.count / 3).toBeGreaterThan(100_000)
  })
})

// 男女共用一份 ecorche.json（拓扑逐字节相同，见 scripts/import-atlas.mjs 的构建期断言），
// 只有几何 bin 不同。这里锁住两件事：女版能独立解码，且与男版确实是两具不同的身体 ——
// 否则 build() 里那个「没把 per-sex data 传下去就回退 cache.male」的回归会悄悄回来。
describe('decodeEcorche (female)', () => {
  const gzFemale = new Uint8Array(readFileSync(new URL('../../../public/models/ecorche-female.bin', import.meta.url)))
  const female = decodeEcorche(meta, gzFemale)

  it('decodes the female body with the skeleton intact', () => {
    expect(female.bone).toBeTruthy()
    expect(female.bone.geo.index.count / 3).toBeGreaterThan(100_000)
    expect(female.parts.size).toBe(data.parts.size)
    for (const [slug, part] of female.parts) {
      expect(data.parts.has(slug)).toBe(true)
      expect(part.units.length).toBeGreaterThan(0)
      let cursor = 0
      for (const u of part.units) {
        expect(u.start).toBe(cursor)
        cursor += u.count
      }
      expect(cursor).toBe(part.geo.index.count / 3)
    }
  })

  it('is a distinct body from the male one, not the same geometry', () => {
    // Same topology, different vertex positions: the female figure is shorter.
    expect(female.height).toBeLessThan(data.height - 0.05)
    // And the vertices themselves differ (positions are in metres here).
    const a = data.parts.get('chest').geo.attributes.position.array
    const b = female.parts.get('chest').geo.attributes.position.array
    expect(b.length).toBe(a.length)
    let differ = 0
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) differ++
    expect(differ).toBeGreaterThan(a.length * 0.2)
  })
})
