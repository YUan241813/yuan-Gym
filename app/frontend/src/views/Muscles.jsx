import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { MUSCLES } from '../lib/muscles.js'
import { t } from '../lib/i18n.js'
import MuscleExplorer from '../components/MuscleExplorer.jsx'
import BodyMap3D from '../components/BodyMap3D.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Segmented } from '../components/ui.jsx'
import { useAnatomyProfile } from '../lib/anatomy-profile.js'
import { setBodySex } from '../lib/body-sex.js'
import '../bodymap3d.css'

// `?m=<muscle>` opens on that muscle (Stats' untrained muscles, #553), and back goes where it came from.
//
// 这一页的选部位控件原本是一张平面人体示意图；用户要的是「三维建模直接替换掉平面图的位置」，
// 所以这里给 MuscleExplorer 传 BodyMap3D —— 三维人体就在原来那张图的位置上，点一下肌肉，
// 下面立刻列出练它的动作。
//
// 标题右边那个「3D compare / 锻炼前后对比」小按钮已经删掉（2026-11-11）：对比功能整个下掉了，
// 而且三维人体就在这一页里，没必要再给一个通往同一具模型的进阶入口。
// /anatomy 路由暂时保留（没有入口，直接输地址才到），等后续把对比功能加回来时再用。
export default function Muscles() {
  const nav = useNavigate()
  const loc = useLocation()
  const [params] = useSearchParams()
  const m = params.get('m')
  const initial = m && MUSCLES.includes(m) ? m : null
  const back = loc.state?.from === '/stats' ? '/stats' : '/library'
  // 建模性别：3D 模型按 profile.sex、动作推荐按 S.body，setBodySex 保证两者同步。
  // 这一页允许独立于「设置」单独切性别——切完下面 3D 人体和推荐动作立刻跟着变。
  const [profile] = useAnatomyProfile()
  const sex = profile?.sex === 'female' ? 'female' : 'male'
  return <>
    <div className="hdr">
      <button className="iconbtn" data-back={back} onClick={() => nav(back)} aria-label={back === '/stats' ? t('Stats') : t('Exercises')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}>
        <h1>{t('Explore muscles')}</h1>
        <div className="sub">{t('Choose a muscle to see exercises that train it.')} 点开「多选」可一次选好几块肌肉，下方按覆盖度排序。</div>
      </div>
      <Segmented
        className="seg-inline"
        options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
        value={sex}
        onChange={v => setBodySex(v)}
      />
    </div>

    <MuscleExplorer key={initial || ''} initial={initial} MapComponent={BodyMap3D} enableMulti
      onDetail={exerciseDetailSheet} onPlan={addToRoutineSheet} />
  </>
}
