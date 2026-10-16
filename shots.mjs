import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/Mega Store/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')

const BASE = process.env.SHOT_BASE || 'http://127.0.0.1:3000'
const OUT = process.argv[2] || 'C:/Users/Mega Store/Downloads/SapAuto/v8/audit-screenshots/tmp'
const LABEL = process.argv[3] || 'shot'
const PAGES = [
  ['home', '/'],
  ['companies', '/companies'],
  ['company-detail', '/companies/company_f2c66b9ff672031dac1b14ad'],
  ['tasks', '/tasks'],
  ['obligations', '/obligations'],
  ['payments', '/payments'],
  ['messages', '/messages'],
  ['reminders', '/reminders'],
  ['reports', '/reports'],
  ['failures', '/failures'],
  ['audit', '/audit'],
  ['settings', '/settings']
]
const VIEWPORTS = [['1440', 1440, 900], ['390', 390, 844]]

fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({
  executablePath: 'C:/Users/Mega Store/AppData/Local/ms-playwright/chromium-1246/chrome-win64/chrome.exe',
  args: ['--force-color-profile=srgb', '--font-render-hinting=none']
})
const problems = []
for (const [tag, width, height] of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: 'dark'
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => problems.push(`${LABEL}/${tag} pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${LABEL}/${tag} console: ${message.text()}`)
  })
  for (const [name, route] of PAGES) {
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(600)
    const file = path.join(OUT, `${LABEL}-${name}-${tag}.png`)
    await page.screenshot({ path: file, fullPage: true })
    process.stdout.write(`${file}\n`)
  }
  await context.close()
}
await browser.close()
if (problems.length) {
  console.log('--- browser problems ---')
  for (const problem of [...new Set(problems)]) console.log(problem)
} else {
  console.log('no console/page errors')
}