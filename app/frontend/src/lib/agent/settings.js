// 小G 能「直接在对话框里改」的设置 —— 一份白名单。
//
// 为什么是白名单而不是「随便改 S 上的字段」：小G 收到的 JSON 是模型生成的，模型一旦幻觉出
// 一个错字段（S.unit 写成 S.units、S.theme 写成 S.dark），最坏的结果不是没改，而是回了句
// 「已经帮你改成浅色了」而屏幕上什么都没变。所以这里每个 key 都对应一段明确的写入器，
// 值域在写入前校验；账号、服务器、文件路径、导出这些「改坏了收不回来」的东西根本不进这张表。
//
// 三个使用方：
//   1. lib/agent/actions.js 的 set-setting / set-module 动作（真正写状态）
//   2. lib/agent/agent.js 的 system prompt（settingsText()，告诉模型能改什么）
//   3. lib/agent/actions.js 的 previewActions（确认卡片里给人看的一行字）

import { LANGS } from '../i18n-core.js'
import { ACCENTS, ACCENT_NAMES } from '../format.js'
import { convertStateUnit } from '../units.js'
import { highestStamp } from '../sync-merge.js'
import { MODULES } from '../modules.js'

// 模型给的名字千奇百怪：「单位」「weight unit」「weightUnit」「units」。
// 比较时统一去空白、下划线、连字符并转小写，所以表里只写一种写法就够，别名按需加。
const keyOf = v => String(v || '').toLowerCase().replace(/[\s_\-.]/g, '')
const labelOf = v => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')

const BOOL = ['on', 'true', 'yes', '开', '打开', '开启', '启用', '是', '1']
const BOOL_OFF = ['off', 'false', 'no', '关', '关闭', '关掉', '停用', '否', '0']

/** 布尔值：模型可能给 true/false，也可能给 "on"/"开"/"关闭"。 */
export function readBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const s = labelOf(v)
  if (BOOL.includes(s)) return true
  if (BOOL_OFF.includes(s)) return false
  return null
}

const clampNum = (v, lo, hi, step) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const c = Math.min(hi, Math.max(lo, step ? Math.round(n / step) * step : n))
  return step ? Math.round(c * 1000) / 1000 : c
}

// 单位换算要在草稿上就地完成：convertStateUnit 返回的是新对象，把它整份铺回草稿。
// 这样仍然走 useStore 的 update（事务 + 持久化 + 云同步），不必去调 store 的 setUnit。
const writeUnit = (s, to, opts) => {
  const convert = opts?.convert !== false
  const next = convert ? convertStateUnit(s, to) : { ...s, unit: to }
  Object.assign(s, next)
  // 和 store 的 setUnit 一样打时间戳：两台设备一台在 kg 一台在 lb 时，谁最后改的说了算
  // （lib/sync-merge.js 的 unitSet 规则）。时钟偏差时用已有最大时间 +1 兜住。
  s.unitSet = { at: Math.max(Date.now(), highestStamp(s) + 1), convert }
}

/**
 * 一条可改的设置。
 *   kind 'choice' —— choices 里的 value 或它的中文名都能写
 *   kind 'bool'   —— true/false、开/关
 *   kind 'number' —— range 里夹一下，step 对齐
 * `read` 取当前值（给人看的一行字），`show` 把原始值翻成中文。
 */
