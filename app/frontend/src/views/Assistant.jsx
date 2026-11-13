import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Icon from '../components/Icon.jsx'
import ChatInput from '../components/ChatInput.jsx'
import { askAgent } from '../lib/agent/agent.js'
import { aiFailHint } from '../lib/ai.js'
import { applyActions, previewActions } from '../lib/agent/actions.js'
import { loadAgentConfig, saveAgentConfig, agentReady } from '../lib/agent/config.js'
import { loadChat, saveChat, startNewChat, listArchives, loadArchive, agoText } from '../lib/agent/history.js'
import '../coach.css'
import '../assistant.css'

const GREETING = '我是小G，这个 App 的大总管。我能看你的动作组和训练记录，帮你建动作组、排到每一天，也能直接在这里改设置 —— 单位、语言、主题、休息计时这些，说一声就改好。你要找哪个功能，问我一句，我直接带你过去。'

const SUGGESTIONS = [
  '帮我建一个每周四练的增肌动作组，排到周一、周二、周四、周五',
  '把重量单位改成磅',
  '换浅色主题，主题色改成绿色',
  '我这周练得怎么样？',
]

/** 首屏消息：接得上的会话原样拿回来，接不上就给问候 + 一条「已开启新对话」的提示。 */
function bootMsgs(boot) {
  // note 只是 UI 提示，不还原（上一次的「已开启新对话」现在没意义了）。
  const restored = (boot.msgs || []).filter(m => m && m.text && m.role !== 'note')
  if (restored.length) return restored
  const out = []
  if (!boot.resumed && boot.archived && boot.previousId) {
    out.push({
      role: 'note',
      text: `已开启新对话（上次对话是 ${agoText(Date.now() - (boot.gapMs || 0))}）`,
      ts: Date.now(),
      prevId: boot.previousId,
    })
  }
  out.push({ role: 'agent', text: GREETING, ts: Date.now() })
  return out
}

