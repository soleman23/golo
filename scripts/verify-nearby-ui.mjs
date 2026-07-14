/**
 * Browser E2E: open /setup with a mocked geolocation and report the
 * NEAR YOU / MORE NEARBY sections. Screenshot: debug-nearby-setup.png (gitignored).
 *
 * Usage: node scripts/verify-nearby-ui.mjs   (needs `npm run dev` running)
 * Target defaults to http://localhost:5173; override via GOLO_URL.
 * Geolocation defaults to Bend, OR; override via GOLO_LAT/GOLO_LNG.
 * /setup requires auth — pass GOLO_EMAIL/GOLO_PASSWORD to sign in first.
 */

import { chromium } from 'playwright'
import { join } from 'node:path'
import { repoRoot, regionFromEnv } from './_shared.mjs'

const base = process.env.GOLO_URL || 'http://localhost:5173'
const region = regionFromEnv()

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    geolocation: { latitude: region.lat, longitude: region.lng },
    permissions: ['geolocation'],
  })
  const page = await context.newPage()

  const consoleLines = []
  page.on('console', (msg) => consoleLines.push(`${msg.type()}: ${msg.text()}`))
  page.on('pageerror', (err) => consoleLines.push(`pageerror: ${err.message}`))

  await page.goto(`${base}/setup`, { waitUntil: 'networkidle', timeout: 60_000 })

  const email = process.env.GOLO_EMAIL
  const password = process.env.GOLO_PASSWORD
  if (email && password) {
    const emailInput = page.locator('input[type="email"]').first()
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(email)
      await page.locator('input[type="password"]').first().fill(password)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForLoadState('networkidle')
      await page.goto(`${base}/setup`, { waitUntil: 'networkidle', timeout: 60_000 })
    }
  }

  const sawNearby = await page
    .waitForFunction(() => /NEAR YOU|MORE NEARBY/i.test(document.body.innerText), { timeout: 30_000 })
    .then(() => true)
    .catch(() => false)

  const bodyText = await page.locator('body').innerText()
  const state = {
    hasNearYou: /NEAR YOU/i.test(bodyText),
    hasMoreNearby: /MORE NEARBY/i.test(bodyText),
    hasFinding: /Finding courses near you/i.test(bodyText),
    hasEnable: /Enable location/i.test(bodyText),
    hasDistance: /\d+(\.\d+)?\s*mi\b/i.test(bodyText),
    addCount: await page.getByText('ADD', { exact: true }).count(),
  }
  console.log('page state', state)
  if (consoleLines.length) console.log('browser console:\n' + consoleLines.map((l) => `  ${l}`).join('\n'))

  await page.screenshot({ path: join(repoRoot, 'debug-nearby-setup.png') })
  console.log('screenshot: debug-nearby-setup.png')

  if (!sawNearby) {
    console.error(`✗ neither NEAR YOU nor MORE NEARBY appeared within 30s (sign-in screen? pass GOLO_EMAIL/GOLO_PASSWORD); body starts:\n${bodyText.slice(0, 600)}`)
    process.exitCode = 1
  }
} catch (err) {
  console.error('✗ UI check failed:', err.message)
  process.exitCode = 1
} finally {
  await browser.close()
}
