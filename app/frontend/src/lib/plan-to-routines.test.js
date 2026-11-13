// @vitest-environment happy-dom
// AI 助手的两个硬承诺：读得到真实训练记录、生成的计划真能落库。
// useStore.js 顶层会注册 document/window 事件，所以需要 DOM 环境。

import { describe, it, expect } from 'vitest'
import { CATALOGUE } from './exercises.js'
import { buildWeek } from './plan-engine.js'
import { useStore } from '../store/useStore.js'
import { historySummary, planToRoutines, cnMuscle } from './plan-to-routines.js'

const NOW = new Date('2026-11-10T12:00:00').getTime()
const EX = CATALOGUE[0].id
const entry = (id, n) => ({ id, sets: Array.from({ length: n }, () => ({ w: 50, r: 10, done: true })) })
const wo = (d, entries) => ({ d, entries })
const week = () => buildWeek({ goal: 'hypertrophy', days: 3, minutes: 60, equipment: 'full', profile: {}, weak: ['chest'] })

describe('读训练记录', () => {
  it('只统计近 28 天，且只算勾选完成的有效组', () => {
    const h = historySummary([
      wo('2026-11-09', [entry(EX, 3), entry(EX, 2)]),
      wo('2026-01-01', [entry(EX, 9)]),                       // 太久，应被排除
      wo('2026-11-08', [{ id: EX, sets: [{ w: 50, r: 10, done: false }] }]),  // 没完成
    ], { now: NOW })
    expect(h.count).toBe(2)
    expect(h.last).toBe('2026-11-09')
    expect(h.total).toBeGreaterThan(0)
  })

  it('热身组不计入有效组数', () => {
    const h = historySummary([
      wo('2026-11-09', [{ id: EX, sets: [
        { w: 20, r: 10, done: true, phase: 'warmup' },
        { w: 50, r: 10, done: true },
      ] }]),
    ], { now: NOW })
    expect(h.total).toBeGreaterThan(0)
    expect(h.total).toBeLessThan(10)
  })

  it('没有记录时给出安全的空摘要', () => {
    const h = historySummary([], { now: NOW })
    expect(h.count).toBe(0)
    expect(h.total).toBe(0)
    expect(h.text).toBe('')
  })

  it('部位中文名可用', () => {
    expect(cnMuscle('chest')).toBe('胸大肌')
    expect(cnMuscle('quadriceps')).toBe('股四头')
  })
})

describe('计划落库', () => {
  it('周计划转成与 coach.js 一致的 routines 结构', () => {
    const plan = week()
    const rs = planToRoutines(plan)
    expect(rs.length).toBe(plan.sessions.length)
    expect(rs.map(r => r.name)).toEqual(plan.sessions.map(s => s.name))
    for (const r of rs) {
      expect(r.id).toBeTruthy()
      expect(r.emoji).toBeTruthy()
      expect(r.ex.length).toBeGreaterThan(0)
      for (const e of r.ex) {
        expect(e.mode).toBe('reps')
        expect(e.sets).toBeGreaterThan(0)
        expect(e.reps).toBeGreaterThan(0)
        expect(typeof e.id).toBe('string')
      }
    }
  })

  it('空计划不产生任何条目', () => {
    expect(planToRoutines(null)).toEqual([])
    expect(planToRoutines({ sessions: [] })).toEqual([])
  })

  it('真正写进 S.routines，计划页能读到', () => {
    const plan = week()
    const before = useStore.getState().S.routines.length
    useStore.getState().update(s => { s.routines.push(...planToRoutines(plan)) })
    const after = useStore.getState().S.routines
    expect(after.length).toBe(before + plan.sessions.length)
    expect(after.slice(before).map(r => r.name)).toEqual(plan.sessions.map(s => s.name))
    // 落库的是独立对象，不是把组件里的计划引用塞进 store
    expect(after[before]).not.toBe(plan.sessions[0])
  })

  it('重复保存会产生独立 id，不会互相覆盖', () => {
    const a = planToRoutines(week())
    const b = planToRoutines(week())
    expect(a[0].id).not.toBe(b[0].id)
  })
})
