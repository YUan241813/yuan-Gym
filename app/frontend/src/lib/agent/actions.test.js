// 小G 的写操作（lib/agent/actions.js）。这一轮新加的是「排日程」和「带路」两类，
// 也是用户抱怨的那两件事的直接实现，所以钉得细一点：名字怎么解析、写到哪个字段、
// 只写 week 会不会被「循环排队」模式盖掉、非法路径绝不跳。
import { describe, expect, it } from 'vitest'
import { applyActions, previewActions, resolveRoutine } from './actions.js'
import { allExercises } from '../exercises.js'

const base = () => ({
  routines: [
    { id: 'r1', name: '推日', emoji: 'arm', ex: [] },
    { id: 'r2', name: '拉日', emoji: 'pullup', ex: [] },
    { id: 'r3', name: '腿日', emoji: 'legs', ex: [] },
  ],
  week: { 6: ['r3'] },
  dayPlan: {},
})

describe('resolveRoutine', () => {
  it('精确名字', () => {
    expect(resolveRoutine(base(), '推日')).toBe('r1')
  })

  it('忽略大小写和多余空白', () => {
    const s = { routines: [{ id: 'x', name: 'Push Day' }] }
    expect(resolveRoutine(s, '  push  day ')).toBe('x')
  })

  it('允许互相包含（用户可能只说了半截名字）', () => {
    const s = { routines: [{ id: 'x', name: '上肢推日 A' }] }
    expect(resolveRoutine(s, '上肢推日')).toBe('x')
  })

  it('太短的名字不做包含匹配，免得「A」抢走「A 推日」', () => {
    const s = { routines: [{ id: 'x', name: 'A 推日' }] }
    expect(resolveRoutine(s, 'a')).toBeNull()
  })

  it('找不到就是 null', () => {
    expect(resolveRoutine(base(), '胸日')).toBeNull()
    expect(resolveRoutine({}, '推日')).toBeNull()
  })
})

describe('schedule-week — 把动作组排到星期几', () => {
  it('写进 S.week 的对应星期，没提到的星期原样留着', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'schedule-week', days: { 1: '推日', 3: '拉日', 5: '腿日' } }])
    expect(out.applied).toBe(1)
    expect(s.week[1]).toEqual(['r1'])
    expect(s.week[3]).toEqual(['r2'])
    expect(s.week[5]).toEqual(['r3'])
    expect(s.week[6]).toEqual(['r3'])          // 原有的周六没被动
    expect(out.summary).toContain('周一 推日')
  })

  it('"rest" 把那天清掉', () => {
    const s = base()
    applyActions(s, [{ type: 'schedule-week', days: { 6: 'rest' } }])
    expect(s.week[6]).toBeUndefined()
  })

  it('只写 week 会被「循环排队」盖掉，所以顺手切回按星期排', () => {
    const s = base()
    s.queue = { ids: ['r1'], since: 1, startsOn: '2026-11-01', label: 'pass', rotationId: 'rot1' }
    s.rotation = { id: 'rot1', sequence: ['r1', 'r2'], label: 'loop' }
    const out = applyActions(s, [{ type: 'schedule-week', days: { 1: '推日' } }])
    expect(s.queue).toBeNull()
    expect(s.scheduleMode).toBe('week')
    expect(s.rotation).toEqual({ id: 'rot1', sequence: ['r1', 'r2'], label: 'loop' })  // 定义留着
    expect(out.summary).toContain('按星期排')
  })

  it('一个名字都认不出来时不写 week，只说没找到', () => {
    const s = base()
    const before = JSON.stringify(s.week)
    const out = applyActions(s, [{ type: 'schedule-week', days: { 1: '胸日' } }])
    expect(out.applied).toBe(0)
    expect(JSON.stringify(s.week)).toBe(before)
    expect(out.summary).toContain('胸日')
  })

  it('星期越界的 key 直接忽略', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'schedule-week', days: { 9: '推日', 1: '推日' } }])
    expect(s.week[9]).toBeUndefined()
    expect(s.week[1]).toEqual(['r1'])
    expect(out.applied).toBe(1)
  })
})

