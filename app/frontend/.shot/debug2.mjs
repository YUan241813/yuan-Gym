import { chromium } from 'playwright'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
page.on('pageerror', e => console.log('PAGEERR', e.message))
await page.goto('http://127.0.0.1:5302/anatomy', { waitUntil: 'networkidle' })
await sleep(1500)
// click 跳过 (skip) if present
for (let i = 0; i < 5; i++) {
  const skip = page.locator('button:has-text("跳过")').first()
  if (await skip.count()) {
    console.log('clicking 跳过')
    await skip.click()
    await sleep(1200)
  }
  const welcome = await page.locator('text=带我看看').count()
  if (!welcome) break
}
await sleep(1000)
const url = page.url()
console.log('URL after skip:', url)
const info = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean)
  const canvas = document.querySelector('canvas')
  return { btns, hasCanvas: !!canvas }
})
console.log('BUTTONS:', JSON.stringify(info.btns))
console.log('canvas', info.hasCanvas)
await browser.close()
