// The Écorché body: 176 separately-authored muscle bundles, decoded from the source
// 图谱 the user built.
//
// Why a custom decoder instead of a .glb: the source ships ~450k vertices as quantised
// int16 deltas (0.1 mm units) inside a gzip, which is a third of the size a glTF of the
// same body would be. Keeping their packing means the APK carries 6.7 MB, not 30.
//
// Runtime shape: one mesh per *training part* (18 of them, see muscle-facts.js) rather
// than one per anatomical unit (176). 18 draw calls instead of 176 is the difference
// between a 60 fps page and a hand-warmer. The fine names are not lost — every unit keeps
// the triangle range it occupies inside that merged mesh, so a tap still resolves to
// "胸大肌上束" through `faceIndex` (see unitAt).
//
// Nothing here comes from the source file's own exercise recommendations: those were
// dropped when the assets were built (tools/build-app-assets.mjs). Recommendations come
// from the app's own catalogue, weighted by muscles.js.

import * as THREE from 'three'
import { gunzipSync } from 'fflate'
import { MUSCLE_FACTS } from '../muscle-facts.js'
import { loadSkinSpec, buildSkin } from './skin.js'
// 210 块最小解剖单位（经左右分离 + 漏分大肌补分段 → 432 个可独立点击单位）的权威数据表。
// 解码器只负责「几何定位」（哪段三角形对应哪个 unit id），展示信息（中英文/父级/示例动作）
// 全部从这里取，保证 3D 模型与 /muscles 页面的数据单一来源、永不漂移。
import { ATLAS_UNIT_BY_ID } from './atlas-groups.js'

// Mirrors BodyModel3D. Only the initial colour — the canvas repaints these every frame
// it has a heat or selection to show.
const MUSCLE_BASE = 0xb84a42
const BONE = 0x8fa6bd

const asset = name => new URL('models/' + name, document.baseURI).href

// The payload *is* gzip, but the file is deliberately not named ".gz": static servers
// (Vite's dev server among them) answer a .gz file with `Content-Encoding: gzip`, and the
// browser then inflates it for us — so fflate would be handed plain bytes and throw
// "invalid gzip data". The extension stays extensionless and we inflate it ourselves.

// Decoded, slug-level geometry, cached per sex so switching male↔female does not re-inflate
// 6 MB each time. Keyed by 'male' / 'female'.
const cache = {}

/** Decode one merged mesh: quantised deltas → float metres, plus the unit triangle map. */
function decodePart(raw, blocks, scale) {
  const verts = blocks.reduce((n, b) => n + b.verts, 0)
  const tris = blocks.reduce((n, b) => n + b.tris, 0)
  const pos = new Float32Array(verts * 3)
  const nor = new Int8Array(verts * 3)
  const idx = verts > 65535 ? new Uint32Array(tris * 3) : new Uint16Array(tris * 3)
  const units = []

  let vo = 0
  let io = 0
  for (const b of blocks) {
    const base = raw.byteOffset + b.offset

    // Positions are stored as a running delta: each vertex is relative to the one three
    // int16s earlier. Undo that in place, then scale to metres.
    const q = new Int16Array(raw.buffer, base + b.posOff, b.verts * 3)
    for (let i = 3; i < q.length; i++) q[i] += q[i - 3]
    for (let i = 0; i < q.length; i++) pos[vo * 3 + i] = q[i] * scale

    nor.set(new Int8Array(raw.buffer, base + b.norOff, b.verts * 3), vo * 3)

    const src = b.indexType === 16
      ? new Uint16Array(raw.buffer, base + b.idxOff, b.tris * 3)
      : new Uint32Array(raw.buffer, base + b.idxOff, b.tris * 3)
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo

    // Each block carries one or more independently-selectable units (segments). The segment's
    // start/count are *block-local* triangle offsets; add the block's global start so unitAt /
    // unitGeometry index the merged mesh directly. The rich display info (cn/en/parent/ex) comes
    // from ATLAS_UNIT_BY_ID so the 3D model and the search/explorer share one source of truth.
    const blockStart = io / 3
    const segs = (b.segments && b.segments.length)
      ? b.segments
      : [{ id: b.id, start: 0, count: b.tris, slug: b.slug }]
    for (const seg of segs) {
      const info = ATLAS_UNIT_BY_ID[seg.id]
      units.push({
        id: seg.id,
        start: blockStart + seg.start,
        count: seg.count,
        slug: seg.slug || b.slug,
        cn: info?.cn || b.cn,
        en: info?.en || b.en,
        parent: info?.parent || b.parent,
        fn: info?.fn || b.fn,
        label: info?.label || b.cn,
        side: info?.side || null,
        band: info?.band ?? 0,
        ex: info?.ex || null,
        tip: info?.tip || null,
      })
    }
    vo += b.verts
    io += b.tris * 3
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  // Int8 normals stay quantised: the GPU renormalises them, and 1.7 MB saved is 1.7 MB
  // of phone memory not spent.
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true))
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
  geo.computeBoundingBox()
  geo.computeBoundingSphere()
  return { geo, units }
}