describe('schedule-date — 单独指定某一天', () => {
  it('写 S.dayPlan[iso] = routine id', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'schedule-date', date: '2026-11-12', routine: '拉日' }])
    expect(s.dayPlan['2026-11-12']).toBe('r2')
    expect(out.summary).toContain('2026-11-12')
  })

  it('routine 是 rest 时写 rest 哨兵', () => {
    const s = base()
    applyActions(s, [{ type: 'schedule-date', date: '2026-11-13', routine: 'rest' }])
    expect(s.dayPlan['2026-11-13']).toBe('rest')
  })

  it('日期格式不对就拒绝，不污染 dayPlan', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'schedule-date', date: '下周三', routine: '推日' }])
    expect(s.dayPlan).toEqual({})
    expect(out.applied).toBe(0)
  })

  it('动作组不存在也拒绝', () => {
    const s = base()
    applyActions(s, [{ type: 'schedule-date', date: '2026-11-12', routine: '胸日' }])
    expect(s.dayPlan['2026-11-12']).toBeUndefined()
  })
})

describe('rename-routine', () => {
  it('按名字找到并改名', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'rename-routine', from: '推日', to: '上肢推' }])
    expect(s.routines[0].name).toBe('上肢推')
    expect(out.summary).toContain('上肢推')
  })

  it('新名字是空的就不改', () => {
    const s = base()
    applyActions(s, [{ type: 'rename-routine', from: '推日', to: '   ' }])
    expect(s.routines[0].name).toBe('推日')
  })
})

describe('go — 带用户去某一页', () => {
  it('合法路径只记下来，不写任何状态', () => {
    const s = base()
    const before = JSON.stringify(s)
    const out = applyActions(s, [{ type: 'go', path: '/settings/units' }])
    expect(out.go).toBe('/settings/units')
    expect(out.applied).toBe(1)
    expect(JSON.stringify(s)).toBe(before)
    expect(out.summary).toContain('已为你打开')
  })

  it('设置子页、主页面、动作组编辑页都认', () => {
    expect(applyActions({}, [{ type: 'go', path: '/plan' }]).go).toBe('/plan')
    expect(applyActions({}, [{ type: 'go', path: '/settings/data' }]).go).toBe('/settings/data')
    expect(applyActions({}, [{ type: 'go', path: '/plan/r/abc-1' }]).go).toBe('/plan/r/abc-1')
  })

  it('不存在的页面一律不跳', () => {
    for (const bad of ['/nope', 'settings', '/settings/nope', 'https://evil.example', '']) {
      const out = applyActions({}, [{ type: 'go', path: bad }])
      expect(out.go).toBeNull()
      expect(out.applied).toBe(0)
    }
  })

  it('多条 go 时最后一个合法的赢', () => {
    const out = applyActions({}, [
      { type: 'go', path: '/plan' },
      { type: 'go', path: '/bad' },
      { type: 'go', path: '/history' },
    ])
    expect(out.go).toBe('/history')
  })
})

