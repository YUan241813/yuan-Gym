// @vitest-environment happy-dom
//
// 聊天记录的分档规则（lib/agent/history.js）：用户只提了两条要求 —— 30 分钟内接着上次聊、开新对话
// 但前面的记录不能丢。这里逐条钉住，另外把「localStorage 被禁 / 超配额不能白屏」也测掉。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'yuangym.assistant.chat.v1'
const MIN = 60 * 1000
const HOUR = 60 * MIN

let mod
beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  mod = await import('./history.js')
})
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

const talk = (session, ...texts) => {
  const msgs = [...(session.msgs || [])]
  for (const t of texts) msgs.push({ role: 'user', text: t, ts: 0 })
  return { ...session, msgs }
}

describe('history — 30 分钟的窗口', () => {
  it('10 分钟后回来，原样接着这段会话', () => {
    const t0 = 1_000_000
    const s = mod.loadChat(t0)
    mod.saveChat(talk(s, '帮我排个日程'), t0)

    const again = mod.loadChat(t0 + 10 * MIN)
    expect(again.resumed).toBe(true)
    expect(again.id).toBe(s.id)
    expect(again.msgs.map(m => m.text)).toEqual(['帮我排个日程'])
  })

  it('刚好 30 分钟还算接得上，31 分钟就开新的', () => {
    const t0 = 2_000_000
    const s = mod.loadChat(t0)
    mod.saveChat(talk(s, '在吗'), t0)

    expect(mod.loadChat(t0 + 30 * MIN).resumed).toBe(true)

    const after = mod.loadChat(t0 + 31 * MIN)
    expect(after.resumed).toBe(false)
    expect(after.msgs).toEqual([])
    expect(after.id).not.toBe(s.id)
  })

  it('隔太久开的新会话会把上一段收进存档，并且能指出是哪一段', () => {
    const t0 = 3_000_000
    const s = mod.loadChat(t0)
    mod.saveChat(talk(s, '周一练推日'), t0)

    const after = mod.loadChat(t0 + 5 * HOUR)
    expect(after.archived).toBe(true)
    expect(after.previousId).toBe(s.id)
    expect(after.gapMs).toBe(5 * HOUR)
    expect(mod.listArchives()[0]).toMatchObject({ id: s.id, preview: '周一练推日', turns: 1 })
  })

  it('从没聊过（只有问候）的那段不进存档，也不给「继续上次」', () => {
    const t0 = 4_000_000
    const s = mod.loadChat(t0)
    mod.saveChat({ ...s, msgs: [{ role: 'agent', text: '你好', ts: t0 }] }, t0)

    const after = mod.loadChat(t0 + 5 * HOUR)
    expect(after.archived).toBe(false)
    expect(after.previousId).toBeNull()
    expect(mod.listArchives()).toEqual([])
  })
})

describe('history — 主动开新对话', () => {
  it('存档当前这段、窗口清空、旧记录还在', () => {
    const t0 = 5_000_000
    const s = mod.loadChat(t0)
    mod.saveChat(talk(s, '第一个问题'), t0)

    const next = mod.startNewChat(t0 + MIN)
    expect(next.archived).toBe(true)
    expect(next.previousId).toBe(s.id)
    expect(next.msgs).toEqual([])

    const list = mod.listArchives()
    expect(list).toHaveLength(1)
    expect(list[0].preview).toBe('第一个问题')
  })

  it('空会话开新对话不产生存档', () => {
    mod.loadChat(6_000_000)
    const next = mod.startNewChat(6_000_000 + MIN)
    expect(next.archived).toBe(false)
    expect(mod.listArchives()).toEqual([])
  })
})

describe('history — 从存档里翻回来', () => {
  it('载入一段存档：它变成当前会话，原来在聊的那段让位进存档', () => {
    const t0 = 7_000_000
    const a = mod.loadChat(t0)
    mod.saveChat(talk(a, '旧对话'), t0)
    mod.startNewChat(t0 + MIN)                     // 旧对话进存档

    const b = mod.loadChat(t0 + 2 * MIN)
    mod.saveChat(talk(b, '新对话'), t0 + 2 * MIN)

    const got = mod.loadArchive(a.id, t0 + 3 * MIN)
    expect(got.id).toBe(a.id)
    expect(got.msgs.map(m => m.text)).toEqual(['旧对话'])
    expect(mod.listArchives().map(x => x.preview)).toEqual(['新对话'])
  })

  it('载入一个不存在的 id：返回 null，什么都不动', () => {
    const t0 = 8_000_000
    const s = mod.loadChat(t0)
    mod.saveChat(talk(s, '别丢'), t0)
    expect(mod.loadArchive('nope')).toBeNull()
    expect(mod.loadChat(t0 + MIN).msgs.map(m => m.text)).toEqual(['别丢'])
  })
})

describe('history — 存档上限与清理', () => {
  it('最多留 5 段，新的挤掉最旧的', () => {
    let t = 9_000_000
    for (let i = 0; i < 7; i++) {
      const s = mod.loadChat(t)
      mod.saveChat(talk(s, '对话 ' + i), t)
      t += MIN
      mod.startNewChat(t)
      t += MIN
    }
    const list = mod.listArchives()
    expect(list).toHaveLength(5)
    expect(list[0].preview).toBe('对话 6')
    expect(list.map(x => x.preview)).not.toContain('对话 0')
  })

  it('clearAllChats 之后什么都不剩', () => {
    const s = mod.loadChat(10_000_000)
    mod.saveChat(talk(s, '删掉我'), 10_000_000)
    mod.clearAllChats()
    expect(mod.listArchives()).toEqual([])
    expect(mod.loadChat(10_000_000 + MIN).resumed).toBe(false)
  })
})

describe('history — 存储不可用时不崩', () => {
  it('localStorage 读取抛异常：当成没有记录，页面照常能聊', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const s = mod.loadChat(11_000_000)
    expect(s.resumed).toBe(false)
    expect(s.msgs).toEqual([])
    expect(() => mod.saveChat(talk(s, '还能用吗'))).not.toThrow()
    expect(mod.listArchives()).toEqual([])
  })

  it('写入抛异常（超配额）：saveChat 不抛，返回值仍然是这段会话', () => {
    const t0 = 12_000_000
    const s = mod.loadChat(t0)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    const out = mod.saveChat(talk(s, '很大的一段'), t0)
    expect(out.id).toBe(s.id)
    expect(out.msgs.map(m => m.text)).toEqual(['很大的一段'])
  })

  it('纯文本沙箱里没有 localStorage 也不崩', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    // eslint-disable-next-line no-global-assign
    delete globalThis.localStorage
    expect(() => mod.loadChat()).not.toThrow()
    expect(() => mod.saveChat({ id: 'x', msgs: [] })).not.toThrow()
    if (desc) Object.defineProperty(globalThis, 'localStorage', desc)
  })
})

describe('agoText', () => {
  const now = 20_000_000_000
  it.each([
    [now, '刚刚'],
    [now - 5 * MIN, '5 分钟前'],
    [now - 3 * HOUR, '3 小时前'],
    [now - 30 * HOUR, '昨天'],
    [now - 5 * 24 * HOUR, '5 天前'],
  ])('%s → %s', (at, want) => {
    expect(mod.agoText(at, now)).toBe(want)
  })

  it('时间戳缺失也当成刚刚', () => {
    expect(mod.agoText(undefined, now)).toBe('刚刚')
  })
})
