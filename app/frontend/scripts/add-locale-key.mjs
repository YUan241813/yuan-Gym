// 给全部语言包插入一个 key（保持 check-locales 的 19 包 key 数一致）。
// 用法：node scripts/add-locale-key.mjs <key> <zh> <zh-TW> [default]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'src/locales')
const [key, zh, zhTW, dflt] = process.argv.slice(2)
if (!key) { console.error('用法：node add-locale-key.mjs <key> <zh> <zh-TW> [default]'); process.exit(1) }

const translations = { 'zh.js': zh || key, 'zh-TW.js': zhTW || key }
let n = 0
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue
  const p = path.join(dir, f)
  let s = fs.readFileSync(p, 'utf8')
  const quoted = JSON.stringify(key)
  if (s.includes(quoted + ':')) { console.log('已有，跳过', f); continue }
  const val = JSON.stringify(translations[f] || dflt || key)
  s = s.replace('export default {', 'export default {\n  ' + quoted + ': ' + val + ',')
  fs.writeFileSync(p, s)
  n++
}
console.log('更新了 ' + n + ' 个语言包：' + key)
