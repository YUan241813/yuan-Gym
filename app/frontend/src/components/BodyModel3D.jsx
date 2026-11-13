// yuan-Gym — the interactive anatomy canvas.
//
// Owns the three.js scene life cycle: build the figure once per body profile, keep the
// camera orbiting, and turn pointer positions into muscle picks. Everything visual is a
// prop (x-ray depth, layer visibility, heat levels, selection) so the page above decides
// the story and this component only draws it.
//
// `view` picks the viewpoint:
//   'all'    the rotatable figure with every muscle on it
//   'front'  turned to the front, the back groups dimmed back
//   'back'   turned to the back, the front groups dimmed back
//   'both'   two figures side by side — a front one and a back one — the way a printed
//            anatomy chart is drawn, each showing only the muscles of its own side

import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
// The model behind this face is swappable — see lib/anatomy/custom-body.js. Everything
// below is written against the contract in lib/anatomy/index.js and knows nothing about
// how the figure was authored.
import { buildBody, disposeBody, PICKABLE_MUSCLES, preloadAnatomyModel, anatomyModelPending, unitGeometry } from '../lib/anatomy/index.js'
import { cnName, academicName } from '../lib/muscle-facts.js'
import { ATLAS_UNIT_BY_ID } from '../lib/anatomy/atlas-groups.js'

const HEAT = [0x000000, 0x1d2b52, 0x2b4b8f, 0x2f6fd0, 0x39a0e0]  // emissive per load level
const ACCENT = 0x49d8ff
// The one colour every muscle wears. Only the muscle you pick brightens.
const MUSCLE_BASE = 0xb84a42

// How far the two figures stand apart in the chart-like view.
const PAIR_GAP = 0.46

