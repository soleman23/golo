/**
 * verify-notifications-ui.mjs — the two-account BROWSER pass for notifications.
 *
 * verify-invites-e2e.mjs proves the RPCs and RLS are right; this proves the UI
 * layer on top of them is, which is the part no headless RPC test can reach:
 *
 *   1. Bell / menu unread badge updates in account B's browser when account A
 *      acts — i.e. Realtime actually reaches the store in a real page.
 *   2. Unread survives a reload. The inbox is deliberately NEVER persisted
 *      (store/notificationStore.js), so a reload proves hydrateInbox() re-reads
 *      the server rather than the badge being local memory.
 *   3. A live-scoring notification raises a transient toast — the behaviour the
 *      LiveNotifications rewrite is responsible for.
 *
 * Requires the LOCAL stack and a dev server pointed at it. `.env.local` holds
 * PRODUCTION credentials, so this runs the app in Vite's `test` mode, where
 * `.env.test.local` overrides them:
 *
 *     npx supabase start && npx supabase db reset --local
 *     npx vite --mode test --port 5174
 *     node scripts/verify-notifications-ui.mjs
 *
 * Never point this at a remote project: it creates and deletes auth users.
 */

import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const APP_URL = process.env.GOLO_URL ?? 'http://localhost:5174'
const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const ANON_KEY = process.env.SUPABASE_ANON_KEY
  ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

if (!/127\.0\.0\.1|localhost/.test(URL_BASE)) {
  console.error('Refusing to run against a non-local Supabase URL:', URL_BASE)
  process.exit(1)
}

let passed = 0
let failed = 0
function assert(cond, msg) {
  if (cond) { passed += 1; console.log('  ok  ', msg) }
  else { failed += 1; console.error('  FAIL', msg) }
}

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_golf-app'
function exec(statement) {
  execFileSync('docker', [
    'exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-q', '-c', statement,
  ], { encoding: 'utf8' })
}

const stamp = Date.now()
const pw = 'test-password-123!'
const created = []

