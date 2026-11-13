import { readFileSync } from 'node:fs'
import { gunzipSync } from 'fflate'

const dir = 'public/models'
const desc = JSON.parse(readFileSync(`${dir}/ecorche-skin.json`, 'utf8'))
const gz = new Uint8Array(readFileSync(`${dir}/ecorche-skin.bin`))
const bytes = gunzipSync(gz)
const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const { offsets, vertexCount: n, indexCount } = desc
const pos = new Float32Array(buf, offsets.positions, n * 3)
const rawNrm = new Int16Array(buf, offsets.normals, n * 3)
const idx = new Uint32Array(buf, offsets.indices, indexCount)
const w = new Uint8Array(buf, offsets.weights, n * 8)

console.log('verts', n, 'tris', indexCount / 3)
console.log('bounds', desc.bounds)

// bbox
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]
for (let i = 0; i < n; i++) {
  for (let k = 0; k < 3; k++) {
    const v = pos[i * 3 + k]
    if (v < mn[k]) mn[k] = v
    if (v > mx[k]) mx[k] = v
  }
}
console.log('bbox min', mn.map(x => x.toFixed(3)).join(', '))
console.log('bbox max', mx.map(x => x.toFixed(3)).join(', '))
console.log('size', [0, 1, 2].map(k => (mx[k] - mn[k]).toFixed(3)).join(', '))

// height buckets: silhouette radius per y-band
const bands = 40
const ymin = mn[1], ymax = mx[1]
const rX = new Array(bands).fill(0)
const rZ = new Array(bands).fill(0)
const cnt = new Array(bands).fill(0)
for (let i = 0; i < n; i++) {
  const y = pos[i * 3 + 1]
  let b = Math.floor(((y - ymin) / (ymax - ymin)) * (bands - 1))
  b = Math.max(0, Math.min(bands - 1, b))
  const x = Math.abs(pos[i * 3]), z = Math.abs(pos[i * 3 + 2])
  if (x > rX[b]) rX[b] = x
  if (z > rZ[b]) rZ[b] = z
  cnt[b]++
}
console.log('\nHeight profile (y from 0..top, X=half-width, Z=half-depth, #verts):')
for (let b = bands - 1; b >= 0; b--) {
  const y = (ymin + (b + 0.5) / bands * (ymax - ymin))
  const bar = '█'.repeat(Math.round(rX[b] * 60)) + '|' + '█'.repeat(Math.round(rZ[b] * 60))
  console.log(`y=${y.toFixed(2)} X=${rX[b].toFixed(3)} Z=${rZ[b].toFixed(3)} n=${String(cnt[b]).padStart(4)}  ${bar}`)
}

// degenerate / inverted triangles
let degen = 0, tiny = 0
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
  const ax = pos[a], ay = pos[a + 1], az = pos[a + 2]
  const bx = pos[b], by = pos[b + 1], bz = pos[b + 2]
  const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2]
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const area = Math.hypot(nx, ny, nz) * 0.5
  if (area < 1e-9) degen++
  else if (area < 1e-5) tiny++
}
console.log('\ndegenerate tris', degen, 'tiny(<0.01mm^2) tris', tiny)

// normal magnitude / inward check: compare averaged vertex normal direction vs outward from centroid
let badNrm = 0
for (let i = 0; i < n; i++) {
  const nx = rawNrm[i * 3], ny = rawNrm[i * 3 + 1], nz = rawNrm[i * 3 + 2]
  const m = Math.hypot(nx, ny, nz)
  if (m < 100) badNrm++
}
console.log('near-zero normals (int16 mag<100):', badNrm)

// duplicate/nearby vertices (limb merge indicator): bucket by rounded pos
const seen = new Map()
let dup = 0
for (let i = 0; i < n; i++) {
  const key = `${pos[i*3].toFixed(2)},${pos[i*3+1].toFixed(2)},${pos[i*3+2].toFixed(2)}`
  if (seen.has(key)) dup++
  else seen.set(key, 1)
}
console.log('vertices sharing same 1cm-grid cell (possible merged/clustered):', dup)
