'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createRequire } = require('node:module')

const requireFromHere = createRequire(__filename)

const APP = path.resolve(__dirname, '../launcher/app')
const read = (...parts) => fs.readFileSync(path.join(APP, ...parts), 'utf8')
const BASE = process.env.V8_SCREENSHOT_BASE || 'http://127.0.0.1:3000'
const AUTH_HEADERS = process.env.V8_SCREENSHOT_COOKIE
  ? { cookie: process.env.V8_SCREENSHOT_COOKIE }
  : null

function fetchDashboard(route, options = {}) {
  return fetch(`${BASE}${route}`, {
    ...options,
    headers: { ...AUTH_HEADERS, ...options.headers }
  })
}

async function reachable() {
  if (!AUTH_HEADERS) return false
  try {
    const response = await fetchDashboard('/companies', { cache: 'no-store', redirect: 'manual' })
    return response.status === 200
  } catch {
    return false
  }
}

test('the stylesheet is the design system, not an ad-hoc palette', () => {
  const globals = read('globals.css')
  assert.match(globals, /@import "\.\/design-system\.css"/)
  assert.match(globals, /@import "\.\/components\.css"/)

  const system = read('design-system.css')
  // one Arabic font family + one display family, no Arial/Georgia leftovers
  assert.match(system, /--font-body: var\(--font-plex\)/)
  assert.match(system, /--font-display: var\(--font-cairo\)/)
  assert.doesNotMatch(system, /Georgia/)
  assert.doesNotMatch(system, /"Noto Naskh Arabic"/)
  assert.doesNotMatch(system, /Arial/)

  const layout = read('layout.jsx')
  assert.match(layout, /IBM_Plex_Sans_Arabic/)
  assert.match(layout, /Cairo/)

  const components = read('components.css')
  assert.doesNotMatch(components, /Georgia/)
  assert.doesNotMatch(components, /"Noto Naskh Arabic"/)
})

test('the design system defines one type scale, an 8px grid, one accent and semantic colours', () => {
  const system = read('design-system.css')
  for (const step of ['--s-2: 8px', '--s-3: 12px', '--s-4: 16px', '--s-5: 24px', '--s-6: 32px', '--s-8: 48px']) {
    assert.ok(system.includes(step), `expected spacing step ${step}`)
  }
  for (const size of ['--t-2xs', '--t-xs', '--t-sm', '--t-base', '--t-md', '--t-lg', '--t-xl', '--t-2xl', '--t-3xl']) {
    assert.ok(system.includes(`${size}:`), `expected type step ${size}`)
  }
  for (const token of ['--accent', '--overdue', '--soon', '--done']) {
    assert.ok(system.includes(`${token}:`), `expected token ${token}`)
  }
  // exactly one accent family: no second brand hue
  assert.doesNotMatch(system, /--(teal|purple|violet|brand|gold)\s*:/)

  // semantic colours must reach the record card
  const components = read('components.css')
  assert.match(components, /\.record-card-urgent\s*\{[^}]*--tone-color: var\(--overdue\)/)
  assert.match(components, /\.record-card-attention\s*\{[^}]*--tone-color: var\(--soon\)/)
  assert.match(components, /\.record-card-calm\s*\{[^}]*--tone-color: var\(--done\)/)
})

