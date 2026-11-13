// Media coverage audit for the exercise animations/stills.
//
// For every built-in exercise we resolve, for BOTH figures (male / female), the file names the
// app will actually ask for at runtime — using the exact same rules as src/lib/exercises.js
// (imgSrc / gifSrc / drawing / clipFile) — and check whether those files exist in
// dist/exercise-media/{still,clip}. Output: total expected, missing counts, the first N missing
// examples, and a breakdown by reason.
//
// This finds the "some exercises won't load / blank tile" class of bug: a drawing id the code
// points at, that was never staged into the media folder.
//
// Usage: node scripts/audit-media-coverage.mjs [--dir <dist-root>] [--top N]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXDB, EXALIAS } from '../src/lib/exercises-data.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
const dirArg = args.indexOf('--dir')
const DIST = dirArg >= 0 ? path.resolve(args[dirArg + 1]) : path.join(root, 'dist')
const topArg = args.indexOf('--top')
const TOP = topArg >= 0 ? Number(args[topArg + 1]) : 20

const STILL_DIR = path.join(DIST, 'exercise-media', 'still')
const CLIP_DIR = path.join(DIST, 'exercise-media', 'clip')

// ---- Mirror of src/lib/exercises.js naming rules (kept in sync with that file) ----
const CLIP_EXT = '.webp' // the Android/store build: VITE_CLIP_EXT=webp
const drawing = (ex, figure) =>
  (figure === 'female' ? ex.fv : figure === 'male' ? ex.mv : null) || null
const clipFile = f =>
  (CLIP_EXT !== '.mp4' && f.endsWith('.mp4') ? f.slice(0, -4) + CLIP_EXT : f)
const imgSrcName = (ex, figure) =>
  drawing(ex, figure) ? drawing(ex, figure) + '.webp' : ex.img
const gifSrcName = (ex, figure) =>
  clipFile(drawing(ex, figure) ? drawing(ex, figure) + '.mp4' : ex.gif)

// Load the set of actually-staged files once. Names are the bare file name without dir.
function fileSet(dir) {
  try { return new Set(fs.readdirSync(dir)) }
  catch { return new Set() }
}
const stillSet = fileSet(STILL_DIR)
const clipSet = fileSet(CLIP_DIR)

// Exercises reachable in the app include the alias ids (female drawings etc. carry their own
// media and can be referenced). We audit the canonical catalogue plus alias targets so a drawing
// id the code may pick is covered.
const aliasTargets = new Set(Object.values(EXALIAS))
const idsSeen = new Set()
const exercises = []
for (const ex of EXDB) {
  if (idsSeen.has(ex.id)) continue
  idsSeen.add(ex.id)
  exercises.push(ex)
}
// EXALIAS keys are extra drawing ids that resolve to a canonical exercise; their media (if any)
// is named by the alias key itself, so audit them as if they were standalone drawings.
const aliasExtras = []
for (const [id, to] of Object.entries(EXALIAS)) {
  if (idsSeen.has(id)) continue
  const target = EXDB.find(e => e.id === to)
  if (!target) continue
  // an alias id behaves like a drawing that points at `to`; its media files are named by `id`
  aliasExtras.push({ id, img: id + '.webp', gif: id + '.mp4', fv: undefined, mv: undefined, _aliasOf: to })
  idsSeen.add(id)
}

const all = [...exercises, ...aliasExtras]

const FIGURES = ['male', 'female']
const missing = [] // { id, name, figure, kind, expected, reason }
const reasons = {} // reason -> count

function addMiss(ex, figure, kind, expected, reason) {
  missing.push({ id: ex.id, name: ex.n, figure, kind, expected, reason })
  reasons[reason] = (reasons[reason] || 0) + 1
}

let counted = 0
for (const ex of all) {
  for (const figure of FIGURES) {
    // Still
    const stillName = imgSrcName(ex, figure)
    counted++
    if (!stillName) {
      addMiss(ex, figure, 'still', '(none)', 'no still name (missing img field)')
    } else if (!stillSet.has(stillName)) {
      const twin = drawing(ex, figure)
      const reason = twin
        ? `twin ${figure} drawing ${twin} not staged (falls back to ex.img ${ex.img})`
        : `ex.img ${ex.img} not staged`
      addMiss(ex, figure, 'still', stillName, reason)
    }
    // Clip
    const clipName = gifSrcName(ex, figure)
    if (!clipName) {
      addMiss(ex, figure, 'clip', '(none)', 'no clip name (missing gif field)')
    } else if (!clipSet.has(clipName)) {
      const twin = drawing(ex, figure)
      const reason = twin
        ? `twin ${figure} drawing ${twin} not staged (falls back to ex.gif ${ex.gif})`
        : `ex.gif ${ex.gif} not staged`
      addMiss(ex, figure, 'clip', clipName, reason)
    }
  }
}

// ---- Per-exercise, per-figure presence (the meaningful view) ----
// expected clip/still name per (exercise, figure), and whether it is staged.
const presence = [] // { id, name, hasFv, hasMv, male:{clip,still}, female:{clip,still}, expectedMaleClip, expectedFemaleClip }
for (const ex of all) {
  const row = { id: ex.id, name: ex.n, hasFv: !!ex.fv, hasMv: !!ex.mv }
  for (const figure of FIGURES) {
    const stillName = imgSrcName(ex, figure)
    const clipName = gifSrcName(ex, figure)
    row[figure] = {
      clip: clipName ? clipSet.has(clipName) : false,
      still: stillName ? stillSet.has(stillName) : false,
      clipName, stillName,
    }
  }
  presence.push(row)
}

