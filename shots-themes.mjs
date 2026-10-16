import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('C:/Users/Mega Store/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')

const BASE = 'http://127.0.0.1:3000'
const OUT = 'C:/Users/Mega Store/Downloads/SapAuto/v8/audit-screenshots/redesign/after'
const browser = await chromium.launch({
  executablePath: 'C:/Users/Mega Store/AppData/Local/ms-playwright/chromium-1246/chrome-win64/chrome.exe'
})
const shots = [
  ['light', 1440, '/companies', 'light', 'after-companies-light-1440.png'],
  ['light', 1440, '/', 'light', 'after-home-light-1440.png'],
  ['light', 1440, '/payments', 'light', 'after-payments-light-1440.png'],
  ['light', 1440, '/settings', 'light', 'after-settings-light-1440.png'],
  ['dark', 1440, '/messages', 'dark', 'after-messages-dark-1440.png'],
  ['dark', 390, '/companies', 'dark', 'after-companies-dark-390.png']
]
for (const [, width, route, scheme, file] of shots) {
  const context = await browser.newContext({
    viewport: { width, height: width === 390 ? 844 : 900 },
    colorScheme: scheme,
    deviceScaleFactor: 1
  })
  const page = await context.newPage()
  await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: false })
  console.log(file)
  await context.close()
}

// Arabic-Indic digits proof: flip the cookie and reload.
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
const page = await context.newPage()
await page.goto(`${BASE}/companies`, { waitUntil: 'networkidle' })
await page.evaluate(() => { document.cookie = 'sapauto_digits=arab; path=/; max-age=31536000' })
await page.reload({ waitUntil: 'networkidle' })
await page.screenshot({ path: `${OUT}/after-companies-digits-arabic-1440.png`, fullPage: false })
console.log('after-companies-digits-arabic-1440.png')
await browser.close()