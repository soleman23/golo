/**
 * Smoke-check Supabase production schema + seed data before crew launch.
 * Reads VITE_* vars from .env.local (or process env). Does not print secrets.
 *
 * Usage: node scripts/verify-production.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

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

const supabase = createClient(url, key)
const checks = []

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
  const { data, error } = await supabase.from('courses').select('id').limit(1)
  if (error) throw error
  if (!data?.length) throw new Error('courses table empty — run 0002_seed_courses.sql')
})

await check('seed course count (expect ≥5)', async () => {
  const { count, error } = await supabase.from('courses').select('*', { count: 'exact', head: true })
  if (error) throw error
  if ((count ?? 0) < 5) throw new Error(`only ${count} courses — re-run 0002_seed_courses.sql`)
})

await check('profiles.avatar_url column (0003)', async () => {
  const { error } = await supabase.from('profiles').select('avatar_url').limit(0)
  if (error) throw error
})

await check('profiles.handicap_index column (0004)', async () => {
  const { error } = await supabase.from('profiles').select('handicap_index').limit(0)
  if (error) throw error
})

await check('profiles.ghin_number column (0005)', async () => {
  const { error } = await supabase.from('profiles').select('ghin_number, ghin_connected_at, ghin_last_sync_at').limit(0)
  if (error) throw error
})

await check('courses GHIN mapping columns (0005)', async () => {
  const { error } = await supabase.from('courses').select('ghin_facility_id, ghin_course_id, ghin_tee_sets').limit(0)
  if (error) throw error
})

await check('rounds GHIN post columns (0005)', async () => {
  const { error } = await supabase.from('rounds').select('ghin_posted_at, ghin_post_id, ghin_post_error').limit(0)
  if (error) throw error
})

await check('ghin_connections table (0005)', async () => {
  const { error } = await supabase.from('ghin_connections').select('user_id').limit(0)
  if (error) throw error
})

await check('avatars storage bucket (0003)', async () => {
  const { data, error } = await supabase.storage.from('avatars').list('', { limit: 1 })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('unexpected storage response')
})

await check('rounds + round_participants readable', async () => {
  const { error: rErr } = await supabase.from('rounds').select('id').limit(0)
  if (rErr) throw rErr
  const { error: pErr } = await supabase.from('round_participants').select('round_id').limit(0)
  if (pErr) throw pErr
})

const failed = checks.filter((c) => !c.ok)
console.log('')
if (failed.length) {
  console.error(`${failed.length} check(s) failed. Apply missing migrations in supabase/migrations/ (0001–0005).`)
  process.exit(1)
}
console.log('All Supabase production checks passed.')
