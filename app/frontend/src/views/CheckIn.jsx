// 拍照签到（2026-11-11 改版）。
//
// 以前这里是「会员卡」：横向滑动的一叠二维码/条码，用来在健身房闸机刷。用户要的是另一件事 ——
// 训练前或训练后自己拍一张照片当作签到，这样一天一张，回头看就是自己每天的变化。所以这一页
// 现在只剩一件事：拍/选一张照片，按今天归档，然后把「哪天签过、长什么样」按天铺开。
//
// 复用现成的照片管线，不新写相机、不新写压缩、不新增 store 字段：
//   useMediaPicker().pick(file)   解码/压缩/去元数据/哈希/写本地媒体库 → MediaRef
//   fileProgressPhoto(s, d, ref)  按天归档（当天有训练就挂在训练上，否则挂在 dayPhotos 上）
//   progressPhotosOf(S) / groupByDate(photos)  读出「每天有哪些照片」
// 「今天签过没有」完全由已有照片推导，零状态、零同步风险；照片本身照旧出现在「进度照片」页。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { fileProgressPhoto, serverTakesDayPhotos } from '../lib/day-photos.js'
import { checkedDays, markCheckIn, backfillCheckIns, photoCheckinDays, streakOf } from '../lib/check-ins.js'
export { streakOf }
import { syncMedia } from '../lib/media-sync.js'
import { isOn } from '../lib/modules.js'
import { useMediaPicker } from '../components/CustomMediaField.jsx'
import { CustomThumb } from '../components/CustomMedia.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { progressPhotosOf, groupByDate, openPhotoView, openProgressCompare } from './ProgressPhotos.jsx'
import { MOBILE } from '../lib/mobile.js'

// 原生安卓里 <input capture="environment"> 要起系统相机，前提是 CAMERA 权限已授予。没授予时，
// Capacitor 8 的 BridgeWebChromeClient 不会直接拉起相机，而是回退到相册选择器 —— 正是这个 bug。
// 所以点击「拍照签到」前先确保 CAMERA 已授予：已授予就直接 click（Capacitor 于是尊重 capture 起相机）；
// 被拒绝就给中文 toast 说明，绝不静默回退到相册。Web/PWA 没有这套原生相机权限机制，照旧 click；
// 插件在该环境拿不到时也照旧 click，不能因为权限层出错就卡住。
async function ensureCameraForCheckIn() {
  if (!MOBILE) return true
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
    let { camera } = await BarcodeScanner.checkPermissions()
    if (camera !== 'granted' && camera !== 'limited') {
      ;({ camera } = await BarcodeScanner.requestPermissions())
    }
    if (camera === 'granted' || camera === 'limited') return true
    toast('相机权限未开启，无法拍照签到。请在系统设置里允许相机权限后重试。')
    return false
  } catch (e) {
    // 插件不可用（非原生包等）—— 照旧起相机，不要把权限层的异常变成死路。
    return true
  }
}

const toast = m => useUI.getState().toast(m)

