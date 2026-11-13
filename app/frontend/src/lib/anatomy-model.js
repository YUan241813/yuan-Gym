// yuan-Gym — parametric anatomy model.
//
// A figure built entirely from primitives so it can be reshaped at runtime from a body
// profile (height, weight, body fat, tape measurements) instead of shipping a fixed mesh.
// Three layers sit on top of each other and fade independently:
//
//   skin   — a translucent hologram shell, so the muscles read through it (x-ray)
//   muscle — 18 groups, each a set of meshes tagged with its MUSCLES slug, raycast-pickable
//   bone   — a simplified skeleton, visible once the skin is faded out
//
// The muscles are not spheres. A real muscle is a spindle of fibres with a tendon at each
// end, a flat sheet with a direction to its fibres, or a block with rounded corners (the
// six-pack) — so every group is built from the shape it actually has and set on the
// landmark it belongs to. They all wear the same muted red; the shape and the position
// do the identifying, and the one you pick lights up.
//
// Units: 1.0 = one metre. The figure is centred on x = 0, stands on y = 0, and faces +z.

import * as THREE from 'three'
import { MUSCLE_FACTS } from './muscle-facts.js'

// Landmarks of a 1.80 m reference body. Every group is placed against these, so a
// proportion change moves a limb and its muscles together.
export const REFERENCE = { height: 1.8, shoulder: 1.44, chest: 1.3, navel: 1.1, hip: 0.94, knee: 0.5, ankle: 0.09 }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Turn a body profile into scale factors. Everything is relative to the reference figure,
 * so an unset field means "average" rather than "zero".
 */
export function deriveProportions(profile = {}) {
  const height = clamp(Number(profile.height) || 175, 140, 215) / 175
  const weight = clamp(Number(profile.weight) || 70, 35, 180)
  const bf = clamp(Number(profile.bodyFat) || 15, 3, 45)

  // A lean bench is BMI-driven: weight over height², with body fat shifting the split
  // between "wide" and "thick" rather than just inflating everything.
  const bmi = weight / Math.pow((Number(profile.height) || 175) / 100, 2)
  const mass = clamp(bmi / 22.9, 0.72, 1.55)
  const leanness = clamp((25 - bf) / 15, 0, 1.35)

  const tape = key => (profile[key] == null ? null : Number(profile[key]))

  // Waist and chest come from tape when the user measured them; otherwise from mass.
  const chestCm = tape('chest')
  const waistCm = tape('waist')
  const armCm = tape('arm')
  const thighCm = tape('thigh')

  return {
    height,
    mass,
    leanness,
    torso: clamp((chestCm ? chestCm / 100 : 0.92 * mass), 0.8, 1.28),
    waist: clamp((waistCm ? waistCm / 80 : 0.95 * mass), 0.82, 1.3),
    arm: clamp((armCm ? armCm / 34 : 0.95 * mass), 0.78, 1.35),
    thigh: clamp((thighCm ? thighCm / 56 : 0.95 * mass), 0.8, 1.4),
    // Fat sits on the outside: it widens the silhouette without lengthening it.
    soft: clamp(0.94 + (bf - 12) / 90, 0.9, 1.2),
  }
}

// --- primitive helpers -------------------------------------------------------

const ellipsoid = (rx, ry, rz, seg = 22) => {
  const g = new THREE.SphereGeometry(1, seg, Math.max(10, Math.round(seg * 0.7)))
  g.scale(rx, ry, rz)
  return g
}

const limb = (rTop, rBottom, length, seg = 16) => {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, seg, 1, false)
  return g
}

function place(mesh, x, y, z, rot = null) {
  mesh.position.set(x, y, z)
  if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0)
  return mesh
}

/**
 * A muscle belly: a spindle, thickest in the middle, tapering to a tendon at each end.
 * This is what a biceps or a quadriceps actually looks like — a lens of fibres, not a
 * ball. `bellyPos` slides the thickest point along the length (a quadriceps is thickest
 * near the hip, a biceps near the middle).
 */
