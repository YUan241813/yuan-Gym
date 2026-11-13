import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://127.0.0.1:5302/anatomy'
const OUT = '/d/Self-developedSoftware/yuan-Gym/app/frontend/.shot/shots'
mkdirSync(OUT, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--enable-webgl', '--window-size=430,900',
  ],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const logs = []
page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))

console.log('goto', URL)
await page.goto(URL, { waitUntil: 'domcontentloaded' })
await sleep(2500)

// Dismiss first-run welcome overlay by clicking 跳过 / 带我看看 / 开始 repeatedly
for (let i = 0; i < 6; i++) {
  const skip = page.locator('button:has-text("跳过")').first()
  if (await skip.count()) { await skip.click().catch(() => {}); await sleep(800) }
  const showme = page.locator('button:has-text("带我看看")').first()
  if (await showme.count()) { await showme.click().catch(() => {}); await sleep(800) }
  const start = page.locator('button:has-text("开始"), button:has-text("进入")').first()
  if (await start.count()) { await start.click().catch(() => {}); await sleep(800) }
}
await sleep(800)

// Navigate to anatomy route via hash
await page.evaluate(() => { location.hash = '#/anatomy' })
await sleep(2000)

// Wait for canvas + model loader gone
try {
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForFunction(() => !document.querySelector('.model3d-wait'), { timeout: 40000 })
} catch (e) { console.log('wait warn:', e.message) }
await sleep(4500) // let assets + frames settle

async function setXray(v) {
  await page.evaluate((val) => {
    const el = document.querySelector('input[aria-label="透视深度"]')
    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, String(val))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
}
async function clickView(label) {
  const btn = page.locator(`button.ana-pill:has-text("${label}")`).first()
  if (await btn.count()) { await btn.click().catch(() => {}) }
  await sleep(1400)
}
async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}
async function dragRotate(dx, dy = 0) {
  const box = await page.locator('canvas').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const steps = 30
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + dx * i / steps, cy + dy * i / steps)
    await sleep(16)
  }
  await page.mouse.up()
  await sleep(1600)
}

// ============ BEFORE: FRONT ============
await clickView('全身')           // view 'all', rotation 0 = front
await setXray(0)                  // opaque skin for clear silhouette
await sleep(700)
await shot('before-front-opaque')
await setXray(0.55)               // default translucent look
await sleep(500)
await shot('before-front')

// ============ BEFORE: BACK ============
await clickView('后视图')
await setXray(0)
await sleep(700)
await shot('before-back-opaque')
await setXray(0.55)
await sleep(500)
await shot('before-back')

// ============ BEFORE: SIDE ============
await clickView('全身')
await sleep(700)
await dragRotate(360, 0)          // ~90° turn
await setXray(0)
await sleep(700)
await shot('before-side-opaque')
await setXray(0.55)
await sleep(500)
await shot('before-side')

console.log('=== CONSOLE (warnings/errors) ===')
console.log(logs.length ? logs.join('\n') : '(none)')
await browser.close()
console.log('DONE')
