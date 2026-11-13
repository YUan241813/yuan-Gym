// 小G 能对 App 做的「写操作」。每个动作都是一段会在 store.update 的草稿 s 上跑的变更，
// 因此天然走事务提交、持久化和云同步（见 store/useStore.js 的 update）。
//
// 动作清单（2026-11-13 扩到「大总管」级别）：
//   create-routine   新建一份动作组（写进 S.routines，计划页立刻可见）
//   rename-routine   改动作组名字
//   delete-routine   删掉一份动作组（连日程里对它的引用一起清掉）
//   add-exercise     往一份动作组里加动作（已有就更新组数次数）
//   remove-exercise  从一份动作组里删动作
//   schedule-week    把动作组排到固定的星期几（写 S.week）
//   schedule-date    把某一天单独指定成某个动作组 / 休息（写 S.dayPlan）
//   set-setting      直接改一条设置（单位、语言、主题、休息计时…，白名单见 settings.js）
//   set-module       开关一个整块功能（签到、激励、身体…）
//   log-weighin      记录一次体重
//   log-checkin      记一次签到（不拍照，只记「今天来过」）
//   mark-sore        把某块肌肉标成疼痛 / 取消（lib/pain.js，之后建议动作会绕开它）
//   go               把用户带到 App 的某一页（不写任何数据，由 Assistant.jsx 执行导航）
//
// 两个解析器：动作名 → 动作库 id（resolveExercise，靠动作库现成的搜索），
// 动作组名 → routine id（resolveRoutine，靠 S.routines 里用户自己起的名字）。
//
// 术语：routine 在界面上叫「动作组」，排到哪天叫「日程」。summary / 预览里的中文都按这个来。

import { EXIDX, allExercises, searchExercises } from '../exercises.js'
import { exerciseNameSearchText } from '../i18n-core.js'
import { uid, todayISO } from '../format.js'
import { DEFAULT_GLYPH } from '../glyphs.js'
import { logWeighIn } from '../bodyweight.js'
import { MUSCLES, MUSCLE_NAME } from '../muscles.js'
import { MUSCLE_FACTS } from '../muscle-facts.js'
import { markCheckIn } from '../check-ins.js'
import { setPains } from '../pain.js'
import { validPath, pathName } from './app-map.js'
import { applySetting, applyModule, resolveSetting, previewLabel } from './settings.js'

const norm = v => String(v || '').toLowerCase().replace(/\s+/g, '').replace(/[()（）\-_/]/g, '')
// 动作组名只去空白和大小写 —— 名字是用户自己起的，别乱改字符。
const nameKey = v => String(v || '').toLowerCase().replace(/\s+/g, '')

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

// 0 = 周日，和 S.week 的 key 一致。
const WEEKDAY = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' }
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** 把模型给的动作中文名解析成动作库里的 id；找不到就是 null。 */
export function resolveExercise(S, name) {
  if (!name) return null
  const raw = String(name).trim()
  if (EXIDX[raw]) return raw
  const list = allExercises(S)
  const want = norm(raw)
  if (!want) return null
  // 名称可能是中文，也可能是英文：用 i18n 的「本地名 + 英文名」组合来比。
  // 先比整串，再比逐词，避免「深蹲」被搜索成「深蹲跳」。
  const exact = list.find(e => {
    const text = norm(exerciseNameSearchText(e))
    return text === want || text.includes(want)
  })
  if (exact) return exact.id
  const hit = searchExercises(list, raw)[0]
  return hit?.id || null
}

/**
 * 把模型给的动作组名字解析成 routine id；找不到就是 null。
 * 先精确（忽略大小写和空白），再互相包含 —— 但太短的名字不许做包含匹配，
 * 否则「A」会把「A 推日」抢走。
 */
export function resolveRoutine(s, name) {
  const list = Array.isArray(s?.routines) ? s.routines : []
  const want = nameKey(name)
  if (!want) return null
  const exact = list.find(r => nameKey(r?.name) === want)
  if (exact) return exact.id
  if (want.length < 2) return null
  const part = list.find(r => {
    const n = nameKey(r?.name)
    return n.length >= 2 && (n.includes(want) || want.includes(n))
  })
  return part ? part.id : null
}

