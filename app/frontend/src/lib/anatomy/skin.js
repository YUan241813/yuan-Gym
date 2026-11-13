// 皮肤外壳：BodyParts3D 4.0 的一张连续人体网格（22,902 顶点 / 44,744 三角面）。
//
// 替换掉旧的分段放样实现。旧实现每段各自封口，肩/肘/髋/膝必然出现台阶与断缝；
// 这里是一整张流形网格，天然无缝，且坐标与 Écorché 完全同一套（米制、Y-up、脚底 0）。
//
// 充气（训练前后对比）：离线已为每个皮肤顶点烘焙好 top-4 训练部位权重（见
// build-skin-from-atlas.mjs）。运行时 setLevels 只做一次线性扫描，沿顶点法线外推
// 至多 1.8cm，不重建几何、不重算法线，也不会在关节处裂开。权重是空间平滑的，
// 所以相邻部位之间过渡连续。
//
// 资产：public/models/ecorche-skin.json（描述）+ ecorche-skin.bin（gzip 打包的
// Float32 顶点 / Int16 法线 / Uint32 索引 / Uint8 权重）。注意后缀故意不用 .gz——
// 静态服务器看到 .gz 会自动加 Content-Encoding 并提前解压，浏览器里再解压就会失败。
//
// 许可：CC BY 4.0，署名见 design/anatomy-model/tools/third_party/ATTRIBUTION.md
// 与解剖页界面。

import * as THREE from 'three'
import { gunzipSync } from 'fflate'

const asset = name => new URL('models/' + name, document.baseURI).href

let cache = null

/** 拉取并解压皮肤资产（一次，之后所有人体实例共享同一份只读 buffer）。 */
export async function loadSkinSpec() {
  if (cache) return cache
  const [desc, packed] = await Promise.all([
    fetch(asset('ecorche-skin.json')).then(r => {
      if (!r.ok) throw new Error(`皮肤描述读取失败 (${r.status})`)
      return r.json()
    }),
    fetch(asset('ecorche-skin.bin')).then(r => {
      if (!r.ok) throw new Error(`皮肤数据读取失败 (${r.status})`)
      return r.arrayBuffer()
    }),
  ])
  const bytes = gunzipSync(new Uint8Array(packed))
  // fflate 可能返回带 offset 的视图；切出干净的 ArrayBuffer 供 TypedArray 零拷贝使用
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  if (buf.byteLength !== desc.bytes) {
    throw new Error(`皮肤数据长度不符：${buf.byteLength} ≠ ${desc.bytes}`)
  }
  cache = { ...desc, buf }
  return cache
}

/**
 * 用一份共享资产构建皮肤实体。每次调用产生独立的 position 副本（因为每个
 * 人体实例的充气程度可能不同），但索引/法线/权重只读共享。
 * 返回 { group, mesh, materials, segments, setLevels, dispose }
 */
export function buildSkin(spec, { levels = {} } = {}) {
  const { buf, offsets, slugs, vertexCount: n, indexCount, inflateMax = 0.018 } = spec
  const base = new Float32Array(buf, offsets.positions, n * 3)
  const rawNrm = new Int16Array(buf, offsets.normals, n * 3)
  const weights = new Uint8Array(buf, offsets.weights, n * 8)
  const indices = new Uint32Array(buf, offsets.indices, indexCount)

  const pos = new Float32Array(base)               // 可写副本
  const normals = new Float32Array(n * 3)         // int16 归一化 → float
  for (let i = 0; i < normals.length; i++) normals[i] = rawNrm[i] / 32767

  const geo = new THREE.BufferGeometry()
  const posAttr = new THREE.BufferAttribute(pos, 3)
  geo.setAttribute('position', posAttr)
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1))
  geo.computeBoundingSphere()

  const mat = new THREE.MeshStandardMaterial({
    color: 0xd8b09a,
    roughness: 0.62,
    metalness: 0.02,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'skin'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const group = new THREE.Group()
  group.name = 'ecorche-skin'
  group.add(mesh)

  const target = new Float32Array(slugs.length)
  let applied = new Float32Array(slugs.length).fill(-1)

  function setLevels(next = {}) {
    let changed = false
    for (let s = 0; s < slugs.length; s++) {
      const v = Math.max(0, Math.min(1, Number(next[slugs[s]]) || 0))
      if (Math.abs(v - applied[s]) > 1e-4) changed = true
      target[s] = v
    }
    if (!changed) return false
    applied.set(target)

    for (let v = 0; v < n; v++) {
      const o = v * 3, w = v * 8
      let level = 0
      for (let k = 0; k < 4; k++) {
        const s = weights[w + k * 2]
        if (s === 255 || s >= slugs.length) continue
        level += (weights[w + k * 2 + 1] / 255) * target[s]
      }
      const d = inflateMax * Math.min(1, level)
      pos[o] = base[o] + normals[o] * d
      pos[o + 1] = base[o + 1] + normals[o + 1] * d
      pos[o + 2] = base[o + 2] + normals[o + 2] * d
    }
    posAttr.needsUpdate = true
    geo.computeBoundingSphere()
    // 不重算法线：最大位移仅 1.8cm，沿原法线方向的形变对光照的影响肉眼不可辨，
    // 而 computeVertexNormals 要遍历 44,744 个面，滑块拖动时会明显掉帧。
    return true
  }

  setLevels(levels)

  const segments = slugs.map((slug, i) => ({
    id: slug,
    slugs: [slug],
    mesh: null,
    scale: () => applied[i],
  }))

  return {
    group,
    mesh,
    materials: { skin: mat },
    segments,
    setLevels,
    dispose: () => { geo.dispose(); mat.dispose() },
  }
}