describe('set-setting / set-module — 在对话框里直接改设置', () => {
  it('改单位：写进 state，summary 说清新值', () => {
    const s = { ...base(), unit: 'kg' }
    const out = applyActions(s, [{ type: 'set-setting', key: 'unit', value: '磅' }])
    expect(s.unit).toBe('lb')
    expect(out.applied).toBe(1)
    expect(out.summary).toContain('已写入 App')
    expect(out.summary).toContain('磅')
  })

  it('convert:false 只换标签', () => {
    const s = { ...base(), unit: 'kg', bodyweight: [{ date: '2026-11-01', w: 80 }] }
    applyActions(s, [{ type: 'set-setting', key: 'unit', value: 'lb', convert: false }])
    expect(s.unit).toBe('lb')
    expect(s.bodyweight[0].w).toBe(80)
  })

  it('和其它动作同一轮里生效', () => {
    const s = base()
    const out = applyActions(s, [
      { type: 'set-setting', key: 'theme', value: 'light' },
      { type: 'schedule-week', days: { 2: '推日' } },
      { type: 'go', path: '/settings/look' },
    ])
    expect(s.theme).toBe('light')
    expect(s.week[2]).toEqual(['r1'])
    expect(out.go).toBe('/settings/look')
    expect(out.applied).toBe(3)
  })

  it('白名单外的 key 只进 skipped，不改状态', () => {
    const s = base()
    const before = JSON.stringify(s)
    const out = applyActions(s, [{ type: 'set-setting', key: 'serverUrl', value: 'http://x' }])
    expect(out.applied).toBe(0)
    expect(out.skipped[0]).toContain('不能改')
    expect(JSON.stringify(s)).toBe(before)
  })

  it('模块开关写进 S.modules', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'set-module', id: '签到', on: false }])
    expect(s.modules.checkin).toBe(false)
    expect(out.summary).toContain('关闭')
  })

  it('一轮里改设置 + 带路时，只有设置算「写入」', () => {
    const s = base()
    const out = applyActions(s, [
      { type: 'set-setting', key: 'sound', value: false },
      { type: 'go', path: '/settings/alerts' },
    ])
    expect(out.applied).toBe(2)
    expect(out.summary).toContain('已写入 App：')
    expect(out.go).toBe('/settings/alerts')
  })
})

describe('previewActions — 确认卡片', () => {
  it('排日程会逐条列出星期几练什么', () => {
    const [card] = previewActions([{ type: 'schedule-week', days: { 1: '推日', 3: 'rest' } }])
    expect(card.title).toContain('日程')
    expect(card.lines).toEqual(['周一 · 推日', '周三 · 休息'])
  })

  it('导航只显示合法路径', () => {
    expect(previewActions([{ type: 'go', path: '/settings/units' }])[0].title).toContain('/settings/units')
    expect(previewActions([{ type: 'go', path: '/bad' }])).toEqual([])
  })

  it('未知动作不产生卡片', () => {
    expect(previewActions([{ type: 'nuke' }])).toEqual([])
  })

  it('改设置会写清改哪一项、改成什么', () => {
    const [card] = previewActions([{ type: 'set-setting', key: 'unit', value: 'lb' }])
    expect(card.title).toContain('重量单位')
    expect(card.title).toContain('磅')
    expect(card.lines[0]).toContain('换算')
  })

  it('只换标签时卡片上说清数字不动', () => {
    const [card] = previewActions([{ type: 'set-setting', key: 'unit', value: 'lb', convert: false }])
    expect(card.lines[0]).toContain('数字不变')
  })

  it('模块开关的卡片', () => {
    const [card] = previewActions([{ type: 'set-module', id: 'checkin', on: false }])
    expect(card.title).toContain('checkin')
    expect(card.title).toContain('关闭')
  })
})

describe('applyActions — 混合一轮', () => {
  it('改名 + 排日程 + 带路可以同时生效', () => {
    const s = base()
    const out = applyActions(s, [
      { type: 'rename-routine', from: '推日', to: '上肢推' },
      { type: 'schedule-week', days: { 1: '上肢推' } },
      { type: 'go', path: '/plan' },
    ])
    expect(s.routines[0].name).toBe('上肢推')
    expect(s.week[1]).toEqual(['r1'])
    expect(out.go).toBe('/plan')
    expect(out.summary).toContain('已写入 App')
  })

  it('一轮里最多执行 8 条，多的丢掉', () => {
    const s = { routines: [], dayPlan: {} }
    const many = Array.from({ length: 12 }, (_, i) => ({ type: 'schedule-date', date: '2026-11-' + String(i + 1).padStart(2, '0'), routine: 'rest' }))
    applyActions(s, many)
    expect(Object.keys(s.dayPlan)).toHaveLength(8)
  })
})

