// 与平面 BodyMap 同接口的三维肌肉选择器。
//
// 「练肌肉」页原来用 BodyMap（一张正/背面的 SVG 示意图）来选部位。这里把它换成
// /anatomy 页那具可以拖动旋转、点肌肉的三维人体，但保持完全一样的 props
// （body / selected / onMuscle / className），所以 MuscleExplorer 里「选中一块肌肉 →
// 列出练它的动作 → 打开详情 / 加入计划」这一整条链路一行都不用改。
//
// 画肌肉层 + 骨架：骨骼是不透明实体，藏在肌肉内层，从头骨/锁骨/骨盆/关节这些肌肉盖不到
// 的地方自然露出来，就是解剖图谱那种「骨头 + 肌肉」的样子。骨骼永远不进拾取表
// （ecorche.js 的 pickMeshes 只收肌肉 mesh，骨骼自己的 raycast 也是空函数），所以
// 三角肌前/中/后束这类细束的点选精度和边界都不受影响。皮肤仍然不显示。
import { useAnatomyProfile } from '../lib/anatomy-profile.js'
import BodyModel3D from './BodyModel3D.jsx'
import '../anatomy.css'
import '../bodymap3d.css'

export default function BodyMap3D({ body = 'male', selected = null, onMuscle = () => {}, className = '', multi = false, onToggle = null, lang = 'zh' }) {
  const [profile] = useAnatomyProfile()
  // profile.sex 是模型自己的性别设置；body 是老 BodyMap 的入参，作为回退。
  const gender = profile?.sex === 'female' || (profile?.sex == null && body === 'female') ? 'female' : 'male'
  return (
    <div className={'bodymap3d ' + className} aria-label="三维人体：拖动旋转，点肌肉查看动作">
      <div className="ana-stage bodymap3d-stage">
        <div className="ana-stagewrap bodymap3d-wrap">
          <BodyModel3D
            profile={profile}
            gender={gender}
            selected={selected}
            onSelect={onMuscle}
            multi={multi}
            onToggle={onToggle}
            lang={lang}
            view="all"
            showSkin={false}
            showBones={true}
            xray={0.25}
          />
        </div>
      </div>
    </div>
  )
}
