import fs from 'node:fs'
import path from 'node:path'

const FRESH = path.resolve('D:/Self-developedSoftware/yuan-Gym/app/frontend', process.argv[2] || 'db4')
const DIST = 'D:/Self-developedSoftware/yuan-Gym/app/frontend/dist'

// 保留 dist 里的 exercise-media（媒体单独 stage，不随 JS 构建产出）
const KEEP = new Set(['exercise-media'])

// 1. 删掉 dist 里除媒体外的旧内容
for (const e of fs.readdirSync(DIST, { withFileTypes: true })) {
  if (KEEP.has(e.name)) continue
  fs.rmSync(path.join(DIST, e.name), { recursive: true, force: true })
}

// 2. 把新产物搬进 dist
let n = 0
function walk(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) walk(a, b)
    else { fs.copyFileSync(a, b); n++ }
  }
}
walk(FRESH, DIST)
console.log('merged', n, 'files into dist')
console.log('dist entries:', fs.readdirSync(DIST))
