#!/usr/bin/env node
/**
 * import-atlas.mjs — 把用户提供的两份 3D 肌肉图谱 HTML 转成 App 的模型资产，
 * 并做「全身一致性细化」，让每一小块肌肉都能单独点击。
 *
 *   npm run import:atlas
 *
 * 输入（源，不进 APK）：
 *   models-src/ecorche-atlas-male.html
 *   models-src/ecorche-atlas-female.html
 * 输出：
 *   public/models/ecorche.json           211 blocks + 每块的 segments（细分单位）
 *   public/models/ecorche-male.bin       男版 gzip 几何
 *   public/models/ecorche-female.bin     女版 gzip 几何
 *   src/lib/anatomy/atlas-groups.js      210 块元数据 + 436 个可点单位表 + 文字搜索
 *
 * ── 为什么要「细化」这一步 ────────────────────────────────────────────────
 * 原图谱 210 块虽然把胸、腹、三角肌拆得很细，但全身 48 个解剖父级里仍有 12 个
 * 只有 1 块（肩袖四肌与大圆肌本身是最小解剖单位，不该拆；另外 7 块是大肌/长肌，
 * 对照作者自己的分段标准明显漏分），此外 `vastus_intermedius` 是股四头肌 7 块里
 * 唯一没分段的。同时每块肌肉的几何都含左右两侧却共用一个 id —— 点左胸和点右胸
 * 选中的是同一个东西。
 *
 * 所以做两件事：
 *   ① 左右分离：全部 210 块 → 左/右两个单位（实测三角形 L/R 严格对半，中线面片极少）
 *   ② 补分段：8 个漏分的大肌按 y 再切上/下两段
 * 结果 436 个最小可点单位。
 *
 * ── 怎么做到不改几何结构 ──────────────────────────────────────────────────
 * App 的 decodePart() 把每个 block 解码成一个连续三角形区间，unitAt(faceIndex)
 * 靠区间二分查找细名，unitGeometry() 按区间抽三角形做单块高亮。因此只要让
 * 「同一细分的三角形在索引缓冲里连续」即可 —— 本脚本对每个 block 的 **index
 * 段做稳定重排**（按 左/右 → 上/下 排序），顶点/法线/颜色段一个字节不动，
 * 各段 offset/byteLength 全部不变，再把每段的边界写进 json 的 segments。
 *
 * 男女两份的 index 缓冲逐字节相同（已实测 211/211 一致），所以共用同一套重排规则
 * 与 segments 表；两份 raw 各自写回后重新 gzip。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'fflate'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(FRONTEND, 'models-src')
const MODELS = path.join(FRONTEND, 'public', 'models')
const LIB = path.join(FRONTEND, 'src', 'lib', 'anatomy')
const FILES = { male: 'ecorche-atlas-male.html', female: 'ecorche-atlas-female.html' }

// ── 需要额外按纵向补分段的块 ────────────────────────────────────────────────
// 判据：① 该解剖父级只有它 1 块；② 体积/跨度明显大于同组已分段的邻居；
// ③ 解剖学上确实有上下部之分或本身是长肌。肩袖四肌、大圆肌不在此列 —— 它们
// 本来就是最小解剖单位，硬切会造出不存在的「肌肉」。
const SEGMENT_Y = new Set([
  'scm',                 // 胸锁乳突肌：9200 面，颈部最大块
  'glute_min',           // 臀小肌：臀中肌已分前后，它仍是单块
  'sartorius',           // 缝匠肌：人体最长肌，y 跨度 0.628
  'brachioradialis',     // 肱桡肌：4384 面，长肌
  'ql',                  // 腰方肌：5664 面
  'brachialis',          // 肱肌：肱二头肌已分长短头，它仍是单块
  'tfl',                 // 阔筋膜张肌
  'vastus_intermedius',  // 股中间肌：股四头肌 7 块里唯一没分段的
])

// ── 210 个解剖单位 → App 的 18 个训练部位 ────────────────────────────────────
// foot / neck / face 是「能点但不计训练负荷」的显示用 slug。
function slugOf({ id, region }) {
  switch (region) {
    case 'chest':
      return (id.startsWith('serratus_') || id.startsWith('intercostal_')) ? 'serratus' : 'chest'
    case 'shoulder': return 'deltoids'
    case 'back':
      if (id.startsWith('trap_')) return 'trapezius'
      if (id.startsWith('lat_') || id === 'teres_major' || id.startsWith('rhomboid_') || id.startsWith('serr_post_')) return 'upper-back'
      return 'lower-back'
    case 'arm':
      if (id.startsWith('triceps_') || id === 'anconeus') return 'triceps'
      if (id === 'brachioradialis') return 'forearm'
      return 'biceps'
    case 'forearm': return 'forearm'
    case 'core': return id.startsWith('rectus_abs_') ? 'abs' : 'obliques'
    case 'hip': return (id === 'psoas_major' || id === 'iliacus' || id === 'tfl') ? 'hip-flexors' : 'gluteal'
    case 'thigh':
      if (id.startsWith('add_') || id === 'gracilis' || id === 'pectineus') return 'adductors'
      if (id.startsWith('biceps_femoris') || id.startsWith('semitendinosus') || id.startsWith('semimembranosus')) return 'hamstring'
      if (id === 'sartorius') return 'hip-flexors'
      return 'quadriceps'
    case 'calf': return (id.startsWith('tibialis_anterior') || id === 'edl' || id === 'ehl') ? 'tibialis' : 'calves'
    case 'foot': return 'foot'
    case 'neck': return 'neck'
    case 'face': return 'face'
    default: throw new Error(`未覆盖的区域：${region} (${id})`)
  }
}

const SEARCH_ALIASES = {
  '胸缝': ['pec_major_stern'], '胸沟': ['pec_major_stern'], '乳沟': ['pec_major_stern'],
  '上胸': ['pec_major_clav'], '中胸': ['pec_major_stern'], '下胸': ['pec_major_abd'],
  '上腹': ['rectus_abs_up', 'rectus_abs_midup'], '下腹': ['rectus_abs_low', 'rectus_abs_midlow'],
  '侧腹': ['ext_oblique_up', 'ext_oblique_low', 'int_oblique_up', 'int_oblique_low'],
  '人鱼线': ['ext_oblique_low', 'int_oblique_low'], '马甲线': ['rectus_abs_low', 'ext_oblique_low'],
  '前束': ['deltoid_ant'], '中束': ['deltoid_lat'], '后束': ['deltoid_post'],
  '蝴蝶肌': ['lat_up', 'lat_mid'], '背阔肌': ['lat_low', 'lat_mid', 'lat_up'],
  '小腿肚': ['gastroc_med', 'gastroc_lat'], '跟腱': ['calcaneal_tendon'],
  '苹果肌': ['zygomaticus_major', 'zygomaticus_minor'], '咬肌': ['masseter_sup', 'masseter_deep'],
  '左侧': [], '左': [], '右侧': [], '右': [],
}

// ── 提取 ────────────────────────────────────────────────────────────────────
function extract(file) {
  const html = fs.readFileSync(file, 'utf8')
  const dataLine = key => {
    const line = html.split(/\r?\n/).find(l => l.startsWith('window.' + key))
    if (!line) throw new Error(`${file}: 找不到 window.${key}`)
    return JSON.parse(line.slice(line.indexOf('=') + 1).trim().replace(/;$/, ''))
  }
  const groups = dataLine('__GROUPS__')
  const regions = dataLine('__REGIONS__')
  const meta = dataLine('__META__')
  const chunks = [...html.matchAll(/<script[^>]*class="md-chunk"[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => m[1].trim())
  if (!chunks.length) throw new Error(`${file}: 没有 md-chunk 数据块`)

  const gz = Buffer.concat(chunks.map(c => Buffer.from(c, 'base64')))
  if (gz.length !== meta.gzipBytes) throw new Error(`${file}: gzip 长度 ${gz.length} ≠ ${meta.gzipBytes}`)
  if (gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Error(`${file}: 不是 gzip`)
  const raw = gunzipSync(new Uint8Array(gz))
  if (raw.length !== meta.bytes) throw new Error(`${file}: 解压后 ${raw.length} ≠ ${meta.bytes}`)
  return { groups, regions, meta, gz, raw }
}

function validateLayout(meta, raw, tag) {
  const base = raw.byteOffset
  for (const b of meta.groups) {
    const start = base + b.offset
    if (b.offset + b.byteLength > raw.length) throw new Error(`${tag}: ${b.id} 超出缓冲`)
    if ((start + b.posOff) % 2) throw new Error(`${tag}: ${b.id} posOff 未 2 字节对齐`)
    const isize = b.indexType === 32 ? 4 : 2
    if ((start + b.idxOff) % isize) throw new Error(`${tag}: ${b.id} idxOff 未对齐`)
    if (b.posOff + b.verts * 3 * 2 > b.byteLength ||
        b.norOff + b.verts * 3 > b.byteLength ||
        b.idxOff + b.tris * 3 * isize > b.byteLength) throw new Error(`${tag}: ${b.id} 段越界`)
    const View = b.indexType === 32 ? Uint32Array : Uint16Array
    const idx = new View(raw.buffer, start + b.idxOff, b.tris * 3)
    let max = 0
    for (let i = 0; i < idx.length; i++) if (idx[i] > max) max = idx[i]
    if (max >= b.verts) throw new Error(`${tag}: ${b.id} 索引越界 max=${max} verts=${b.verts}`)
  }
}

// ── 细化：计算每个 block 的三角形分组与重排顺序 ──────────────────────────────
// 用男版几何算分组（男女 index 完全一致，体型也左右对称），男女共用同一份结果。
function planRefinement(block, raw, group, yMidFn) {
  const base = raw.byteOffset + block.offset
  const q = new Int16Array(raw.buffer, base + block.posOff, block.verts * 3)
  const pos = Int16Array.from(q)
  for (let i = 3; i < pos.length; i++) pos[i] += pos[i - 3]
  const View = block.indexType === 32 ? Uint32Array : Uint16Array
  const idx = new View(raw.buffer, base + block.idxOff, block.tris * 3)

  const side = new Array(block.tris)
  const cy = new Float32Array(block.tris)
  for (let t = 0; t < block.tris; t++) {
    const a = idx[t * 3] * 3, c = idx[t * 3 + 1] * 3, d = idx[t * 3 + 2] * 3
    side[t] = (pos[a] + pos[c] + pos[d]) >= 0 ? 'R' : 'L'
    cy[t] = (pos[a + 1] + pos[c + 1] + pos[d + 1]) / 3
  }
  const needBand = SEGMENT_Y.has(block.id)
  const yMid = needBand ? yMidFn(cy) : 0
  const bandOf = t => needBand ? (cy[t] >= yMid ? 1 : 0) : 0

  const order = Array.from({ length: block.tris }, (_, t) => t)
  order.sort((a, b) => {
    if (side[a] !== side[b]) return side[a] === 'L' ? -1 : 1
    const ba = bandOf(a), bb = bandOf(b)
    if (ba !== bb) return ba - bb
    return a - b                          // 组内保持稳定顺序
  })

  // 分组边界：order 已按 (side, band) 排序，所以每组是连续区间。
  const segments = []
  for (let i = 0; i < order.length; i++) {
    const t = order[i], s = side[t], band = bandOf(t)
    const last = segments[segments.length - 1]
    if (!last || last.side !== s || last.band !== band) {
      segments.push({ side: s, band, start: i, count: 1 })
    } else last.count++
  }
  const cn = group?.cn || block.id
  for (const seg of segments) {
    const sideCn = seg.side === 'L' ? '左' : '右'
    const bandCn = needBand ? (seg.band === 1 ? '·上部' : '·下部') : ''
    seg.id = `${block.id}__${seg.side}${needBand ? '_' + seg.band : ''}`
    seg.baseId = block.id
    seg.label = `${sideCn}${cn}${bandCn}`
    seg.slug = group ? slugOf(group) : null
    if (seg.count < 1) throw new Error(`${block.id}: 空分段`)
  }
  return { order, segments, needBand }
}

function applyOrder(block, raw, order) {
  const base = raw.byteOffset + block.offset
  const View = block.indexType === 32 ? Uint32Array : Uint16Array
  const idx = new View(raw.buffer, base + block.idxOff, block.tris * 3)
  const copy = Array.from(idx)                       // 必须先复制：写回的是同一块内存
  for (let i = 0; i < order.length; i++) {
    const t = order[i]
    idx[i * 3] = copy[t * 3]
    idx[i * 3 + 1] = copy[t * 3 + 1]
    idx[i * 3 + 2] = copy[t * 3 + 2]
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const male = extract(path.join(SRC, FILES.male))
const female = extract(path.join(SRC, FILES.female))

const layoutOf = m => m.groups.map(b => [
  b.id, b.verts, b.tris, b.parts, b.indexType,
  b.posOff, b.norOff, b.colOff, b.idxOff, b.byteLength, b.offset,
].join('|'))
if (JSON.stringify(male.groups) !== JSON.stringify(female.groups)) throw new Error('男女 GROUPS 不一致')
if (JSON.stringify(layoutOf(male.meta)) !== JSON.stringify(layoutOf(female.meta))) throw new Error('男女 block 布局不一致')
if (male.meta.scale !== female.meta.scale) throw new Error('男女 scale 不一致')
validateLayout(male.meta, male.raw, 'male')
validateLayout(female.meta, female.raw, 'female')

// 男女 index 缓冲必须完全一致，否则不能共用同一套重排顺序。
for (let i = 0; i < male.meta.groups.length; i++) {
  const a = male.meta.groups[i], b = female.meta.groups[i]
  const V = a.indexType === 32 ? Uint32Array : Uint16Array
  const ia = new V(male.raw.buffer, male.raw.byteOffset + a.offset + a.idxOff, a.tris * 3)
  const ib = new V(female.raw.buffer, female.raw.byteOffset + b.offset + b.idxOff, b.tris * 3)
  for (let k = 0; k < ia.length; k++) if (ia[k] !== ib[k]) throw new Error(`男女 index 不一致：${a.id}`)
}

const { groups, regions, meta } = male
const byId = new Map(meta.groups.map(b => [b.id, b]))
const groupById = new Map(groups.map(g => [g.id, g]))
if (groups.length !== 210 || meta.groups.length !== 211) throw new Error('数量不符：预期 210 组 / 211 mesh')

const yMidFn = cy => {
  const s = Float32Array.from(cy).sort()
  return s[Math.floor(s.length / 2)]
}

const plans = new Map()
for (const g of groups) {
  const b = byId.get(g.id)
  if (!b) throw new Error(`META 里缺 ${g.id}`)
  plans.set(g.id, planRefinement(b, male.raw, g, yMidFn))
}
// 两份几何都按同一顺序重排。
for (const g of groups) {
  const b = byId.get(g.id)
  applyOrder(b, male.raw, plans.get(g.id).order)
  applyOrder(b, female.raw, plans.get(g.id).order)
}
validateLayout(meta, male.raw, 'male(重排后)')
validateLayout(meta, female.raw, 'female(重排后)')

// 三角形总数守恒：重排只是换顺序。
const totalTris = groups.reduce((n, g) => n + byId.get(g.id).tris, 0)
const totalSegTris = [...plans.values()].reduce((n, p) => n + p.segments.reduce((s, x) => s + x.count, 0), 0)
if (totalTris !== totalSegTris) throw new Error(`三角形不守恒 ${totalTris} vs ${totalSegTris}`)

// ── ecorche.json ────────────────────────────────────────────────────────────
const blocks = groups.map(g => {
  const b = byId.get(g.id)
  const p = plans.get(g.id)
  return {
    id: g.id, slug: slugOf(g),
    cn: g.cn, en: g.en, parent: g.parent, parentCn: g.parentCn, parentEn: g.parentEn,
    region: g.region, fn: g.fn, ex: g.ex, tip: g.tip,
    verts: b.verts, tris: b.tris, parts: b.parts,
    indexType: b.indexType, posOff: b.posOff, norOff: b.norOff, colOff: b.colOff,
    idxOff: b.idxOff, byteLength: b.byteLength, offset: b.offset, bbox: b.bbox,
    segments: p.segments.map(s => ({ id: s.id, label: s.label, baseId: s.baseId, slug: s.slug, start: s.start, count: s.count })),
  }
})
const bone = byId.get('_bone')
blocks.unshift({ id: '_bone', ...bone, segments: [] })

const json = {
  version: 3,
  scale: meta.scale,
  height: bone.bbox[4],
  source: 'Écorché anatomical atlas, 210 anatomical units refined into independently selectable units. See NOTICE.md.',
  blocks,
}
fs.mkdirSync(MODELS, { recursive: true })
fs.writeFileSync(path.join(MODELS, 'ecorche.json'), JSON.stringify(json))
fs.writeFileSync(path.join(MODELS, 'ecorche-male.bin'), gzipSync(male.raw, { level: 6 }))
fs.writeFileSync(path.join(MODELS, 'ecorche-female.bin'), gzipSync(female.raw, { level: 6 }))

// ── atlas-groups.js：搜索 / 详情 / 动作推荐的数据源 ───────────────────────────
const atlas = groups.map(g => ({ ...g, slug: slugOf(g) }))
const regionCn = Object.fromEntries(regions.map(r => [r.id, r.cn]))
const units = []
for (const g of groups) {
  const p = plans.get(g.id)
  for (const s of p.segments) {
    units.push({
      id: s.id, label: s.label, baseId: s.baseId, slug: s.slug,
      side: s.side, band: s.band,
      cn: g.cn, en: g.en, region: g.region, regionCn: regionCn[g.region],
      parent: g.parent, parentCn: g.parentCn, parentEn: g.parentEn,
      fn: g.fn, ex: g.ex, tip: g.tip,
    })
  }
}
const js = `// 自动生成，请勿手改 —— 源：models-src/ecorche-atlas-*.html，生成：npm run import:atlas
// 210 个解剖单位，经左右分离与漏分大肌补分段后，得到 ${units.length} 个可独立点击的最小单位。
// 模型按 slug 合并绘制（21 个 draw call），但每个 unit 在索引缓冲里占一段连续三角形，
// 所以点哪块就只高亮哪块；左右两侧也能分别选中。

export const ATLAS_REGIONS = ${JSON.stringify(regions, null, 2)}
export const ATLAS_GROUPS = ${JSON.stringify(atlas, null, 2)}
export const ATLAS_BY_ID = Object.fromEntries(ATLAS_GROUPS.map(g => [g.id, g]))
export const ATLAS_REGION_CN = ${JSON.stringify(regionCn, null, 2)}

/** ${units.length} 个最小可点单位（含中文显示名、所属训练部位、示例动作）。 */
export const ATLAS_UNITS = ${JSON.stringify(units, null, 2)}
export const ATLAS_UNIT_BY_ID = Object.fromEntries(ATLAS_UNITS.map(u => [u.id, u]))

