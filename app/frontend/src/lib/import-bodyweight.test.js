import { describe, expect, it } from 'vitest'
import { parseBodyweight, parseImport } from './import-csv.js'

const record = (day, value, unit) => `<Record type="HKQuantityTypeIdentifierBodyMass" unit="${unit}" value="${value}" startDate="2026-09-${day} 08:00:00 +0000"/>`

describe('Apple Health body-weight units', () => {
  it.each([
    ['kg', [80, 81.65]],
    ['lb', [176.37, 180]],
  ])('converts each record into %s independently', (unit, expected) => {
    const parsed = parseBodyweight(record('01', 80, 'kg') + record('02', 180, 'lb'), { unit })
    expect(parsed.bodyweight.map(b => b.w)).toEqual(expected)
    expect(parsed.converted).toBe(true)
    expect(parsed.fileUnit).toBe('kg / lb')
  })

  it('does not let record order change another day’s weight', () => {
    const kg = record('01', 80, 'kg'), lb = record('02', 180, 'lb')
    expect(parseBodyweight(kg + lb).bodyweight).toEqual(parseBodyweight(lb + kg).bodyweight)
  })

  it('preserves conversion for single-unit XML and CSV exports', () => {
    expect(parseBodyweight(record('01', 180, 'lb')).bodyweight[0].w).toBe(81.65)
    expect(parseBodyweight('Date,Weight (lbs)\n2026-09-01,180').bodyweight[0].w).toBe(81.65)
    expect(parseBodyweight(record('01', 80, 'kg')).converted).toBe(false)
  })
})

describe('Strong measurements export', () => {
  // Header and rows as Strong 6 writes them: newest first, one measurement per row.
  const STRONG = [
    'Date,Measurement Type,Value,Unit,Source',
    '2026-10-12 08:15:25,Weight,114.75,kg,Strong',
    '2026-10-11 10:54:54,Weight,114.85,kg,Strong',
    '2026-10-11 10:55:10,Body Fat Percentage,28.5,%,Strong',
    '2026-10-09 07:30:09,Weight,253,lbs,Strong',
  ].join('\n')

  it('reads the weight rows and nothing else', () => {
    const parsed = parseImport(STRONG, { unit: 'kg' })
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed.source).toBe('Strong')
    expect(parsed.bodyweight.map(b => b.d)).toEqual(['2026-10-09', '2026-10-11', '2026-10-12'])
    expect(parsed.bodyweight.map(b => b.w)).toEqual([114.76, 114.85, 114.75])
  })

  it('converts each row from its own unit', () => {
    const parsed = parseBodyweight(STRONG, { unit: 'lb' })
    expect(parsed.bodyweight.find(b => b.d === '2026-10-09').w).toBe(253)
    expect(parsed.fileUnit).toBe('kg / lb')
    expect(parsed.converted).toBe(true)
  })

  it('a file with no weight rows is not a body-weight file', () => {
    expect(parseBodyweight('Date,Measurement Type,Value,Unit,Source\n2026-10-11,Waist,98,cm,Strong').error).toBe('unrecognised')
  })
})

// Discord lajawi, eibergerd: an Apple Health export (or a Google Health / Health Connect CSV)
// imported here went straight back into Apple Health / Health Connect, a second copy of every
// weigh-in. An imported weigh-in is marked, and only one typed into yuan-Gym goes out.
describe('imported weigh-ins never go back to the health hub', () => {
  // The health hub (Apple Health / Health Connect) this used to write back to was removed
  // from the app: there is no writer left to keep in step, so only the marking itself is
  // still checked (below), not a round trip through ./health-connect.js.
  it('a second CSV of weights counts as an import too', async () => {
    const { mergeImport } = await import('./import-csv.js')
    const S = { unit: 'kg', workouts: [], bodyweight: [] }
    mergeImport(S, parseImport('Date,Weight (kg)\n2026-09-01,80\n2026-09-02,80.5'))
    mergeImport(S, parseImport('Date,Weight (kg)\n2026-09-03,81'))
    expect(S.bodyweight.map(b => b.src)).toEqual(['import', 'import', 'import'])
  })
})

// #859 (Borgna02): an Apple Health export with 366 body-mass records on 231 days kept one per day.
describe('several weigh-ins a day from a file', () => {
  const at = (day, time, value) => `<Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="${value}" startDate="2026-09-${day} ${time}:00 +0200"/>`
  const FILE = at('01', '07:05', 80.2) + at('01', '21:40', 81.4) + at('02', '06:58', 80) + at('01', '21:40', 81.4)

  it('keeps every record with its time, once', () => {
    const parsed = parseImport(FILE)
    expect(parsed.bodyweight.map(b => [b.d, b.at, b.w])).toEqual([['2026-09-01', '07:05', 80.2], ['2026-09-01', '21:40', 81.4], ['2026-09-02', '06:58', 80]])
  })

  it('files them by day, the morning one the day\'s value, and a second import adds nothing', async () => {
    const { mergeImport } = await import('./import-csv.js')
    const S = { unit: 'kg', workouts: [], bodyweight: [] }
    expect(mergeImport(S, parseImport(FILE))).toEqual({ added: 3, skipped: 0 })
    expect(S.bodyweight.map(b => [b.d, b.w, b.ins.length])).toEqual([['2026-09-01', 80.2, 2], ['2026-09-02', 80, 1]])
    expect(mergeImport(S, parseImport(FILE))).toEqual({ added: 0, skipped: 3 })
    expect(S.bodyweight[0].ins.map(r => r.src)).toEqual(['import', 'import'])
  })

  it('a CSV without times keeps one weigh-in per day, as before', () => {
    const parsed = parseImport('Date,Weight (kg)\n2026-09-01,80\n2026-09-01,80.4\n2026-09-02,80.5')
    expect(parsed.bodyweight.map(b => [b.d, b.at || null, b.w])).toEqual([['2026-09-01', null, 80.4], ['2026-09-02', null, 80.5]])
  })

  it('a day the profile has gets the file\'s untimed weigh-in only when it has none', async () => {
    const { mergeImport } = await import('./import-csv.js')
    const S = { unit: 'kg', workouts: [], bodyweight: [{ d: '2026-09-01', w: 79, t: 5 }] }
    expect(mergeImport(S, parseImport('Date,Weight (kg)\n2026-09-01,80\n2026-09-02,80.5'))).toEqual({ added: 1, skipped: 1 })
    expect(S.bodyweight[0]).toEqual({ d: '2026-09-01', w: 79, t: 5 })
  })
})