test('light and dark themes both exist and follow the system by default', () => {
  const system = read('design-system.css')
  assert.match(system, /:root,\r?\n:root\[data-theme="dark"\]/)
  assert.match(system, /:root\[data-theme="light"\]/)
  assert.match(system, /@media \(prefers-color-scheme: light\) \{\s*\n\s*:root:not\(\[data-theme\]\)/)
  assert.match(read('layout.jsx'), /sapauto\.theme/)
})

test('Cyber uses the selected six-second, two-pixel edge and theme-aware surfaces', () => {
  const cyber = read('kamal/kamal-mode.css')
  const components = read('components.css')
  assert.match(cyber, /background-color: #080d18/)
  assert.match(cyber, /#e860f2/)
  assert.match(cyber, /#818cff/)
  assert.match(components, /border-width: 2px/)
  assert.match(components, /padding: 2px/)
  assert.match(components, /animation: cyber-edge-chase 6s linear infinite/)
  assert.match(components, /@media \(prefers-reduced-motion: reduce\)/)

  const mission = fs.readFileSync(path.resolve(__dirname, '../launcher/components/mission-board.jsx'), 'utf8')
  assert.match(mission, /priority-panel[\s\S]*summary-strip/, 'attention appears before the summary strip')
  assert.match(mission, /priority-item-featured/, 'the leading priority item gets the Cyber treatment')
  assert.match(mission, /dashboard-sync-card/, 'the home page presents data freshness in plain language')
  assert.doesNotMatch(mission, /حالة النظام|المتابعة والقنوات|function ServiceRow|return ['"]—['"]/)

  for (const file of ['archive-view.jsx', 'company-documents-card.jsx']) {
    const source = fs.readFileSync(path.resolve(__dirname, `../launcher/components/${file}`), 'utf8')
    assert.doesNotMatch(source, /#[\da-fA-F]{3,8}\b/, `${file} uses shared theme tokens instead of fixed colors`)
  }
})

test('the live dashboard renders the new shell and honours the digit setting', async (t) => {
  if (!(await reachable())) return t.skip(`dashboard not running at ${BASE}`)

  const western = await (await fetchDashboard('/companies')).text()
  assert.match(western, /62/, 'company summary uses Western digits by default')
  assert.doesNotMatch(western, /[٠-٩]\d/, 'no Arabic-Indic digits by default')

  const arabic = await (await fetchDashboard('/companies', {
    headers: { cookie: 'sapauto_digits=arab' }
  })).text()
  assert.match(arabic, /٦٢/, 'Arabic-Indic digits on request')
})

/** Playwright lives in the npx cache; the browser test skips when it is absent. */
function loadPlaywright() {
  const candidates = [
    'playwright',
    process.env.PLAYWRIGHT_MODULE,
    path.join(process.env.LOCALAPPDATA || '', 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright')
  ].filter(Boolean)
  for (const candidate of candidates) {
    try { return requireFromHere(candidate) } catch { /* try the next one */ }
  }
  return null
}

function findChromium() {
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
  if (!fs.existsSync(root)) return null
  const build = fs.readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().pop()
  if (!build) return null
  const executable = path.join(root, build, 'chrome-win64', 'chrome.exe')
  return fs.existsSync(executable) ? executable : null
}

test('home shows at most seven prioritized items, each naming its company', async (t) => {
  if (!(await reachable())) return t.skip(`dashboard not running at ${BASE}`)
  const status = await (await fetchDashboard('/api/status')).json()
  assert.ok(Array.isArray(status.attention))
  assert.ok(status.attention.length <= 7, `expected at most 7 items, saw ${status.attention.length}`)

  const playwright = loadPlaywright()
  const executablePath = findChromium()
  if (!playwright || !executablePath) return t.skip('playwright chromium is not available')

  const browser = await playwright.chromium.launch({ executablePath })
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: AUTH_HEADERS
    })
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForSelector('.priority-item', { timeout: 15000 })

    const items = await page.locator('.priority-item').count()
    assert.ok(items <= 7, `expected at most 7 prioritized items, saw ${items}`)
    assert.ok(items > 0, 'the priority list rendered')

    const stripCells = await page.locator('.summary-cell').count()
    assert.ok(stripCells >= 3, `clickable summary strip, saw ${stripCells} cells`)
    assert.equal(await page.locator('.summary-cell').first().getAttribute('href'), '/companies')

    for (const item of await page.locator('.priority-item').all()) {
      assert.equal(await item.locator('.priority-cta').count(), 1, 'exactly one primary button per item')
      assert.ok(
        (await item.locator('.priority-company').count()) === 1,
        'each prioritized item names its company'
      )
    }
    await page.close()
  } finally {
    await browser.close()
  }
})

test('a company card shows the real name, a one-line summary and a primary action', async (t) => {
  if (!(await reachable())) return t.skip(`dashboard not running at ${BASE}`)
  const html = await (await fetchDashboard('/companies')).text()
  const cards = [...html.matchAll(/<article class="company-card[\s\S]*?<\/article>/g)]
  assert.equal(cards.length, 3)
  for (const card of cards) {
    const body = card[0]
    assert.match(body, /<h2[^>]*class="[^"]*company-name-full[^"]*"[^>]*>[^<]+<\/h2>/, 'card has a full name heading')
    assert.match(body, /title="[^"]+"/, 'the heading keeps the full name as a tooltip')
    assert.match(body, /class="company-card-summary-line"/, 'card has exactly one summary line')
    assert.equal((body.match(/class="company-card-summary-line"/g) || []).length, 1)
    assert.match(body, /class="company-card-action[^"]*"/, 'card has a primary action')
    assert.doesNotMatch(body, /الشركة\s*[0-9٠-٩]/)
    assert.doesNotMatch(body, /company-avatar[^>]*>ا?[٠-٩]{1,2}</, 'badge never uses placeholder characters')
  }
  assert.match(html, /تعيين اسم الشركة|فتح سجل الشركة/)
})

test('every sync label says what it measures and carries the exact timestamp', async (t) => {
  if (!(await reachable())) return t.skip(`dashboard not running at ${BASE}`)
  const companies = await (await fetchDashboard('/companies')).text()
  assert.match(companies, /title="[^"]*مزامنة[^"]*"/, 'exact sync timestamp on hover')
  assert.doesNotMatch(companies, /آخر مراجعة/)

  const payments = await (await fetchDashboard('/payments')).text()
  assert.doesNotMatch(payments, /آخر مراجعة/)
  assert.match(payments, /class="record-sync-meta[^"]*" title="/)
  // Plan 2.4 §3.3 — payments are a worklist, and every row still names its company.
  assert.match(payments, /class="payment-worklist"/, 'payments render as a worklist, not a card wall')
  assert.match(payments, /ما تقوله البوابة/, 'the worklist separates what the portal says')
  assert.match(payments, /مراجعتك المحلية/, 'the worklist separates the local review lane')
  assert.match(payments, /worklist-company-name company-name-full" title="/, 'every payment row names its company in full')
})