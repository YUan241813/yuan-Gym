// 小G 的聊天记录（2026-11-11）。
//
// 以前 Assistant.jsx 把消息放在纯 React state 里，页面一卸载就全丢，每次进来都是「你好，我是小G」。
// 现在改成落 localStorage，规则是用户提的那两条：
//
//   1. 30 分钟内回到小G，默认接着上次的对话聊（同一段会话，消息原样在）；
//   2. 用户主动「新对话」，或者隔了 30 分钟以上再进来，就开一段新会话 —— 但**前面的记录不丢**，
//      存档里留着，随时能翻回来接着聊。
//
// 存储形状（key = yuangym.assistant.chat.v1）：
//   { v: 1,
//     current:  { id, startedAt, lastAt, msgs: [{ role, text, ts, ... }] } | null,
//     archives: [ { id, startedAt, lastAt, msgs } ]   // 最新在前，最多 5 段
//   }
//
// 这里只负责读写和分档，不碰 UI、不碰 prompt。`role: 'note'` 是给小G 自己插的提示（例如「已开启
// 新对话」），agent.js 的 historyPrompt 只认 user/agent，所以它天然不会喂给模型。
//
// localStorage 可能被禁用、也可能超配额（照片和历史都往同一个 origin 里写）。所有读写在 try/catch
// 里，失败就退化成纯内存：页面照常能用，只是关掉就没了 —— 不能白屏。

const KEY = 'yuangym.assistant.chat.v1'
export const SESSION_GAP_MS = 30 * 60 * 1000
const MAX_ARCHIVES = 5
// 一段会话最多留这么多条，再多就把最早的丢掉：几十轮之后 prompt 只取最近 10 轮，
// 更早的只是占地方，还会把 localStorage 撑大。
const MAX_MSGS = 200

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
// 图片之类可以让一条消息大得离谱，存档时顺手限一下，别把配额吃光。
const clampText = s => (typeof s === 'string' ? s.slice(0, 4000) : '')

const now = () => Date.now()
const uid = () => 'c' + now().toString(36) + Math.random().toString(36).slice(2, 7)

/** 一条消息能不能存：打字指示之类的临时态不进库。 */
const storable = m => isMap(m) && (m.role === 'user' || m.role === 'agent' || m.role === 'note') && !m.pending

function cleanMsgs(msgs) {
  return (Array.isArray(msgs) ? msgs : [])
    .filter(storable)
    .slice(-MAX_MSGS)
    .map(m => {
      const out = { role: m.role, text: clampText(m.text), ts: Number(m.ts) || now() }
      if (m.applied) out.applied = true
      return out
    })
}

const emptyState = () => ({ v: 1, current: null, archives: [] })

function read() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return emptyState()
    const o = JSON.parse(raw)
    if (!isMap(o)) return emptyState()
    const current = isMap(o.current) && Array.isArray(o.current.msgs)
      ? { ...o.current, msgs: cleanMsgs(o.current.msgs) }
      : null
    const archives = Array.isArray(o.archives)
      ? o.archives.filter(a => isMap(a) && Array.isArray(a.msgs)).slice(0, MAX_ARCHIVES)
        .map(a => ({ ...a, msgs: cleanMsgs(a.msgs) }))
      : []
    return { v: 1, current: current && current.msgs.length ? current : null, archives }
  } catch {
    return emptyState()
  }
}

function write(state) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false          // 禁用 / 超配额：这一份只活在内存里
  }
}

/** 一段新会话的空壳。 */
function freshSession(at = now()) {
  return { id: uid(), startedAt: at, lastAt: at, msgs: [] }
}

/** 存档一段会话（空的不存），最新的排最前，只留 MAX_ARCHIVES 段。 */
function pushArchive(archives, session) {
  const msgs = cleanMsgs(session?.msgs)
  // 只有一句问候的那种不算「对话」，不必占一个存档位。
  if (msgs.filter(m => m.role === 'user').length === 0) return archives
  const entry = { id: session.id, startedAt: session.startedAt, lastAt: session.lastAt || now(), msgs }
  return [entry, ...archives.filter(a => a.id !== session.id)].slice(0, MAX_ARCHIVES)
}

