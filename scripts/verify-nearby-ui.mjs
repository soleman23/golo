/**
 * Browser smoke test for the unified course browser and selection collapse.
 *
 * Usage: node scripts/verify-nearby-ui.mjs   (needs `npm run dev` running)
 * Target defaults to http://localhost:5173; override via GOLO_URL.
 * Geolocation defaults to Bend, OR; override via GOLO_LAT/GOLO_LNG.
 * /setup requires auth when Supabase is configured; pass
 * GOLO_EMAIL/GOLO_PASSWORD to sign in first.
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { repoRoot, regionFromEnv } from './_shared.mjs'

const base = process.env.GOLO_URL || 'http://localhost:5173'
const region = regionFromEnv()
const denyGeo = process.env.GOLO_DENY_GEO === '1'
const screenshotDir = join(repoRoot, 'output', 'playwright')

await mkdir(screenshotDir, { recursive: true })

let failed = false
function check(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`)
    return
  }
  failed = true
  console.error(`✗ ${message}`)
}

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ...(!denyGeo
      ? {
          geolocation: { latitude: region.lat, longitude: region.lng },
          permissions: ['geolocation'],
        }
      : {}),
  })
  if (process.env.GOLO_LOCAL_TEST === '1') {
    await context.addInitScript(() => {
      localStorage.setItem('golo-profile', JSON.stringify({
        state: {
          name: 'Course Browser Tester',
          email: 'course-browser@example.test',
          onboarded: true,
          homeClub: 'Tetherow',
        },
        version: 0,
      }))
      localStorage.setItem('golf-history', JSON.stringify({
        state: {
          rounds: [
            { roundId: 'pinehurst-new', courseId: 'pinehurst', course: 'Pinehurst No.2', date: '2026-07-20' },
            { roundId: 'lost-tracks', courseId: 'losttracks', course: 'Lost Tracks Golf Course', date: '2026-07-19' },
            { roundId: 'pinehurst-old', courseId: 'pinehurst', course: 'Pinehurst No.2', date: '2026-06-15' },
          ],
        },
        version: 0,
      }))
    })
  }
  const page = await context.newPage()

  const browserErrors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') browserErrors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => browserErrors.push(`pageerror: ${err.message}`))

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

  const search = page.getByRole('textbox', { name: 'Search courses' })
  const ready = await search.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false)
  if (!ready) {
    const bodyText = await page.locator('body').innerText()
    throw new Error(`Course browser did not open (sign-in required?). Body starts: ${bodyText.slice(0, 600)}`)
  }

  const poolCards = page.locator('[data-course-list] [data-course-kind]')
  await page.waitForFunction(() => document.querySelectorAll('[data-course-list] [data-course-kind]').length > 0)

  const initialPoolCount = await poolCards.count()
  const homeCount = await page.locator('[data-home-course] [data-course-kind="catalog"]').count()
  const initialText = await page.locator('body').innerText()
  check(initialPoolCount <= 4, `initial unified list is capped at four rows (saw ${initialPoolCount})`)
  check(homeCount <= 1, `home course is rendered at most once (saw ${homeCount})`)
  check(homeCount === 1, 'explicit You home club shows a HOME COURSE section')
  check(!/MORE NEARBY/i.test(initialText), 'legacy MORE NEARBY section is absent')
  check(await page.getByText('ROUND', { exact: true }).isVisible(), 'scorecard note and ROUND controls remain visible while browsing')
  if (denyGeo) {
    check(/Enable location to see nearby courses/i.test(initialText), 'denied geolocation shows the fallback hint')
    check(!/\d+(\.\d+)?\s*mi\b|>50 mi/i.test(initialText), 'denied geolocation shows no distance badges')
    check(
      (await poolCards.first().getAttribute('data-course-id')) === 'pinehurst',
      'played-history fallback orders by play count before recency',
    )
  }

  const pagination = page.locator('[data-course-pagination]')
  if (await pagination.isVisible().catch(() => false)) {
    await pagination.click()
    const expandedCount = await poolCards.count()
    check(expandedCount > initialPoolCount, `Load more reveals additional rows (${initialPoolCount} → ${expandedCount})`)
    check((await pagination.innerText()).trim() === 'Show less', 'expanded pagination changes to Show less')
    await pagination.click()
    check((await poolCards.count()) === initialPoolCount, 'Show less restores the initial page')
  } else {
    console.log('• pagination not shown because four or fewer merged courses are available')
  }

  const firstCatalogCard = page.locator('button[data-course-kind="catalog"]').first()
  const selectedId = await firstCatalogCard.getAttribute('data-course-id')
  const selectedName = (await firstCatalogCard.locator('div').first().innerText()).split('\n')[0].trim()
  await firstCatalogCard.click()
  await page.getByRole('button', { name: 'Choose a different course' }).waitFor({ state: 'visible' })

  check(!(await search.isVisible().catch(() => false)), 'explicit course tap collapses the browser')
  check(await page.getByText('TEES', { exact: true }).isVisible(), 'selected course tees appear in collapsed mode')
  check(await page.getByText('ROUND', { exact: true }).isVisible(), 'ROUND controls remain visible in collapsed mode')
  check(
    (await page.locator('[data-course-kind="catalog"]').count()) === 1,
    'only the selected course card remains in collapsed mode',
  )
  await page.screenshot({ path: join(screenshotDir, 'course-browser-collapsed.png') })

  await page.getByRole('button', { name: 'Choose a different course' }).click()
  await search.waitFor({ state: 'visible' })
  check(
    await page.locator(`button[data-course-id="${selectedId}"][aria-pressed="true"]`).isVisible(),
    'closing restores the list and keeps the course selected',
  )

  await search.fill(selectedName)
  const searchedCard = page.locator(`button[data-course-id="${selectedId}"]`).first()
  await searchedCard.waitFor({ state: 'visible' })
  await searchedCard.click()
  await page.getByRole('button', { name: 'Choose a different course' }).click()
  await search.waitFor({ state: 'visible' })
  check((await search.inputValue()) === '', 'closing a search selection restores the default course browser')

  check(browserErrors.length === 0, 'browser console has no errors')
  if (browserErrors.length) console.error(browserErrors.map((line) => `  ${line}`).join('\n'))

  await page.screenshot({ path: join(screenshotDir, 'course-browser-browsing.png') })
  console.log('screenshots: output/playwright/course-browser-{browsing,collapsed}.png')
} catch (err) {
  failed = true
  console.error('✗ UI check failed:', err.message)
} finally {
  await browser.close()
}

if (failed) process.exitCode = 1