export const SETTINGS = [
  {
    key: 'unit', label: '重量单位', page: 'units', kind: 'choice',
    aliases: ['unit', 'units', 'weightunit', '重量单位', '单位', '公斤还是磅'],
    choices: [{ v: 'kg', label: '公斤 (kg)' }, { v: 'lb', label: '磅 (lb)' }],
    // 单位是用户最常手写的一对值：lbs / pounds / 磅 都得认。
    alts: { kg: ['kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', '公斤', '千克'], lb: ['lbs', 'pound', 'pounds', '磅'] },
    read: S => (S.unit === 'lb' ? 'lb' : 'kg'),
    write: writeUnit,
    // 单位是本轮唯一带副作用的设置，所以它的 summary 自己写。
    say: (to, opts) => to === 'lb'
      ? `重量单位改成磅（${opts?.convert === false ? '数字没动，只换了标签' : '所有记录的重量都换算成磅'}）`
      : `重量单位改成公斤（${opts?.convert === false ? '数字没动，只换了标签' : '所有记录的重量都换算成公斤'}）`,
  },
  {
    key: 'lang', label: '语言', page: 'units', kind: 'choice',
    aliases: ['lang', 'language', 'locale', '语言', '界面语言'],
    choices: Object.entries(LANGS).map(([v, name]) => ({ v, label: name })),
    // 用户说的是语言，模型要把它落到代码上。
    hint: 'en 英、zh 简中、zh-TW 繁中、de 德、es 西、fr 法、it 意、pt 葡、pt-BR 巴葡、pl 波、tr 土、ru 俄、uk 乌、ko 韩、hi 印地、bn 孟加拉、th 泰、hu 匈、sv 瑞典、ar 阿拉伯',
    alts: { zh: ['中文', '简体', '简体中文', '汉语'], en: ['英文', '英语'], 'zh-TW': ['繁体', '繁体中文', '台湾'], de: ['德语'], es: ['西语', '西班牙语'], fr: ['法语'], it: ['意语', '意大利语'], ru: ['俄语'], ko: ['韩语'], th: ['泰语'], ar: ['阿拉伯语'] },
    read: S => (LANGS[S.lang] ? S.lang : 'en'),
    // 手动选了语言就把「自动跟随系统」的标记摘掉，和设置页的写法一致。
    write: (s, v) => { s.lang = v; s.langAuto = false },
  },
  {
    key: 'theme', label: '主题', page: 'look', kind: 'choice',
    aliases: ['theme', 'appearance', 'darkmode', '主题', '外观', '深色模式', '浅色模式'],
    choices: [{ v: 'dark', label: '深色' }, { v: 'light', label: '浅色' }, { v: 'system', label: '跟随系统' }],
    alts: { dark: ['深色模式', '夜间', '黑夜', '暗色'], light: ['浅色模式', '白天', '日间', '亮色'], system: ['自动', '系统', '跟随系统设置'] },
    read: S => (['dark', 'light', 'system'].includes(S.theme) ? S.theme : 'dark'),
    write: (s, v) => { s.theme = v },
  },
  {
    key: 'accent', label: '主题色', page: 'look', kind: 'choice',
    aliases: ['accent', 'color', 'colour', 'accentcolor', '主题色', '强调色', '颜色'],
    choices: [
      { v: 'yuan', label: '蓝色（默认）' },
      ...Object.entries(ACCENT_NAMES).map(([v, name]) => ({ v, label: name })),
    ],
    alts: {
      yuan: ['默认蓝', '系统色'], lime: ['绿色', '绿'], sky: ['蓝色', '蓝'], orange: ['橙色', '橘色', '橘'],
      violet: ['紫色', '紫'], pink: ['粉色', '粉'], red: ['红色', '红'], teal: ['青色', '青'], gold: ['黄色', '金色', '黄'],
    },
    read: S => (ACCENTS[S.accent] ? S.accent : 'yuan'),
    write: (s, v) => { s.accent = v },
  },
  {
    key: 'body', label: '体型图性别', page: 'look', kind: 'choice',
    aliases: ['body', 'sex', 'gender', '体型图', '性别', '人体模型'],
    choices: [{ v: 'male', label: '男' }, { v: 'female', label: '女' }],
    read: S => (S.body === 'female' ? 'female' : 'male'),
    write: (s, v) => { s.body = v },
  },
  {
    key: 'wdec', label: '重量小数位', page: 'units', kind: 'choice',
    aliases: ['wdec', 'decimals', 'weightdecimals', '小数位', '重量小数', '精度'],
    choices: [{ v: 1, label: '1 位小数' }, { v: 2, label: '2 位小数' }],
    read: S => (S.wdec === 2 ? 2 : 1),
    write: (s, v) => { s.wdec = v },
  },
  {
    key: 'speedUnit', label: '速度单位', page: 'units', kind: 'choice',
    aliases: ['speedunit', 'speed', '速度单位', '配速单位'],
    choices: [{ v: 'kmh', label: 'km/h' }, { v: 'mph', label: 'mph' }, { v: 'auto', label: '跟随重量单位' }],
    read: S => (S.speedUnit === 'mph' || S.speedUnit === 'kmh' ? S.speedUnit : 'auto'),
    // null 就是「跟随重量单位」（lib/speed.js speedUnitOf）。
    write: (s, v) => { s.speedUnit = v === 'auto' ? null : v },
  },
  {
    key: 'weekStart', label: '一周从哪天开始', page: 'plan', kind: 'choice',
    aliases: ['weekstart', 'firstdayofweek', '周起始', '每周第一天', '一周从哪天开始'],
    choices: [{ v: 'monday', label: '周一' }, { v: 'sunday', label: '周日' }],
    read: S => (S.weekStart === 0 ? 'sunday' : 'monday'),
    write: (s, v) => { s.weekStart = v === 'sunday' ? 0 : 1 },
  },
  {
    key: 'restSec', label: '休息计时', page: 'workout', kind: 'number',
    aliases: ['restsec', 'resttimer', 'rest', '休息计时', '休息时间', '组间休息', '计时'],
    range: { min: 10, max: 600, step: 5, unit: '秒' },
    read: S => (Number.isFinite(Number(S.restSec)) ? Number(S.restSec) : 90),
    write: (s, v) => { s.restSec = v },
    show: v => `${v} 秒`,
  },
  {
    key: 'workoutView', label: '训练界面布局', page: 'workout', kind: 'choice',
    aliases: ['workoutview', 'layout', '布局', '训练布局', '界面布局'],
    choices: [{ v: 'cards', label: '卡片（一次一个动作）' }, { v: 'list', label: '列表（全部铺开）' }, { v: 'compact', label: '紧凑' }],
    read: S => (['cards', 'list', 'compact'].includes(S.workoutView) ? S.workoutView : 'cards'),
    write: (s, v) => { s.workoutView = v },
  },
  {
    key: 'warmupAuto', label: '自动热身', page: 'workout', kind: 'choice',
    aliases: ['warmupauto', 'warmup', '热身', '自动热身', '热身组'],
    choices: [{ v: 'off', label: '关' }, { v: 'compounds', label: '只给复合动作' }, { v: 'all', label: '所有动作' }],
    read: S => (['off', 'compounds', 'all'].includes(S.warmupAuto) ? S.warmupAuto : 'off'),
    write: (s, v) => { s.warmupAuto = v },
  },
  {
    key: 'startFrom', label: '训练从哪开始算', page: 'advanced', kind: 'choice',
    aliases: ['startfrom', 'plannedstart', '起始重量', '从哪开始'],
    choices: [{ v: 'plan', label: '按计划' }, { v: 'last', label: '按上次训练' }],
    read: S => (S.startFrom === 'last' ? 'last' : 'plan'),
    write: (s, v) => { s.startFrom = v },
  },
  {
    key: 'lastFrom', label: '「上次」指哪一次', page: 'advanced', kind: 'choice',
    aliases: ['lastfrom', 'lasttime', '上次参考', '上次是哪次'],
    choices: [{ v: 'routine', label: '这个动作组的上一次' }, { v: 'any', label: '任何训练里的最近一次' }],
    read: S => (S.lastFrom === 'any' ? 'any' : 'routine'),
    write: (s, v) => { s.lastFrom = v },
  },
  {
    key: 'progDefault', label: '默认进阶方式', page: 'advanced', kind: 'choice',
    aliases: ['progdefault', 'progression', '进阶', '进阶方式', '加重方式'],
    choices: [
      { v: 'linear', label: '线性加重' },
      { v: 'off', label: '不自动进阶' },
      { v: 'greyskull', label: 'Greyskull LP' },
      { v: 'double', label: '双重进阶' },
      { v: 'triple', label: '三重进阶' },
    ],
    read: S => (['off', 'linear', 'greyskull', 'double', 'triple'].includes(S.progDefault) ? S.progDefault : 'linear'),
    write: (s, v) => { s.progDefault = v },
  },
  {
    key: 'volumeWarmups', label: '热身计入总量', page: 'units', kind: 'bool',
    aliases: ['volumewarmups', 'countwarmups', '热身计入总量'],
    read: S => !!S.volumeWarmups,
    write: (s, v) => { s.volumeWarmups = v },
  },
  {
    key: 'volumeBodyweight', label: '自重计入总量', page: 'units', kind: 'bool',
    aliases: ['volumebodyweight', 'countbodyweight', '自重计入总量'],
    read: S => !!S.volumeBodyweight,
    write: (s, v) => { s.volumeBodyweight = v },
  },
  {
    key: 'weighIn', label: '训练前称重', page: 'workout', kind: 'bool',
    aliases: ['weighin', '称重', '训练前称重'],
    read: S => S.weighIn !== false,
    write: (s, v) => { s.weighIn = v },
  },
  {
    key: 'keepAwake', label: '屏幕常亮', page: 'workout', kind: 'bool',
    aliases: ['keepawake', 'wakelock', '屏幕常亮', '保持亮屏'],
    read: S => S.keepAwake !== false,
    write: (s, v) => { s.keepAwake = v },
  },
  {
    key: 'sound', label: '提示音', page: 'alerts', kind: 'bool',
    aliases: ['sound', '音效', '提示音', '声音'],
    read: S => S.sound !== false,
    write: (s, v) => { s.sound = v },
  },
  {
    key: 'vibrate', label: '震动', page: 'alerts', kind: 'bool',
    aliases: ['vibrate', 'vibration', '震动', '振动'],
    read: S => S.vibrate !== false,
    write: (s, v) => { s.vibrate = v },
  },
  {
    key: 'timerFlash', label: '计时结束闪屏', page: 'alerts', kind: 'bool',
    aliases: ['timerflash', 'flash', '闪屏', '闪光'],
    read: S => !!S.timerFlash,
    write: (s, v) => { s.timerFlash = v },
  },
  {
    key: 'showWeightCard', label: '首页体重卡片', page: 'look', kind: 'bool',
    aliases: ['showweightcard', '体重卡片', '首页体重'],
    read: S => S.showWeightCard !== false,
    write: (s, v) => { s.showWeightCard = v },
  },
  {
    key: 'targetW', label: '目标体重', page: 'body-edit', kind: 'number',
    aliases: ['targetw', 'targetweight', '目标体重'],
    // 数值按当前单位理解，所以范围跟着单位走（20-400 kg 换成磅就是 45-880）。
    range: { min: 20, max: 400, step: 0.1 },
    read: S => (Number.isFinite(Number(S.targetW)) ? Number(S.targetW) : null),
    write: (s, v) => { s.targetW = v },
    show: (v, S) => `${v} ${S?.unit === 'lb' ? 'lb' : 'kg'}`,
    // 磅的人填 400 以上很常见，范围放宽。
    rangeOf: S => (S?.unit === 'lb' ? { min: 44, max: 900, step: 0.1 } : { min: 20, max: 400, step: 0.1 }),
  },
]