/** 口语/俗称 → 解剖单位 baseId。 */
export const ATLAS_ALIASES = ${JSON.stringify(SEARCH_ALIASES, null, 2)}

/** App 里能对应到训练动作的 18 个真实部位；foot / neck / face 只用于显示。 */
export const ATLAS_TRAINABLE = new Set([
  'trapezius', 'deltoids', 'chest', 'upper-back', 'serratus',
  'biceps', 'triceps', 'forearm', 'abs', 'obliques', 'lower-back',
  'gluteal', 'quadriceps', 'hamstring', 'adductors', 'hip-flexors',
  'calves', 'tibialis',
])

/** 选中若干 unit id 后，折算成训练部位（用于过滤动作库，自动去重）。 */
export function slugsOfUnits(ids) {
  const out = new Set()
  for (const id of ids || []) {
    const u = ATLAS_UNIT_BY_ID[id]
    const slug = u?.slug || ATLAS_BY_ID[id]?.slug
    if (slug && ATLAS_TRAINABLE.has(slug)) out.add(slug)
  }
  return [...out]
}

/** 文字搜索选肌肉：中文名 / 英文名 / 父级 / 区域 / 俗称 / 左右 / id，大小写不敏感。 */
export function searchAtlas(query, limit = 30) {
  const raw = String(query || '').trim().toLowerCase()
  if (!raw) return []
  const sideHint = /^(左|左侧)/.test(raw) ? 'L' : /^(右|右侧)/.test(raw) ? 'R' : null
  const q = raw.replace(/^(左侧|右侧|左|右)\\s*/, '').replace(/\\s*(左侧|右侧)$/, '')
  const aliasIds = new Set()
  for (const [word, ids] of Object.entries(ATLAS_ALIASES)) {
    if (word.includes(q) || q.includes(word)) ids.forEach(id => aliasIds.add(id))
  }
  const scored = []
  for (const u of ATLAS_UNITS) {
    if (sideHint && u.side !== sideHint) continue
    const cn = String(u.label || '').toLowerCase()
    const baseCn = String(u.cn || '').toLowerCase()
    const en = String(u.en || '').toLowerCase()
    const pCn = String(u.parentCn || '').toLowerCase()
    const pEn = String(u.parentEn || '').toLowerCase()
    const reg = String(u.regionCn || '').toLowerCase()
    const id = u.baseId.toLowerCase()
    let score = 0
    if (aliasIds.has(u.baseId)) score = 100
    else if (cn === q || baseCn === q || en === q || id === q) score = 95
    else if (cn.includes(q) || baseCn.includes(q) || en.includes(q)) score = 80
    else if (pCn.includes(q) || pEn.includes(q)) score = 55
    else if (reg.includes(q)) score = 40
    else if (u.ex && u.ex.some(x => String(x).toLowerCase().includes(q))) score = 25
    else if (id.includes(q)) score = 15
    if (score) scored.push({ u, score })
  }
  scored.sort((a, b) => b.score - a.score || ATLAS_UNITS.indexOf(a.u) - ATLAS_UNITS.indexOf(b.u))
  return scored.slice(0, limit).map(x => x.u)
}
`
fs.writeFileSync(path.join(LIB, 'atlas-groups.js'), js)

// ── 报告 ────────────────────────────────────────────────────────────────────
const slugs = {}
for (const g of atlas) slugs[g.slug] = (slugs[g.slug] || 0) + 1
const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB'
console.log('[import-atlas] 解剖单位          :', atlas.length, '（+1 骨骼）')
console.log('[import-atlas] 最小可点单位      :', units.length, `（左右分离 ${atlas.length * 2} + 补分段 ${units.length - atlas.length * 2}）`)
console.log('[import-atlas] 补分段的块        :', [...SEGMENT_Y].join(', '))
console.log('[import-atlas] draw-call 分组    :', Object.keys(slugs).length, JSON.stringify(slugs))
console.log('[import-atlas] 三角形守恒        :', totalTris, '=', totalSegTris)
console.log('[import-atlas] male.bin          :', mb(fs.statSync(path.join(MODELS, 'ecorche-male.bin')).size))
console.log('[import-atlas] female.bin        :', mb(fs.statSync(path.join(MODELS, 'ecorche-female.bin')).size))
console.log('[import-atlas] ecorche.json      :', mb(fs.statSync(path.join(MODELS, 'ecorche.json')).size))
console.log('[import-atlas] atlas-groups.js   :', mb(fs.statSync(path.join(LIB, 'atlas-groups.js')).size))
console.log('[import-atlas] 布局校验通过；男女共用同一份 segments 表。')