export default function BodyModel3D({
  profile = {},
  gender = 'male',
  // A slug, or an array of them when the page lets people pick several parts at once.
  selected = null,
  onSelect = () => {},
  // Multi-select: taps toggle membership instead of replacing the selection.
  multi = false,
  onToggle = null,
  loads = null,
  xray = 0.55,
  showSkin = true,
  showBones = true,
  compareProfile = null,
  autoRotate = false,
  view = 'all',
  // How "trained" each part looks: { [slug]: 0..1 }. Drives the skin's per-segment
  // inflation, so a slider can show the same body before and after a training block.
  levels = null,
  // Side-by-side "before vs after" of a training block: the left figure stays at level 0,
  // the right one wears `levels`. Both are full figures (not the front/back chart).
  trainingCompare = false,
  className = '',
  // 界面语言：决定左下角「精确肌束名」是中文（三角肌前束）还是英文（Anterior deltoid）。
  // 这个 prop 必须在这里解构出来 —— 下面 selNames 直接读 `lang`，漏了它就是未声明变量，
  // 一渲染就抛 ReferenceError，错误边界会把整页替换成「出了点问题」。
  lang = 'zh',
}) {
  const hostRef = useRef(null)
  const stateRef = useRef(null)
  const [failed, setFailed] = useState(false)
  // `hoverUnit` and `selUnits` carry the exact tapped bundle(s) ({ slug, unit }) so the
  // canvas can highlight one fine muscle block on its own, not just the whole training-part
  // group. `selUnits` is an array because multi-select can light up several bundles at once.
  const [hoverUnit, setHoverUnit] = useState(null)
  const [selUnits, setSelUnits] = useState([])
  // Bumped once the real body finishes loading (successfully or not), so the build effect
  // runs again: with the model if it arrived, without it if it did not.
  const [modelEpoch, setModelEpoch] = useState(0)
  const [waiting, setWaiting] = useState(() => anatomyModelPending(gender))

  useEffect(() => {
    let alive = true
    setWaiting(true)
    preloadAnatomyModel(gender)
      .then(() => { if (!alive) return; setWaiting(false); setModelEpoch(e => e + 1) })
      .catch(() => { if (alive) setWaiting(false) })
    return () => { alive = false }
  }, [gender])

  // A stable key for "what is selected", so an array rebuilt on every render does not
  // repaint every muscle forty times a second.
  const selKey = typeof selected === 'string'
    ? selected
    : (selected ? [...selected].filter(Boolean).sort().join('|') : '')
  const selSet = useMemo(() => new Set(selKey ? selKey.split('|') : []), [selKey])
  // The coarse slug currently under the pointer, for the whole-group hover tint.
  const hoverSlug = hoverUnit?.slug || null

  // The scene is built once, so its pointer handlers must read the latest callbacks
  // through a ref rather than closing over the first render's props.
  const cbRef = useRef({ onSelect, onToggle, multi })
  useEffect(() => { cbRef.current = { onSelect, onToggle, multi } })

  // Scene, camera, renderer, controls — created once.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)
    host.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.touchAction = 'none'

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x070c18, 0.045)

    const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20)
    camera.position.set(0, 1.02, 3.45)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.95, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.075
    controls.minDistance = 1.1
    controls.maxDistance = 6
    controls.minPolarAngle = 0
    controls.maxPolarAngle = Math.PI
    controls.enablePan = false
    controls.rotateSpeed = 0.85

    // Lighting: a cool key from the front-left, a warm fill from behind, and a soft ambient
    // so the far side of a muscle never goes fully black.
    scene.add(new THREE.HemisphereLight(0xcfe2ff, 0x141b2c, 1.7))
    const key = new THREE.DirectionalLight(0xffffff, 3.4)
    key.position.set(2.4, 3.2, 2.6)
    scene.add(key)
    const rim = new THREE.DirectionalLight(0x6fb4ff, 2.4)
    rim.position.set(-2.6, 1.6, -2.4)
    scene.add(rim)
    const under = new THREE.PointLight(0x3f86ff, 14, 7, 2)
    under.position.set(0, -0.4, 1.2)
    scene.add(under)

    const root = new THREE.Group()
    scene.add(root)

    const clock = new THREE.Clock()
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      controls.update()
      const st = stateRef.current
      const dt = clock.getDelta()
      if (st?.autoRotate) root.rotation.y += dt * 0.35
      // A view change turns the figure to that side; it eases into place rather than
      // snapping, so the body reads as turning rather than jumping.
      if (st && st.targetRot != null) {
        const d = st.targetRot - root.rotation.y
        if (Math.abs(d) < 0.002) { root.rotation.y = st.targetRot; st.targetRot = null }
        else root.rotation.y += d * Math.min(1, dt * 6)
      }
      renderer.render(scene, camera)
    }
    frame()

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    // --- picking ---
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    // Returns { slug, unit } — `unit` is the exact bundle ("胸大肌上束") when the model
    // knows its sub-parts, otherwise null.
    const pickAt = event => {
      const rect = renderer.domElement.getBoundingClientRect()
      ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      // A flat list of muscle meshes, not a subtree walk: the body keeps its parts in a
      // group and skinning/reparenting would both break under the alternative.
      const meshes = stateRef.current?.pickMeshes || []
      if (!meshes.length) return null
      const hits = ray.intersectObjects(meshes, false)
      if (!hits.length) return null
      const hit = hits[0]
      const slug = hit.object.userData.muscle
      if (!slug) return null
      const unit = hit.object.userData.unitAt ? hit.object.userData.unitAt(hit.faceIndex) : null
      return { slug, unit }
    }

    let downAt = null
    const onDown = e => { downAt = { x: e.clientX, y: e.clientY, t: Date.now() } }
    const onUp = e => {
      if (!downAt) return
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
      const quick = Date.now() - downAt.t < 600
      downAt = null
      if (moved > 8 || !quick) return   // a drag, not a tap
      const found = pickAt(e)
      if (!found) return
      // Selection key is the fine unit id (e.g. "pec_major_clav__L"), not the coarse slug, so
      // adjacent bundles sharing a slug (上腹/下腹, 前/中/后束) can each be picked on their own.
      const id = found.unit ? found.unit.id : found.slug
      const { onSelect: sel, onToggle: tog, multi: many } = cbRef.current
      if (many && tog) tog(id, found.unit)
      else sel(id, found.unit)
      // Remember the exact bundle so the canvas can highlight just that block: a tap on the
      // anterior deltoid lights up only the anterior deltoid, not the whole deltoid group.
      // This survives multi-select — every tapped bundle gets its own entry.
      setSelUnits(prev => {
        const without = prev.filter(u => (u.unit?.id ?? u.slug) !== id)
        return found.unit ? [...without, { slug: found.slug, unit: found.unit }] : without
      })
    }
    const onMove = e => {
      if (e.buttons) return
      const found = pickAt(e)
      setHoverUnit(found ? { slug: found.slug, unit: found.unit } : null)
      renderer.domElement.style.cursor = found ? 'pointer' : 'grab'
    }

    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.style.cursor = 'grab'

    stateRef.current = {
      scene, camera, renderer, controls, root, built: null, bodies: [], ghost: null,
      autoRotate, targetRot: null, pickMeshes: [],
    }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('pointermove', onMove)
      controls.dispose()
      ;(stateRef.current?.bodies || []).forEach(disposeBody)
      if (stateRef.current?.ghost) disposeBody(stateRef.current.ghost)
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
      stateRef.current = null
    }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // A new body profile means new geometry. `view` decides how many figures stand there:
  // one rotatable figure, one turned to a side, or the chart's front-and-back pair.
  const profileKey = JSON.stringify(profile) + gender
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    ;(st.bodies || []).forEach(b => { st.root.remove(b.group); disposeBody(b) })
    st.bodies = []
    st.pickMeshes = []
    if (st.built) { st.root.remove(st.built.group); disposeBody(st.built); st.built = null }

    // The real body is still downloading: leave the stage empty rather than draw the
    // built-in figure for a second and swap it out.
    if (anatomyModelPending(gender)) return

    const make = (half, x, spin, lv = levels || {}, role = null) => {
      const built = buildBody({ profile, gender, half, levels: lv })
      built.group.position.x = x
      built.group.rotation.y = spin
      built.__trainingRole = role
      built.__half = half
      st.root.add(built.group)
      st.bodies.push(built)
      st.pickMeshes.push(...(built.pickMeshes || []))
      return built
    }

    if (trainingCompare) {
      // 锻炼前 / 锻炼后：两个完整人体并排，左边永远保持 0% 训练量。
      make('all', -PAIR_GAP, 0, {}, 'before')
      make('all', PAIR_GAP, 0, levels || {}, 'after')
      st.targetRot = null
    } else if (view === 'both') {
      // Two halves, each showing only its own muscles: the printed chart, in 3D.
      make('front', -PAIR_GAP, 0)
      make('back', PAIR_GAP, Math.PI)
    } else {
      const built = make('all', 0, 0)
      st.built = built
      st.targetRot = view === 'back' ? Math.PI : 0
    }
  }, [profileKey, view, modelEpoch, trainingCompare])   // eslint-disable-line react-hooks/exhaustive-deps

  // The "before" figure of a comparison, drawn as a cool wireframe ghost behind the real one.
  const ghostKey = compareProfile ? JSON.stringify(compareProfile) + gender : ''
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    if (st.ghost) { st.root.remove(st.ghost.group); disposeBody(st.ghost) ; st.ghost = null }
    if (!compareProfile) return
    const ghost = buildBody({ profile: compareProfile, gender, levels: {} })
    ghost.group.position.x = -0.62
    ghost.root = ghost.group
    ghost.group.traverse(o => {
      if (o.isMesh) {
        o.material = new THREE.MeshBasicMaterial({ color: 0x2f6fd0, wireframe: true, transparent: true, opacity: 0.28 })
      }
    })
    st.root.add(ghost.group)
    st.ghost = ghost
  }, [ghostKey, modelEpoch])   // eslint-disable-line react-hooks/exhaustive-deps

  // Frame the pair when a comparison is on, otherwise centre the single figure.
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    const pair = view === 'both' || trainingCompare
    const offset = compareProfile ? (pair ? 0.0 : 0.42) : 0
    st.bodies.forEach((b, i) => {
      if (pair) b.group.position.x = (i === 0 ? -PAIR_GAP : PAIR_GAP) + offset
      else b.group.position.x = offset
    })
    if (st.controls) {
      st.controls.target.set(offset, 0.95, 0)
      st.controls.update()
    }
    // Pull back far enough that the pair fits in a portrait-shaped stage.
    if (st.camera && pair && !compareProfile) {
      const dir = st.camera.position.clone().sub(st.controls.target).normalize()
      st.camera.position.copy(st.controls.target).add(dir.multiplyScalar(4.6))
    }
  }, [compareProfile, profileKey, view, modelEpoch, trainingCompare])

  // X-ray + layer toggles.
  useEffect(() => {
    const st = stateRef.current
    if (!st?.built) return
    for (const built of st.bodies) {
      const skinMat = built.materials.skin
      // xray = 0 → a real, opaque body. Sliding it up thins the skin until the muscles
      // underneath read through it. Depth writing follows the opacity so a translucent
      // shell never hides the muscle behind it.
      const opacity = showSkin ? Math.max(0.06, 1 - xray * 0.94) : 0
      skinMat.opacity = opacity
      skinMat.visible = showSkin
      skinMat.depthWrite = opacity >= 0.999
      built.skin.visible = showSkin
      // The chart view splits the body into a front half and a back half; a whole skeleton
      // behind a half body reads as bones floating in the gaps, so those two keep the
      // muscle-only look while the normal full-body view gets the skeleton.
      built.bones.visible = showBones && (built.__half ?? 'all') === 'all'
    }
  }, [xray, showSkin, showBones, profileKey, view, modelEpoch, trainingCompare])

  // A slider move must not rebuild 760k triangles. The skin keeps its base vertices, so
  // only the affected rings are rewritten (about 1 ms for the whole body).
  const levelsKey = JSON.stringify(levels || {})
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    for (const built of st.bodies) {
      // 锻炼前的那具人体始终停在 0%，只有「锻炼后」跟着滑块变。
      built.setLevels?.(built.__trainingRole === 'before' ? {} : (levels || {}))
    }
  }, [levelsKey, modelEpoch, trainingCompare])   // eslint-disable-line react-hooks/exhaustive-deps

  // Heat + selection + hover, applied to the muscle materials in place.
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    for (const built of st.bodies) {
      for (const id of PICKABLE_MUSCLES) {
        const meshes = built.muscleMeshes[id] || []
        const level = loads ? Math.round(Math.max(0, Math.min(4, loads[id] || 0))) : 0
        // A specific bundle of this group is selected → skip the whole-group tint; the
        // per-block overlay (below) draws the highlight so the rest of the group stays calm.
        const blockSel = selUnits.some(u => u.slug === id && u.unit && selSet.has(u.unit.id))
        const isSel = blockSel
        const isHover = hoverSlug === id && !blockSel
        for (const mesh of meshes) {
          const mat = mesh.material
          if (!(mat instanceof THREE.MeshStandardMaterial)) continue
          // A muscle on the far side of the body from the current view steps back, so the
          // side you are looking at is the one that reads.
          const far = (view === 'front' && mesh.userData.facing === 'back')
            || (view === 'back' && mesh.userData.facing === 'front')
          const base = MUSCLE_BASE
          if (isSel && !blockSel) {
            mat.emissive.setHex(ACCENT)
            mat.emissiveIntensity = 0.85
            mat.color.setHex(0xe8fbff)
          } else if (isHover) {
            mat.emissive.setHex(0x8fdcff)
            mat.emissiveIntensity = 0.4
            mat.color.setHex(0xd8f2ff)
          } else if (far) {
            mat.emissive.setHex(0x000000)
            mat.emissiveIntensity = 0
            mat.color.setHex(base).multiplyScalar(0.32)
          } else if (level > 0) {
            mat.emissive.setHex(HEAT[level] || 0)
            mat.emissiveIntensity = 0.25 + level * 0.16
            mat.color.setHex(base)
          } else {
            mat.emissive.setHex(0x000000)
            mat.emissiveIntensity = 0
            mat.color.setHex(base)
          }
          mat.needsUpdate = true
        }
      }
    }
  }, [loads, selKey, hoverSlug, selUnits, profileKey, view, modelEpoch, trainingCompare])   // eslint-disable-line react-hooks/exhaustive-deps

  // A block-level selection only stays meaningful while its parent training-part group is
  // still chosen. Reconcile the remembered bundles against the slugs the page currently has
  // selected (chip tap, clear, multi-array): keep the still-selected ones, drop the rest.
  //
  // Critically, an array `selected` (multi-select) no longer wipes the fine-bundle highlight
  // — that was the old behaviour and it is exactly what made "开关多选后不能精细选束" happen.
  useEffect(() => {
    setSelUnits(prev => prev.filter(u => u.unit && selSet.has(u.unit.id)))
  }, [selKey])   // eslint-disable-line react-hooks/exhaustive-deps

  // Per-block highlight overlay: when a tap lands on a specific bundle, lift that bundle out
  // of its merged mesh and draw it as a bright, slightly offset copy so "every small block is
  // its own clickable target" — the anterior deltoid lights up alone, not the whole deltoid.
  useEffect(() => {
    const st = stateRef.current
    if (!st) return
    // Drop every previously-drawn bundle highlight first.
    for (const b of st.bodies) {
      if (b.__blockHLs) {
        for (const hl of b.__blockHLs) { b.group.remove(hl); hl.material.dispose() }
        b.__blockHLs = []
      }
    }
    // One overlay per selected bundle — multi-select lights up each tapped bundle on its own.
    for (const u of selUnits) {
      if (!u || !u.unit) continue
      const built = st.bodies.find(b => b.muscleMeshes[u.slug])
      if (!built) continue
      const mesh = built.muscleMeshes[u.slug][0]
      const geo = unitGeometry(mesh.geometry, u.unit)
      if (!geo) continue
      const mat = new THREE.MeshStandardMaterial({
        color: 0xe8fbff, emissive: ACCENT, emissiveIntensity: 0.9,
        roughness: 0.5, metalness: 0.0,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      })
      const hl = new THREE.Mesh(geo, mat)
      hl.renderOrder = 2
      built.group.add(hl)
      ;(built.__blockHLs = built.__blockHLs || []).push(hl)
    }
  }, [selUnits, modelEpoch, profileKey, view, trainingCompare])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stateRef.current) stateRef.current.autoRotate = autoRotate
  }, [autoRotate])

  if (failed) {
    return <div className={'model3d-fallback ' + className}>
      <div>
        <strong>此设备无法创建 3D 视图</strong>
        <p>浏览器不支持 WebGL。你仍然可以在下方用平面图谱选择肌肉，训练与计划功能不受影响。</p>
      </div>
    </div>
  }

  // Bottom-left precise academic name: the exact bundle the user picked ("三角肌前束"),
  // falling back to the training-part group name when only a whole group is selected.
  const isZh = String(lang || 'zh').toLowerCase().startsWith('zh')
  const selNames = [...selSet].map(id => {
    const hit = selUnits.find(x => x.unit && x.unit.id === id)
    const info = hit?.unit || ATLAS_UNIT_BY_ID[id]
    return info ? (isZh ? info.cn : info.en) : id
  }).filter(Boolean)

  return <div ref={hostRef} className={'model3d ' + className} role="img" style={{ position: 'relative' }}
    aria-label="可旋转的人体肌肉模型，点击肌肉查看训练动作">
    {waiting && <div className="model3d-wait">正在载入人体模型…</div>}
    {!waiting && hoverUnit && <div className="model3d-hint" style={{ position: 'absolute', right: 10, top: 10, zIndex: 2, padding: '4px 9px', borderRadius: 9, background: 'rgba(7,12,24,.55)', color: '#cfe6ff', fontSize: 12, pointerEvents: 'none' }}>{hoverUnit.unit ? hoverUnit.unit.cn : cnName(hoverUnit.slug)}</div>}
    {!waiting && selNames.length > 0 && <div className="model3d-sel" style={{ position: 'absolute', left: 10, bottom: 10, zIndex: 2, padding: '5px 10px', borderRadius: 10, background: 'rgba(7,12,24,.62)', color: '#eaf4ff', fontSize: 13, fontWeight: 600, lineHeight: 1.3, maxWidth: '72%', pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,.3)' }}>{selNames.join('、')}</div>}
  </div>
}
