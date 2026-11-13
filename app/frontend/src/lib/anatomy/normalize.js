// Turns *any* three.js object tree — hand-built meshes, a glTF scene, a Blender export —
// into the one shape BodyModel3D knows how to draw.
//
// Why this exists: the canvas does not care how a model was made. It only asks for five
// things (see `built` below). Everything else — which mesh is which muscle, how big the
// figure is, which way it faces, whether the materials can glow — is sorted out here. That
// keeps the swap point to a single file (`custom-body.js`) and means a new model can never
// break the anatomy page, only fail to light up.
//
// The contract `normalizeBuiltModel` returns:
//
//   group         THREE.Group   the root the caller positions and rotates
//   skin          Object3D      .visible toggles the outer skin  (dummy if the model has none)
//   bones         Object3D      .visible toggles the skeleton    (dummy if the model has none)
//   muscleMeshes  {slug: Mesh[]} every mesh of that muscle — heat, selection, hover
//   pickMeshes    Mesh[]        the flat list the raycaster tests (see note on picking)
//   materials     {skin, bone, muscle}
//   custom        true          tells disposeBody the geometry is shared, do not free it
//
// Note on picking: BodyModel3D raycasts `pickMeshes` as a flat array instead of walking a
// "muscles" group. Flattening here rather than reparenting meshes means a model that uses
// nested groups or SkinnedMesh keeps working — reparenting would break both.

import * as THREE from 'three'
import { MUSCLE_FACTS } from '../muscle-facts.js'

/** The eight… eighteen muscles the app can talk about, in head-to-toe order. */
export const SLUGS = Object.keys(MUSCLE_FACTS)

// The colour every muscle wears before heat or selection tints it. Mirrors BodyModel3D.
export const MUSCLE_BASE = 0xb84a42

const norm = s => String(s || '').toLowerCase().replace(/[\s_\-.·]/g, '')

// One flat lookup so a mesh may be named "Biceps", "biceps_L", "肱二头肌" or "BICEPS.001"
// and still resolve. Built once — the facts file is static.
const LOOKUP = (() => {
  const map = new Map()
  for (const slug of SLUGS) {
    const f = MUSCLE_FACTS[slug] || {}
    for (const key of [slug, f.cn, f.en, ...(f.aliases || [])]) {
      if (key) map.set(norm(key), slug)
    }
  }
  return map
})()

/**
 * Map any mesh name onto a muscle slug, or null when it is not a muscle.
 *
 * Modelling tools leave all sorts of decoration on a name, so a few forms are tried in
 * order before giving up: "quadriceps.001", "Biceps_L", "biceps-left", "muscle_chest".
 * The exact form is always tried first — otherwise "gluteal" would lose its trailing "l"
 * to the left/right rule.
 */
export function slugOf(name) {
  const key = norm(name)
  if (!key) return null
  const tries = [
    key,
    key.replace(/\d+$/, ''),
    key.replace(/(left|right|l|r)$/, ''),
    key.replace(/\d+$/, '').replace(/(left|right|l|r)$/, ''),
    key.replace(/^(muscle|muscles|m)/, ''),
    key.replace(/^(muscle|muscles|m)/, '').replace(/(left|right|l|r)$/, ''),
  ]
  for (const t of tries) {
    if (t && LOOKUP.has(t)) return LOOKUP.get(t)
  }
  return null
}

/** Swap a non-standard material for one that can glow. Colour and maps are carried over. */
function toStandard(mat) {
  const std = new THREE.MeshStandardMaterial({ color: MUSCLE_BASE, roughness: 0.62, metalness: 0.04 })
  if (mat) {
    if (mat.color) std.color.copy(mat.color)
    for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'alphaMap']) {
      if (mat[key]) std[key] = mat[key]
    }
    if (typeof mat.opacity === 'number') std.opacity = mat.opacity
    if (mat.transparent) std.transparent = true
    if (mat.side != null) std.side = mat.side
  }
  return std
}

function firstMaterial(obj) {
  if (!obj) return null
  let found = null
  obj.traverse(o => {
    if (!found && o.isMesh && o.material) found = Array.isArray(o.material) ? o.material[0] : o.material
  })
  return found
}

/**
 * Scale the figure to the height the rest of the app assumes (metres, feet on y=0,
 * centred on x/z). A model authored in centimetres, or off-centre in Blender, lands in
 * the right place without anyone editing the export.
 */
function autoFit(root, height) {
  root.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  if (size.y > 0) {
    const k = height / size.y
    if (Math.abs(k - 1) > 0.02) {
      root.scale.multiplyScalar(k)
      root.updateWorldMatrix(true, true)
      box.setFromObject(root)
    }
  }
  const centre = box.getCenter(new THREE.Vector3())
  // y: drop the feet to the floor. x/z: stand the figure on the origin.
  root.position.x -= centre.x
  root.position.y -= box.min.y
  root.position.z -= centre.z
}

/**
 * @param {object}   opts
 * @param {Object3D} opts.root      the model as authored
 * @param {string}   opts.half      'all' | 'front' | 'back' — the printed-chart pair view
 * @param {number}   opts.height    target height in metres (default 1.8, the app's reference)
 * @param {boolean}  opts.autoFit   scale/centre the model (default true for custom models)
 * @param {string[]} opts.pickable  slugs allowed to be picked (default: all of them)
 * @param {Object3D} opts.skin      explicit skin node, if the model names one
 * @param {Object3D} opts.bones     explicit skeleton node, if the model names one
 * @param {object}   opts.nameMap   {meshName: slug} for models with unusable names ("Object_12")
 */
export function normalizeBuiltModel({
  root,
  half = 'all',
  height = 1.8,
  autoFit: doFit = true,
  pickable = SLUGS,
  skin = null,
  bones = null,
  nameMap = null,
} = {}) {
  if (!root) throw new Error('normalizeBuiltModel: root is required')
  if (doFit) autoFit(root, height)

  const allowed = new Set(pickable)
  const muscleMeshes = {}
  const pickMeshes = []
  const muscleMats = []

  root.traverse(o => {
    if (!o.isMesh) return
    // Explicit map first — a Blender export that named everything "Object_12" cannot be
    // guessed at, and a wrong guess would light up the wrong muscle.
    const slug = (nameMap && nameMap[o.name]) || o.userData.muscle || slugOf(o.name)
    if (!slug || !MUSCLE_FACTS[slug]) return

    // Tag it so the raycaster can answer with a slug, and so the far-side dimming in
    // BodyModel3D knows which half of the body this mesh belongs to.
    o.userData.muscle = slug
    o.userData.facing = o.userData.facing || MUSCLE_FACTS[slug].facing || 'front'

    if (!(o.material instanceof THREE.MeshStandardMaterial)) o.material = toStandard(o.material)
    if (o.material && 'emissive' in o.material) o.material.emissive.setHex(0)
    muscleMats.push(o.material)

    ;(muscleMeshes[slug] = muscleMeshes[slug] || []).push(o)

    // In the chart's paired view each figure shows only its own side.
    const shown = half === 'all' || o.userData.facing === half
    o.visible = shown
    if (shown && allowed.has(slug)) pickMeshes.push(o)
  })

  const skinObj = skin || new THREE.Object3D()
  const boneObj = bones || new THREE.Object3D()
  const skinMat = firstMaterial(skin) || new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })

  return {
    group: root,
    skin: skinObj,
    bones: boneObj,
    muscleMeshes,
    pickMeshes,
    materials: { skin: skinMat, bone: [], muscle: muscleMats },
    custom: true,
    height,
  }
}