// 1.4.13：「大总管」得能改也能删 —— 增删动作组的动作、删整份动作组、标记疼痛、记签到。
describe('删动作组、改动作组里的动作、标疼痛、记签到', () => {
  it('删掉动作组，日程里指向它的那一格一起清掉', () => {
    const s = base()
    s.dayPlan = { '2026-11-20': 'r3' }
    s.queue = { ids: ['r1', 'r3'], label: '', startsOn: '2026-11-13' }
    const out = applyActions(s, [{ type: 'delete-routine', name: '腿日' }])
    expect(out.applied).toBe(1)
    expect(s.routines.map(r => r.id)).toEqual(['r1', 'r2'])
    expect(s.week[6]).toBeUndefined()
    expect(s.dayPlan['2026-11-20']).toBeUndefined()
    expect(s.queue.ids).toEqual(['r1'])
  })

  it('删一个不存在的动作组只报跳过，不动数据', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'delete-routine', name: '胸日' }])
    expect(out.applied).toBe(0)
    expect(out.skipped.join()).toContain('找不到动作组')
    expect(s.routines).toHaveLength(3)
  })

  it('往动作组加动作；已经在了就改组数次数，不重复加', () => {
    const s = base()
    // 用小G 实际会收到的写法：动作库里的英文名（i18n 的语言状态在测试里是默认那套）。
    const name = allExercises(s).find(e => e.bp === 'chest').n
    const first = applyActions(s, [{ type: 'add-exercise', routine: '推日', exercise: name, sets: 4, reps: 8 }])
    expect(first.applied).toBe(1)
    expect(s.routines[0].ex).toHaveLength(1)
    expect(s.routines[0].ex[0].sets).toBe(4)
    applyActions(s, [{ type: 'add-exercise', routine: '推日', exercise: name, sets: 5, reps: 5 }])
    expect(s.routines[0].ex).toHaveLength(1)
    expect(s.routines[0].ex[0]).toMatchObject({ sets: 5, reps: 5 })
  })

  it('从动作组删动作；本来就没有就报跳过', () => {
    const s = base()
    const name = allExercises(s).find(e => e.bp === 'chest').n
    applyActions(s, [{ type: 'add-exercise', routine: '推日', exercise: name, sets: 4, reps: 8 }])
    const gone = applyActions(s, [{ type: 'remove-exercise', routine: '推日', exercise: name }])
    expect(gone.applied).toBe(1)
    expect(s.routines[0].ex).toHaveLength(0)
    const again = applyActions(s, [{ type: 'remove-exercise', routine: '推日', exercise: name }])
    expect(again.applied).toBe(0)
  })

  it('把中文俗称的肌肉标成疼痛，并写进 S.pains', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'mark-sore', muscles: ['胸', '肩膀'] }])
    expect(out.applied).toBe(1)
    expect(Object.keys(s.pains).sort()).toEqual(['chest', 'deltoids'])
    applyActions(s, [{ type: 'mark-sore', muscles: ['胸'], on: false }])
    expect(Object.keys(s.pains)).toEqual(['deltoids'])
  })

  it('认不出的肌肉不写，只说没认出', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'mark-sore', muscles: ['膝盖'] }])
    expect(out.applied).toBe(0)
    expect(out.skipped.join()).toContain('没认出肌肉')
    expect(s.pains).toBeUndefined()
  })

  it('记签到写进 S.checkIns；同一天再来一次不覆盖', () => {
    const s = base()
    const out = applyActions(s, [{ type: 'log-checkin', date: '2026-11-13' }])
    expect(out.applied).toBe(1)
    expect(s.checkIns['2026-11-13'].at).toBeGreaterThan(0)
    const again = applyActions(s, [{ type: 'log-checkin', date: '2026-11-13' }])
    expect(again.summary).toContain('已经签到')
  })

  it('预览卡片说得清要删什么、加什么', () => {
    const out = previewActions([
      { type: 'delete-routine', name: '腿日' },
      { type: 'add-exercise', routine: '推日', exercise: '卧推', sets: 4, reps: 8 },
      { type: 'mark-sore', muscles: ['胸'] },
    ])
    expect(out[0].title).toContain('删掉动作组「腿日」')
    expect(out[1].title).toContain('加入：卧推')
    expect(out[1].lines[0]).toBe('4 组 × 8 次')
    expect(out[2].title).toContain('标成疼痛')
  })
})