/**
 * 打开小G 时调一次。
 * - 距上一条消息不超过 30 分钟：原样接着这段会话（`resumed: true`）。
 * - 超过 30 分钟，或者根本没有记录：把旧会话收进存档，开一段新的（`resumed: false`，
 *   `gapMs` 是隔了多久，UI 用它写「上次对话是 X 前」）。
 */
export function loadChat(at = now()) {
  const state = read()
  if (state.current) {
    const gapMs = Math.max(0, at - (Number(state.current.lastAt) || 0))
    if (gapMs <= SESSION_GAP_MS) {
      return { ...state.current, resumed: true, archived: false, gapMs, archives: state.archives }
    }
    // 隔太久了：存档，然后开新的。只有真的聊过（有用户消息）才算一段对话。
    const hadTalk = state.current.msgs.some(m => m.role === 'user')
    state.archives = pushArchive(state.archives, state.current)
    state.current = null
    write(state)
    return {
      ...freshSession(at), resumed: false, archived: hadTalk, gapMs,
      archives: state.archives, previousId: hadTalk ? state.archives[0]?.id || null : null,
    }
  }
  return { ...freshSession(at), resumed: false, archived: false, gapMs: 0, archives: state.archives, previousId: null }
}

/** 把当前这段会话写回去（每次消息变化都调，代价就是一次 JSON.stringify）。 */
export function saveChat({ id, startedAt, msgs }, at = now()) {
  const state = read()
  state.current = {
    id: id || state.current?.id || uid(),
    startedAt: Number(startedAt) || state.current?.startedAt || at,
    lastAt: at,
    msgs: cleanMsgs(msgs),
  }
  write(state)
  return state.current
}

/** 用户主动「新对话」：存档当前这段，开一段新的。返回新会话 + 存档列表。 */
export function startNewChat(at = now()) {
  const state = read()
  const hadTalk = !!state.current && state.current.msgs.some(m => m.role === 'user')
  if (state.current) state.archives = pushArchive(state.archives, state.current)
  state.current = null
  write(state)
  return {
    ...freshSession(at), archived: hadTalk,
    previousId: hadTalk ? state.archives[0]?.id || null : null, archives: state.archives,
  }
}

/** 存档列表，最新在前：`[{ id, startedAt, lastAt, preview, turns }]`。 */
export function listArchives() {
  const { archives } = read()
  return archives.map(a => {
    const firstUser = a.msgs.find(m => m.role === 'user')
    return {
      id: a.id,
      startedAt: a.startedAt,
      lastAt: a.lastAt,
      turns: a.msgs.filter(m => m.role === 'user').length,
      preview: (firstUser?.text || a.msgs[0]?.text || '').slice(0, 40),
    }
  })
}

/**
 * 把某段存档载回来继续聊：它变成当前会话，原来那段（如果还有内容）先进存档。
 * 找不到就返回 null，UI 什么也不做。
 */
export function loadArchive(id, at = now()) {
  const state = read()
  const hit = state.archives.find(a => a.id === id)
  if (!hit) return null
  let archives = state.archives.filter(a => a.id !== id)
  // 正在聊的那段别丢：它先进存档，再让位给被翻出来的这一段。
  if (state.current) archives = pushArchive(archives, state.current)
  state.archives = archives
  state.current = { ...hit, lastAt: at, msgs: cleanMsgs(hit.msgs) }
  write(state)
  return { ...state.current, resumed: true, previousId: archives[0]?.id || null, archives }
}

/** 清空全部聊天记录（设置里给用户的后悔药）。 */
export function clearAllChats() {
  try { globalThis.localStorage?.removeItem(KEY) } catch { /* 禁用就是没存过 */ }
  return emptyState()
}

/** 「3 分钟前 / 2 小时前 / 昨天」——历史列表和「已开启新对话」提示共用。 */
export function agoText(ms, at = now()) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return '刚刚'      // 没有时间戳就别算成 1970 年
  const m = Math.max(0, Math.round((at - t) / 60000))
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.round(h / 24)
  return d === 1 ? '昨天' : `${d} 天前`
}
