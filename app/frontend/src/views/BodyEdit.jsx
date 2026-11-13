import { useNavigate } from 'react-router-dom'
import { useAnatomyProfile } from '../lib/anatomy-profile.js'
import { deriveProportions } from '../lib/anatomy-model.js'
import BodyModel3D from '../components/BodyModel3D.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../anatomy.css'
import '../plan.css'

const NUM = [
  ['height', '身高', 'cm', 140, 215],
  ['weight', '体重', 'kg', 35, 180],
  ['bodyFat', '体脂率', '%', 3, 45],
  ['chest', '胸围', 'cm', 60, 150],
  ['waist', '腰围', 'cm', 50, 140],
  ['arm', '臂围', 'cm', 18, 60],
  ['thigh', '腿围', 'cm', 30, 90],
]

export default function BodyEdit() {
  const nav = useNavigate()
  const [profile, setProfile] = useAnatomyProfile()
  const p = deriveProportions(profile)

  const setNum = (k, raw) => {
    if (raw === '') { setProfile({ [k]: null }); return }
    const n = Number(raw)
    if (Number.isFinite(n)) setProfile({ [k]: n })
  }

  return <>
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav(-1)} aria-label="返回"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1 }}>
        <h1>体型数据</h1>
        <div className="sub">填多少算多少，留空就用平均值</div>
      </div>
    </div>

    <div className="body-preview">
      <BodyModel3D profile={profile} gender={profile.sex === 'female' ? 'female' : 'male'} xray={0.4} showBones={true} autoRotate />
    </div>

    <div className="card" style={{ marginTop: 12 }}>
      <h4 className="sec">基本信息</h4>
      <div className="chips wrap" style={{ marginBottom: 12 }}>
        {[['male', '男'], ['female', '女']].map(([id, label]) => (
          <button key={id} className={'chip' + (profile.sex === id ? ' on' : '')} aria-pressed={profile.sex === id}
            onClick={() => setProfile({ sex: id })}>{label}</button>
        ))}
        {['新手（不足 1 年）', '中级（1–3 年）', '进阶（3 年以上）'].map(x => (
          <button key={x} className={'chip' + (profile.experience === x ? ' on' : '')} aria-pressed={profile.experience === x}
            onClick={() => setProfile({ experience: x })}>{x}</button>
        ))}
      </div>

      <div className="body-form">
        <div className="body-field">
          <label htmlFor="age">年龄</label>
          <input id="age" className="input" type="number" inputMode="numeric" value={profile.age ?? ''}
            placeholder="选填" onChange={e => setNum('age', e.target.value)} />
        </div>
        {NUM.map(([k, label, unit, lo, hi]) => (
          <div className="body-field" key={k}>
            <label htmlFor={k}>{label}</label>
            <div className="row" style={{ gap: 8 }}>
              <input id={k} className="input" type="number" inputMode="decimal" value={profile[k] ?? ''}
                min={lo} max={hi} placeholder={k === 'bodyFat' || k.startsWith('c') || k === 'waist' || k === 'arm' || k === 'thigh' ? '选填' : ''}
                onChange={e => setNum(k, e.target.value)} />
              <span className="dim small" style={{ width: 24 }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="plan-note">
        模型按比例换算：肌肉量看 BMI 与体脂的分配，围度填了就以围度为准。
        现在这套数据对应：躯干 {Math.round(p.torso * 100)}%、腰 {Math.round(p.waist * 100)}%、手臂 {Math.round(p.arm * 100)}%、大腿 {Math.round(p.thigh * 100)}%。
      </div>
    </div>

    <div className="card" style={{ marginTop: 12 }}>
      <h4 className="sec">这些数据用在哪</h4>
      <div className="ana-facts">
        <div className="ana-fact"><span className="ico"><Icon name="figureStrength" /></span>
          <div><b>3D 模型</b>改完立刻变形，可以旋转看比例。</div></div>
        <div className="ana-fact"><span className="ico"><Icon name="clipboard" /></span>
          <div><b>动作组</b>决定起始重量与每周容量的分配。</div></div>
        <div className="ana-fact"><span className="ico"><Icon name="chart" /></span>
          <div><b>进度对比</b>记录体态快照后，可以和一个月前的自己并排看。</div></div>
      </div>
      <div style={{ height: 12 }} />
      <Button variant="primary" icon="check" onClick={() => nav(-1)}>完成</Button>
    </div>
  </>
}