const fusiform = (rBelly, length, { bellyPos = 0.42, tendon = 0.2, seg = 20, rings = 14 } = {}) => {
  const pts = []
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    const rise = Math.min(1, t / bellyPos)
    const fall = Math.min(1, (1 - t) / (1 - bellyPos))
    const k = Math.min(rise, fall)
    const r = rBelly * (tendon + (1 - tendon) * Math.sin((Math.PI / 2) * k))
    pts.push(new THREE.Vector2(Math.max(r, 0.003), (t - 0.5) * length))
  }
  return new THREE.LatheGeometry(pts, seg)
}

/**
 * A flat muscle with a direction to its fibres — a trapezius, a lat, an oblique. The
 * outline is drawn in the XY plane and extruded, so the shape is a real contour rather
 * than a squashed sphere.
 */
const sheet = (pts, thickness, { bevel = 0.007 } = {}) => {
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 2, curveSegments: 6,
  })
  geo.translate(0, 0, -thickness / 2)
  return geo
}

/** A rounded rectangle, for the blocks of the six-pack and the joints of the spine. */
const roundedRect = (w, h, r) => {
  const shape = new THREE.Shape()
  const x = w / 2
  const y = h / 2
  shape.moveTo(-x + r, -y)
  shape.lineTo(x - r, -y)
  shape.quadraticCurveTo(x, -y, x, -y + r)
  shape.lineTo(x, y - r)
  shape.quadraticCurveTo(x, y, x - r, y)
  shape.lineTo(-x + r, y)
  shape.quadraticCurveTo(-x, y, -x, y - r)
  shape.lineTo(-x, -y + r)
  shape.quadraticCurveTo(-x, -y, -x + r, -y)
  return shape
}

const block = (w, h, d, r = 0.008) => {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, h, r), {
    depth: d, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006,
    bevelSegments: 2, curveSegments: 4,
  })
  geo.translate(0, 0, -d / 2)
  return geo
}

