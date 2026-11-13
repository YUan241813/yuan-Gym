// @vitest-environment happy-dom
//
// 拍照签到页（2026-11-11 改版后）。这一页不再有会员卡，只做一件事：拍/选一张照片按今天归档，
// 然后把「哪天签过、长什么样」按天铺开。所以要证明的是：
//   · 今天没照片时给出空状态和两个入口（拍照 / 相册）；
//   · 两个入口分别接到各自的隐藏 file input，且都能把选中的文件交给 pick；
//   · pick 成功 → 走 fileProgressPhoto 写库（走 useStore.update 事务）→ toast + 同步媒体；
//   · 今天已有照片时换成「今天已签到」+ 缩略图；
//   · streakOf 的连续天数规则（今天没拍不清零昨天）。
//
// 照片管线和分组本身由 ProgressPhotos.test.js / day-photos.test.js 覆盖，这里把它们整体替身掉，
// 只测这一个页面的行为。
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  S: null,
  photos: [],           // progressPhotosOf(S) 的返回值
  writes: [],
  toast: vi.fn(),
  nav: vi.fn(),
  syncMedia: vi.fn(),
  fileProgressPhoto: vi.fn(),
  picker: null,         // useMediaPicker() 的返回值
}))

const update = vi.fn((mut, push = true) => {
  const next = structuredClone(mocks.S)
  mut(next)
  mocks.S = next
  mocks.writes.push({ push })
})

vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: mocks.S, update, user: null, config: null })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: () => ({ close() {} }) })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../lib/media-sync.js', () => ({ syncMedia: (...a) => mocks.syncMedia(...a) }))
vi.mock('../lib/day-photos.js', () => ({
  fileProgressPhoto: (...a) => mocks.fileProgressPhoto(...a),
  serverTakesDayPhotos: () => true,
}))
vi.mock('../lib/modules.js', () => ({ isOn: () => true }))
vi.mock('../components/CustomMediaField.jsx', () => ({ useMediaPicker: () => mocks.picker }))
vi.mock('../components/CustomMedia.jsx', () => ({
  CustomThumb: ({ ex }) => <i data-media={ex.media && ex.media.hash} />,
}))
// 分组逻辑在 ProgressPhotos.jsx 里，已有自己的测试；这里只按 d 字段归并。
vi.mock('./ProgressPhotos.jsx', () => ({
  progressPhotosOf: () => mocks.photos,
  groupByDate: photos => {
    const out = []
    for (const p of photos) {
      const last = out[out.length - 1]
      if (last && last.d === p.d) last.items.push(p)
      else out.push({ d: p.d, items: [p] })
    }
    return out
  },
}))

import CheckIn, { streakOf } from './CheckIn.jsx'
import { todayISO } from '../lib/format.js'

const shift = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const TODAY = todayISO()

