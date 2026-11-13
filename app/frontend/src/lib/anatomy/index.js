// The single front door to "a body you can draw". BodyModel3D imports only from here.
//
//   buildBody({ profile, gender, half })  → the contract described in normalize.js
//   disposeBody(built)                    → free what should be freed, and nothing else
//   PICKABLE_MUSCLES                      → the slugs that can be tapped
//   preloadAnatomyModel()                 → Promise; resolves when a custom .glb is ready
//
// If `MODEL.url` in custom-body.js is set and the file loads, that model is used and the
// built-in procedural figure is never built. If it is not set — or fails — everything falls
// through to the built-in figure, so this layer can never be the reason the page breaks.

import * as procedural from '../anatomy-model.js'
import { MODEL, preloadModel, buildFromModel, modelReady, modelFailed } from './custom-body.js'
import { unitGeometry } from './ecorche.js'

export { modelReady, modelFailed, unitGeometry }

export const PICKABLE_MUSCLES = MODEL.pickable || procedural.PICKABLE_MUSCLES

/**
 * True while the real body is still arriving. The canvas stays empty for this moment
 * instead of drawing the built-in figure and swapping it out a second later.
 */
export const anatomyModelPending = (gender = 'male') => !modelReady(gender) && !modelFailed()

/** Resolves true when a custom model is in memory (false = built-in figure in use). */
export const preloadAnatomyModel = (gender = 'male') => preloadModel(gender).then(t => !!t)

/** The procedural build returns `muscles` (a group); the canvas wants a flat mesh list. */
function withPickList(built) {
  if (built.pickMeshes) return built
  const flat = []
  for (const list of Object.values(built.muscleMeshes || {})) flat.push(...list)
  built.pickMeshes = flat
  return built
}

export function buildBody(opts = {}) {
  const custom = buildFromModel(opts)
  if (custom) return custom
  return withPickList(procedural.buildBody(opts))
}

export function disposeBody(built) {
  if (!built) return
  // A custom model shares geometry with its template, so only what it says is safe to free
  // gets freed. Without a dispose hook there is nothing to do.
  if (built.custom) {
    if (typeof built.dispose === 'function') built.dispose()
    return
  }
  procedural.disposeBody(built)
}
