// 小G 直接改设置（lib/agent/settings.js）的白名单与写入器。
// 这里钉的是三件事：模型给的别名能认出来、值不合法时绝不写、切单位真的把数字一起换算。
import { describe, expect, it } from 'vitest'
import {
  SETTINGS, resolveSetting, normalizeValue, applySetting, applyModule, resolveModule,
  showValue, previewLabel, settingsText, readBool,
} from './settings.js'

const base = () => ({ unit: 'kg', lang: 'zh', theme: 'dark', accent: 'yuan', routines: [], workouts: [] })

describe('resolveSetting — 认名字', () => {
  it('标准 key 和它的别名都能对上', () => {
    expect(resolveSetting('unit').key).toBe('unit')
    expect(resolveSetting('weightUnit').key).toBe('unit')
    expect(resolveSetting('重量单位').key).toBe('unit')
    expect(resolveSetting('weight-unit').key).toBe('unit')
    expect(resolveSetting('休息计时').key).toBe('restSec')
    expect(resolveSetting('theme').key).toBe('theme')
  })

  it('不认识的 key 是 null —— 白名单之外一律不动', () => {
    for (const bad of ['serverUrl', 'apiKey', '', null, 'password']) {
      expect(resolveSetting(bad)).toBeNull()
    }
  })

  it('每个 key 唯一，别互相抢', () => {
    const keys = SETTINGS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('readBool', () => {
  it('布尔、字符串、中文开关都认', () => {
    expect(readBool(true)).toBe(true)
    expect(readBool('off')).toBe(false)
    expect(readBool('开')).toBe(true)
    expect(readBool('关闭')).toBe(false)
    expect(readBool(0)).toBe(false)
  })

  it('认不出来是 null，不是 false', () => {
    expect(readBool('也许')).toBeNull()
    expect(readBool(undefined)).toBeNull()
  })
})

describe('normalizeValue — 值域校验', () => {
  it('单位的各种写法都归到 kg / lb', () => {
    const unit = resolveSetting('unit')
    for (const v of ['lb', 'lbs', 'POUNDS', '磅']) expect(normalizeValue(unit, v, base())).toBe('lb')
    for (const v of ['kg', 'kgs', '公斤', '千克']) expect(normalizeValue(unit, v, base())).toBe('kg')
    expect(normalizeValue(unit, '石头', base())).toBeNull()
  })

  it('数字夹在范围里并按步长对齐', () => {
    const rest = resolveSetting('restSec')
    expect(normalizeValue(rest, 10000, base())).toBe(600)
    expect(normalizeValue(rest, 3, base())).toBe(10)
    expect(normalizeValue(rest, 122, base())).toBe(120)
    expect(normalizeValue(rest, 'abc', base())).toBeNull()
  })

  it('布尔设置接受中文', () => {
    expect(normalizeValue(resolveSetting('sound'), '关', base())).toBe(false)
  })

  it('未知值返回 null，不会退化成某个默认值', () => {
    expect(normalizeValue(resolveSetting('theme'), '午夜蓝', base())).toBeNull()
  })

  it('用户嘴里的说法也能落到值上（语言 / 主题 / 主题色）', () => {
    expect(normalizeValue(resolveSetting('lang'), '中文', base())).toBe('zh')
    expect(normalizeValue(resolveSetting('lang'), '英文', base())).toBe('en')
    expect(normalizeValue(resolveSetting('theme'), '深色模式', base())).toBe('dark')
    expect(normalizeValue(resolveSetting('theme'), '浅色', base())).toBe('light')
    expect(normalizeValue(resolveSetting('accent'), '绿色', base())).toBe('lime')
    expect(normalizeValue(resolveSetting('accent'), '蓝色', base())).toBe('yuan')
  })
})

describe('applySetting — 切单位', () => {
  const withWeights = () => ({
    unit: 'kg',
    bodyweight: [{ date: '2026-11-01', w: 100 }],
    workouts: [{ date: '2026-11-01', entries: [{ id: '0025', sets: [{ w: 100, reps: 5 }] }] }],
    routines: [],
  })

  it('默认把每一处重量都换算（100 kg → 220.5 lb，按显示精度）', () => {
    const s = withWeights()
    const out = applySetting(s, 'unit', 'lb')
    expect(out.ok).toBe(true)
    expect(s.unit).toBe('lb')
    expect(s.bodyweight[0].w).toBeCloseTo(220.5, 1)
    expect(s.workouts[0].entries[0].sets[0].w).toBeCloseTo(220.5, 1)
    expect(out.text).toContain('磅')
  })

  it('convert:false 只换标签，数字一个都不动', () => {
    const s = withWeights()
    applySetting(s, 'unit', 'lb', { convert: false })
    expect(s.unit).toBe('lb')
    expect(s.bodyweight[0].w).toBe(100)
    expect(s.workouts[0].entries[0].sets[0].w).toBe(100)
  })

  it('打上 unitSet 时间戳，合并时才知道这条单位是最后改的', () => {
    const s = withWeights()
    applySetting(s, 'unit', 'lb')
    expect(s.unitSet.convert).toBe(true)
    expect(s.unitSet.at).toBeGreaterThan(0)
  })

  it('已经是这个单位时什么也不做，但也不报错', () => {
    const s = withWeights()
    const out = applySetting(s, 'unit', 'kg')
    expect(out.ok).toBe(true)
    expect(s.unitSet).toBeUndefined()
  })
})

describe('applySetting — 普通设置', () => {
  it('语言顺手清掉「跟随系统」的标记', () => {
    const s = { ...base(), langAuto: true }
    applySetting(s, 'lang', 'en')
    expect(s.lang).toBe('en')
    expect(s.langAuto).toBe(false)
  })

  it('主题 / 强调色 / 休息计时都写进对应字段', () => {
    const s = base()
    applySetting(s, 'theme', 'light')
    applySetting(s, 'accent', 'lime')
    applySetting(s, 'restSec', 150)
    expect(s.theme).toBe('light')
    expect(s.accent).toBe('lime')
    expect(s.restSec).toBe(150)
  })

  it('速度单位的「跟随」写回 null', () => {
    const s = { ...base(), speedUnit: 'mph' }
    applySetting(s, 'speedUnit', 'auto')
    expect(s.speedUnit).toBeNull()
  })

  it('周日开始写 0，周一写 1', () => {
    const s = base()
    applySetting(s, 'weekStart', 'sunday')
    expect(s.weekStart).toBe(0)
    applySetting(s, 'weekStart', '周一')
    expect(s.weekStart).toBe(1)
  })

  it('不在白名单里的 key 拒绝，状态原样', () => {
    const s = base()
    const before = JSON.stringify(s)
    const out = applySetting(s, 'serverUrl', 'http://x')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('不能改')
    expect(JSON.stringify(s)).toBe(before)
  })

  it('值不合法时拒绝，并在 reason 里说清能填什么', () => {
    const s = base()
    const out = applySetting(s, 'theme', '午夜蓝')
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('只接受')
    expect(s.theme).toBe('dark')
  })

  it('本来就是那个值时如实说，不重复写', () => {
    const s = { ...base(), theme: 'light' }
    const out = applySetting(s, 'theme', 'light')
    expect(out.ok).toBe(true)
    expect(out.text).toContain('本来')
  })
})

describe('模块开关', () => {
  it('id 和中文名都能对上', () => {
    expect(resolveModule('checkin')).toBe('checkin')
    expect(resolveModule('签到')).toBe('checkin')
    expect(resolveModule('AI 教练')).toBe('coach')
    expect(resolveModule('没有这个')).toBeNull()
  })

  it('关掉写 false、打开写 true，只存改过的（isOn 的规矩）', () => {
    const s = base()
    applyModule(s, '签到', false)
    expect(s.modules.checkin).toBe(false)
    applyModule(s, '签到', '开')
    expect(s.modules.checkin).toBe(true)
    expect(s.modules.other).toBeUndefined()
  })

  it('不存在的模块不往 modules 里写垃圾', () => {
    const s = base()
    const out = applyModule(s, '量子模块', false)
    expect(out.ok).toBe(false)
    expect(s.modules).toBeUndefined()
  })
})

describe('给人看的文案', () => {
  it('showValue 把原始值翻成中文', () => {
    expect(showValue(resolveSetting('unit'), { unit: 'lb' })).toBe('磅 (lb)')
    expect(showValue(resolveSetting('theme'), { theme: 'light' })).toBe('浅色')
    expect(showValue(resolveSetting('sound'), { sound: false })).toBe('关')
    expect(showValue(resolveSetting('restSec'), { restSec: 120 })).toBe('120 秒')
  })

  it('确认卡片上无效值直说无效，不装作能改', () => {
    expect(previewLabel(resolveSetting('theme'), '午夜蓝', {})).toContain('无效')
    expect(previewLabel(resolveSetting('unit'), '磅', {})).toBe('磅 (lb)')
  })

  it('prompt 里的清单覆盖每一条设置，并标出它在哪一页', () => {
    const text = settingsText()
    expect(text).toContain('可以直接改的设置')
    expect(text).toContain('restSec')
    expect(text).toContain('在 /settings/units')
    expect(text).toContain('可以开关的模块')
    for (const s of SETTINGS) expect(text).toContain(s.key)
  })
})
