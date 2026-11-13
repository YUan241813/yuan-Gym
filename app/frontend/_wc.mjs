// Read animated-WebP frame count + duration by walking the RIFF/WebP container.
// No deps. Counts ANMF chunks (=frames) and sums frame_duration (24-bit, in ms).
import fs from 'node:fs'
import path from 'node:path'

const base = 'D:/Self-developedSoftware/yuan-Gym/app/frontend/dist/exercise-media/clip'
const files = fs.readdirSync(base).filter(f => f.endsWith('.webp')).sort().slice(0, 8)

function readWebp(p) {
  const buf = fs.readFileSync(p)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP')
    return { error: 'not webp' }
  let off = 12
  let frames = 0, totalMs = 0, anim = false, durs = []
  while (off + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', off, off + 4)
    let size = buf.readUInt32LE(off + 4)
    const payload = off + 8
    if (fourcc === 'ANIM') anim = true
    if (fourcc === 'ANMF') {
      frames++
      // frame_duration is 24-bit LE at payload offset 12
      const dur = buf.readUIntLE(payload + 12, 3)
      durs.push(dur)
      totalMs += dur
    }
    off = payload + size + (size & 1) // chunks are padded to even
  }
  const fps = totalMs ? frames / (totalMs / 1000) : 0
  return { frames, totalMs, fps: +fps.toFixed(2), anim, firstMs: durs[0] || 0 }
}

for (const f of files) {
  const r = readWebp(path.join(base, f))
  console.log(JSON.stringify({ file: f, ...r }))
}