const BOOL_LABEL = v => (v ? '开' : '关')

/** 把模型给的 key/别名解析成一条设置；找不到返回 null。 */
export function resolveSetting(name) {
  const k = keyOf(name)
  if (!k) return null
  const direct = SETTINGS.find(s => keyOf(s.key) === k)
  if (direct) return direct
  return SETTINGS.find(s => (s.aliases || []).some(a => keyOf(a) === k)) || null
}

/** 设置当前值的中文说法，给确认卡片和「现在是 X」用。 */
export function showValue(entry, S) {
  const raw = entry.read(S)
  if (entry.show) return entry.show(raw, S)
  if (entry.kind === 'bool') return BOOL_LABEL(raw)
  if (entry.kind === 'choice') {
    const hit = entry.choices.find(c => c.v === raw)
    return hit ? hit.label : String(raw)
  }
  return raw == null ? '未设置' : String(raw)
}

/** 一个值能不能被这条设置接受；能就返回规范化后的值，不能返回 null。 */
export function normalizeValue(entry, value, S) {
  if (entry.kind === 'bool') return readBool(value)
  if (entry.kind === 'number') {
    const range = entry.rangeOf ? entry.rangeOf(S) : entry.range
    return clampNum(value, range.min, range.max, range.step)
  }
  // choice：先比 value，再比中文/英文标签，最后比别名（lbs / pounds / 磅）
  const v = labelOf(value)
  const hit = entry.choices.find(c => String(c.v).toLowerCase() === v)
    || entry.choices.find(c => labelOf(c.label) === v || labelOf(c.label).startsWith(v))
  if (hit) return hit.v
  for (const [val, alts] of Object.entries(entry.alts || {})) {
    if (alts.includes(v)) return val
  }
  return null
}