// Classify each exercise by what its two figures can actually show.
const classes = {
  bothClipBothFig: 0,   // clip for male AND female → fully animated either view
  clipMaleOnly: 0,      // clip exists for male, not female  → female view blank (FIGURE MISMATCH)
  clipFemaleOnly: 0,    // clip exists for female, not male  → male view blank   (FIGURE MISMATCH)
  noClipEither: 0,      // no clip for either figure         → never animates    (no media / gap)
  stillBothButNoClip: 0,
}
const figureMismatch = [] // exercises where exactly one figure has a clip
const noClipAtAll = []    // exercises with no clip in either figure

for (const r of presence) {
  const mC = r.male.clip, fC = r.female.clip
  const mS = r.male.still, fS = r.female.still
  if (mC && fC) classes.bothClipBothFig++
  else if (mC && !fC) { classes.clipMaleOnly++; figureMismatch.push(r) }
  else if (!mC && fC) { classes.clipFemaleOnly++; figureMismatch.push(r) }
  else {
    classes.noClipEither++
    noClipAtAll.push(r)
  }
  if (!mC && !fC && (mS || fS)) classes.stillBothButNoClip++
}

// Unique expected file names (dedup across exercises/figures) → real coverage of the naming space.
const needClip = new Set(), needStill = new Set()
const haveClipFromNeed = new Set(), haveStillFromNeed = new Set()
for (const r of presence) {
  for (const figure of FIGURES) {
    const c = r[figure].clipName, s = r[figure].stillName
    if (c) { needClip.add(c); if (clipSet.has(c)) haveClipFromNeed.add(c) }
    if (s) { needStill.add(s); if (stillSet.has(s)) haveStillFromNeed.add(s) }
  }
}

// ---- Report ----
console.log('=== Media coverage audit ===')
console.log('dist root           :', DIST)
console.log('staged still files  :', stillSet.size)
console.log('staged clip files   :', clipSet.size)
console.log('exercises audited   :', all.length, `(catalogue ${exercises.length} + alias-drawings ${aliasExtras.length})`)
console.log('')
console.log('--- unique file-name coverage (dedup across figures) ---')
console.log(`  clip  : need ${needClip.size} distinct names, ${haveClipFromNeed.size} present, ${needClip.size - haveClipFromNeed.size} missing`)
console.log(`  still : need ${needStill.size} distinct names, ${haveStillFromNeed.size} present, ${needStill.size - haveStillFromNeed.size} missing`)
console.log('')
console.log('--- per-exercise / per-figure animation availability ---')
console.log(`  fully animated in BOTH views      : ${classes.bothClipBothFig}`)
console.log(`  clip for MALE only (female blank) : ${classes.clipMaleOnly}   ← figure mismatch bug`)
console.log(`  clip for FEMALE only (male blank) : ${classes.clipFemaleOnly} ← figure mismatch bug`)
console.log(`  NO clip in either view            : ${classes.noClipEither}   (never animates)`)
console.log(`    of which have a still fallback  : ${classes.stillBothButNoClip}`)
const exWithAnyClip = classes.bothClipBothFig + classes.clipMaleOnly + classes.clipFemaleOnly
console.log(`  exercises with ≥1 clip            : ${exWithAnyClip} / ${all.length} (${Math.round(100 * exWithAnyClip / all.length)}%)`)
console.log('')
console.log('--- figure-mismatch examples (have clip in one view, blank in the other) ---')
for (const r of figureMismatch.slice(0, TOP)) {
  const line = (fig) => `${fig}:${r[fig].clip ? 'clip✓' : 'clip✗'}(${r[fig].clipName})`
  console.log(`  id=${r.id} ${r.name}  male[${line('male')}] female[${line('female')}]  fv=${r.hasFv ? 'Y' : '-'} mv=${r.hasMv ? 'Y' : '-'}`)
}
console.log('')
console.log('--- no-clip-at-all examples (never animate) ---')
for (const r of noClipAtAll.slice(0, TOP)) {
  console.log(`  id=${r.id} ${r.name}  maleClip=${r.male.clipName} femaleClip=${r.female.clipName} maleStill=${r.male.still ? '✓' : '✗'} femaleStill=${r.female.still ? '✓' : '✗'}`)
}

// Persist a machine-readable summary next to the script for the final report.
const summary = {
  dist: DIST, stagedStill: stillSet.size, stagedClip: clipSet.size,
  audited: all.length,
  needClip: needClip.size, haveClip: haveClipFromNeed.size,
  needStill: needStill.size, haveStill: haveStillFromNeed.size,
  classes,
  figureMismatchIds: figureMismatch.map(r => r.id),
  noClipIds: noClipAtAll.map(r => r.id),
}
fs.writeFileSync(path.join(root, 'scripts', 'audit-media-coverage.json'), JSON.stringify(summary, null, 2))
console.log('\nWrote scripts/audit-media-coverage.json')
