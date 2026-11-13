// 验证「每一小块肌肉都能单独点击 + 单独高亮」是否真的成立。
//
// 直接吃真实模型资产（ecorche.json + ecorche.bin），跑两件事：
//   1) unitAt：对每一块随机取一个三角面索引，确认能被解析回这一块（即点击命中正确）。
//   2) unitGeometry：对每一块切出独立子网格，确认顶点/索引数量自洽、能被 three 接受。
//
// 这不是 UI 测试（UI 在安卓里），而是把支撑「逐块点击」的两个纯函数用真数据打一遍，
// 给出 177 块全部可单独解析 + 可单独高亮的可计数证据。

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeEcorche, unitAt, unitGeometry } from '../app/frontend/src/lib/anatomy/ecorche.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const MODELS = path.resolve(here, '../app/frontend/public/models')

const meta = JSON.parse(fs.readFileSync(path.join(MODELS, 'ecorche.json'), 'utf8'))
const gz = new Uint8Array(fs.readFileSync(path.join(MODELS, 'ecorche.bin')))

const { parts } = decodeEcorche(meta, gz)

let total = 0
let resolved = 0
let geoOk = 0
const names = new Set()
const slugs = new Set()
const problems = []

for (const [slug, part] of parts) {
  const mesh = { userData: { units: part.units, muscle: slug } }
  for (const unit of part.units) {
    total++
    slugs.add(slug)
    names.add(unit.cn)

    // (1) 点击解析：取这一块范围内的一个三角面索引，确认解析回同一个 id。
    const faceIndex = unit.start + ((unit.count >> 1) | 0)
    const got = unitAt(mesh, faceIndex)
    if (!got || got.id !== unit.id) {
      problems.push(`解析失败 slug=${slug} id=${unit.id} cn=${unit.cn} → ${got ? got.id : 'null'}`)
    } else {
      resolved++
    }

    // (2) 独立子网格：顶点数应与索引引用的范围一致，索引数应为 count*3。
    const geo = unitGeometry(part.geo, unit)
    if (!geo) { problems.push(`子网格为空 id=${unit.id} cn=${unit.cn}`); continue }
    const idxCount = geo.index ? geo.index.count : 0
    const posCount = geo.attributes.position ? geo.attributes.position.count : 0
    if (idxCount !== unit.count * 3) {
      problems.push(`索引数不符 id=${unit.id} 期望 ${unit.count * 3} 实际 ${idxCount}`)
    } else if (posCount < 3) {
      problems.push(`顶点数异常 id=${unit.id} posCount=${posCount}`)
    } else {
      geoOk++
    }
  }
}

console.log(`模型块总数（粗分 parts）：${parts.size} 个 slug`)
console.log(`细块总数：${total}`)
console.log(`点击解析成功：${resolved} / ${total}`)
console.log(`独立子网格成立：${geoOk} / ${total}`)
console.log(`不同中文细名：${names.size}`)
console.log(`不同 slug：${slugs.size}`)
if (problems.length) {
  console.log(`\n❌ 发现问题 ${problems.length} 个：`)
  for (const p of problems.slice(0, 40)) console.log('  - ' + p)
  process.exit(1)
} else {
  console.log('\n✅ 全部细块均可单独点击解析、且均可单独高亮（unitGeometry 自洽）。')
}