export default function Assistant() {
  const nav = useNavigate()
  // 只读一次存储：后面所有变化都由 saveChat 写回去。
  const [boot] = useState(() => loadChat())
  const [chat, setChat] = useState(() => ({ id: boot.id, startedAt: boot.startedAt, msgs: bootMsgs(boot) }))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [cfg, setCfg] = useState(() => loadAgentConfig())
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const endRef = useRef(null)

  const msgs = chat.msgs
  const setMsgs = fn => setChat(c => ({ ...c, msgs: typeof fn === 'function' ? fn(c.msgs) : fn }))

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])
  // 每条消息落盘一次。30 分钟的「接着上次聊」就是靠这里的 lastAt 判断的。
  useEffect(() => { saveChat({ id: chat.id, startedAt: chat.startedAt, msgs: chat.msgs }) }, [chat])

  /**
   * 执行一组动作，然后把用户带走（如果有 go）。
   * 只有导航的那一轮不进 update —— 什么都没改，不该触发一次同步写。
   */
  const runActions = actions => {
    const list = Array.isArray(actions) ? actions : []
    const onlyGo = list.length > 0 && list.every(a => a?.type === 'go')
    let out = { summary: '没有可执行的改动', applied: 0, go: null }
    try {
      if (onlyGo) out = applyActions({}, list)
      else useStore.getState().update(s => { out = applyActions(s, list) })
    } catch (e) {
      out = { summary: '写入失败：' + (e?.message || e), applied: 0, go: null }
    }
    if (out.go) nav(out.go)
    return out
  }

  const send = async (forced) => {
    const text = String(forced ?? input).trim()
    if (!text || busy) return
    if (!agentReady(cfg)) { setShowSettings(true); return }
    setInput('')
    const history = [...msgs, { role: 'user', text, ts: Date.now() }]
    setMsgs([...history, { role: 'agent', text: '', pending: true, ts: Date.now() }])
    setBusy(true)

    const res = await askAgent({ history, S: useStore.getState().S, cfg })
    setBusy(false)

    if (!res.ok) {
      setMsgs(m => m.map(x => x.pending
        ? { role: 'agent', text: '抱歉，' + aiFailHint(res.reason, res.detail), ts: Date.now() }
        : x))
      return
    }

    let msg = { role: 'agent', text: res.reply, actions: res.actions?.length ? res.actions : null, ts: Date.now() }
    if (cfg.fullAccess && msg.actions) {
      const out = runActions(msg.actions)
      msg = {
        ...msg,
        actions: null,
        applied: out.applied > 0,
        text: res.reply + (out.applied > 0 ? `\n\n${out.summary}` : ''),
      }
    }
    setMsgs(m => m.map(x => x.pending ? msg : x))
  }

  const confirm = (idx) => {
    const msg = msgs[idx]
    if (!msg?.actions) return
    const out = runActions(msg.actions)
    setMsgs(m => m.map((x, i) => i === idx
      ? { ...x, actions: null, applied: out.applied > 0, text: `${x.text}\n\n${out.summary}` }
      : x))
  }

  const cancel = (idx) => {
    setMsgs(m => m.map((x, i) => i === idx
      ? { ...x, actions: null, text: `${x.text}\n\n（已取消，没有改动数据）` }
      : x))
  }

  // 主动开新对话：当前这段先进存档（聊过才存），窗口清空并提示一句。
  const newChat = () => {
    const next = startNewChat()
    setChat({
      id: next.id,
      startedAt: next.startedAt,
      msgs: [
        {
          role: 'note',
          text: next.archived ? '已开启新对话，之前那几段都留在「历史对话」里。' : '已开启新对话。',
          ts: Date.now(),
          prevId: next.archived ? next.previousId : null,
        },
        { role: 'agent', text: GREETING, ts: Date.now() },
      ],
    })
    setShowHistory(false)
    setInput('')
  }

  // 从存档里翻一段回来接着聊。
  const resume = (id) => {
    const got = loadArchive(id)
    if (!got) return
    setChat({
      id: got.id,
      startedAt: got.startedAt,
      msgs: got.msgs.length ? got.msgs : [{ role: 'agent', text: GREETING, ts: Date.now() }],
    })
    setShowHistory(false)
  }

  const saveCfg = patch => setCfg(saveAgentConfig(patch))
  const idle = !busy && !msgs.some(m => m.role === 'user')

  return <div className="narrow chat">
    <div className="chat-hdr ag-hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav(-1)} aria-label="返回"><Icon name="chevronLeft" /></button>
      <div className="chat-av"><Icon name="sparkles" /></div>
      <div className="grow">
        <h1>小G</h1>
        <div className="chat-st">{cfg.mode === 'byok' ? `自定义模型 · ${cfg.model || '未配置'}` : 'GLM · 默认'}{cfg.fullAccess ? ' · 完全访问' : ''}</div>
      </div>
      <button className="iconbtn" onClick={() => setShowHistory(true)} aria-label="历史对话"><Icon name="history" /></button>
      <button className="iconbtn" onClick={newChat} aria-label="新对话"><Icon name="plus" /></button>
      <button className="iconbtn" onClick={() => setShowSettings(true)} aria-label="设置"><Icon name="gear" /></button>
    </div>

    <div className="msgs">
      {msgs.map((m, i) => <Bubble key={i} m={m} onConfirm={() => confirm(i)} onCancel={() => cancel(i)} onResume={resume} />)}
      {busy && <div className="msg coach"><div className="bub ag-typing"><i /><i /><i /></div></div>}
      <div ref={endRef} />
    </div>

    <div className="composer">
      {idle && <div className="chips-row">
        {SUGGESTIONS.map(s => <button className="qchip" key={s} onClick={() => send(s)}><Icon name="sparkles" />{s}</button>)}
      </div>}
      <div className={'composer-in' + (expanded ? ' tall' : '')}>
        <ChatInput value={input} onChange={setInput} onSend={() => send()} placeholder="问小G，或者让它排日程、改设置、带你去找功能…"
          disabled={busy} maxLength={1000} expanded={expanded} setExpanded={setExpanded} />
        <button className="send" onClick={() => send()} disabled={busy || !input.trim()} aria-label="发送"><Icon name="arrowUp" /></button>
      </div>
    </div>

    {showSettings && <SettingsSheet cfg={cfg} onSave={saveCfg} onClose={() => setShowSettings(false)} />}
    {showHistory && <HistorySheet onOpen={resume} onNew={newChat} onClose={() => setShowHistory(false)} />}
  </div>
}