/**
 * 确认卡片上的「要改成什么」：把模型给的值翻成中文，值不合法时直说无效。
 * 不读当前状态（卡片可能比执行早一步），只按设置自己的定义解释。
 */
export function previewLabel(entry, value, S) {
  const v = normalizeValue(entry, value, S)
  if (v == null) return `「${String(value ?? '')}」无效`
  if (entry.kind === 'bool') return BOOL_LABEL(v)
  if (entry.kind === 'choice') return (entry.choices.find(c => c.v === v) || {}).label || String(v)
  return entry.range?.unit ? `${v} ${entry.range.unit}` : String(v)
}

/**
 * 写一条设置进草稿 s。
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
export function applySetting(s, name, value, opts) {
  const entry = resolveSetting(name)
  if (!entry) return { ok: false, reason: `不能改这个设置：${name || '（空）'}` }
  const v = normalizeValue(entry, value, s)
  if (v == null) {
    const want = entry.kind === 'choice' ? entry.choices.map(c => c.label).join(' / ')
      : entry.kind === 'bool' ? '开 / 关'
        : `一个数字（${entry.range.min}-${entry.range.max}）`
    return { ok: false, reason: `「${entry.label}」只接受：${want}` }
  }
  const was = entry.read(s)
  if (was === v) return { ok: true, text: `「${entry.label}」本来就是 ${showValue(entry, s)}` }
  entry.write(s, v, opts)
  const text = entry.say ? entry.say(v, opts) : `「${entry.label}」改成 ${showValue(entry, s)}`
  return { ok: true, text }
}

// --- 模块开关（设置 › 模块）-----------------------------------------------
// 模块的 id 是英文（checkin / motivation / …），模型很容易照抄，但用户说的是「签到」「激励」。
// 中文叫法在 MODULES 的 title 里是翻译 key，这里另给一份别名表，避免依赖 t()。
const MODULE_ALIAS = {
  effort: ['用力程度', '努力程度', 'rir', 'rpe'],
  plates: ['杠铃片', '片重', '热身'],
  strength: ['力量等级', '力量水平', '等级'],
  videos: ['视频', '动作视频', '录像'],
  checkin: ['签到', '打卡', '拍照签到', '普通签到', '照片签到', '每日签到'],
  body: ['身体', '体重', '身体数据', '围度'],
  motivation: ['激励', '鼓励', '挑战', '连续记录', '成就'],
  coach: ['ai教练', 'ai 教练', '教练', '小g'],
  seasonal: ['节日主题', '节日', '万圣节', '圣诞'],
}

/** 模块 id 的中文名，给 summary 和 prompt 用。 */
export function moduleLabel(id) {
  const m = MODULES.find(x => x.id === id)
  if (!m) return id
  return (MODULE_ALIAS[id] || [])[0] || m.title
}

