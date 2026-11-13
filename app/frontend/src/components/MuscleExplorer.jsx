import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { BODYPARTS, allExercises, equipmentOf, searchExercises } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum, exCount } from '../lib/format.js'
import { MUSCLES, MUSCLE_NAME, musclesOf } from '../lib/muscles.js'
import { academicName, MUSCLE_FACTS } from '../lib/muscle-facts.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import BodyMap from './BodyMap.jsx'
import { MediaPreview } from './Media.jsx'
import Icon from './Icon.jsx'
import ExerciseViewToggle from './ExerciseViewToggle.jsx'
import { Button } from './ui.jsx'
import { useAutoMore } from '../lib/use-auto-more.js'
import { favIds, isFav, sortFavouritesFirst } from '../lib/favourites.js'
// 210 块最小解剖单位（→ 432 个可独立点击细束）的权威数据表：搜索、slug 折算、详情。
import { ATLAS_UNIT_BY_ID, slugsOfUnits, searchAtlas } from '../lib/anatomy/atlas-groups.js'
// 按性别的推荐偏置：图谱 ex 男女完全一致、运行时无性别训练数据，故用策展启发式
// （肌肉群加权 + 标志性动作微调），叠加到现有的肌肉匹配打分之上。
import { sexBiasFor } from '../lib/muscle-sex-bias.js'
import { painSlugs, setPains, isPained, painsOf, hitsPain } from '../lib/pain.js'
import { popBoost } from '../lib/known-exercises.js'

const FAV = '☆'