function Bubble({ m, onConfirm, onCancel, onResume }) {
  const preview = useMemo(() => (m.actions ? previewActions(m.actions) : []), [m.actions])

  // 系统提示（已开启新对话 / 上次对话是 X 前）：一条居中的小字，不是对话气泡。
  if (m.role === 'note') {
    return <div className="ag-sysrow">
      <span>{m.text}</span>
      {m.prevId && <button className="ag-syslink" onClick={() => onResume(m.prevId)}>继续上次</button>}
    </div>
  }

  const mine = m.role === 'user'
  return <div className={'msg ' + (mine ? 'user' : 'coach')}>
    <div className="bub">
      {m.pending ? <span className="ag-typing"><i /><i /><i /></span> : m.text}
      {m.actions && <div className="ag-actions">
        {preview.map((p, i) => <div className="ag-card" key={i}>
          <div className="ag-card-t">{p.title}</div>
          {p.lines.map((l, j) => <div className="ag-card-l" key={j}>{l}</div>)}
        </div>)}
        <div className="ag-btns">
          <button className="ag-btn ghost" onClick={onCancel}>取消</button>
          <button className="ag-btn primary" onClick={onConfirm}>确认执行</button>
        </div>
        <div className="ag-hint">确认后才会改动 App 数据。可在设置里开启「完全访问」跳过这一步。</div>
      </div>}
      {m.applied && <div className="ag-ok"><Icon name="checkCircle" />已同步到 App</div>}
    </div>
  </div>
}

function HistorySheet({ onOpen, onNew, onClose }) {
  const [list] = useState(() => listArchives())
  return <div className="ag-sheet-wrap" onClick={onClose}>
    <div className="ag-sheet" onClick={e => e.stopPropagation()}>
      <div className="ag-sheet-h">
        <div>历史对话</div>
        <button className="iconbtn" onClick={onClose} aria-label="关闭"><Icon name="xmark" /></button>
      </div>
      {list.length === 0
        ? <div className="ag-note">还没有历史对话。开过新对话之后，之前的记录都会留在这里。</div>
        : <div className="ag-hist">
          {list.map(a => <button key={a.id} className="ag-hist-row" onClick={() => onOpen(a.id)}>
            <span className="ag-hist-t">{a.preview || '（没有文字）'}</span>
            <span className="ag-hist-s">{agoText(a.lastAt)} · {a.turns} 轮</span>
          </button>)}
        </div>}
      <button className="ag-btn primary wide" onClick={onNew}>开启新对话</button>
    </div>
  </div>
}

function SettingsSheet({ cfg, onSave, onClose }) {
  const [mode, setMode] = useState(cfg.mode)
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl)
  const [model, setModel] = useState(cfg.model)
  const [apiKey, setApiKey] = useState(cfg.apiKey)
  const [fullAccess, setFullAccess] = useState(!!cfg.fullAccess)

  const save = () => {
    onSave({ mode, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim(), fullAccess })
    onClose()
  }

  return <div className="ag-sheet-wrap" onClick={onClose}>
    <div className="ag-sheet" onClick={e => e.stopPropagation()}>
      <div className="ag-sheet-h">
        <div>小G 设置</div>
        <button className="iconbtn" onClick={onClose} aria-label="关闭"><Icon name="xmark" /></button>
      </div>

      <div className="ag-seg">
        <button className={mode === 'glm' ? 'on' : ''} onClick={() => setMode('glm')}>默认 GLM</button>
        <button className={mode === 'byok' ? 'on' : ''} onClick={() => setMode('byok')}>自定义接口</button>
      </div>

      {mode === 'byok' && <div className="ag-fields">
        <label>接口地址<input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
        <label>模型<input value={model} onChange={e => setModel(e.target.value)} placeholder="gpt-4o-mini" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
        <label>API Key<input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-…" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
        <div className="ag-note">Key 只存在本机，不会上传到服务器，也不会同步到其他设备。</div>
      </div>}

      <div className="ag-row">
        <div>
          <div className="ag-row-t">完全访问</div>
          <div className="ag-row-s">开启后小G 改数据不再弹确认，全权接管。默认关闭。</div>
        </div>
        <button className={'ag-switch' + (fullAccess ? ' on' : '')} onClick={() => setFullAccess(v => !v)} aria-pressed={fullAccess}><span /></button>
      </div>

      <button className="ag-btn primary wide" onClick={save}>保存</button>
    </div>
  </div>
}
