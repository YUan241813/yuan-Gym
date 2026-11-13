// Loads a .glb/.gltf once and hands out cheap clones of it.
//
// Only imported when `MODEL.url` is set (see custom-body.js) — that keeps GLTFLoader and
// the skeleton-clone helper out of the bundle for builds that use the built-in figure.
//
// Cloning matters because the anatomy page can stand two figures side by side (front and
// back in the chart view) and a comparison ghost behind them. Each needs its own materials,
// or brightening the chest on one figure would brighten it on all of them.

import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js'

export async function loadBodyTemplate(MODEL, { applyProfile, normalizeBuiltModel, SLUGS }) {
  const gltf = await new GLTFLoader().loadAsync(MODEL.url)
  const source = gltf.scene
  if (!source) throw new Error('glTF 里没有 scene')

  return {
    source,
    build({ profile = {}, gender = 'male', half = 'all' } = {}) {
      // SkeletonUtils.clone keeps skinned meshes bound to their own skeleton copy.
      const root = cloneWithSkeleton(source)

      // Per-instance materials: selection colour must not leak between figures. The map is
      // keyed on the original material so meshes that shared one still share one copy here
      // (cloning per mesh would multiply draw-call state for no gain).
      const copies = new Map()
      root.traverse(o => {
        if (!o.isMesh) return
        const many = Array.isArray(o.material)
        const mats = many ? o.material : [o.material]
        const own = mats.map(m => {
          if (!m) return m
          if (!copies.has(m)) copies.set(m, m.clone())
          return copies.get(m)
        })
        o.material = many ? own : own[0]
      })

      applyProfile(root, { profile, gender })

      const built = normalizeBuiltModel({
        root,
        half,
        height: MODEL.height,
        autoFit: MODEL.autoFit !== false,
        pickable: MODEL.pickable || SLUGS,
        skin: MODEL.skinName ? root.getObjectByName(MODEL.skinName) : null,
        bones: MODEL.bonesName ? root.getObjectByName(MODEL.bonesName) : null,
        nameMap: MODEL.meshMap || null,
      })

      // The template owns its geometry; a clone must never free it. Materials above were
      // cloned per instance, so those are safe to drop.
      built.dispose = () => {
        for (const m of copies.values()) m.dispose()
        // The skin material is either one of those copies or a dummy made by the normaliser.
        const sk = built.materials.skin
        if (sk && ![...copies.values()].includes(sk)) sk.dispose()
      }

      return built
    },
  }
}