async function makeUser(tag, name) {
  const email = `${tag}.${stamp}@golo.test`
  const cr = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw, email_confirm: true }),
  })
  const cu = await cr.json()
  if (!cr.ok) throw new Error(`createUser ${tag}: ${JSON.stringify(cu)}`)
  const id = cu.id
  created.push(id)

  // onboarded + a contact, so the app doesn't bounce us into onboarding and the
  // verified-player predicate (0011) accepts them as an invite target.
  exec(`insert into public.profiles (id, name, email, onboarded) values ('${id}', '${name}', '${email}', true)
        on conflict (id) do update set name = excluded.name, email = excluded.email, onboarded = true`)

  const sr = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  })
  const sess = await sr.json()
  if (!sr.ok) throw new Error(`signIn ${tag}: ${JSON.stringify(sess)}`)

  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${sess.access_token}`, 'Content-Type': 'application/json' }
  return {
    id, email, name,
    async rpc(fn, body) {
      const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) })
      const text = await r.text()
      const data = text ? JSON.parse(text) : null
      return r.ok ? { data, error: null } : { data: null, error: data ?? { message: text } }
    },
  }
}

/** Sign a context in through the real AuthPage, then land on Home. */
async function signIn(page, email) {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.locator('#auth-email').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('#auth-email').fill(email)
  await page.locator('#auth-password').fill(pw)
  await page.getByRole('button', { name: /sign in|log in|continue/i }).first().click()
  // Home renders the header menu; that's our signal the session took.
  await page.getByRole('button', { name: 'Open menu' }).waitFor({ state: 'visible', timeout: 25000 })
}

/**
 * Unread count as the USER sees it. Prefers the header menu button aria-label
 * (`Open menu, N unread`), then falls back to opening the menu and reading the
 * Notifications row badge. Legacy bell selectors kept for older builds.
 */
async function readUnread(page) {
  const menuBtn = page.getByRole('button', { name: /Open menu/i }).first()
  if (await menuBtn.count()) {
    const label = await menuBtn.getAttribute('aria-label')
    const fromAria = /(\d+)\s*unread/i.exec(label ?? '')
    if (fromAria) return Number(fromAria[1])
    if (/^Open menu$/i.test(String(label ?? '').trim())) {
      // No unread announced — confirm via menu row (badge hidden when zero).
      await menuBtn.click()
      const row = page.getByRole('button', { name: /Notifications/i }).first()
      await row.waitFor({ state: 'visible', timeout: 10000 })
      const text = await row.innerText()
      await menuBtn.click()
      const m = /(\d+|9\+)\s*new/i.exec(text)
      return m ? (m[1] === '9+' ? 10 : Number(m[1])) : 0
    }
  }

  const bell = page.getByRole('button', { name: /Notifications,\s*\d+\s*unread/i })
  if (await bell.count()) {
    const label = await bell.first().getAttribute('aria-label')
    return Number(/(\d+)\s*unread/i.exec(label ?? '')?.[1] ?? 0)
  }
  const bellZero = page.getByRole('button', { name: /^Notifications$/i })
  if (await bellZero.count()) return 0

  return null
}

async function waitForUnread(page, want, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last = null
  while (Date.now() < deadline) {
    last = await readUnread(page)
    if (last === want || (want >= 10 && last >= 10)) return last
    await page.waitForTimeout(500)
  }
  return last
}

async function cleanup() {
  if (process.env.KEEP) { console.log('KEEP set — leaving test users in place'); return }
  for (const id of created) {
    await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, {
      method: 'DELETE', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    }).catch(() => {})
  }
}

const browser = await chromium.launch({ headless: process.env.HEADED !== '1' })
try {
  const A = await makeUser('ui-organizer', 'Ann Organizer')
  const B = await makeUser('ui-invitee', 'Bob Invitee')

  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageB = await ctxB.newPage()
  pageB.on('console', (m) => { if (m.type() === 'error') console.error('   [B console]', m.text()) })

  await signIn(pageB, B.email)
  assert(true, 'invitee signed in and reached Home')
  // Let the Realtime channel finish SUBSCRIBING. Without this the first event
  // races the handshake and the badge looks broken when it isn't.
  await pageB.waitForTimeout(Number(process.env.GOLO_RT_SETTLE_MS ?? 4000))

  const before = await readUnread(pageB)
  assert(before === 0 || before === null,
    `badge starts clear (got ${before === null ? 'no badge' : before})`)

  /* -------------------------------------------------- 1. cross-account badge */
  const roundId = crypto.randomUUID()
  const roster = [
    { id: crypto.randomUUID(), name: A.name, email: A.email, guest: false },
    { id: crypto.randomUUID(), name: B.name, email: B.email, guest: false },
  ]
  const { error: startErr } = await A.rpc('start_live_round', {
    p_round_id: roundId, p_state: { round: { roundId }, players: roster, scores: {}, bets: [] },
    p_roster: roster, p_course_name: 'Tetherow',
  })
  assert(!startErr, `organizer started a live round${startErr ? ` (${startErr.message})` : ''}`)

  const { data: sent, error: sendErr } = await A.rpc('send_game_invites', {
    p_round_id: roundId, p_invitee_ids: [B.id],
  })
  assert(!sendErr && sent?.invited === 1, `organizer sent the invite${sendErr ? ` (${sendErr.message})` : ''}`)

  const afterInvite = await waitForUnread(pageB, 1)
  assert(afterInvite === 1,
    `account A's invite lit account B's unread badge without a reload (got ${afterInvite})`)

  /* --------------------------------------------- 2. unread survives a reload */
  await pageB.reload({ waitUntil: 'domcontentloaded' })
  await pageB.getByRole('button', { name: 'Open menu' }).waitFor({ state: 'visible', timeout: 25000 })
  const afterReload = await waitForUnread(pageB, 1)
  assert(afterReload === 1,
    `unread survives a full reload — re-hydrated from the server (got ${afterReload})`)

  /* ------------------------------------------- 3. live-scoring toast appears */
  // Insert as postgres: score_updated is normally raised by the live-round
  // fan-out trigger, and we want the client path (Realtime -> LiveNotifications
  // -> pushToast), not the trigger, under test here.
  await pageB.waitForTimeout(1000)
  exec(`insert into public.notifications (user_id, type, title, message, round_id, action_url)
        values ('${B.id}', 'score_updated', 'Scores updated', 'Ann Organizer posted a 4 on 7.',
                '${roundId}', '/scoring')`)

  const toast = pageB.getByRole('status')
  let toastOk = true
  await toast.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => { toastOk = false })
  assert(toastOk, 'a live-scoring notification raised a toast after the LiveNotifications rewrite')

  if (toastOk) {
    const toastText = await toast.first().innerText()
    assert(/Scores updated|posted a 4/i.test(toastText),
      `the toast carries the scoring copy (got "${toastText.replace(/\s+/g, ' ').trim()}")`)
    assert(/SCORES/i.test(toastText), 'the toast uses the SCORES kicker')
  }

  const afterToast = await waitForUnread(pageB, 2)
  assert(afterToast === 2, `the scoring notification also bumped the badge to 2 (got ${afterToast})`)

  /* ------------------------------- 4. toast suppressed on the linked screen */
  await pageB.goto(`${APP_URL}/notifications`, { waitUntil: 'domcontentloaded' })
  await pageB.waitForTimeout(1500)
  exec(`insert into public.notifications (user_id, type, title, message, round_id, action_url)
        values ('${B.id}', 'score_updated', 'Another score', 'Ann Organizer posted a 5 on 8.',
                '${roundId}', '/notifications')`)
  await pageB.waitForTimeout(4000)
  const suppressed = await pageB.getByRole('status').count()
  assert(suppressed === 0,
    `no toast while already on the screen it links to (saw ${suppressed})`)

  await ctxB.close()
} catch (err) {
  failed += 1
  console.error('  FAIL  unexpected error:', err?.message ?? err)
} finally {
  await browser.close()
  await cleanup()
}

console.log(`\nverify-notifications-ui: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
