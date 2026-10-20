'use strict'
const { chromium } = require('playwright')
const fs = require('fs')
const css = fs.readFileSync('launcher/app/components.css', 'utf8')

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(`
    <!DOCTYPE html>
    <html dir="rtl">
    <head><style>${css}</style></head>
    <body style="padding: 50px;">
      <button class="setting-switch" id="off-btn"><span id="off-span"></span></button>
      <br><br>
      <button class="setting-switch is-on" id="on-btn"><span id="on-span"></span></button>
    </body>
    </html>
  `)

  const res = await page.evaluate(() => {
    const offBtn = document.getElementById('off-btn').getBoundingClientRect()
    const offSpan = document.getElementById('off-span').getBoundingClientRect()
    const onBtn = document.getElementById('on-btn').getBoundingClientRect()
    const onSpan = document.getElementById('on-span').getBoundingClientRect()
    return { offBtn, offSpan, onBtn, onSpan }
  })

  console.log('OFF button:', res.offBtn.x, 'width:', res.offBtn.width)
  console.log('OFF span:', res.offSpan.x, 'width:', res.offSpan.width, 'relative x:', res.offSpan.x - res.offBtn.x)
  console.log('ON button:', res.onBtn.x, 'width:', res.onBtn.width)
  console.log('ON span:', res.onSpan.x, 'width:', res.onSpan.width, 'relative x:', res.onSpan.x - res.onBtn.x)

  await page.screenshot({ path: 'scratch/switches.png' })
  await browser.close()
})()