/** 把模型给的模块名解析成 id；找不到返回 null。 */
export function resolveModule(name) {
  const k = labelOf(name).replace(/\s+/g, '')
  if (!k) return null
  const byId = MODULES.find(m => m.id === k)
  if (byId) return byId.id
  const byAlias = MODULES.find(m => (MODULE_ALIAS[m.id] || []).some(a => labelOf(a).replace(/\s+/g, '') === k))
  if (byAlias) return byAlias.id
  // 「AI 教练」这种带空格的，去空格后再比一次
  return MODULES.find(m => (MODULE_ALIAS[m.id] || []).some(a => labelOf(a).replace(/\s+/g, '').includes(k) && k.length >= 2))?.id || null
}

/** 开/关一个模块。S.modules 只存「改过的」（lib/modules.js isOn 的规矩）。 */
export function applyModule(s, name, on) {
  const id = resolveModule(name)
  if (!id) return { ok: false, reason: `没有这个模块：${name || '（空）'}` }
  const flag = readBool(on)
  if (flag == null) return { ok: false, reason: '模块只能开或关' }
  s.modules = { ...(s.modules || {}), [id]: flag }
  return { ok: true, text: `「${moduleLabel(id)}」模块${flag ? '打开' : '关闭'}了` }
}

/** 这条设置在 App 的哪一页（改完想给个 go 时用）。 */
const pathOf = s => (s.page === 'body-edit' ? '/body-edit' : `/settings/${s.page}`)

/** 给 system prompt 的设置清单，一行一条。 */
export function settingsText() {
  const lines = SETTINGS.map(s => {
    const where = `（在 ${pathOf(s)}）`
    if (s.kind === 'choice') return `${s.key} · ${s.label}${where}：${s.choices.map(c => c.v).join(' / ')}${s.hint ? `\n    ${s.hint}` : ''}`
    if (s.kind === 'bool') return `${s.key} · ${s.label}${where}：true / false`
    return `${s.key} · ${s.label}${where}：数字，${s.range.min}-${s.range.max}${s.range.unit ? '（' + s.range.unit + '）' : ''}`
  })
  const mods = MODULES.map(m => `${m.id}（${moduleLabel(m.id)}）`).join('、')
  return `【可以直接改的设置】\n${lines.join('\n')}\n【可以开关的模块】${mods}`
}
