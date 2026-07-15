/**
 * Smoke-check Supabase production schema + seed data before crew launch.
 * Reads VITE_* vars from .env.local (or process env). Does not print secrets.
 *
 * Usage: node scripts/verify-production.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  for (const name of ['.env.local', '.env.netlify']) {
    const path = resolve(root, name)
    if (!existsSync(path)) continue
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.replace(/^\uFEFF/, '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      if (!process.env[key]) {
        process.env[key] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

loadEnv()

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (.env.local or env).')
  process.exit(1)
}

// Raw REST/Storage over fetch — deliberately NOT supabase-js. Its client
// constructs a RealtimeClient eagerly, which throws on Node < 22 ("no native
// WebSocket support"). This smoke-check only needs GETs and one storage list,
// so fetch is both sufficient and free of that dependency.
const base = url.replace(/\/$/, '')
const authHeaders = { apikey: key, Authorization: `Bearer ${key}` }
const checks = []

/** GET /rest/v1/<query>; returns { res, body } with body parsed as JSON when possible. */
async function rest(query, extraHeaders = {}) {
  const res = await fetch(`${base}/rest/v1/${query}`, { headers: { ...authHeaders, ...extraHeaders } })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { res, body }
}

/** Assert a column list exists on a table. A missing column → PostgREST 400 (42703);
 *  RLS merely hides rows and still returns 200, so status alone proves the schema. */
async function columnsExist(table, cols) {
  const { res, body } = await rest(`${table}?select=${cols}&limit=0`)
  if (!res.ok) {
    const msg = body?.message || (typeof body === 'string' ? body.slice(0, 120) : JSON.stringify(body))
    throw new Error(`HTTP ${res.status}: ${msg}`)
  }
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

await check('courses table readable', async () => {
  const { res, body } = await rest('courses?select=id&limit=1')
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body?.message || body}`)
  if (!Array.isArray(body) || !body.length) throw new Error('courses table empty — run 0002_seed_courses.sql')
})

await check('seed course count (expect ≥5)', async () => {
  const { res, body } = await rest('courses?select=id&limit=1', { Prefer: 'count=exact' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body?.message || body}`)
  const count = Number(res.headers.get('content-range')?.split('/')[1] ?? NaN)
  if (!(count >= 5)) throw new Error(`only ${count} courses — re-run 0002_seed_courses.sql`)
})

await check('profiles.avatar_url column (0003)', () => columnsExist('profiles', 'avatar_url'))

await check('profiles.handicap_index column (0004)', () => columnsExist('profiles', 'handicap_index'))

await check('profiles.ghin_number column (0005)', () =>
  columnsExist('profiles', 'ghin_number,ghin_connected_at,ghin_last_sync_at'))

await check('courses GHIN mapping columns (0005)', () =>
  columnsExist('courses', 'ghin_facility_id,ghin_course_id,ghin_tee_sets'))

await check('admin course columns (0012)', async () => {
  await columnsExist('profiles', 'is_admin')
  await columnsExist('courses', 'visible_in_setup')
})

await check('rounds GHIN post columns (0005)', () =>
  columnsExist('rounds', 'ghin_posted_at,ghin_post_id,ghin_post_error'))

await check('ghin_connections table (0005)', () => columnsExist('ghin_connections', 'user_id'))

await check('profiles.onboarded column (0006)', () => columnsExist('profiles', 'onboarded'))

await check('avatars storage bucket (0003)', async () => {
  const res = await fetch(`${base}/storage/v1/object/list/avatars`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 1 }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // Post-0021 the owner-scoped policy makes this empty for an anon caller; an
  // array (even []) confirms the bucket exists and responds.
  if (!Array.isArray(body)) throw new Error('unexpected storage response')
})

await check('rounds + round_participants readable', async () => {
  await columnsExist('rounds', 'id')
  await columnsExist('round_participants', 'round_id')
})

const failed = checks.filter((c) => !c.ok)
console.log('')
if (failed.length) {
  console.error(`${failed.length} check(s) failed. Apply missing migrations in supabase/migrations/.`)
  process.exit(1)
}
console.log('All Supabase production checks passed.')
