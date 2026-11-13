import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const loc = join(here, 'src/locales')
const files = readdirSync(loc).filter(f => f.endsWith('.js'))
const key = '本机数据'
for (const f of files) {
  try {
    const mod = await import(pathToFileURL(join(loc, f)).href)
    const pack = mod.default
    const has = Object.prototype.hasOwnProperty.call(pack, key)
    console.log(f, 'hasKey=', has, has ? ('=> ' + JSON.stringify(String(pack[key]).slice(0,40))) : '')
  } catch (e) {
    console.log(f, 'ERR', e.message)
  }
}