// One explorer for the Library and every catalogue picker. Supplying `onPick` turns
// a result into a selection; without it the explorer behaves like the normal Library.
// `MapComponent` lets a screen swap the flat body chart for the 3D figure without
// rewriting the muscle → exercise list below it (see BodyMap3D.jsx).
//
// `enableMulti` (default false) turns the muscle chips + 3D figure into a multi-select:
// flick the 多选 switch and taps toggle membership instead of replacing it. Every existing
// caller leaves it off, so their single-select behaviour is untouched. `Muscles` is the one
// page that opts in.
export default function MuscleExplorer({ onPick, onDetail, onPlan, pickIcon = 'plus', initial = null, MapComponent = BodyMap, enableMulti = false }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  // A single source of truth for the chosen muscle(s). Single-select pages keep exactly one
  // entry (or none); multi-select pages may hold several. `multiOn` only matters when
  // `enableMulti` is on — it is the 多选 switch the user flips.
  const [picked, setPicked] = useState(() => {
    if (!initial) return []
    if (ATLAS_UNIT_BY_ID[initial]) return [initial]
    // `initial` 是 slug（来自 ?m= 参数）：选中该组下全部细束。
    const ids = Object.values(ATLAS_UNIT_BY_ID).filter(u => u.slug === initial).map(u => u.id)
    return ids.length ? ids : [initial]
  })
  const [multiOn, setMultiOn] = useState(false)
  const gender = S.body === 'female' ? 'female' : 'male'
  const isZh = String(S.lang || 'zh').toLowerCase().startsWith('zh')
  // Selection is keyed by fine-unit id (e.g. "pec_major_clav__L"); map back to the 18 training
  // slugs for exercise filtering / coverage ordering.
  const slugs = useMemo(() => slugsOfUnits(picked), [picked])
  // The atlas ships a curated exercise list per fine bundle (author-verified) — a strong
  // relevance signal so "what this exact bundle trains" rises to the top regardless of sex.
  const exNames = useMemo(() => {
    const set = new Set()
    for (const id of picked) {
      const u = ATLAS_UNIT_BY_ID[id]
      if (u?.ex) for (const n of u.ex) set.add(n)
    }
    return set
  }, [picked])
  // 文字搜索选肌肉：中文名 / 英文名 / 俗称 / 左右 / 父级，结果点一下即选中该细束。
  const [mq, setMq] = useState('')
  const muscleHits = useMemo(() => (mq.trim() ? searchAtlas(mq, 24) : []), [mq])
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [shown, setShown] = useState(40)
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  const moreRef = useAutoMore(() => setShown(s => s + 40))
  // The muscle-group strip scrolls sideways; when a tap on the 3D model picks a group,
  // bring that group's chip into view so the row and the figure stay in sync.
  const chipsRef = useRef(null)
  useEffect(() => {
    const el = chipsRef.current?.querySelector('.chip.on')
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [picked])
  // Same rule as the Library and the picker: the active equipment profile narrows the catalogue
  // (and the per-muscle counts) unless the user asks for everything.
  const profile = activeProfile(S)
  const catalog = useMemo(() => {
    const all = allExercises(S)
    return (profile && !showAll) ? all.filter(e => exAvailable(S, e)) : all
  }, [S.customEx, S.equipFilterOn, S.activeEquipId, S.equipProfiles, showAll])
  const counts = useMemo(() => Object.fromEntries(MUSCLES.map(m => [m,
    catalog.filter(e => musclesOf(e)[m]).length
  ])), [catalog])
  // `id` is a fine-unit id (e.g. "pec_major_clav__L"); falls back to the coarse slug for parts
  // without a fine unit. Keyed by unit id so adjacent bundles sharing a slug stay separable.
  const pick = (id, unit) => {
    setPicked(prev => {
      if (enableMulti && multiOn) {
        return prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
      }
      return (prev.length === 1 && prev[0] === id) ? [] : [id]
    })
    setEq(''); setShown(40)
  }
  const clear = () => { setPicked([]); setEq(''); setShown(40) }
  // Single select trains exactly the one muscle; multi select is the union of every picked one.
  const targeted = slugs.length ? catalog.filter(e => slugs.some(m => (musclesOf(e)[m] || 0) > 0)) : []
  // The picker's Favourites chip (#669), here for the chosen muscle: '☆' in place of a body part.
  const favOn = bp === FAV
  const favHere = targeted.filter(e => isFav(S, e.id)).length
  const base = searchExercises(targeted.filter(e => favOn ? isFav(S, e.id) : (!bp || e.bp === bp)), q)
  // Multi-select: float the exercises that hit the most of the chosen muscles to the top
  // (stable sort keeps the catalogue order among ties), then let Favourites rise within that.
  // Rank by how strongly the movement actually loads the chosen muscle(s), plus a boost when the
  // movement is one the fine bundle itself recommends (unit.ex) — so "what this exact bundle
  // trains" surfaces first regardless of sex.
  const exHit = e => exNames.has(exerciseNameFor(e)) ? 0.6 : 0
  // Rank by how strongly the movement loads the chosen muscle(s) + the fine bundle's
  // own recommended exercise boost (unit.ex) + a gender bias that surfaces the
  // movements each sex tends to emphasise (never overrides the muscle match).
  const matchedWeight = e => slugs.reduce((s, m) => s + ((musclesOf(e)[m] || 0) > 0 ? musclesOf(e)[m] : 0), 0) + exHit(e) + sexBiasFor(e, gender) + popBoost(e)
  const ordered = picked.length ? [...base].sort((a, b) => matchedWeight(b) - matchedWeight(a)) : base
  const eqOpts = equipmentOf(base)
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  const exercises = sortFavouritesFirst(eqOn ? ordered.filter(e => e.eq === eqOn) : ordered, S)
  const choose = ex => onPick ? onPick(ex) : onDetail(ex)
  // The live count and the × of the Library's search (#338): the count while a search or a
  // filter narrows the muscle's list, the × while there is text.
  const narrowed = !!(q.trim() || bp || eqOn)
  // 中文界面才在标题后面补一行拉丁/英文学术名；英文界面下标题本身已经是英文名，别重复。
  const singleUnit = picked.length === 1 ? ATLAS_UNIT_BY_ID[picked[0]] : null
  const singleLabel = singleUnit ? (isZh ? singleUnit.cn : singleUnit.en) : ''
  const showLatin = /[\u3400-\u9fff]/.test(singleLabel)

  return <>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 'var(--fs-footnote)' }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 'var(--fs-caption)' }} onClick={() => { setShowAll(v => !v); setEq(''); setShown(40) }}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    <div className="card">
      <MapComponent className="tappable" body={S.body} lang={S.lang}
        selected={enableMulti && (multiOn || picked.length > 1) ? picked : (picked[0] ?? null)}
        onMuscle={pick} multi={enableMulti && multiOn} onToggle={pick} />
      {enableMulti && <div className="row" style={{ margin: '0 0 10px', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={'chip nocap' + (multiOn ? ' on' : '')} aria-pressed={multiOn}
          onClick={() => setMultiOn(v => !v)}><Icon name="checkCircle" />多选</button>
        {picked.length > 0
          ? <span className="small dim">已选 {picked.length} 处</span>
          : <span className="small dim">可一次选多块肌肉</span>}
        {multiOn && <span className="small dim">点模型或标签可反复加减，下面按覆盖度排序</span>}
      </div>}
      {/* 一排可左右滑动的肌肉群标签（不再换行堆到模型下面）。点三维模型时，对应标签自动
          选中并滚动到可视区域。 */}
      <div className="chips" ref={chipsRef} style={{ marginTop: 10 }}>
        {MUSCLES.map(m => {
          const slugIds = Object.values(ATLAS_UNIT_BY_ID).filter(u => u.slug === m).map(u => u.id)
          const on = slugIds.some(id => picked.includes(id))
          return <button key={m} className={'chip' + (on ? ' on' : '')}
            aria-pressed={on} onClick={() => {
              setPicked(prev => {
                const multi = enableMulti && multiOn
                if (multi) return on ? prev.filter(id => !slugIds.includes(id)) : [...new Set([...prev, ...slugIds])]
                return on ? [] : [...slugIds]
              })
              setEq(''); setShown(40)
            }}>
            {academicName(m, S.lang, t(MUSCLE_NAME[m]))} <span className="dim">{counts[m]}</span>
          </button>
        })}
      </div>
    </div>

      {/* 文字搜索选肌肉：输入中文名 / 英文名 / 俗称 / 左右 / 父级，结果点一下即选中该细束。 */}
      <div className="search-row" style={{ marginTop: 12, marginBottom: 2 }}>
        <div className={'search' + (mq ? ' has-clear' : '')}>
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input className="input" placeholder={t('搜索肌肉…')} value={mq} onChange={e => setMq(e.target.value)} />
          {mq && <button className="clear" onClick={() => setMq('')} aria-label={t('Clear')}><Icon name="xmark" /></button>}
        </div>
        {muscleHits.length > 0 && <div className="chips" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          {muscleHits.map(u => (
            <button key={u.id} className={'chip' + (picked.includes(u.id) ? ' on' : '')}
              aria-pressed={picked.includes(u.id)} onClick={() => pick(u.id, u)}>
              {isZh ? u.cn : u.en}
            </button>
          ))}
        </div>}
      </div>

    {!picked.length && onPick && <div className="empty"><div className="ico"><Icon name="figureStrength" /></div>{t('Choose a muscle to see exercises that train it.')}</div>}

    {picked.length > 0 && <>
      <div className="row between" style={{ margin: '2px 0 10px' }}>
        {picked.length === 1 ? <h4 className="sec" style={{ margin: 0 }}>
          {t('Exercises for {0}', singleLabel)}
          {showLatin && <span className="dim"> {MUSCLE_FACTS[picked[0]]?.en}</span>}
        </h4>         : <h4 className="sec" style={{ margin: 0 }}>
          已选 {picked.length} 处肌肉
          <span className="dim"> {picked.map(id => { const u = ATLAS_UNIT_BY_ID[id]; return u ? (isZh ? u.cn : u.en) : id }).join('、')}</span>
        </h4>}
        <Button size="sm" variant="ghost" onClick={clear}>{t('Clear selection')}</Button>
      </div>
      {/* Sore or injured: the point of marking is that suggestions stop offering movements that
          load it (lib/pain.js). Marked muscles stay listed here so it can be undone, and clearing
          a mark is one tap on the chip rather than finding the muscle on the model again. */}
      <div className="row" style={{ margin: '-2px 0 10px', flexWrap: 'wrap', gap: 8 }}>
        {slugs.length > 0 && <Button size="sm" variant={slugs.every(m => isPained(S, m)) ? 'tinted' : 'ghost'} icon="heart"
          onClick={() => update(s => { const on = !slugs.every(m => !!painsOf(s)[m]); s.pains = setPains(s.pains, slugs, on) })}>
          {slugs.every(m => isPained(S, m)) ? t('Marked as sore — tap to undo') : t('Mark as sore')}
        </Button>}
        {painSlugs(S).map(m => <button key={m} type="button" className="chip on" onClick={() => update(s => { s.pains = setPains(s.pains, [m], false) })}>
          {academicName(m, S.lang, t(MUSCLE_NAME[m]))} <Icon name="xmark" />
        </button>)}
      </div>
      {picked.length > 1 && <div className="small dim" style={{ margin: '-4px 0 10px' }}>按覆盖度排序</div>}
      <div className="search-row" style={{ marginBottom: 10 }}><div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} />
        {narrowed && <span className="search-count" role="status" aria-label={exCount(exercises.length)}>{fmtNum(exercises.length)}</span>}
        {q && <button className="clear" onClick={() => { setQ(''); setShown(40) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}
      </div><ExerciseViewToggle /></div>
      {/* Changing body part keeps the equipment filter (issue #71, same rule as Library): the
          eqOn fallback above drops it only for this view if the new body part has nothing under
          it, without forgetting the choice. "All" clears it, since it spans every body part. */}
      <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
        {favIds(S).length > 0 && <button className={'chip' + (favOn ? ' on' : '')} onClick={() => { setBp(FAV); setEq(''); setShown(40) }}><Icon name="starFill" className="fav-star" />{t('Favourites')} ({favHere})</button>}
        <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40) }}>{t('All')}</button>
        {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40) }}>{t(b)}</button>)}
      </div>
      {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
        <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
        {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
      </div>}
      <div className={'list' + (S.exerciseView === 'cards' ? ' ex-grid' : '')}>
        {exercises.slice(0, shown).map(e => {
          const best = bestWeightFor(S, e.id)
          // Which of *your chosen* muscles this movement actually trains. The old subtitle
          // printed the exercise's own `tg` alias, so it could read "chest" while you had
          // picked "deltoids" — the reason the recommendations looked imprecise.
          const hitMuscles = slugs.filter(m => (musclesOf(e)[m] || 0) > 0)
          const primary = hitMuscles.some(m => musclesOf(e)[m] === 1)
          // How many of the chosen muscles this movement actually trains — shown on each row
          // in multi-select so the coverage ordering reads clearly.
          const cover = picked.length > 1 ? hitMuscles.length : 0
          const hitLabel = hitMuscles.map(m => academicName(m, S.lang, t(MUSCLE_NAME[m]))).join('、')
          const sore = hitsPain(S, e)
          // The name is the row's button, stretched over it; Plan is its sibling (card dismiss pass).
          return <div key={e.id} className="item tap-host">
            <MediaPreview ex={e} />
            <button type="button" className="grow item-open tap-main" onClick={() => choose(e)}><span className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}{sore && <span className="tag" style={{ marginInlineStart: 6, color: 'var(--gold-ink)', background: 'transparent' }}>{t('Sore')}</span>}</span><span className="ss">{t(primary ? 'Primary target' : 'Also trains')} · <span className="capitalize">{hitLabel} · {t(e.eq)}</span>{cover > 0 && <> · 命中 {cover}/{picked.length} 处</>}</span></button>
            {onPick ? <Icon name={pickIcon} className="chev" /> : <>
              {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
              <Button size="sm" variant="tinted" icon="plus" onClick={() => onPlan(e)}>{t('Plan')}</Button>
            </>}
          </div>
        })}
        {exercises.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
      </div>
      {exercises.length > shown && <><div style={{ height: 10 }} /><Button ref={moreRef} onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
    </>}
  </>
}