let host, root
beforeEach(() => {
  mocks.S = {}
  mocks.photos = []
  mocks.writes.length = 0
  mocks.toast.mockClear(); mocks.nav.mockClear()
  mocks.syncMedia.mockClear(); mocks.fileProgressPhoto.mockReset()
  mocks.picker = { pick: vi.fn(async () => ({ hash: 'h1', mime: 'image/jpeg' })), busy: false, canAdd: true, note: null }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => { root.render(<CheckIn />) })
const btn = label => [...host.querySelectorAll('button')].find(b => (b.textContent || '').trim() === label)
const inputs = () => [...host.querySelectorAll('input[type="file"]')]

describe('CheckIn — 今天还没签到', () => {
  it('给出拍照（主操作）、普通签到（次按钮）、相册三个入口，并提示还没有签到记录', () => {
    mount()
    expect(btn('拍照签到')).toBeTruthy()
    expect(btn('不拍照，直接签到')).toBeTruthy()
    expect(btn('从相册选')).toBeTruthy()
    expect(host.textContent).toContain('Check in today')
    expect(host.textContent).toContain('还没有照片')
  })

  it('拍照签到是唯一主操作（实心 primary），普通签到降级为低调次按钮', () => {
    mount()
    const primary = host.querySelector('.btn.primary')
    expect(primary).toBeTruthy()
    expect((primary.textContent || '').trim()).toBe('拍照签到')
    const order = [...host.querySelectorAll('button')].map(b => (b.textContent || '').trim())
    expect(order.indexOf('拍照签到')).toBeLessThan(order.indexOf('不拍照，直接签到'))
  })

  it('拍照和相册按钮分别接到不同的文件输入，拍照那个直接起后置相机', async () => {
    mount()
    const [camera, album] = inputs()
    expect(camera.getAttribute('capture')).toBe('environment')
    expect(album.getAttribute('capture')).toBeNull()

    const cameraClick = vi.fn(); camera.click = cameraClick
    const albumClick = vi.fn(); album.click = albumClick
    await act(async () => { btn('拍照签到').click() })
    expect(cameraClick).toHaveBeenCalledTimes(1)
    expect(albumClick).not.toHaveBeenCalled()
    await act(async () => { btn('从相册选').click() })
    expect(albumClick).toHaveBeenCalledTimes(1)
  })
})

describe('CheckIn — 选一张照片', () => {
  const choose = async (file, which = 0) => {
    const input = inputs()[which]
    Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise(r => setTimeout(r, 0))
    })
  }

  it('照片交给 pick，成功后按今天归档、提示并同步', async () => {
    mocks.fileProgressPhoto.mockReturnValue('day')
    mount()
    mocks.writes.length = 0 // 清掉挂载时回填（backfill）的那一次写入，只测选照片这一次
    await choose(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    expect(mocks.picker.pick).toHaveBeenCalledTimes(1)
    expect(mocks.fileProgressPhoto.mock.calls[0][1]).toBe(todayISO())
    expect(mocks.writes).toEqual([{ push: true }])
    expect(mocks.toast).toHaveBeenCalledWith('Checked in for today')
    expect(mocks.syncMedia).toHaveBeenCalledWith({ force: true })
  })

  it('pick 失败（返回 null）时什么都不写', async () => {
    mocks.picker.pick = vi.fn(async () => null)
    mount()
    mocks.writes.length = 0
    await choose(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    expect(mocks.fileProgressPhoto).not.toHaveBeenCalled()
    expect(mocks.writes).toEqual([])
  })

  it('同一个文件已经被归档过时说清楚，而不是假装成功', async () => {
    mocks.fileProgressPhoto.mockReturnValue('dup')
    mount()
    await choose(new File(['x'], 'a.jpg', { type: 'image/jpeg' }))
    expect(mocks.toast).toHaveBeenCalledWith('That photo is already in today’s check-in')
    expect(mocks.syncMedia).not.toHaveBeenCalled()
  })

  it('没选文件就走开，什么也不发生', async () => {
    mount()
    await choose(null)
    expect(mocks.picker.pick).not.toHaveBeenCalled()
  })

  it('相册入口走的是第二个输入，行为一致', async () => {
    mocks.fileProgressPhoto.mockReturnValue('workout')
    mount()
    await choose(new File(['x'], 'b.jpg', { type: 'image/jpeg' }), 1)
    expect(mocks.picker.pick).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('Checked in for today')
  })

  it('这一台设备存不了照片时按钮禁用并说明原因', async () => {
    mocks.picker = { pick: vi.fn(), busy: false, canAdd: false, note: 'This browser cannot store photos or videos here.' }
    mount()
    expect(btn('拍照签到').disabled).toBe(true)
    expect(host.textContent).toContain('This browser cannot store photos or videos here.')
  })
})

describe('CheckIn — 今天已签到（拍照签到）', () => {
  it('换成「今天已签到」+ 今天的缩略图，并给「再拍一张」', () => {
    mocks.S = { dayPhotos: { h1: { d: TODAY, m: { hash: 'h1' }, _ts: 1 } } }
    mocks.photos = [{ key: 'day:h1', d: TODAY, m: { hash: 'h1' } }]
    mount()
    expect(host.textContent).toContain('Checked in today')
    expect(host.querySelector('[data-media="h1"]')).toBeTruthy()
    expect(btn('再拍一张')).toBeTruthy()
    expect(host.textContent).not.toContain('No check-ins yet')
  })

  it('一天多张会说几张', () => {
    mocks.S = { dayPhotos: { a: { d: TODAY, m: { hash: 'a' }, _ts: 1 }, b: { d: TODAY, m: { hash: 'b' }, _ts: 2 } } }
    mocks.photos = [
      { key: 'day:a', d: TODAY, m: { hash: 'a' } },
      { key: 'day:b', d: TODAY, m: { hash: 'b' } },
    ]
    mount()
    expect(host.textContent).toContain('2 photos today')
  })

  it('历史按天铺开，一天多张挂角标', () => {
    mocks.S = { dayPhotos: {
      c: { d: TODAY, m: { hash: 'c' }, _ts: 1 },
      d: { d: TODAY, m: { hash: 'd' }, _ts: 2 },
      e: { d: shift(TODAY, -1), m: { hash: 'e' }, _ts: 3 },
    } }
    mocks.photos = [
      { key: 'day:c', d: TODAY, m: { hash: 'c' } },
      { key: 'day:d', d: TODAY, m: { hash: 'd' } },
      { key: 'day:e', d: shift(TODAY, -1), m: { hash: 'e' } },
    ]
    mount()
    expect(host.querySelectorAll('.wmedia-item')).toHaveLength(2)
    expect(host.textContent).toContain('2 days checked in')
    expect(host.textContent).toContain('+1')
  })

  it('返回按钮回首页', async () => {
    mount()
    await act(async () => { host.querySelector('[data-back="/home"]').click() })
    expect(mocks.nav).toHaveBeenCalledWith('/home')
  })
})

describe('CheckIn — 今天只普通签到（无照片，可补拍照升级）', () => {
  it('显示已签到状态 + 补拍照入口，不显示照片缩略图', () => {
    mocks.S = { checkIns: { [TODAY]: { at: 1, _ts: 1 } } }
    mocks.photos = []
    mount()
    expect(host.textContent).toContain('Checked in today')
    expect(host.textContent).toContain('Add a photo to remember the day.')
    expect(btn('拍照签到')).toBeTruthy()
    expect(host.querySelector('[data-media]')).toBeNull()
  })
})

describe('streakOf', () => {
  const g = (...days) => days

  it('今天有、连着往前数', () => {
    expect(streakOf(g(TODAY, shift(TODAY, -1), shift(TODAY, -2)), TODAY)).toBe(3)
  })

  it('今天还没拍，从昨天数 —— 不该把昨天的连续记录清零', () => {
    expect(streakOf(g(shift(TODAY, -1), shift(TODAY, -2)), TODAY)).toBe(2)
  })

  it('断档就停', () => {
    expect(streakOf(g(TODAY, shift(TODAY, -2)), TODAY)).toBe(1)
  })

  it('一张都没有是 0', () => {
    expect(streakOf([], TODAY)).toBe(0)
  })
})
