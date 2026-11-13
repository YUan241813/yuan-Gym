// 冒烟测试：设置 → 关于 → 点「请喝咖啡」→ 应用内弹出收款码弹窗（不跳网页）。
// 顺带验证 /plan/r/:id 的动作行渲染 ex-preview（MediaPreview）。
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 420, height: 860 } })

const fails = []
try {
  // 0. 首次启动的引导弹窗先跳过，否则它挡住一切点击
  await page.goto(BASE + '/#/settings/about', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const skip = page.getByRole('button', { name: '跳过' }).first()
  if (await skip.count()) { await skip.click().catch(() => {}); await page.waitForTimeout(600); console.log('引导已跳过') }
  await page.goto(BASE + '/#/settings/about', { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  // 1. 关于页：点「请喝咖啡」
  await page.goto(BASE + '/#/settings/about', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const row = page.getByText('请喝咖啡', { exact: false }).first()
  await row.waitFor({ timeout: 8000 })
  await row.click()
  await page.waitForTimeout(1200)
  // 弹窗里的收款码图片必须真的加载出来（naturalWidth > 0）
  const img = page.locator('img[src*="support-yuan-gym"]')
  const n = await img.count()
  if (!n) fails.push('QR 弹窗里没有找到收款码 <img>')
  else {
    const ok = await img.first().evaluate(el => el.complete && el.naturalWidth > 50)
    if (!ok) fails.push('收款码图片未成功加载')
    else console.log('QR 弹窗：图片已加载', await img.first().evaluate(el => `${el.naturalWidth}x${el.naturalHeight}`))
  }
  // 确认没有跳出去（页面还在应用里）
  if (!page.url().startsWith(BASE)) fails.push('点击后跳出了应用：' + page.url())
  await page.screenshot({ path: '_shots/qr-sheet.png' })
  // 关闭按钮可用
  const close = page.getByRole('button', { name: '关闭' })
  if (await close.count()) { await close.click(); await page.waitForTimeout(400); console.log('关闭按钮可用') }
  else fails.push('没有「关闭」按钮')

  // 2. 计划编辑页：动作行用 MediaPreview（ex-preview 容器 + 底图）
  await page.goto(BASE + '/#/plan', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const routineRow = page.locator('.plan-routine').first()
  if (await routineRow.count()) {
    await routineRow.click()
    await page.waitForTimeout(1500)
    const previews = await page.locator('.ex-preview').count()
    const thumbs = await page.locator('img.thumb').count()
    console.log('计划动作行：ex-preview', previews, '个；img.thumb', thumbs, '个')
    if (!previews) fails.push('计划动作行没有 ex-preview（MediaPreview 未生效）')
    await page.screenshot({ path: '_shots/plan-previews.png' })
  } else {
    console.log('（没有已建计划，跳过计划页检查）')
  }
} catch (e) {
  fails.push('异常: ' + e.message)
}
await browser.close()
if (fails.length) { console.log('FAIL:\n- ' + fails.join('\n- ')); process.exit(1) }
console.log('SMOKE OK')