async function load(gender = 'male') {
  const key = gender === 'female' ? 'female' : 'male'
  if (cache[key]) return cache[key]

  // Male and female share one ecorche.json but carry two geometry blobs; pick the right one.
  const binName = key === 'female' ? 'ecorche-female.bin' : 'ecorche-male.bin'
  const [meta, gz] = await Promise.all([
    fetch(asset('ecorche.json')).then(r => {
      if (!r.ok) throw new Error(`模型描述读取失败 (${r.status})`)
      return r.json()
    }),
    fetch(asset(binName)).then(r => {
      if (!r.ok) throw new Error(`模型数据读取失败 (${r.status})`)
      return r.arrayBuffer()
    }),
  ])

  const data = decodeEcorche(meta, new Uint8Array(gz))
  // The skin is optional: if its spec is missing the muscle-only view still works.
  try {
    data.skinSpec = await loadSkinSpec()
  } catch (err) {
    console.warn('[anatomy] 皮肤规格不可用，按纯肌肉模式显示：', err)
    data.skinSpec = null
  }
  cache[key] = data
  return data
}

/**
 * The whole decode, with the network taken out so it can be tested (and rendered offline)
 * from plain bytes. Returns slug → geometry, the bone layer, and the body's bounds.
 */
export function decodeEcorche(meta, gz) {
  // A server that "helpfully" inflated the file for us, or a truncated download.
  if (gz[0] !== 0x1f || gz[1] !== 0x8b) {
    throw new Error(`模型数据不是 gzip（首字节 ${gz[0]?.toString(16)} ${gz[1]?.toString(16)}），可能是静态服务器自动解压了`)
  }
  // Inflating 6.7 MB blocks the thread for a moment; there is no worker here because the
  // anatomy page is the only consumer and it shows a loader until this resolves.
  const raw = gunzipSync(gz)

  const bySlug = new Map()
  let boneBlocks = []
  for (const b of meta.blocks) {
    if (b.id === '_bone') { boneBlocks = [b]; continue }
    if (!b.slug) continue
    if (!bySlug.has(b.slug)) bySlug.set(b.slug, [])
    bySlug.get(b.slug).push(b)
  }

  const parts = new Map()
  for (const [slug, blocks] of bySlug) parts.set(slug, decodePart(raw, blocks, meta.scale))
  const bone = boneBlocks.length ? decodePart(raw, boneBlocks, meta.scale) : null

  // The body's own bounds: the figure is fitted to this, so the camera framing the rest of
  // the app uses (target y≈0.95) lands on the chest rather than the knees.
  const box = new THREE.Box3()
  for (const p of parts.values()) box.union(p.geo.boundingBox)
  if (bone) box.union(bone.geo.boundingBox)

  return { parts, bone, box, height: box.max.y - box.min.y }
}

/** The unit (fine anatomical name) under a tap, from the merged mesh's triangle index. */
export function unitAt(mesh, faceIndex) {
  const units = mesh.userData.units
  if (!units || faceIndex == null) return null
  // Ranges are ascending, so binary search rather than a scan per pointer-move.
  let lo = 0
  let hi = units.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const u = units[mid]
    if (faceIndex < u.start) hi = mid - 1
    else if (faceIndex >= u.start + u.count) lo = mid + 1
    else return u
  }
  return null
}

/**
 * A standalone mesh of one fine unit's triangles, lifted out of the merged mesh so a single
 * muscle bundle can be highlighted on its own (a tap on the anterior deltoid lights up only
 * the anterior deltoid, not the whole deltoid). The unit's triangle range is contiguous and
 * its vertices are contiguous too, so we can slice the position/normal buffers directly and
 * remap the index — no copy of the vertex data, just a small index array. Cached per
 * (geometry, unit id): building it is cheap but the highlight repaints on every selection.
 */
const unitGeoCache = new Map()
export function unitGeometry(baseGeo, unit) {
  if (!baseGeo || !unit) return null
  const key = baseGeo.uuid + ':' + unit.id
  const cached = unitGeoCache.get(key)
  if (cached) return cached
  const idx = baseGeo.index.array
  const start = unit.start * 3
  const end = (unit.start + unit.count) * 3
  let vmin = Infinity
  let vmax = -Infinity
  for (let i = start; i < end; i++) {
    const v = idx[i]
    if (v < vmin) vmin = v
    if (v > vmax) vmax = v
  }
  const pos = baseGeo.attributes.position.array
  const nor = baseGeo.attributes.normal.array
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(vmin * 3, (vmax + 1) * 3), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(vmin * 3, (vmax + 1) * 3), 3, true))
  const ni = idx.subarray(start, end).slice()
  for (let i = 0; i < ni.length; i++) ni[i] -= vmin
  g.setIndex(new THREE.BufferAttribute(ni, 1))
  g.computeBoundingSphere()
  unitGeoCache.set(key, g)
  return g
}