const routineName = (s, id) => (Array.isArray(s?.routines) ? s.routines : []).find(r => r.id === id)?.name || id

// 俗称 → 18 个训练部位。用户说的是「胸」「肩膀」「腰」，不是 slug，也不是数据集的英文名。
const MUSCLE_COLLOQ = {
  胸: 'chest', 胸部: 'chest', 胸肌: 'chest', 胸大肌: 'chest',
  肩: 'deltoids', 肩膀: 'deltoids', 肩部: 'deltoids', 三角肌: 'deltoids',
  背: 'upper-back', 背部: 'upper-back', 背阔肌: 'upper-back', 上背: 'upper-back',
  斜方: 'trapezius', 斜方肌: 'trapezius', 前锯肌: 'serratus',
  二头: 'biceps', 肱二头肌: 'biceps', 三头: 'triceps', 肱三头肌: 'triceps', 前臂: 'forearm',
  腹: 'abs', 腹部: 'abs', 腹肌: 'abs', 核心: 'abs', 侧腹: 'obliques', 腹斜肌: 'obliques',
  腰: 'lower-back', 下背: 'lower-back', 下背部: 'lower-back', 竖脊肌: 'lower-back',
  臀: 'gluteal', 臀部: 'gluteal', 屁股: 'gluteal', 臀大肌: 'gluteal',
  腿: 'quadriceps', 大腿: 'quadriceps', 股四头肌: 'quadriceps', 股四: 'quadriceps',
  腘绳肌: 'hamstring', 腿后: 'hamstring', 大腿后侧: 'hamstring', 内收肌: 'adductors',
  髂腰肌: 'hip-flexors', 髋屈肌: 'hip-flexors', 小腿: 'calves', 腓肠肌: 'calves',
  胫骨前肌: 'tibialis', 小腿前侧: 'tibialis',
}

/** 肌肉名（俗称 / 中文学名 / 英文 / slug）→ 18 个训练部位之一；认不出就是 null。 */
export function resolveMuscle(name) {
  const raw = String(name || '').trim()
  if (!raw) return null
  if (MUSCLES.includes(raw)) return raw
  if (MUSCLE_COLLOQ[raw]) return MUSCLE_COLLOQ[raw]
  const want = norm(raw)
  if (!want) return null
  const exact = MUSCLES.find(m => norm(MUSCLE_NAME[m]) === want || norm(MUSCLE_FACTS[m]?.cn) === want)
  if (exact) return exact
  return MUSCLES.find(m => {
    const cn = norm(MUSCLE_FACTS[m]?.cn)
    return (cn && (cn.includes(want) || want.includes(cn))) || norm(MUSCLE_NAME[m]).includes(want)
  }) || null
}

const muscleLabel = m => MUSCLE_FACTS[m]?.cn || MUSCLE_NAME[m] || m

const measure = e => {
  if (!e) return null
  const id = e.id
  if (!id) return null
  const mode = e.mode === 'time' ? 'time' : 'reps'
  if (mode === 'time') {
    return { id, mode, sets: clampInt(e.sets, 1, 20, 3), sec: clampInt(e.sec, 5, 3600, 45) }
  }
  return { id, mode, sets: clampInt(e.sets, 1, 20, 3), reps: clampInt(e.reps, 1, 100, 10) }
}

/**
 * 在草稿 s 上执行一组动作。
 * `go` 是本轮要导航到的路径（最后一个合法的赢），本身不改任何状态。
 * @returns {{summary: string, applied: number, skipped: string[], go: string|null}}
 */
