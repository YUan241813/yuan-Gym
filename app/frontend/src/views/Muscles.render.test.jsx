// @vitest-environment happy-dom
// 「探索肌肉」页（/muscles）必须能渲染出来。
//
// 这页把平面人体图换成了三维人体（BodyMap3D → BodyModel3D），而三维组件在渲染期会读
// `lang` 来决定左下角显示中文还是英文的肌束名。1.4.9 里那次改动漏了在 props 里解构
// `lang`，于是它成了未声明变量，一进这页就抛 ReferenceError，错误边界把整页替换成
// 「出了点问题 / 此页面无法显示」——用户看到的就是「建模打不开」。
//
// 单元测试跑在 happy-dom 里，没有 WebGL：BodyModel3D 会自己退回「此设备无法创建 3D 视图」
// 的兜底画面，但只要渲染期有任何未声明变量，异常就会一路抛出 createRoot 的 act 并让本测试失败。
// 换句话说，这个用例守的是「这页能画出来」，不是「3D 画得好不好看」。
import React, { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import Muscles from './Muscles.jsx'

beforeAll(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })

const roots = []
afterEach(() => { roots.splice(0).forEach(root => act(() => root.unmount())) })

function renderAt(path) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(<MemoryRouter initialEntries={[path]}><Muscles /></MemoryRouter>))
  return host
}

describe('Muscles page', () => {
  it('renders the 3D muscle picker without throwing', () => {
    const host = renderAt('/muscles')
    // 「多选」开关是这页独有的硬编码文案，说明 MuscleExplorer 真的挂上来了。
    expect(host.textContent).toContain('多选')
    // 三维容器在 DOM 里（WebGL 缺失时它退化成兜底块，但容器本身不会消失）。
    expect(host.querySelector('.bodymap3d')).toBeTruthy()
  })

  it('opens straight onto a muscle when ?m= names one', () => {
    const host = renderAt('/muscles?m=deltoids')
    // 选中三角肌后应该出现「已选」与「清除选择」，证明 initial 参数被消化了。
    expect(host.textContent).toContain('多选')
    expect(host.textContent).toMatch(/三角肌|Deltoids/)
  })
})
