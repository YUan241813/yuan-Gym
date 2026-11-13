// ═══════════════════════════════════════════════════════════════════════════════════
//  唯一需要动的地方 —— 换成你自己的 3D 人体模型，就改这一个文件。
// ═══════════════════════════════════════════════════════════════════════════════════
//
// 页面、相机、光照、点击选中、热力上色、正背面对照、X 光透明、左右转动……全部由
// BodyModel3D 负责，跟模型怎么做的无关。这个文件只回答一个问题：
//   「给我一个 half（'all' / 'front' / 'back'），还我一个能画的模型。」
//
// ── 接法 A：glb / gltf 文件（最常见，推荐）────────────────────────────────────
//   1) 把模型丢进 `app/frontend/public/models/body.glb`（public 下的东西会原样进包）
//   2) 把下面 MODEL.url 改成 '/models/body.glb'
//   3) 关键：模型里每一块肌肉的**网格名**要是这 18 个之一（大小写、下划线、中文名
//      都能认，见 lib/muscle-facts.js）：
//        trapezius 斜方肌   deltoids 三角肌     chest 胸大肌       upper-back 上背
//        serratus 前锯肌    biceps 肱二头肌      triceps 肱三头肌    forearm 前臂
//        abs 腹直肌         obliques 腹斜肌      lower-back 下背     gluteal 臀肌
//        quadriceps 股四头肌 hamstring 腘绳肌    adductors 内收肌    hip-flexors 髂腰肌
//        calves 小腿         tibialis 胫骨前肌
//      名字不对的网格会被当成「非肌肉」——不亮、点不到，但也不会报错。
//   4) 建议：模型朝 +Z，脚底贴在 y=0，单位米。单位不对也没关系，autoFit 会按身高
//      1.8m 自动缩放并居中（模型是 180 单位高也照样对）。
//
// ── 接法 B：直接给 three.js 代码 ────────────────────────────────────────────
//   用 `buildFromModel` 里写好的钩子返回自己的 Object3D，或者把整棵 Group 塞进
//   `setTemplate()`。要求只有一条：每个肌肉网格的 `mesh.name`（或
//   `mesh.userData.muscle`）能对上上面的 slug。剩下的交给 normalize.js。
//
// ── 想按用户身材变形？──────────────────────────────────────────────────────
//   实现下面的 `applyProfile(root, { profile, gender })`。profile 里有
//   { height, shoulder, chest, waist, hip, ... }（见 lib/anatomy-profile.js）。
//   没实现就是固定模型，页面其它功能一切照常。
//
// 说明：`profile` 变化时不会重载模型，只会再调一次 applyProfile，所以那里应该是
// 「按比例缩放骨骼/顶点」这类便宜操作，不要重新加载资源。

import { normalizeBuiltModel, SLUGS } from './normalize.js'

/** 模型清单。除 url 外都可以留空。 */
export const MODEL = {
  /** '/models/body.glb' —— 设了它，就启用了自定义模型；null 则用 App 内置的程序化人体。 */
  url: null,
  /** 只让这些肌肉可点。null = 18 个全开。模型缺哪块就把它从这里去掉。 */
  pickable: null,
  /** 如果模型里有一层独立的外皮网格，填它的节点名，X 光模式就能单独淡化这层。 */
  skinName: null,
  /** 如果有独立骨骼网格，填节点名，就能被「显示骨骼」开关控制。 */
  bonesName: null,
  /** 目标身高（米）。autoFit 会按它缩放。 */
  height: 1.8,
  /** 自动缩放/居中。自己已经摆好了就设 false。 */
  autoFit: true,
  /**
   * 兜底：网格名认不出来时，用这张表硬指定。
   * 例：{ 'Object_12': 'chest', 'Object_13': 'deltoids' }
   * 用之前先确认网格名——模型里每一块肌肉的 name 对上 slug 的话这里不用填。
   */
  meshMap: null,
}

/** 可选钩子：按用户身材调整模型。默认什么都不做。 */
export function applyProfile(/* root, { profile, gender } */) {}

// ── 以下一般不用改 ──────────────────────────────────────────────────────────

// 按性别缓存模板：male / female 各一份（各自对应 ecorche-male.bin / ecorche-female.bin）。
// 切换性别时按性别重新 preload，两份几何互不覆盖，免去反复解压 6 MB。
let templates = {}      // { male: { build, source }, female: ... }
let pending = {}        // { male: Promise, female: Promise }
let failed = false

/** 某个性别的模型是否已加载（false = 正在用内置模型）。 */
export const modelReady = (gender = 'male') => !!(gender === 'female' ? templates.female : templates.male)

/** 加载失败、已经退回内置程序化人体。 */
export const modelFailed = () => failed

/** 直接塞一个模板进来（接法 B 用）。 */
export function setTemplate(t, gender = 'male') {
  const key = gender === 'female' ? 'female' : 'male'
  templates[key] = t
  delete pending[key]
  failed = false
}

/**
 * 预加载。解析失败也 resolve(null) —— 模型坏了就退回内置人体，不能让解剖页白屏。
 *
 * 默认加载 Écorché（210 块细肌束，assets 随包发布，男女两套几何）；只有在 MODEL.url
 * 被填上时才改走 glTF 文件那条路。gender 决定加载男/女几何。
 */
export function preloadModel(gender = 'male') {
  const key = gender === 'female' ? 'female' : 'male'
  if (templates[key]) return Promise.resolve(templates[key])
  if (pending[key]) return pending[key]

  // 动态 import：没配 url 的版本里 GLTFLoader（约 50KB gzip）根本不会进包。
  const loader = MODEL.url
    ? import('./gltf-body.js').then(m => m.loadBodyTemplate(MODEL, { applyProfile, normalizeBuiltModel, SLUGS }))
    : import('./ecorche.js').then(m => m.loadEcorche(key))

  pending[key] = loader
    .then(t => { templates[key] = t; delete pending[key]; return t })
    .catch(err => { delete pending[key]; failed = true; console.warn('[anatomy] 模型加载失败，已回退内置模型：', err); return null })
  return pending[key]
}

/** 建一个实例；没有对应性别的模型就返回 null，由 facade 回退。 */
export function buildFromModel(opts = {}) {
  const key = (opts.gender === 'female') ? 'female' : 'male'
  const t = templates[key]
  if (!t) return null
  return t.build(opts)
}