export function applyActions(s, actions) {
  const list = Array.isArray(actions) ? actions.slice(0, 8) : []
  const done = []
  const skipped = []
  let go = null
  // 只导航的那一轮不该说「已写入 App」：go 只在 done 里占一条，减掉它就是真写的件数。
  const writes = () => done.length - (go ? 1 : 0)

  for (const a of list) {
    if (!a || typeof a !== 'object') continue

    if (a.type === 'go') {
      const p = String(a.path || '').trim()
      if (!validPath(p)) { skipped.push(`没有这个页面：${p || '（空）'}`); continue }
      go = p
      done.push(pathName(p))
      continue
    }

    if (a.type === 'create-routine') {
      const wanted = Array.isArray(a.exercises) ? a.exercises.slice(0, 30) : []
      const ex = []
      const missing = []
      const seen = new Set()
      for (const e of wanted) {
        const id = resolveExercise(s, e?.name)
        if (!id) { if (e?.name) missing.push(String(e.name)); continue }
        if (seen.has(id)) continue
        seen.add(id)
        const m = measure({ ...e, id })
        if (m) ex.push(m)
      }
      if (!ex.length) {
        skipped.push(`动作组「${a.name || '未命名'}」没有识别到有效动作`)
        continue
      }
      s.routines = Array.isArray(s.routines) ? s.routines : []
      const name = String(a.name || '小G 动作组').slice(0, 60)
      s.routines.push({ id: uid(), name, emoji: DEFAULT_GLYPH, ex })
      done.push(`新建动作组「${name}」（${ex.length} 个动作）`)
      if (missing.length) skipped.push(`未识别的动作：${missing.slice(0, 6).join('、')}`)
      continue
    }

    if (a.type === 'rename-routine') {
      const id = resolveRoutine(s, a.from)
      const to = String(a.to || '').trim().slice(0, 60)
      if (!id) { skipped.push(`找不到动作组「${a.from || ''}」`); continue }
      if (!to) { skipped.push('新名字是空的'); continue }
      const r = s.routines.find(x => x.id === id)
      const was = r.name
      r.name = to
      done.push(`把动作组「${was}」改名为「${to}」`)
      continue
    }

    if (a.type === 'delete-routine') {
      const id = resolveRoutine(s, a.name)
      if (!id) { skipped.push(`找不到动作组「${a.name || ''}」`); continue }
      const was = routineName(s, id)
      s.routines = (Array.isArray(s.routines) ? s.routines : []).filter(r => r.id !== id)
      // 日程里指向它的引用一起清掉：留着的话那天会指向一个不存在的动作组，比空着更糟。
      const week = { ...(s.week || {}) }
      for (const [k, v] of Object.entries(week)) {
        if (Array.isArray(v) ? v.includes(id) : v === id) delete week[k]
      }
      s.week = week
      const plan = { ...(s.dayPlan || {}) }
      for (const [k, v] of Object.entries(plan)) if (v === id) delete plan[k]
      s.dayPlan = plan
      if (s.queue && Array.isArray(s.queue.ids)) s.queue = { ...s.queue, ids: s.queue.ids.filter(x => x !== id) }
      done.push(`删掉动作组「${was}」（日程里对它的引用也清掉了）`)
      continue
    }

    if (a.type === 'add-exercise') {
      const id = resolveRoutine(s, a.routine)
      if (!id) { skipped.push(`找不到动作组「${a.routine || ''}」`); continue }
      const exId = resolveExercise(s, a.exercise)
      if (!exId) { skipped.push(`没认出动作「${a.exercise || ''}」`); continue }
      const m = measure({ ...a, id: exId })
      if (!m) { skipped.push('动作的组数/次数不可用'); continue }
      const r = s.routines.find(x => x.id === id)
      r.ex = Array.isArray(r.ex) ? r.ex : []
      const at = r.ex.findIndex(e => e.id === exId)
      const label = EXIDX[exId]?.name || a.exercise
      if (at >= 0) {
        r.ex[at] = { ...r.ex[at], ...m }
        done.push(`「${routineName(s, id)}」里的「${label}」改成 ${m.sets} 组`)
      } else {
        r.ex.push(m)
        done.push(`往「${routineName(s, id)}」加了「${label}」（${m.sets} 组）`)
      }
      continue
    }

    if (a.type === 'remove-exercise') {
      const id = resolveRoutine(s, a.routine)
      if (!id) { skipped.push(`找不到动作组「${a.routine || ''}」`); continue }
      const exId = resolveExercise(s, a.exercise)
      if (!exId) { skipped.push(`没认出动作「${a.exercise || ''}」`); continue }
      const r = s.routines.find(x => x.id === id)
      const before = Array.isArray(r.ex) ? r.ex.length : 0
      r.ex = (Array.isArray(r.ex) ? r.ex : []).filter(e => e.id !== exId)
      if (r.ex.length === before) { skipped.push(`「${routineName(s, id)}」里没有「${EXIDX[exId]?.name || a.exercise}」`); continue }
      done.push(`从「${routineName(s, id)}」去掉「${EXIDX[exId]?.name || a.exercise}」`)
      continue
    }

    if (a.type === 'schedule-week') {
      const days = a.days && typeof a.days === 'object' && !Array.isArray(a.days) ? a.days : {}
      const next = { ...(s.week || {}) }
      const put = []
      const missing = []
      for (const [k, v] of Object.entries(days)) {
        const d = String(Number(k))
        if (!/^[0-6]$/.test(d)) continue
        if (v === 'rest' || v === null || v === '' || v === 'restday') {
          delete next[d]
          put.push(`${WEEKDAY[d]} 休息`)
          continue
        }
        const id = resolveRoutine(s, v)
        if (!id) { missing.push(String(v)); continue }
        next[d] = [id]
        put.push(`${WEEKDAY[d]} ${routineName(s, id)}`)
      }
      if (!put.length) {
        skipped.push(missing.length ? `没找到这些动作组：${missing.join('、')}` : '没有给出有效的星期')
        continue
      }
      s.week = next
      // 只写 S.week 而用户还在「循环排队」模式下是看不见的（lib/rotation.js scheduleModeOf：
      // 只要 S.queue 还在就恒为 rotation）。所以顺手切回按星期排 —— 定义本身（S.rotation）留着，
      // 用户想换回去随时可以。
      const wasRotation = !!s.queue || s.scheduleMode === 'rotation'
      s.queue = null
      s.scheduleMode = 'week'
      done.push(`日程排上了：${put.join('、')}${wasRotation ? '（已从「循环排队」切到「按星期排」）' : ''}`)
      if (missing.length) skipped.push(`没找到这些动作组：${missing.join('、')}`)
      continue
    }

    if (a.type === 'schedule-date') {
      const d = String(a.date || '').trim()
      if (!ISO.test(d)) { skipped.push(`日期格式不对：${a.date || '（空）'}`); continue }
      s.dayPlan = { ...(s.dayPlan || {}) }
      if (a.routine === 'rest' || a.routine === null) {
        s.dayPlan[d] = 'rest'
        done.push(`${d} 休息`)
        continue
      }
      const id = resolveRoutine(s, a.routine)
      if (!id) { skipped.push(`找不到动作组「${a.routine || ''}」`); continue }
      s.dayPlan[d] = id
      done.push(`${d} 练「${routineName(s, id)}」`)
      continue
    }

    if (a.type === 'set-setting') {
      // convert 只在切单位时有意义：默认换算数字，用户说「只改标签」才传 false。
      const out = applySetting(s, a.key, a.value, { convert: a.convert !== false })
      if (out.ok) done.push(out.text)
      else skipped.push(out.reason)
      continue
    }

    if (a.type === 'set-module') {
      const out = applyModule(s, a.id, a.on)
      if (out.ok) done.push(out.text)
      else skipped.push(out.reason)
      continue
    }

    if (a.type === 'log-weighin') {
      const kg = Number(a.kg)
      if (!Number.isFinite(kg) || kg <= 20 || kg > 400) { skipped.push('体重数值不可用'); continue }
      logWeighIn(s, kg)
      done.push(`记录体重 ${kg} kg`)
      continue
    }

    if (a.type === 'log-checkin') {
      const d = a.date ? String(a.date).trim() : todayISO()
      if (!ISO.test(d)) { skipped.push(`日期格式不对：${a.date || '（空）'}`); continue }
      done.push(markCheckIn(s, d) ? `记下 ${d} 的签到` : `${d} 本来就已经签到了`)
      continue
    }

    if (a.type === 'mark-sore') {
      const names = Array.isArray(a.muscles) ? a.muscles : a.muscle ? [a.muscle] : []
      const slugs = [...new Set(names.map(resolveMuscle).filter(Boolean))]
      if (!slugs.length) { skipped.push(`没认出肌肉：${names.join('、') || '（空）'}`); continue }
      const on = a.on !== false
      s.pains = setPains(s.pains, slugs, on)
      const label = slugs.map(muscleLabel).join('、')
      done.push(on ? `把「${label}」标成疼痛了，之后推荐会绕开它` : `取消了「${label}」的疼痛标记`)
      continue
    }

    skipped.push(`未知操作：${a.type}`)
  }

  const summary = done.length
    ? (writes() ? '已写入 App：' : '已为你打开：') + done.join('；') + (skipped.length ? `（${skipped.join('；')}）` : '')
    : (skipped.length ? '没有改动：' + skipped.join('；') : '没有可执行的改动')
  return { summary, applied: done.length, skipped, go }
}

