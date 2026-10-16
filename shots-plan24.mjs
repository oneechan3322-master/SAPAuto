import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/Mega Store/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:3000'
const OUT = 'C:/Users/Mega Store/Downloads/SapAuto/v8/audit-screenshots/plan-2-4'

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Users/Mega Store/AppData/Local/ms-playwright/chromium-1246/chrome-win64/chrome.exe',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none']
})
const problems = []

// Viewport-sized shots so the top of the worklist is legible in review.
for (const [tag, width, height] of [['1440', 1440, 900], ['390', 390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark' })
  const page = await context.newPage()
  page.on('pageerror', (error) => problems.push(`${tag} pageerror: ${error.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${tag} console: ${m.text()}`) })

  await page.goto(`${BASE}/payments`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, `worklist-viewport-${tag}.png`) })

  // Open the detail row of the first record to prove the lanes are explained.
  const expand = page.locator('.worklist-expand').first()
  if (await expand.count()) {
    await expand.click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT, `worklist-detail-${tag}.png`) })
  }

  // Exercise each lane filter and record the resulting count.
  const filters = await page.locator('.worklist-filter').allTextContents()
  const counts = {}
  for (let i = 0; i < filters.length; i += 1) {
    await page.locator('.worklist-filter').nth(i).click()
    await page.waitForTimeout(250)
    counts[filters[i].trim()] = await page.locator('.worklist-row').count()
  }
  console.log(`filters@${tag}:`, JSON.stringify(counts, null, 2))

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(900)
  const body = await page.innerText('body')
  console.log(`settings@${tag} mentions WhatsApp:`, body.includes('WhatsApp'))
  console.log(`settings@${tag} mentions "قريبًا":`, body.includes('قريبًا'))
  await page.screenshot({ path: path.join(OUT, `settings-channels-${tag}.png`), fullPage: true })

  await context.close()
}
await browser.close()
if (problems.length) {
  console.log('--- browser problems ---')
  for (const problem of [...new Set(problems)]) console.log(problem)
} else console.log('no console/page errors')