export default function CheckIn() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const { pick, busy, canAdd, note } = useMediaPicker()
  const cameraRef = useRef(null)
  const albumRef = useRef(null)

  const today = todayISO()
  const photos = useMemo(() => progressPhotosOf(S), [S.workouts, S.dayPhotos])
  const groups = useMemo(() => groupByDate(photos), [photos])
  const checked = useMemo(() => checkedDays(S), [S.workouts, S.dayPhotos, S.checkIns])
  const todayGroup = groups.find(g => g.d === today)
  const checkedToday = checked.has(today)
  const photoToday = !!todayGroup
  const streak = streakOf(checked, today)
  const canDay = serverTakesDayPhotos(user, config)
  const canSeeAll = isOn(S, 'body')

  // 历史照片天幂等回填进 checkIns（只补缺失的天，不覆盖已有记录），让「删掉历史某天最后一张
  // 照片后那天仍算签到」成立。只在首次挂载跑一次，而且没有缺的天就不写（免得白推一次同步）。
  useEffect(() => {
    const missing = [...photoCheckinDays(S).keys()].some(d => !S.checkIns?.[d]?.at)
    if (missing) update(s => { backfillCheckIns(s) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 普通签到：只写 checkIns，不碰照片。
  const onPlain = () => {
    let added = false
    update(s => { added = markCheckIn(s, todayISO()) })
    if (added) toast(t('Checked in for today'))
  }

  // 一张照片一张照片地来：拍照 / 选照片都既存照片、又记签到（照片天通过 union 也算签到，这里
  // 显式写 checkIns 让删照片后那天仍然算签到）。多选没意义。
  const onFile = async ev => {
    const file = ev.target.files && ev.target.files[0]
    ev.target.value = ''                       // 同一个文件下次还能再选
    if (!file) return
    const ref = await pick(file)
    if (!ref) return                           // pick 自己已经 toast 过原因
    let res
    update(s => {
      res = fileProgressPhoto(s, todayISO(), ref, { canDay })
      if (res === 'workout' || res === 'day' || res === 'dup') markCheckIn(s, todayISO())
    })
    if (res === 'workout' || res === 'day') {
      toast(t('Checked in for today'))
      syncMedia({ force: true })
    } else if (res === 'dup') {
      toast(t('That photo is already in today’s check-in'))
    } else if (res === 'no-room') {
      toast(t('Your server keeps photos only on days with a workout. An update lets it keep them for any day.'))
    }
  }

  // 拍照签到：先确认相机权限，授予后再起系统相机；被拒则已 toast 并放弃，绝不回退相册。
  const onCameraClick = async () => {
    if (disabled) return
    if (!(await ensureCameraForCheckIn())) return
    cameraRef.current?.click()
  }

  const disabled = !canAdd || busy

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}>
        <h1>{t('Check in')}</h1>
        <div className="sub">拍照或只点一下，每天记一笔 —— 看得见自己的变化。</div>
      </div>
      {canSeeAll && photos.length >= 2 && (
        <button className="iconbtn" onClick={() => openProgressCompare(photos[1], photos[0])} aria-label={t('Compare with last time')}><Icon name="sides" /></button>
      )}
      {canSeeAll && groups.length > 0 && (
        <button className="iconbtn" onClick={() => nav('/progress-photos')} aria-label={t('Progress photos')}><Icon name="image" /></button>
      )}
    </div>

    {/* 今天三态：
        ① 没签到 → 「拍照签到」整行主按钮 + 「不拍照，直接签到」+「从相册选」
        ② 已普通签到（有记录、无照片）→ 已签到状态 + 可补拍照升级
        ③ 已拍照签到 → 今天缩略图（点开可删）+ 再拍一张 */}
    <div className="card" style={{ padding: 14 }}>
      {!checkedToday ? <>
        <div style={{ fontWeight: 600, fontSize: 17 }}>{t('Check in today')}</div>
        <div className="muted small" style={{ margin: '4px 0 14px', lineHeight: 1.5 }}>
          {t('Snap a photo or just check in. One a day is enough — the point is seeing the change.')}
        </div>
        {/* 拍照签到是唯一的主操作（整行宽实心按钮）；普通签到降级为低调次按钮；从相册选为小号 ghost 链接。 */}
        <Button variant="primary" icon="camera" disabled={disabled} onClick={onCameraClick} style={{ width: '100%' }}>
          {busy ? t('Loading…') : '拍照签到'}
        </Button>
        <div className="row" style={{ gap: 10, marginTop: 10, justifyContent: 'center' }}>
          <Button variant="ghost" disabled={disabled} onClick={onPlain}>不拍照，直接签到</Button>
          <Button variant="ghost" size="sm" icon="image" disabled={disabled} onClick={() => albumRef.current?.click()}>从相册选</Button>
        </div>
        {streak > 0 && <div className="small" style={{ marginTop: 12, color: 'var(--acc)' }}>
          {tn('{0} day in a row so far', '{0} days in a row so far', streak)}
        </div>}
        {note && <div className="dim small" style={{ marginTop: 10 }}>{note}</div>}
      </> : photoToday ? <>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button type="button" data-swipe-ignore onClick={() => openPhotoView(todayGroup.items[0])}
            aria-label={t('Checked in today')} style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', flex: '0 0 auto', background: 'var(--fill-3)', padding: 0, border: 'none', cursor: 'pointer' }}>
            <CustomThumb ex={{ custom: true, media: todayGroup.items[0].m }} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{t('Checked in today')}</div>
            <div className="muted small" style={{ marginTop: 2 }}>
              {tn('{0} photo today', '{0} photos today', todayGroup.items.length)}
            </div>
            {streak > 1 && <div className="small" style={{ marginTop: 6, color: 'var(--acc)' }}>
              {tn('{0} day in a row', '{0} days in a row', streak)}
            </div>}
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <Button icon="camera" disabled={disabled} onClick={onCameraClick}>{busy ? t('Loading…') : '再拍一张'}</Button>
          <Button variant="ghost" icon="image" disabled={disabled} onClick={() => albumRef.current?.click()}>从相册选</Button>
        </div>
      </> : <>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <div style={{ width: 84, height: 84, borderRadius: 12, flex: '0 0 auto', background: 'var(--fill-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="checkCircle" style={{ fontSize: 40, color: 'var(--green)' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 17 }}>{t('Checked in today')}</div>
            <div className="muted small" style={{ marginTop: 2 }}>{t('Add a photo to remember the day.')}</div>
            {streak > 1 && <div className="small" style={{ marginTop: 6, color: 'var(--acc)' }}>
              {tn('{0} day in a row', '{0} days in a row', streak)}
            </div>}
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14 }}>
          <Button variant="primary" icon="camera" disabled={disabled} onClick={onCameraClick}>
            {busy ? t('Loading…') : '拍照签到'}
          </Button>
          <Button variant="ghost" icon="image" disabled={disabled} onClick={() => albumRef.current?.click()}>从相册选</Button>
        </div>
      </>}
    </div>

    {/* 顶部计数：按有效签到记录（checkIns ∪ 历史照片天）算，不是按有照片的天。 */}
    {checked.size > 0 && <div className="small muted" style={{ margin: '20px 0 8px' }}>
      {tn('{0} day checked in', '{0} days checked in', checked.size)}
    </div>}

    {/* 历史：照片网格（只展示有照片的天），按天倒序，每天一格缩略图。一天多张显示第一张 + 角标。
        点开任一天 → openPhotoView（可删 / Undo）。 */}
    {groups.length === 0
      ? <div className="empty" style={{ marginTop: 20 }}>
          <div className="ico"><Icon name="camera" /></div>
          还没有照片。每天来拍一张签到，记下今天的变化。
        </div>
      : <div className="wmedia-grid">
          {groups.map(g => (
            <button key={g.d} type="button" data-swipe-ignore className="wmedia-item"
              aria-label={fmtDate(g.d, true)} onClick={() => openPhotoView(g.items[0])}
              style={{ position: 'relative' }}>
              <CustomThumb ex={{ custom: true, media: g.items[0].m }} />
              {g.items.length > 1 && (
                <span style={{
                  position: 'absolute', insetInlineEnd: 6, insetBlockEnd: 6, padding: '1px 6px',
                  borderRadius: 999, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 11, lineHeight: '16px',
                }}>+{g.items.length - 1}</span>
              )}
              <span style={{
                position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, insetBlockEnd: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,.55), transparent)', color: '#fff',
                fontSize: 11, lineHeight: '18px', padding: '10px 6px 3px', textAlign: 'center',
              }}>{fmtDate(g.d, true)}</span>
            </button>
          ))}
        </div>}

    {/* 两个隐藏的文件输入：一个直接起后置相机，一个走相册。都只收图片。 */}
    <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
    <input ref={albumRef} type="file" accept="image/*" hidden onChange={onFile} />
  </div>
}