/** 给确认卡片用的人类可读预览（纯文本，不写状态）。 */
export function previewActions(actions) {
  const out = []
  for (const a of Array.isArray(actions) ? actions : []) {
    if (a?.type === 'go') {
      if (!validPath(a.path)) continue
      out.push({ title: `打开：${a.path}`, lines: [] })
    } else if (a?.type === 'create-routine') {
      const lines = (a.exercises || []).slice(0, 12).map(e => {
        const sets = clampInt(e?.sets, 1, 20, 3)
        if (Number(e?.sec) > 0) return `${e.name} · ${sets} 组 × ${clampInt(e.sec, 5, 3600, 45)} 秒`
        return `${e.name} · ${sets} 组 × ${clampInt(e?.reps, 1, 100, 10)} 次`
      })
      out.push({ title: `新建动作组「${a.name || '未命名'}」`, lines })
    } else if (a?.type === 'rename-routine') {
      out.push({ title: `动作组改名：「${a.from || ''}」→「${a.to || ''}」`, lines: [] })
    } else if (a?.type === 'delete-routine') {
      out.push({ title: `删掉动作组「${a.name || ''}」`, lines: ['日程里对它的引用也会一起清掉'] })
    } else if (a?.type === 'add-exercise') {
      const sets = clampInt(a?.sets, 1, 20, 3)
      const how = Number(a?.sec) > 0 ? `${sets} 组 × ${clampInt(a.sec, 5, 3600, 45)} 秒` : `${sets} 组 × ${clampInt(a?.reps, 1, 100, 10)} 次`
      out.push({ title: `「${a.routine || ''}」加入：${a.exercise || ''}`, lines: [how] })
    } else if (a?.type === 'remove-exercise') {
      out.push({ title: `「${a.routine || ''}」去掉：${a.exercise || ''}`, lines: [] })
    } else if (a?.type === 'log-checkin') {
      out.push({ title: `签到：${a.date || '今天'}`, lines: [] })
    } else if (a?.type === 'mark-sore') {
      const names = Array.isArray(a.muscles) ? a.muscles : a.muscle ? [a.muscle] : []
      out.push({ title: `${a.on === false ? '取消疼痛' : '标成疼痛'}：${names.join('、') || '（空）'}`, lines: [] })
    } else if (a?.type === 'schedule-week') {
      const lines = Object.entries(a.days || {}).map(([k, v]) => {
        const d = String(Number(k))
        if (!/^[0-6]$/.test(d)) return null
        return `${WEEKDAY[d]} · ${v === 'rest' ? '休息' : v}`
      }).filter(Boolean)
      out.push({ title: '排日程（按星期）', lines })
    } else if (a?.type === 'schedule-date') {
      out.push({ title: `${a.date || ''} · ${a.routine === 'rest' ? '休息' : a.routine || ''}`, lines: [] })
    } else if (a?.type === 'set-setting') {
      const entry = resolveSetting(a.key)
      out.push({
        title: entry ? `改设置：${entry.label} → ${previewLabel(entry, a.value, {})}` : `改设置：${a.key || '（未知）'}`,
        lines: entry?.key === 'unit' ? [a.convert === false ? '只换标签，记录的重量数字不变' : '所有记录的重量会一起换算'] : [],
      })
    } else if (a?.type === 'set-module') {
      const on = a.on === true || a.on === 'on' || a.on === 1
      out.push({ title: `模块「${a.id || '?'}」${on ? '打开' : '关闭'}`, lines: [] })
    } else if (a?.type === 'log-weighin') {
      out.push({ title: `记录体重 ${a.kg} kg`, lines: [] })
    }
  }
  return out
}
