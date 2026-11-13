import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { MUSCLES } from '../lib/muscles.js'
import { cnMuscle, historySummary, planToRoutines } from '../lib/plan-to-routines.js'
import { useStore } from '../store/useStore.js'
import { useAnatomyProfile } from '../lib/anatomy-profile.js'
import { buildWeek, buildMesocycle, buildMacro, bodySummary, GOALS } from '../lib/plan-engine.js'
import { ask, aiAvailable, COACH_SYSTEM, aiFailHint } from '../lib/ai.js'
import { addToRoutineSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../plan.css'

const cn = cnMuscle
const EQUIP_LABEL = { full: '完整健身房', home: '家里（哑铃/弹力带）', bodyweight: '只有自重' }

export default function AiPlan() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [profile, setProfile] = useAnatomyProfile()
  const [plan, setPlan] = useState(null)
  const [phase, setPhase] = useState('week')          // week | meso | year
  const [aiState, setAiState] = useState('idle')      // idle | checking | working | done | failed
  const [aiNote, setAiNote] = useState('')
  const [aiText, setAiText] = useState('')
  const [useHistory, setUseHistory] = useState(true)
  const [saved, setSaved] = useState(false)

  // 训练记录来自 store；这是"AI 助手读得到用户练过什么"的入口，只读，不写。
  const workouts = useStore(s => s.S?.workouts)
  const history = useMemo(() => historySummary(workouts), [workouts])

  // 解剖页多选肌肉时把 slug 用逗号拼在 focus 里；旧的单个 focus 依然兼容。
  const focusList = (params.get('focus') || '').split(',').filter(m => MUSCLES.includes(m))
  const goal = profile.goal || 'hypertrophy'

  // 重点部位 = 用户手动标的 + 从解剖页带过来的 + 近 4 周明显练得少的。
  const weakPoints = () => [...new Set([
    ...(profile.weak || []),
    ...focusList,
    ...(useHistory ? history.low.slice(0, 2) : []),
  ])]

  const generate = () => {
    setPlan(buildWeek({
      goal,
      days: profile.days,
      minutes: profile.minutes,
      equipment: profile.equipment,
      profile,
      weak: weakPoints(),
    }))
    setPhase('week')
    setSaved(false)
  }

  /** 把整周计划一次写进 S.routines——"计划页"直接可见、可直接开练。 */
  const savePlan = () => {
    if (!plan || saved) return
    const sessions = planToRoutines(plan)
    if (!sessions.length) return
    useStore.getState().update(s => { s.routines.push(...sessions) })
    setSaved(true)
  }

  const askAi = async () => {
    setAiState('checking')
    const ok = await aiAvailable()
    if (!ok) {
      setAiState('failed')
      setAiNote('AI 未接通（服务端没有配置密钥，或当前是纯静态部署）。下面的计划由本地引擎生成，同样可以直接用。')
      if (!plan) generate()
      return
    }
    setAiState('working')
    const base = plan || buildWeek({ goal, days: profile.days, minutes: profile.minutes, equipment: profile.equipment, profile, weak: weakPoints() })
    if (!plan) setPlan(base)

    const skeleton = base.sessions.map(s => `${s.name}: ` + s.exercises.map(e => `${e.name} ${e.sets}×${e.reps}`).join('；')).join('\n')
    const historyBlock = useHistory && history.count
      ? `
近 4 周的真实训练记录（App 内已完成的训练，只统计勾选完成的有效组）：
- 训练次数：${history.count} 次，最近一次 ${history.last || '未知'}
- 各部位有效组数：${history.text || '暂无'}
- 明显练得少的部位：${history.low.map(cn).join('、') || '无明显短板'}

请据此修正候选计划：练得少的部位优先补量，已经堆得多的部位不要再加，
并指出按这份历史看最可能出现的恢复风险或进步卡点。`
      : '\n（用户暂无可读取的训练记录，按新手保守起步。）'

    const prompt = `根据以下信息，给这位训练者一份可以立刻执行的每周训练计划。

身体与目标：${bodySummary(profile)}
训练目标：${GOALS[goal]?.label || goal}
每周可训练：${profile.days} 天，每次约 ${profile.minutes} 分钟
器械条件：${EQUIP_LABEL[profile.equipment] || profile.equipment}
经验：${profile.experience || '未填写'}
想重点加强：${weakPoints().map(cn).join('、') || '无'}
${historyBlock}
系统已按动作库给出一个候选计划（动作名必须来自这里，不要自创器械动作）：
${skeleton}

请输出：
1. 一句总评（这套计划适合他什么、风险在哪，要呼应上面的训练记录）；
2. 每周安排表（第几天练什么）；
3. 每一天的动作、组数、次数、组间休息、起始重量建议；
4. 一个 4 周的进阶规则（每周如何加重/加组，第几周减载）；
5. 三条最关键的注意点。

用简体中文，直接给结论，不要寒暄，不要用表格符号画蛇的 ASCII 图。`

    const out = await ask({ system: COACH_SYSTEM, prompt, maxTokens: 2600 })
    if (out.ok) {
      setAiText(out.text)
      setAiState('done')
      setAiNote(`已由 ${out.model} 结合本地动作库与近 4 周训练记录生成`)
    } else {
      setAiState('failed')
      setAiNote(`AI 调用失败：${aiFailHint(out.reason, out.detail)} 本地引擎的计划仍然可用。`)
    }
  }

  const meso = useMemo(() => buildMesocycle(12), [])
  const macro = useMemo(() => buildMacro(), [])

  return <>
    <div className="hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav(-1)} aria-label="返回"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1>AI 排计划</h1>
        <div className="sub">{bodySummary(profile)}</div>
      </div>
    </div>

    <div className="card">
      <h4 className="sec">最近练了什么</h4>
      <div className="chips wrap">
        <button className={'chip' + (useHistory ? ' on' : '')} aria-pressed={useHistory}
          onClick={() => { setUseHistory(v => !v); setSaved(false) }}>
          {useHistory ? '✓ 参考近 4 周记录' : '不参考训练记录'}
        </button>
      </div>
      {useHistory && <div className="plan-note" style={{ marginTop: 8 }}>
        {history.count
          ? `已读取 ${history.count} 次训练，最近一次 ${history.last || '–'}，有效组数合计约 ${Math.round(history.total)} 组。` +
            (history.text ? `练得最多：${history.text}。` : '') +
            (history.low.length ? ` 偏少：${history.low.map(cn).join('、')}，生成计划时会优先补。` : ' 各部位覆盖比较均衡。')
          : '还没有训练记录，会按新手保守起步；练过几次之后这里会自动变成你的真实数据。'}
      </div>}
      {focusList.length > 0 && <div className="plan-note" style={{ marginTop: 6 }}>
        从肌肉模型带过来的重点部位：{focusList.map(cn).join('、')}
      </div>}
    </div>

    <div className="card">
      <h4 className="sec">目标</h4>
      <div className="chips wrap">
        {Object.entries(GOALS).map(([id, g]) => (
          <button key={id} className={'chip' + (goal === id ? ' on' : '')} aria-pressed={goal === id}
            onClick={() => setProfile({ goal: id })}>{g.label}</button>
        ))}
      </div>

      <h4 className="sec">每周练几天</h4>
      <div className="chips wrap">
        {[2, 3, 4, 5, 6].map(d => (
          <button key={d} className={'chip' + (profile.days === d ? ' on' : '')} aria-pressed={profile.days === d}
            onClick={() => setProfile({ days: d })}>{d} 天</button>
        ))}
        {[30, 45, 60, 75].map(m => (
          <button key={'m' + m} className={'chip' + (profile.minutes === m ? ' on' : '')} aria-pressed={profile.minutes === m}
            onClick={() => setProfile({ minutes: m })}>{m} 分钟</button>
        ))}
      </div>

      <h4 className="sec">器械条件</h4>
      <div className="chips wrap">
        {Object.entries(EQUIP_LABEL).map(([id, label]) => (
          <button key={id} className={'chip' + (profile.equipment === id ? ' on' : '')} aria-pressed={profile.equipment === id}
            onClick={() => setProfile({ equipment: id })}>{label}</button>
        ))}
      </div>

      <h4 className="sec">重点加强（可多选）</h4>
      <div className="chips wrap">
        {MUSCLES.map(m => {
          const on = (profile.weak || []).includes(m)
          return <button key={m} className={'chip' + (on ? ' on' : '')} aria-pressed={on}
            onClick={() => setProfile({ weak: on ? profile.weak.filter(x => x !== m) : [...(profile.weak || []), m] })}>
            {cn(m)}
          </button>
        })}
      </div>

      <div style={{ height: 14 }} />
      <div className="row" style={{ gap: 8 }}>
        <Button variant="primary" icon="sparkles" onClick={generate}>生成计划</Button>
        <Button variant="tinted" icon="bolt" onClick={askAi} disabled={aiState === 'working'}>
          {aiState === 'working' ? 'AI 正在编排…' : 'AI 优化'}
        </Button>
      </div>
      {aiState === 'failed' && <div className="plan-note warn" style={{ marginTop: 10 }}>{aiNote}</div>}
      {aiState === 'done' && <div className="plan-note" style={{ marginTop: 10 }}>{aiNote}</div>}
    </div>

    {plan && <>
      <div className="card">
        <Button variant="primary" icon="check" onClick={savePlan} disabled={saved}>
          {saved ? '已保存到计划页' : `保存 ${plan.sessions.length} 个动作组到计划页`}
        </Button>
        <div className="plan-note" style={{ marginTop: 8 }}>
          {saved
            ? '已写入动作组，回到「计划」页就能看到，也可以直接开练。'
            : '一次把整周计划写进 App 自己的计划库，不用逐个动作点「+」。'}
        </div>
      </div>

      <div className="seg" role="tablist" style={{ marginTop: 14 }}>
        {[['week', '本周'], ['meso', '12 周周期'], ['year', '年度规划']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={phase === id} className={phase === id ? 'on' : ''} onClick={() => setPhase(id)}>{label}</button>
        ))}
      </div>

      {phase === 'week' && <>
        <div className="plan-stats">
          <div><b>{plan.sessions.length}</b><span>动作组</span></div>
          <div><b>{plan.volume}</b><span>周总组数</span></div>
          <div><b>{plan.neglected.length}</b><span>未覆盖肌群</span></div>
        </div>

        {plan.neglected.length > 0 && <div className="plan-note" style={{ marginBottom: 10 }}>
          这周没安排到：{plan.neglected.map(cn).join('、')}。练的天数少时这是正常的取舍；想补就先增加天数或选"重点加强"。
        </div>}

        {plan.sessions.map((s, i) => (
          <div className="card plan-day" key={s.name}>
            <div className="plan-day-h">
              <span className="plan-day-n">第 {i + 1} 天</span>
              <b>{s.name}</b>
              <span className="dim small">{s.exercises.reduce((a, e) => a + e.sets, 0)} 组</span>
            </div>
            {s.exercises.map(e => (
              <div className="plan-ex" key={e.exId + e.name}>
                <div className="plan-ex-main">
                  <div className="plan-ex-name">{e.name}</div>
                  <div className="plan-ex-meta">{cn(e.muscle)} · 休息 {e.rest}s{e.note ? ' · ' + e.note : ''}</div>
                </div>
                <div className="plan-ex-pres">{e.sets} × {e.reps}{e.load ? ` · ${e.load}kg` : ''}</div>
                <button className="iconbtn" aria-label="加入计划" onClick={() => addToRoutineSheet({ id: e.exId, n: e.name })}><Icon name="plus" /></button>
              </div>
            ))}
            <div className="plan-day-foot">{GOALS[plan.goal]?.note}</div>
          </div>
        ))}

        <div className="card">
          <h4 className="sec">每周每块肌肉的组数</h4>
          <div className="plan-bars">
            {plan.coverage.filter(c => c.sets > 0).sort((a, b) => b.sets - a.sets).map(c => (
              <div className="plan-bar" key={c.muscle}>
                <span>{cn(c.muscle)}</span>
                <i style={{ width: `${Math.min(100, c.sets * 4)}%` }} />
                <b>{c.sets}</b>
              </div>
            ))}
          </div>
          <div className="plan-note">增肌一般每块肌肉每周 10–20 组；低于 10 组算维持，高于 22 组多数人恢复不过来。</div>
        </div>
      </>}

      {phase === 'meso' && <div className="card">
        <h4 className="sec">12 周 = 3 个积累块 + 1 个减载</h4>
        {meso.map(w => (
          <div className="plan-week" key={w.week}>
            <span className="plan-week-n">{w.week}</span>
            <div style={{ flex: 1 }}>
              <b>{w.block}{w.deload ? ' · 减载' : ''}</b>
              <div className="small dim">{w.detail}</div>
            </div>
            <span className="plan-vol" style={{ width: 62 }}><i style={{ width: `${w.volumeFactor * 100}%` }} /></span>
          </div>
        ))}
        <div className="plan-note">第 4、8、12 周是减载周：组数降到 60%，重量不变。身体是在恢复里变强的。</div>
      </div>}

      {phase === 'year' && <div className="card">
        <h4 className="sec">一年三段</h4>
        {macro.map(p => (
          <div className="plan-phase" key={p.name}>
            <div className="row between">
              <b>{p.name}</b><span className="dim small">{p.months}</span>
            </div>
            <div className="small" style={{ marginTop: 4 }}>{p.detail}</div>
            <div className="plan-phase-goal">目标：{GOALS[p.goal]?.label}</div>
          </div>
        ))}
        <div className="plan-note">每 4 周减载一次，每 16 周重新测一次主项 5RM，用新数据重排下一段。</div>
      </div>}
    </>}

    {aiText && <div className="card">
      <h4 className="sec">AI 教练的说明</h4>
      <div className="ai-text">{aiText}</div>
    </div>}

    {!plan && <div className="ana-empty" style={{ marginTop: 18 }}>
      选好上面的条件，点"生成计划"。不联网也能用，本地引擎同样会按你的身体数据和训练记录排。
    </div>}
  </>
}