/** Bow a flat sheet so it wraps the body instead of hanging like a plank. */
const bend = (geo, fn) => {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setZ(i, pos.getZ(i) + fn(pos.getX(i), pos.getY(i)))
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/** Mirror an outline to the other side of the body, keeping the winding. */
const mirrorPts = pts => pts.map(([x, y]) => [-x, y]).reverse()

// --- fibre texture ----------------------------------------------------------
//
// Muscle is not smooth: it is bundles of fibres running one way. A striped texture
// used as a bump map catches the light along those bundles, which is most of what
// separates "a muscle" from "a lump" at this scale. The stripes run along the texture's
// vertical axis, which on a lathe is the length of the muscle and on a sheet is the
// direction the outline was drawn.

const fiberCache = new Map()

const fiberTexture = (angle, repeat) => {
  const key = `${angle}|${repeat}`
  if (fiberCache.has(key)) return fiberCache.get(key)
  let tex = null
  try {
    const size = 128
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, size, size)
    // Bundles of fibres: darker seams between them, light ridges on top.
    for (let i = 0; i < 64; i++) {
      const x = (i / 64) * size
      const w = 0.6 + (i % 3) * 0.5
      const shade = 108 + ((i * 37) % 46)
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`
      ctx.fillRect(x, 0, w, size)
    }
    ctx.globalAlpha = 0.25
    for (let i = 0; i < 90; i++) {
      const y = Math.random() * size
      ctx.fillStyle = Math.random() > 0.5 ? '#a8a8a8' : '#5c5c5c'
      ctx.fillRect(0, y, size, 0.8)
    }
    ctx.globalAlpha = 1
    tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeat, repeat)
    tex.rotation = (angle * Math.PI) / 180
    tex.center.set(0.5, 0.5)
    tex.needsUpdate = true
  } catch {
    tex = null   // no canvas (tests, or a locked-down webview): the muscles simply stay smooth
  }
  fiberCache.set(key, tex)
  return tex
}

// --- palette ----------------------------------------------------------------

const BONE_COLOR = 0xe7dfcc

// Every muscle wears the same muted red. Colour is not a channel in this figure —
// position and shape do the identifying, and only the muscle you pick lights up.
const MUSCLE_COLOR = 0xb84a42

/**
 * Build the figure. Returns Groups for each layer plus a lookup from muscle slug to its
 * meshes, so the viewer can shade, highlight and pick them individually.
 *
 * `side` limits the figure to one half of the body: 'front' draws only the groups a
 * front view shows, 'back' only those a back view shows. 'all' draws everything, which
 * is what the rotatable single figure uses.
 *
 * @param {{profile?: object, gender?: 'male'|'female', side?: 'all'|'front'|'back'}} options
 */
export function buildBody({ profile = {}, gender = 'male', half = 'all' } = {}) {
  const p = deriveProportions(profile)
  const H = REFERENCE.height * p.height

  const skin = new THREE.Group()
  const muscles = new THREE.Group()
  const bones = new THREE.Group()

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x9dc0f0, transparent: true, opacity: 0.13, roughness: 0.35,
    metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
  })
  const boneMat = new THREE.MeshStandardMaterial({ color: BONE_COLOR, roughness: 0.72, metalness: 0.04 })
  const boneMats = [boneMat]

  const muscleMeshes = {}
  const muscleMats = new Map()
  const muscleMaterial = slug => {
    if (muscleMats.has(slug)) return muscleMats.get(slug)
    const mat = new THREE.MeshStandardMaterial({
      color: MUSCLE_COLOR, roughness: 0.52, metalness: 0.06,
      emissive: new THREE.Color(0x000000), emissiveIntensity: 0,
    })
    const tex = fiberTexture(slug === 'chest' || slug === 'upper-back' ? 20 : 0, slug === 'chest' || slug === 'upper-back' ? 1.4 : 1)
    if (tex) { mat.bumpMap = tex; mat.bumpScale = 0.22 }
    muscleMats.set(slug, mat)
    return mat
  }

  const push = (id, mesh, facing) => {
    mesh.userData.muscle = id
    // Which view the muscle belongs to — a front view shows the chest, a back view the
    // traps. The rear head of the deltoid is the one group that appears on both.
    mesh.userData.facing = facing || MUSCLE_FACTS[id]?.facing || 'front'
    mesh.castShadow = true
    muscles.add(mesh)
    ;(muscleMeshes[id] = muscleMeshes[id] || []).push(mesh)
  }

  const y = k => k * (H / REFERENCE.height)

  // ---- landmarks (reference metres, scaled to this figure) ----
  const ankleY = y(0.09)
  const kneeY = y(0.485)
  const crotchY = y(0.83)
  const hipY = y(0.87)
  const navelY = y(1.08)
  const nippleY = y(1.30)
  const chestTopY = y(1.40)
  const shoulderY = y(1.42)
  const neckY = y(1.47)
  const headTopY = y(1.72)
  const elbowY = y(1.11)
  const wristY = y(0.845)

  const chestR = 0.132 * p.torso * p.soft
  const waistR = 0.100 * p.waist * p.soft
  const hipR = 0.112 * p.torso * p.soft
  const chestZ = 0.108 * p.torso * p.soft     // how far the chest stands off the spine
  const waistZ = 0.090 * p.waist * p.soft

  const armR = 0.050 * p.arm * p.soft
  const legR = 0.084 * p.thigh * p.soft
  const side = [-1, 1]

  // ---- torso shell (skin) ----
  // A lathe profile gives the trunk its waist and ribcage; flattened afterwards, it is
  // the elliptical section a human trunk really has.
  const trunkProfile = new THREE.SplineCurve([
    new THREE.Vector2(hipR * 0.92, crotchY),
    new THREE.Vector2(hipR, (crotchY + navelY) / 2),
    new THREE.Vector2(waistR, navelY),
    new THREE.Vector2(waistR * 1.06, navelY + 0.06 * (H / REFERENCE.height)),
    new THREE.Vector2(chestR * 0.92, y(1.20)),
    new THREE.Vector2(chestR, y(1.32)),
    new THREE.Vector2(chestR * 0.96, chestTopY),
    new THREE.Vector2(chestR * 0.42, shoulderY),
  ]).getPoints(24)
  const trunk = new THREE.Mesh(new THREE.LatheGeometry(trunkProfile, 28), skinMat)
  trunk.scale.z = 0.78 * (gender === 'female' ? 0.95 : 1)
  skin.add(trunk)

  const neck = new THREE.Mesh(limb(0.046, 0.058, 0.12), skinMat)
  place(neck, 0, neckY + 0.01, 0)
  skin.add(neck)

  const headR = 0.104
  const head = new THREE.Mesh(ellipsoid(headR * 0.86, headR * 1.1, headR), skinMat)
  place(head, 0, neckY + 0.135, 0.006)
  skin.add(head)

  // ---- muscles: torso, front ----
  side.forEach(s => {
    // pectoralis major — a fan from the sternum out to the humerus
    const pecPts = [
      [0.012, 0.062], [0.070, 0.050], [0.120, 0.020], [0.148, -0.020],
      [0.140, -0.070], [0.100, -0.098], [0.040, -0.100], [0.010, -0.070],
    ]
    const pec = new THREE.Mesh(sheet(s > 0 ? pecPts : mirrorPts(pecPts), 0.026), muscleMaterial('chest'))
    place(pec, s * 0.016, nippleY + 0.012, chestZ * 0.72, [0.06, s * -0.14, s * 0.05])
    push('chest', pec)

    // deltoid — three heads: front, side and the rear head the chart marks on the back view
    const deltFront = new THREE.Mesh(ellipsoid(0.046, 0.055, 0.05), muscleMaterial('deltoids'))
    place(deltFront, s * (chestR * 0.92), shoulderY - 0.035, chestZ * 0.42, [0, 0, s * 0.12])
    push('deltoids', deltFront)

    const deltSide = new THREE.Mesh(ellipsoid(0.05, 0.06, 0.055), muscleMaterial('deltoids'))
    place(deltSide, s * (chestR * 1.02), shoulderY - 0.045, 0)
    push('deltoids', deltSide)

    const deltRear = new THREE.Mesh(ellipsoid(0.044, 0.052, 0.046), muscleMaterial('deltoids'))
    place(deltRear, s * (chestR * 0.9), shoulderY - 0.038, -chestZ * 0.45, [0, 0, s * 0.12])
    push('deltoids', deltRear, 'back')

    // serratus anterior — the saw-toothed slips under the pec, along the ribs
    for (let i = 0; i < 4; i++) {
      const slip = new THREE.Mesh(ellipsoid(0.02, 0.042, 0.022), muscleMaterial('serratus'))
      place(slip, s * (chestR * 0.82), nippleY - 0.02 - i * 0.042, chestZ * 0.42, [0, 0, s * 0.2])
      push('serratus', slip, 'front')
    }

    // obliques — the flank, fibres running down and in
    const oblPts = [
      [0.010, 0.060], [0.048, 0.030], [0.058, -0.020], [0.046, -0.070], [0.012, -0.090], [0.000, -0.030],
    ]
    const obl = new THREE.Mesh(sheet(s > 0 ? oblPts : mirrorPts(oblPts), 0.022), muscleMaterial('obliques'))
    place(obl, s * (waistR * 0.92), navelY + 0.02, waistZ * 0.55, [0, s * 0.2, s * -0.12])
    push('obliques', obl)

    // quadriceps — three heads, the inner one a teardrop low on the thigh
    const quadRect = new THREE.Mesh(fusiform(legR * 0.42, 0.36, { bellyPos: 0.5 }), muscleMaterial('quadriceps'))
    place(quadRect, s * 0.012, hipY - 0.20, legR * 0.42)
    push('quadriceps', quadRect)

    const quadLat = new THREE.Mesh(fusiform(legR * 0.58, 0.38, { bellyPos: 0.38 }), muscleMaterial('quadriceps'))
    place(quadLat, s * 0.058, hipY - 0.19, legR * 0.16, [0, 0, s * -0.04])
    push('quadriceps', quadLat)

    const quadMed = new THREE.Mesh(fusiform(legR * 0.46, 0.28, { bellyPos: 0.66 }), muscleMaterial('quadriceps'))
    place(quadMed, s * 0.036, hipY - 0.30, legR * 0.30)
    push('quadriceps', quadMed)

    // adductors — the inner thigh
    const add = new THREE.Mesh(fusiform(legR * 0.4, 0.30, { bellyPos: 0.45 }), muscleMaterial('adductors'))
    place(add, s * 0.022, hipY - 0.17, -legR * 0.1)
    push('adductors', add)

    // hip flexors — psoas and iliacus, small and deep in front of the hip
    const hipFlex = new THREE.Mesh(fusiform(0.026, 0.20, { bellyPos: 0.55 }), muscleMaterial('hip-flexors'))
    place(hipFlex, s * 0.044, hipY + 0.08, legR * 0.36)
    push('hip-flexors', hipFlex)

    // tibialis anterior — a narrow strap down the front of the shin
    const tib = new THREE.Mesh(fusiform(0.016, 0.26, { bellyPos: 0.4 }), muscleMaterial('tibialis'))
    place(tib, s * 0.026, kneeY - 0.15, legR * 0.42)
    push('tibialis', tib)
  })

  // rectus abdominis — three rows of paired blocks, with the midline seam and the
  // tendinous grooves between them
  const absRows = [
    { yy: navelY + 0.105, w: 0.036, h: 0.040 },
    { yy: navelY + 0.055, w: 0.038, h: 0.042 },
    { yy: navelY + 0.002, w: 0.034, h: 0.038 },
  ]
  absRows.forEach(row => {
    side.forEach(s => {
      const b = new THREE.Mesh(block(row.w, row.h, 0.028, 0.009), muscleMaterial('abs'))
      place(b, s * (row.w / 2 + 0.006), row.yy, waistZ * 0.86, [0, s * 0.1, 0])
      push('abs', b)
    })
  })

  // ---- muscles: torso, back ----
  // trapezius — the big kite from the neck to the middle of the back
  const trapPts = [
    [0.000, 0.175], [0.052, 0.158], [0.105, 0.120], [0.150, 0.060], [0.148, -0.010],
    [0.110, -0.100], [0.062, -0.200], [0.022, -0.300], [0.000, -0.318],
    [-0.022, -0.300], [-0.062, -0.200], [-0.110, -0.100], [-0.148, -0.010],
    [-0.150, 0.060], [-0.105, 0.120], [-0.052, 0.158],
  ]
  const trap = new THREE.Mesh(bend(sheet(trapPts, 0.024), (x, yy) => -0.012 * Math.cos((x / 0.15) * 1.4)), muscleMaterial('trapezius'))
  place(trap, 0, shoulderY - 0.03, -chestZ * 0.42)
  push('trapezius', trap)

  side.forEach(s => {
    // latissimus dorsi — a wing, wide at the waist, up to the armpit
    const latPts = [
      [0.000, 0.150], [0.062, 0.140], [0.118, 0.120], [0.140, 0.060],
      [0.136, -0.010], [0.112, -0.090], [0.062, -0.165], [0.014, -0.200], [0.000, -0.160],
    ]
    const lat = new THREE.Mesh(
      bend(sheet(s > 0 ? latPts : mirrorPts(latPts), 0.022), (x, yy) => -0.03 * (1 - (x / 0.15) ** 2) + 0.012 * yy),
      muscleMaterial('upper-back'),
    )
    place(lat, s * 0.012, shoulderY - 0.20, -chestZ * 0.36)
    push('upper-back', lat)

    // erector spinae — two columns along the spine
    const erect = new THREE.Mesh(fusiform(0.028, 0.22, { bellyPos: 0.5 }), muscleMaterial('lower-back'))
    place(erect, s * 0.028, navelY - 0.06, -chestZ * 0.62)
    push('lower-back', erect)

    // gluteus maximus — the heaviest muscle in the body
    const glute = new THREE.Mesh(ellipsoid(legR * 0.86, legR * 0.74, legR * 0.66), muscleMaterial('gluteal'))
    place(glute, s * 0.082, hipY - 0.02, -chestZ * 0.56, [0.08, 0, 0])
    push('gluteal', glute)

    // hamstrings — biceps femoris outside, semitendinosus inside
    const hamLong = new THREE.Mesh(fusiform(legR * 0.52, 0.38, { bellyPos: 0.36 }), muscleMaterial('hamstring'))
    place(hamLong, s * 0.056, hipY - 0.21, -legR * 0.48)
    push('hamstring', hamLong)

    const hamShort = new THREE.Mesh(fusiform(legR * 0.42, 0.30, { bellyPos: 0.5 }), muscleMaterial('hamstring'))
    place(hamShort, s * 0.028, hipY - 0.22, -legR * 0.26)
    push('hamstring', hamShort)

    // gastrocnemius — two heads, and the soleus under them
    const gast = new THREE.Mesh(fusiform(legR * 0.38, 0.30, { bellyPos: 0.34 }), muscleMaterial('calves'))
    place(gast, s * 0.042, kneeY - 0.15, -legR * 0.44)
    push('calves', gast)

    const soleus = new THREE.Mesh(fusiform(legR * 0.30, 0.22, { bellyPos: 0.4 }), muscleMaterial('calves'))
    place(soleus, s * 0.034, kneeY - 0.14, -legR * 0.18)
    push('calves', soleus)
  })

  // ---- muscles: arms ----
  side.forEach(s => {
    const shoulderX = chestR * 1.02
    const elbowX = shoulderX + 0.022
    const wristX = elbowX + 0.022

    const upperArm = new THREE.Mesh(limb(armR * 0.95, armR * 0.78, shoulderY - elbowY), skinMat)
    place(upperArm, s * (shoulderX + 0.008), (shoulderY + elbowY) / 2, 0, [0, 0, s * 0.05])
    skin.add(upperArm)

    const foreArm = new THREE.Mesh(limb(armR * 0.85, armR * 0.52, elbowY - wristY), skinMat)
    place(foreArm, s * (elbowX + 0.01), (elbowY + wristY) / 2, 0.004, [0, 0, s * 0.03])
    skin.add(foreArm)

    const hand = new THREE.Mesh(ellipsoid(armR * 0.6, 0.058, armR * 0.38), skinMat)
    place(hand, s * (wristX + 0.006), wristY - 0.055, 0.006)
    skin.add(hand)

    // biceps — long head and short head, the belly high on the arm
    const bicLong = new THREE.Mesh(fusiform(armR * 0.56, 0.20, { bellyPos: 0.42 }), muscleMaterial('biceps'))
    place(bicLong, s * (shoulderX + 0.006), shoulderY - 0.115, armR * 0.5)
    push('biceps', bicLong)

    const bicShort = new THREE.Mesh(fusiform(armR * 0.38, 0.15, { bellyPos: 0.5 }), muscleMaterial('biceps'))
    place(bicShort, s * (shoulderX - 0.012), shoulderY - 0.10, armR * 0.2)
    push('biceps', bicShort)

    // triceps — long head down the back, lateral and medial heads either side of it
    const triLong = new THREE.Mesh(fusiform(armR * 0.5, 0.24, { bellyPos: 0.38 }), muscleMaterial('triceps'))
    place(triLong, s * (shoulderX + 0.012), shoulderY - 0.135, -armR * 0.45)
    push('triceps', triLong)

    const triLat = new THREE.Mesh(fusiform(armR * 0.38, 0.17, { bellyPos: 0.45 }), muscleMaterial('triceps'))
    place(triLat, s * (shoulderX + 0.022), shoulderY - 0.135, -armR * 0.1)
    push('triceps', triLat)

    const triMed = new THREE.Mesh(fusiform(armR * 0.3, 0.15, { bellyPos: 0.5 }), muscleMaterial('triceps'))
    place(triMed, s * (shoulderX - 0.006), shoulderY - 0.13, -armR * 0.28)
    push('triceps', triMed)

    // forearm — flexor mass in front, extensor mass behind
    const flex = new THREE.Mesh(fusiform(armR * 0.5, 0.22, { bellyPos: 0.32 }), muscleMaterial('forearm'))
    place(flex, s * (elbowX + 0.006), elbowY - 0.12, armR * 0.42)
    push('forearm', flex)

    const ext = new THREE.Mesh(fusiform(armR * 0.42, 0.20, { bellyPos: 0.34 }), muscleMaterial('forearm'))
    place(ext, s * (elbowX + 0.012), elbowY - 0.12, -armR * 0.4)
    push('forearm', ext)
  })

  // ---- skin: legs ----
  side.forEach(s => {
    const hipX = 0.086
    const thighMesh = new THREE.Mesh(limb(legR, legR * 0.68, hipY - kneeY), skinMat)
    place(thighMesh, s * hipX, (hipY + kneeY) / 2, 0, [0, 0, s * 0.02])
    skin.add(thighMesh)

    const shin = new THREE.Mesh(limb(legR * 0.66, legR * 0.38, kneeY - ankleY), skinMat)
    place(shin, s * hipX, (kneeY + ankleY) / 2, 0)
    skin.add(shin)

    const foot = new THREE.Mesh(ellipsoid(legR * 0.56, 0.034, 0.095), skinMat)
    place(foot, s * hipX, ankleY - 0.01, 0.048)
    skin.add(foot)
  })

  // ---- skeleton (simplified) ----
  const bone = (geo, x, yy, z, rot) => {
    const m = new THREE.Mesh(geo, boneMat)
    bones.add(place(m, x, yy, z, rot))
    return m
  }

  const skull = new THREE.Mesh(ellipsoid(headR * 0.7, headR * 0.9, headR * 0.78), boneMat)
  place(skull, 0, neckY + 0.15, 0.004)
  bones.add(skull)

  // vertebral column
  for (let i = 0; i < 13; i++) {
    const t = i / 12
    const v = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.024, 8), boneMat)
    place(v, 0, shoulderY - 0.05 - t * (shoulderY - hipY - 0.04), -chestZ * 0.42)
    bones.add(v)
  }

  // ribcage: rings that narrow toward the waist
  for (let i = 0; i < 6; i++) {
    const t = i / 5
    const rx = chestR * (1.0 - t * 0.28)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rx, 0.007, 6, 26, Math.PI * 1.35), boneMat)
    place(ring, 0, nippleY + 0.06 - t * 0.17, -0.004, [Math.PI / 2, 0, Math.PI * 0.32])
    bones.add(ring)
  }

  const pelvisRing = new THREE.Mesh(new THREE.TorusGeometry(hipR * 0.82, 0.017, 8, 24), boneMat)
  place(pelvisRing, 0, hipY + 0.02, 0, [Math.PI / 2, 0, 0])
  bones.add(pelvisRing)

  side.forEach(s => {
    const shoulderX = chestR * 1.02
    const clav = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, chestR * 1.0, 8), boneMat)
    place(clav, s * (chestR * 0.46), shoulderY + 0.005, chestZ * 0.4, [0, 0, Math.PI / 2])
    bones.add(clav)

    const humerus = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.013, shoulderY - elbowY, 10), boneMat)
    place(humerus, s * (shoulderX + 0.008), (shoulderY + elbowY) / 2, 0, [0, 0, s * 0.05])
    bones.add(humerus)

    const radius = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, elbowY - wristY, 10), boneMat)
    place(radius, s * (shoulderX + 0.042), (elbowY + wristY) / 2, 0.004, [0, 0, s * 0.03])
    bones.add(radius)

    const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.016, hipY - kneeY, 10), boneMat)
    place(femur, s * 0.086, (hipY + kneeY) / 2, 0)
    bones.add(femur)

    const tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, kneeY - ankleY, 10), boneMat)
    place(tibia, s * 0.086, (kneeY + ankleY) / 2, 0)
    bones.add(tibia)
  })

  const group = new THREE.Group()
  group.add(skin, muscles, bones)

  // One half only? Drop the muscles of the other side, so a front figure really is a
  // front figure — the way the printed chart is drawn.
  if (half === 'front' || half === 'back') {
    const kept = {}
    muscles.children.slice().forEach(m => {
      if (m.userData.facing === half) {
        const id = m.userData.muscle
        ;(kept[id] = kept[id] || []).push(m)
      } else {
        muscles.remove(m)
        m.geometry.dispose()
      }
    })
    for (const id of Object.keys(muscleMeshes)) delete muscleMeshes[id]
    Object.assign(muscleMeshes, kept)
  }

  return {
    group, skin, muscles, bones, muscleMeshes,
    materials: { skin: skinMat, bone: boneMats, muscle: muscleMats },
    proportions: p,
    height: H,
  }
}

/** The muscles a user can actually pick, in the app's head-to-toe order. */
export const PICKABLE_MUSCLES = [
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm',
  'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
]

export const disposeBody = built => {
  if (!built) return
  const seen = new Set()
  built.group.traverse(o => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose() }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (seen.has(m)) return
      seen.add(m)
      m.dispose()
    })
  })
}
