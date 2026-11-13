import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { MUSCLES, MUSCLE_NAME, loadOfWorkouts, levelsOf, muscleBalanceWindow, musclesOf } from '../lib/muscles.js'
import { candidatesFor, candidatesForMany } from '../lib/plan-engine.js'
import { guideFor, involvementOf } from '../lib/exercise-guide.js'
import { useAnatomyProfile } from '../lib/anatomy-profile.js'
import { MUSCLE_FACTS, cnName } from '../lib/muscle-facts.js'
import { addToRoutineSheet, exerciseDetailSheet } from '../sheets.jsx'
import BodyModel3D from '../components/BodyModel3D.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../anatomy.css'

// The chart's two viewpoints. 'both' stands the front and back figures side by side.
const VIEWS = [
  { value: 'all', label: '全身' },
  { value: 'front', label: '前视图' },
  { value: 'back', label: '后视图' },
  { value: 'both', label: '前后对照' },
]

function Stars({ n }) {
  return <span className="ana-stars" aria-label={`推荐度 ${n} / 5`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>
}

/** Which of the chosen parts this movement trains, in the app's own words. */
function CoverTags({ ex, picked }) {
  const weights = useMemo(() => musclesOf(ex), [ex])
  const hits = picked.filter(slug => (weights[slug] || 0) > 0)
  if (hits.length < 1) return null
  return <div className="ana-cover">
    {hits.map(slug => (
      <span key={slug} className={'ana-tag' + ((weights[slug] || 0) >= 1 ? ' primary' : '')}>
        {cnName(slug, MUSCLE_NAME[slug])}
      </span>
    ))}
  </div>
}

function ExerciseRow({ ex, picked = [], onDetail }) {
  const [open, setOpen] = useState(false)
  const g = useMemo(() => guideFor(ex), [ex])
  const inv = useMemo(() => involvementOf(ex), [ex])
  return <div>
    <div className="ana-ex">
      <div className="ana-ex-main">
        <div className="ana-ex-name">{ex.n}</div>
        <div className="ana-ex-meta">{ex.eq} · {g.scheme} · 难度 {g.level}</div>
        {picked.length > 1 && <CoverTags ex={ex} picked={picked} />}
      </div>
      <Stars n={g.rating} />
      <button className="iconbtn" aria-expanded={open} aria-label={open ? '收起' : '展开讲解'} onClick={() => setOpen(v => !v)}>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
    </div>
    {open && <div className="ana-detail">
      <div className="ana-involve">
        {inv.primary.map(m => <span key={m} className="ana-tag primary">主动肌 · {cnName(m, MUSCLE_NAME[m])}</span>)}
        {inv.secondary.map(m => <span key={m} className="ana-tag">协同 · {cnName(m, MUSCLE_NAME[m])}</span>)}
      </div>

      <h5>怎么做</h5>
      <ol>{g.howto.map((s, i) => <li key={i}>{s}</li>)}</ol>

      <h5>技巧要点</h5>
      <ul>{g.cues.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h5>怎么找到发力感</h5>
      <div className="ana-callout"><span className="ico"><Icon name="target" /></span><span>{g.feel}</span></div>

      <h5>注意</h5>
      <div className="ana-callout warn"><span className="ico"><Icon name="warning" /></span><span>{g.caution}</span></div>

      <div style={{ height: 12 }} />
      <div className="row" style={{ gap: 8 }}>
        <Button size="sm" variant="tinted" icon="plus" onClick={() => addToRoutineSheet(ex)}>加入动作组</Button>
        <Button size="sm" variant="ghost" onClick={() => onDetail(ex)}>完整动作页</Button>
      </div>
    </div>}
  </div>
}

export default function Anatomy() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [params] = useSearchParams()
  const [profile] = useAnatomyProfile()
  // Picked parts, in the order they were tapped. One entry = the normal single-muscle
  // view; several = the multi-select comparison the model page is for.
  const [picked, setPicked] = useState(() => {
    const m = params.get('m')
    return m && MUSCLES.includes(m) ? [m] : []
  })
  const [multi, setMulti] = useState(false)
  const [heat, setHeat] = useState(false)
  const [view, setView] = useState('all')

  const selected = picked.length ? picked[picked.length - 1] : null

  // Seven-day training load, shaded onto the model when the heat toggle is on.
  const loads = useMemo(() => {
    if (!heat) return null
    const week = muscleBalanceWindow(S.workouts, 7)
    const load = loadOfWorkouts(week, s => s.done)
    return levelsOf(load)
  }, [heat, S.workouts])

  const exercises = useMemo(() => {
    if (!picked.length) return []
    if (picked.length === 1) return candidatesFor(picked[0], { equipment: profile.equipment, limit: 16 })
    return candidatesForMany(picked, { equipment: profile.equipment, limit: 16 })
  }, [picked, profile.equipment])

  const pickOne = slug => {
    if (multi) return
    setPicked(prev => (prev.length === 1 && prev[0] === slug ? [] : [slug]))
  }
  const toggleOne = slug => {
    setPicked(prev => (prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]))
  }

  const shape = { ...profile }
  const modelProfile = useMemo(() => shape, [JSON.stringify([profile.sex, profile.height, profile.weight, profile.bodyFat, profile.chest, profile.waist, profile.arm, profile.thigh])]) // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <div className="hdr ana-hdr">
      <button className="iconbtn" data-back="/library" onClick={() => nav(-1)} aria-label="返回"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1>肌肉建模</h1>
        <div className="sub">拖动旋转 · 点肌肉看动作 · 多选比较</div>
      </div>
      <button className="chip nocap" onClick={() => nav('/body-edit')}><Icon name="slider" />体型</button>
    </div>

    <div className="ana-layout">
      <div>
        <div className="ana-stage">
          <div className={'ana-stagewrap' + (view === 'both' ? ' pair' : '')}>
            <BodyModel3D
              profile={modelProfile}
              gender={profile.sex === 'female' ? 'female' : 'male'}
              selected={picked}
              multi={multi}
              onSelect={pickOne}
              onToggle={toggleOne}
              loads={loads}
              showSkin={false}
              showBones={true}
              view={view}
            />
          </div>

          <div className="ana-ctrl top">
            <div className="ana-views" role="group" aria-label="视图">
              {VIEWS.map(v => (
                <button key={v.value} className="ana-pill" aria-pressed={view === v.value}
                  onClick={() => setView(v.value)}>{v.label}</button>
              ))}
            </div>
          </div>

          <div className="ana-ctrl top2">
            <button className="ana-pill" aria-pressed={multi}
              onClick={() => setMulti(v => !v)}>
              <Icon name="checkCircle" />多选
            </button>
            <button className="ana-pill" aria-pressed={heat} onClick={() => setHeat(v => !v)}>
              <Icon name="flame" />近 7 天负荷
            </button>
          </div>

          {heat && <div className="ana-legend" aria-hidden="true">
            <span>低</span>
            <i style={{ width: 54 }} />
            <span>高</span>
          </div>}
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <h4 className="sec" style={{ margin: 0 }}>
              选择肌肉{picked.length > 1 ? ` · 已选 ${picked.length} 处` : ''}
            </h4>
            {picked.length > 0 && <button className="chip nocap" onClick={() => setPicked([])}>清除</button>}
          </div>
          <div className="chips wrap">
            {MUSCLES.map(m => (
              <button key={m} className={'chip' + (picked.includes(m) ? ' on' : '')}
                aria-pressed={picked.includes(m)}
                onClick={() => (multi ? toggleOne(m) : pickOne(m))}>
                <i className={'ana-face ' + (MUSCLE_FACTS[m]?.facing === 'back' ? 'b' : 'f')}>
                  {MUSCLE_FACTS[m]?.facing === 'back' ? '后' : '前'}
                </i>
                {cnName(m, MUSCLE_NAME[m])}
              </button>
            ))}
          </div>
          {multi && <div className="small dim" style={{ marginTop: 8 }}>
            多选模式下点模型或上面的标签即可反复加减，下面会给出同时命中这些部位的动作。
          </div>}
        </div>
      </div>

      <div className="ana-muscle-card">
        {!picked.length && <>
          <div className="ana-muscle-name">点一块肌肉开始</div>
          <div className="ana-muscle-action">模型上的任意肌肉都可以点，也可以在上面的列表里选；开「多选」可以一次挑好几处。</div>
          <div className="ana-facts">
            <div className="ana-fact"><span className="ico"><Icon name="target" /></span>
              <div><b>看什么</b>主动肌、协同肌，以及这块肌肉现在有多累。</div></div>
            <div className="ana-fact"><span className="ico"><Icon name="lightbulb" /></span>
              <div><b>怎么练</b>每个动作都有步骤、技巧、找发力感的方法和风险提示。</div></div>
            <div className="ana-fact"><span className="ico"><Icon name="sides" /></span>
              <div><b>体型同步</b>身高、体重、体脂、围度会实时改变模型比例。</div></div>
          </div>
          <div style={{ height: 10 }} />
          <Button variant="primary" onClick={() => nav('/ai-plan')}>让 AI 排一份动作组</Button>
        </>}

        {picked.length === 1 && <>
          <div className="ana-muscle-top">
            <div style={{ flex: 1 }}>
              <div className="ana-muscle-name">{cnName(selected)}</div>
              <div className="ana-muscle-action">{MUSCLE_NAME[selected]} · 共 {exercises.length} 个候选动作</div>
            </div>
            <Button size="sm" variant="tinted" icon="target" onClick={() => nav(`/ai-plan?focus=${selected}`)}>排计划</Button>
          </div>

          <div className="ana-facts">
            <div className="ana-fact"><span className="ico"><Icon name="info" /></span>
              <div><b>这块肌肉做什么</b>{MUSCLE_FACTS[selected]?.fn}</div></div>
            <div className="ana-fact"><span className="ico"><Icon name="dumbbell" /></span>
              <div><b>怎么练</b>{MUSCLE_FACTS[selected]?.train}</div></div>
          </div>

          <h4 className="sec" style={{ margin: '14px 0 4px' }}>推荐动作</h4>
          <div>
            {exercises.map(({ ex }) => <ExerciseRow key={ex.id} ex={ex} picked={picked} onDetail={exerciseDetailSheet} />)}
            {exercises.length === 0 && <div className="ana-empty">当前器械配置下没有可选动作，换一个器械档位试试。</div>}
          </div>

          <div style={{ height: 8 }} />
          <Button variant="ghost" icon="dumbbell" onClick={() => nav(`/library`)}>去动作库看全部动作</Button>
          <div style={{ height: 10 }} />
        </>}

        {picked.length > 1 && <>
          <div className="ana-muscle-name">同时练这 {picked.length} 处</div>
          <div className="ana-muscle-action">下面按「覆盖得全 + 不跑偏」排序：靠前的动作能用一次同时练到你选的大部分部位。</div>

          <div className="chips wrap" style={{ marginTop: 10 }}>
            {picked.map(slug => (
              <button key={slug} className="chip on" onClick={() => toggleOne(slug)}>
                {cnName(slug, MUSCLE_NAME[slug])}
                <Icon name="xmark" />
              </button>
            ))}
          </div>
          <div style={{ height: 10 }} />
          <Button variant="primary" icon="sparkles" onClick={() => nav(`/ai-plan?focus=${picked.join(',')}`)}>
            按这 {picked.length} 处排计划
          </Button>

          <h4 className="sec" style={{ margin: '14px 0 4px' }}>推荐动作 · {exercises.length} 个</h4>
          <div>
            {exercises.map(({ ex }) => <ExerciseRow key={ex.id} ex={ex} picked={picked} onDetail={exerciseDetailSheet} />)}
            {exercises.length === 0 && <div className="ana-empty">这几处没有共同动作，试试拆成两组，或放宽器械配置。</div>}
          </div>

          <div style={{ height: 10 }} />
        </>}
      </div>
      <p className="ana-attribution">
        人体皮肤网格：BodyParts3D 4.0 © DBCLS / NBDC，CC BY 4.0（经 ashemag/human-atlas 简化）；
        肌肉模型基于 Écorché 解剖数据。详见项目内 third_party/ATTRIBUTION.md。
      </p>
    </div>
  </>
}
