import fs from 'node:fs'
import path from 'node:path'

const SRC = 'D:/Self-developedSoftware/yuan-Gym/app/frontend/dist'
const PUB = 'D:/Self-developedSoftware/yuan-Gym/app/frontend/android/app/src/main/assets/public'

// 增量复制：媒体有 6000 多个文件、260 MB，无条件 copyFileSync 会把目标的 mtime 全部刷新，
// Gradle 于是认为 6184 个资源全变了，compressAssets 要重跑二十分钟。没变的文件就别碰。
// 判据 = 大小相同 + 目标不比源旧；JS 产物改了会换 hash 文件名（或至少改大小），照样会更新。
let n = 0, bytes = 0, skipped = 0
function walk(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) { walk(a, b); continue }
    const st = fs.statSync(a)
    if (fs.existsSync(b)) {
      const cur = fs.statSync(b)
      if (cur.size === st.size && cur.mtimeMs >= st.mtimeMs) { skipped++; continue }
    }
    fs.copyFileSync(a, b)
    n++
    bytes += st.size
  }
}
walk(SRC, PUB)

// Vite 每次构建给 JS chunk 换 hash 文件名。只增不删会让旧版 chunk 一直留在 public 里，
// 打进 APK 变成没人引用的死代码（实测攒了 182 个 / 11.4 MB）。这里把「dist 里没有」的
// 文件删掉。只清 assets/ 这一个目录：它是纯构建产物；public 根目录还有 Capacitor 生成的
// capacitor.plugins.json 等，媒体目录也可能有刻意补的别名文件，都不能按 dist 为准去动。
const assetsDir = path.join(PUB, 'assets')
const freshJs = new Set(fs.readdirSync(path.join(SRC, 'assets')))
let removed = 0, removedBytes = 0
for (const name of fs.readdirSync(assetsDir)) {
  if (freshJs.has(name)) continue
  const p = path.join(assetsDir, name)
  removedBytes += fs.statSync(p).size
  fs.unlinkSync(p)
  removed++
}

console.log('copied', n, 'files', (bytes / 1048576).toFixed(1), 'MB; skipped', skipped, 'unchanged')
console.log('removed', removed, 'stale js chunks', (removedBytes / 1048576).toFixed(1), 'MB')
console.log('public entries:', fs.readdirSync(PUB).length)
console.log('index.html', fs.statSync(path.join(PUB, 'index.html')).size, 'bytes')
