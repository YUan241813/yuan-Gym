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
try { await page.waitForFunction(() => !document.querySelector('.model3d-wait'), { timeout: 20000 }) } catch {}
await sleep(3000)
const info = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
  const canvas = document.querySelector('canvas')
  return { btns, hasCanvas: !!canvas, canvasSize: canvas ? [canvas.width, canvas.height] : null }
})
console.log('BUTTONS:', JSON.stringify(info.btns, null, 0))
console.log('canvas', info.hasCanvas, info.canvasSize)
await browser.close()
