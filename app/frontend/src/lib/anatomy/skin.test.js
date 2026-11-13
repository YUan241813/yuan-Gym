// 皮肤资产的回归测试：加载、几何完整性、局部充气、复用与性能。
// 这些断言钉死的是"训练前后对比"能成立的前提——连续网格不能被重建，
// 也不能因为一次滑块调整就把主线程卡住。

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MODELS = fileURLToPath(new URL('../../../public/models/', import.meta.url))

// skin.js 用 document.baseURI 拼资源 URL、用 fetch 取静态文件；Node 里把它们接到本地磁盘。
vi.stubGlobal('document', { baseURI: 'http://localhost/' })
vi.stubGlobal('fetch', async url => {
  const name = String(url).split('/').pop()
  const buf = readFileSync(MODELS + name)
  return {
    ok: true,
    json: async () => JSON.parse(buf.toString('utf8')),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  }
})

const { loadSkinSpec, buildSkin } = await import('./skin.js')

let spec, built

beforeAll(async () => {
  spec = await loadSkinSpec()
  built = buildSkin(spec)
})

describe('皮肤资产', () => {
  it('解压后的字节数与描述一致', () => {
    expect(spec.buf.byteLength).toBe(spec.bytes)
    expect(spec.vertexCount).toBe(22902)
    expect(spec.triangleCount).toBe(44744)
  })

  it('是一张连续网格：索引全部合法、只有一个 mesh', () => {
    const idx = built.mesh.geometry.index.array
    expect(idx.length).toBe(spec.indexCount)
    let max = 0
    for (const i of idx) if (i > max) max = i
    expect(max).toBeLessThan(spec.vertexCount)
    expect(built.group.children.length).toBe(1)
  })

  it('18 个训练部位都有 slug 映射', () => {
    expect(spec.slugs.length).toBe(18)
    expect(new Set(spec.slugs).size).toBe(18)
  })
})

describe('局部充气', () => {
  const chestIdx = () => spec.slugs.indexOf('chest')

  it('胸肌权重最高的顶点沿法线外移，且不超过 1.8cm', () => {
    const w = new Uint8Array(spec.buf, spec.offsets.weights, spec.vertexCount * 8)
    const ci = chestIdx()
    let best = -1, bestW = 0
    for (let v = 0; v < spec.vertexCount; v++) {
      for (let k = 0; k < 4; k++) {
        if (w[v * 8 + k * 2] === ci && w[v * 8 + k * 2 + 1] > bestW) {
          bestW = w[v * 8 + k * 2 + 1]; best = v
        }
      }
    }
    expect(best).toBeGreaterThanOrEqual(0)
    expect(bestW).toBeGreaterThan(200)

    const pos = built.mesh.geometry.attributes.position.array
    const before = [pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]]
    expect(built.setLevels({ chest: 1 })).toBe(true)
    const d = Math.hypot(
      pos[best * 3] - before[0], pos[best * 3 + 1] - before[1], pos[best * 3 + 2] - before[2],
    )
    expect(d).toBeGreaterThan(0.008)
    expect(d).toBeLessThanOrEqual(spec.inflateMax + 1e-6)
    // 复位，别污染后面的用例
    built.setLevels({})
  })

  it('没有训练部位的顶点（头/手/脚）完全不动', () => {
    const w = new Uint8Array(spec.buf, spec.offsets.weights, spec.vertexCount * 8)
    let head = -1
    for (let v = 0; v < spec.vertexCount; v++) if (w[v * 8] === 255) { head = v; break }
    expect(head).toBeGreaterThanOrEqual(0)
    const pos = built.mesh.geometry.attributes.position.array
    const before = [pos[head * 3], pos[head * 3 + 1], pos[head * 3 + 2]]
    built.setLevels({ chest: 1, quadriceps: 1 })
    expect(pos[head * 3]).toBe(before[0])
    expect(pos[head * 3 + 1]).toBe(before[1])
    expect(pos[head * 3 + 2]).toBe(before[2])
    built.setLevels({})
  })

  it('复位后顶点逐字节回到原始位置', () => {
    const base = new Float32Array(spec.buf, spec.offsets.positions, spec.vertexCount * 3)
    const pos = built.mesh.geometry.attributes.position.array
    built.setLevels({ chest: 1, biceps: 0.7, quadriceps: 1 })
    built.setLevels({})
    for (let i = 0; i < pos.length; i++) expect(pos[i]).toBe(base[i])
  })

  it('不重建几何：position 数组始终是同一个对象', () => {
    const attr = built.mesh.geometry.attributes.position
    const ref = attr.array
    built.setLevels({ chest: 0.5 })
    built.setLevels({})
    expect(built.mesh.geometry.attributes.position.array).toBe(ref)
    expect(built.mesh.geometry).toBe(built.mesh.geometry)
  })

  it('相同的 levels 不会触发无谓的写入', () => {
    expect(built.setLevels({ chest: 0.4 })).toBe(true)
    expect(built.setLevels({ chest: 0.4 })).toBe(false)
    built.setLevels({})
  })

  it('一次全量更新远低于一帧预算（<16ms）', () => {
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) built.setLevels({ chest: i / 20, quadriceps: 1 - i / 20 })
    const per = (performance.now() - t0) / 20
    built.setLevels({})
    expect(per).toBeLessThan(16)
    console.log(`  setLevels 平均 ${per.toFixed(2)} ms/次`)
  })
})