/** Every part that is on the requested side of the body. */
function facingOf(slug) {
  return MUSCLE_FACTS[slug]?.facing || 'front'
}

function build({ half = 'all', levels = {} } = {}, src = null) {
  // src is the per-sex decoded data handed down from loadEcorche(gender); fall back to a
  // cached body so a stray call without a source still draws something rather than nothing.
  const data = src || cache.male || Object.values(cache)[0] || null
  if (!data) return null

  const group = new THREE.Group()
  const muscleMeshes = {}
  const pickMeshes = []
  const muscleMats = []

  for (const [slug, part] of data.parts) {
    // Materials are per figure, not per slug: the chart view stands two figures side by
    // side and comparing them must not tint both.
    const mat = new THREE.MeshStandardMaterial({
      color: MUSCLE_BASE,
      roughness: 0.62,
      metalness: 0.06,
      emissive: 0x000000,
    })
    muscleMats.push(mat)
    const mesh = new THREE.Mesh(part.geo, mat)
    mesh.name = slug
    mesh.userData.muscle = slug
    mesh.userData.facing = facingOf(slug)
    mesh.userData.units = part.units
    // Lets the canvas resolve "which exact bundle did I just tap" without knowing this
    // file's packing. Returns null for models that have no sub-units.
    mesh.userData.unitAt = faceIndex => unitAt(mesh, faceIndex)
    const shown = half === 'all' || mesh.userData.facing === half
    mesh.visible = shown
    group.add(mesh)
    ;(muscleMeshes[slug] = muscleMeshes[slug] || []).push(mesh)
    if (shown) pickMeshes.push(mesh)
  }

  let bones = null
  if (data.bone) {
    bones = new THREE.Mesh(data.bone.geo, new THREE.MeshStandardMaterial({
      color: BONE, roughness: 0.85, metalness: 0.02,
    }))
    bones.name = '_bone'
    bones.visible = half === 'all'
    // The skeleton is decoration, never a click target: pickMeshes only ever holds muscle
    // meshes, and this makes that a property of the mesh itself so a future edit cannot
    // accidentally let a bone swallow a tap meant for the muscle in front of it.
    bones.raycast = () => {}
    group.add(bones)
  }

  // The skin is a real, lofted body surface over the same bones. It lives on the same
  // group as the muscles so the canvas can fade it (x-ray) or hide it (muscle-only).
  // A separate copy per figure: the comparison view inflates one and not the other.
  let skinBundle = null
  let skin = new THREE.Object3D()
  let skinMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  if (data.skinSpec) {
    skinBundle = buildSkin(data.skinSpec, { levels })
    skin = skinBundle.group
    skinMat = skinBundle.materials.skin
    skinMat.transparent = true
    skinMat.opacity = 1
    skinMat.depthWrite = true
    skinMat.side = THREE.DoubleSide
    group.add(skin)
  }

  return {
    group,
    skin,
    bones: bones || new THREE.Object3D(),
    muscleMeshes,
    pickMeshes,
    materials: { skin: skinMat, bone: bones ? [bones.material] : [], muscle: muscleMats },
    custom: true,
    height: data.height,
    /** Change how trained each part looks without rebuilding the whole body. */
    setLevels: levels => {
      if (skinBundle && skinBundle.setLevels(levels)) skinBundle.materials.skin.needsUpdate = true
    },
    // Muscle geometry is shared between figures; only per-figure materials and the
    // skin's own geometry may be freed.
    dispose: () => {
      for (const m of muscleMats) m.dispose()
      bones?.material.dispose()
      if (skinBundle) skinBundle.dispose()
      else skinMat.dispose()
    },
  }
}

/**
 * Load the body and hand it to the anatomy seam. Resolves the template so
 * `preloadModel()` in custom-body.js can drop it into place.
 */
export async function loadEcorche(gender = 'male') {
  const data = await load(gender)
  return {
    source: data,
    // Pass this sex's decoded body in explicitly. `build()` falls back to `cache.male` when
    // its `src` is null, so dropping it here made every figure render male geometry as soon
    // as the male model had been loaded once.
    build: opts => build(opts, data),
    /** Fine anatomical unit under a raycast hit, for the info panel. */
    unitOf: hit => {
      const mesh = hit?.object
      if (!mesh?.userData?.unitAt) return null
      const u = mesh.userData.unitAt(hit.faceIndex)
      return u ? { ...u, slug: mesh.userData.muscle } : null
    },
  }
}
