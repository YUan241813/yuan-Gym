import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)))
const views = resolve(root, 'src/views')
const locales = resolve(root, 'src/locales')

const log = []
function replaceOnce(file, oldStr, newStr, label) {
  const orig = readFileSync(file, 'utf8')
  if (!orig.includes(oldStr)) { log.push(`SKIP ${label} in ${file} (not found)`); return }
  const next = orig.replace(oldStr, newStr)
  writeFileSync(file, next, 'utf8')
  log.push(`OK   ${label} in ${file}`)
}

// 1) settings-pages.js: drop stale 'Connect to my server' account SEARCH entry (offline mobile account renders none)
replaceOnce(
  resolve(views, 'settings-pages.js'),
  "  { page: 'account', title: 'Connect to my server', icon: 'cloud', tint: 'var(--indigo)', kw: 'server sync self-hosted connect', when: c => c.mobile && !c.user },\n",
  '',
  'remove Connect to my server'
)

// 2) settings-pages.test.jsx
const testFile = resolve(views, 'settings-pages.test.jsx')
replaceOnce(testFile, "import { resolve } from 'node:path'", "import { fileURLToPath } from 'node:url'", 'test import')
replaceOnce(
  testFile,
  `  it('signed in, Reminders is there and the card names the account; on the phone app the Coach too', () => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mount()
    expect(titles()).toContain('Reminders')
    expect(titles()).not.toContain('AI Coach')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('Dana')
    expect(host.querySelector('.sp-avatar').textContent).toBe('D')
    mocks.user = null
    mocks.MOBILE = true
    mount()
    expect(titles()).toContain('Reminders')
    expect(titles()).toContain('AI Coach')
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('This phone')
  })`,
  `  it('the account card names the device, not a user; the AI Coach row appears on the phone app', () => {
    // 单机版没有账号：卡片只说数据在哪台设备上，永远不显示登录用户名。
    mount()
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('This device')
    expect(titles()).not.toContain('AI Coach')
    mocks.MOBILE = true
    mount()
    expect(host.querySelector('.sp-acct .lrow-t').textContent).toBe('This phone')
    expect(titles()).toContain('AI Coach')
  })`,
  'test rewrite signed-in'
)
replaceOnce(
  testFile,
  `  const scenarios = {
    'guest in a browser': () => {},
    'signed in, browser without push': () => { mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' } },
    'phone, reminder off': () => { mocks.MOBILE = true },
    'phone, reminder and nudge on': () => { mocks.MOBILE = true; mocks.S.reminder = { on: true, time: '17:30', nudge: true }; mocks.S.autoBackup = true },
    'phone paired with a server': () => { mocks.MOBILE = true; mocks.user = { id: 'u1', name: 'Dana' }; mocks.sync = { status: 'ok', server: 'https://gym.example' } },
  }`,
  `  const scenarios = {
    'guest in a browser': () => {},
    'phone, reminder off': () => { mocks.MOBILE = true },
    'phone, reminder and nudge on': () => { mocks.MOBILE = true; mocks.S.reminder = { on: true, time: '17:30', nudge: true }; mocks.S.autoBackup = true },
  }`,
  'test scenarios'
)

// 3) locale packs: add missing '本机数据' (offline account page title) to every pack that lacks it
const trans = {
  'bn': 'এই ডিভাইসের ডেটা',
  'de': 'Daten auf diesem Gerät',
  'es': 'Datos de este dispositivo',
  'fr': 'Données de cet appareil',
  'hi': 'इस डिवाइस का डेटा',
  'hu': 'Ezen az eszközön lévő adatok',
  'it': 'Dati su questo dispositivo',
  'ko': '이 기기의 데이터',
  'pl': 'Dane na tym urządzeniu',
  'pt-BR': 'Dados deste dispositivo',
  'pt': 'Dados deste dispositivo',
  'ru': 'Данные на этом устройстве',
  'sv': 'Data på den här enheten',
  'th': 'ข้อมูลในอุปกรณ์นี้',
  'tr': 'Bu cihazdaki veriler',
  'uk': 'Дані на цьому пристрої',
  'zh-TW': '此裝置的資料',
  'zh': '本机数据',
}
for (const [base, val] of Object.entries(trans)) {
  const f = resolve(locales, base + '.js')
  let s
  try { s = readFileSync(f, 'utf8') } catch { log.push(`SKIP locale ${base} (no file)`); continue }
  if (s.includes('本机数据')) { log.push(`SKIP locale ${base} (already has key)`); continue }
  if (!s.includes('export default {')) { log.push(`SKIP locale ${base} (no default export)`); continue }
  const next = s.replace("export default {", `export default {\n  '本机数据': ${JSON.stringify(val)},`)
  writeFileSync(f, next, 'utf8')
  log.push(`OK   locale ${base} added 本机数据`)
}

console.log(log.join('\n'))
