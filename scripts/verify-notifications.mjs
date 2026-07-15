/**
 * Smoke-check the notifications foundation (migrations 0022/0023) against the
 * linked Supabase project. Anon-key REST only — deliberately NOT supabase-js, so
 * it runs on Node < 22 without the eager RealtimeClient WebSocket dependency
 * (same reasoning as verify-production.mjs).
 *
 * What it proves:
 *   • 0022 — the four tables + their columns exist (foundation applied).
 *   • 0023 — RLS holds for an unauthenticated (anon) client:
 *       – it cannot READ any notification / delivery row, and
 *       – it cannot CREATE a notification, device, or preference.
 *     The insert-denial covers the guide's hard rule: "the browser must not be
 *     allowed to create arbitrary notifications for other people."
 *
 * What it does NOT cover: the fan-out trigger's runtime behavior + dedupe
 * coalescing, and the authenticated cross-user cases. Those need two signed-in
 * members in a live round — run the two-account manual check for that.
 *
 * Usage: npm run verify:notifications   (needs VITE_SUPABASE_* in .env.local)
 */

import { requireSupabaseEnv } from './_shared.mjs'

const { url, key } = requireSupabaseEnv()
const base = url.replace(/\/$/, '')
const authHeaders = { apikey: key, Authorization: `Bearer ${key}` }
const checks = []

const FAKE_UID = '00000000-0000-0000-0000-000000000000'

/** GET/POST /rest/v1/<query>; returns { res, body } with body parsed when JSON. */
async function rest(query, init = {}) {
  const res = await fetch(`${base}/rest/v1/${query}`, {
    ...init,
    headers: { ...authHeaders, ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { res, body }
}

/** Assert a column list exists on a table. Missing column → PostgREST 400 (42703);
 *  RLS merely hides rows and still returns 200, so status alone proves the schema. */
async function columnsExist(table, cols) {
  const { res, body } = await rest(`${table}?select=${cols}&limit=0`)
  if (!res.ok) {
    const msg = body?.message || (typeof body === 'string' ? body.slice(0, 120) : JSON.stringify(body))
    throw new Error(`HTTP ${res.status}: ${msg}`)
  }
}

/** Assert an anon read returns no rows — either an empty 200 (RLS filtered) or a
 *  permission denial. Both mean the property "anon sees no data" holds. */
async function anonReadsNothing(table) {
  const { res, body } = await rest(`${table}?select=id&limit=1`)
  if (res.ok) {
    if (!Array.isArray(body)) throw new Error('expected an array')
    if (body.length) throw new Error(`RLS leak: anon read ${body.length} row(s) from ${table}`)
    return
  }
  if (res.status === 401 || res.status === 403) return // denied outright — also fine
  throw new Error(`HTTP ${res.status}: ${body?.message || body}`)
}

/** Assert an anon insert is rejected. `return=minimal` + denial means no row is
 *  written; the FK to auth.users also blocks the fake user_id as defence-in-depth. */
async function anonInsertDenied(table, row) {
  const { res, body } = await rest(table, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  })
  if (res.ok) {
    throw new Error(`SECURITY: anon insert into ${table} SUCCEEDED — no client path should allow this`)
  }
  // 401/403 (RLS or grant) or 409 (FK) are all correct denials.
}

async function check(name, fn) {
  try {
    await fn()
    checks.push({ name, ok: true })
    console.log(`✓ ${name}`)
  } catch (err) {
    checks.push({ name, ok: false, detail: err.message })
    console.error(`✗ ${name}: ${err.message}`)
  }
}

// ------------------------------------------------------------ 0022 schema
await check('notifications columns (0022)', () =>
  columnsExist(
    'notifications',
    'id,user_id,type,title,message,round_id,actor_user_id,action_url,payload,dedupe_key,read_at,archived_at,created_at',
  ))

await check('notification_devices columns (0022)', () =>
  columnsExist(
    'notification_devices',
    'id,user_id,platform,provider,endpoint_or_token,web_p256dh,web_auth,enabled,last_seen_at,revoked_at',
  ))

await check('notification_preferences columns (0022)', () =>
  columnsExist('notification_preferences', 'user_id,event_type,in_app_enabled,push_enabled'))

await check('notification_deliveries columns (0022)', () =>
  columnsExist('notification_deliveries', 'id,notification_id,channel,provider,status,attempts,last_error,delivered_at'))

// ------------------------------------------------------------- 0023 RLS: reads
await check('anon cannot read notifications (RLS)', () => anonReadsNothing('notifications'))

await check('anon cannot read notification_deliveries (server-only)', () =>
  anonReadsNothing('notification_deliveries'))

// ------------------------------------------------------------ 0023 RLS: writes
await check('anon cannot create a notification (RLS)', () =>
  anonInsertDenied('notifications', { user_id: FAKE_UID, type: 'score_updated', title: 'x', message: 'x' }))

await check('anon cannot create a device (RLS)', () =>
  anonInsertDenied('notification_devices', { user_id: FAKE_UID, endpoint_or_token: 'https://example.test/x' }))

await check('anon cannot create a preference (RLS)', () =>
  anonInsertDenied('notification_preferences', { user_id: FAKE_UID, event_type: 'live_score' }))

// ------------------------------------------------------------------- summary
const failed = checks.filter((c) => !c.ok)
console.log('')
if (failed.length) {
  console.error(`${failed.length} check(s) failed. Confirm 0022/0023 are applied (supabase db push --linked).`)
  process.exit(1)
}
console.log('All notifications foundation checks passed (schema + RLS). Fan-out/dedupe still need the two-account live-round check.')
