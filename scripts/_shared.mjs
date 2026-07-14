/**
 * Shared helpers for the verification scripts in scripts/.
 * Env loading follows verify-production.mjs: reads .env.local / .env.netlify,
 * skips comment lines, never overwrites existing process.env values.
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export function loadEnvLocal() {
  for (const name of ['.env.local', '.env.netlify']) {
    const path = resolve(repoRoot, name)
    if (!existsSync(path)) continue
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.replace(/^\uFEFF/, '').trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf('=')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      if (!key || process.env[key]) continue
      let value = line.slice(idx + 1).trim()
      const quote = value[0]
      // Only strip quotes when they actually match; a lone quote is kept as-is.
      if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}

/** Load env and return Supabase creds, or exit 1 with a clear message. */
export function requireSupabaseEnv() {
  loadEnvLocal()
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (.env.local or env).')
    process.exit(1)
  }
  return { url, key }
}

/** Region under test; defaults to Bend, OR. Override via GOLO_LAT/GOLO_LNG/GOLO_CITY/GOLO_STATE. */
export function regionFromEnv() {
  const state = process.env.GOLO_STATE ?? 'OR'
  return {
    lat: Number(process.env.GOLO_LAT ?? 44.026),
    lng: Number(process.env.GOLO_LNG ?? -121.28),
    city: process.env.GOLO_CITY ?? 'Bend',
    state,
    stateCode: state,
  }
}

/**
 * POST a Supabase Edge Function. Never throws: network errors, timeouts,
 * non-2xx statuses and non-JSON bodies all come back as { ok: false, error }
 * so one bad request can't sink a Promise.all batch or read as "no results".
 */
export async function invokeEdgeFunction(env, fn, body, { timeoutMs = 15_000 } = {}) {
  try {
    const res = await fetch(`${env.url}/functions/v1/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: env.key, Authorization: `Bearer ${env.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.headers.get('content-type')?.includes('application/json')) {
      const text = await res.text()
      return { ok: false, status: res.status, json: null, error: `non-JSON response: ${text.slice(0, 200)}` }
    }
    const json = await res.json()
    if (!res.ok) {
      return { ok: false, status: res.status, json, error: json?.message ?? json?.error ?? `HTTP ${res.status}` }
    }
    return { ok: true, status: res.status, json, error: null }
  } catch (err) {
    return { ok: false, status: 0, json: null, error: err.message }
  }
}

/** NCRDB course search; `hits` is null (not []) when the request failed. */
export async function searchNcrdb(env, query, opts) {
  const res = await invokeEdgeFunction(env, 'ncrdb-course-search', { action: 'search', ...query }, opts)
  return { ...res, hits: res.ok ? res.json?.courses ?? [] : null }
}

/**
 * Fetch setup-visible courses mapped to the app catalog shape (mirrors
 * courseFromDb in src/lib/db/courses.js for the fields used here). Exits 1 on
 * failure — a failed fetch must not be mistaken for an empty catalog.
 */
export async function fetchVisibleCourses(env) {
  let res
  try {
    res = await fetch(
      `${env.url}/rest/v1/courses?select=id,name,location,ghin_course_id,latitude,longitude&visible_in_setup=eq.true&order=name`,
      { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` }, signal: AbortSignal.timeout(15_000) },
    )
  } catch (err) {
    console.error(`courses fetch failed: ${err.message}`)
    process.exit(1)
  }
  const rows = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(rows)) {
    console.error(`courses fetch failed: HTTP ${res.status} ${JSON.stringify(rows)?.slice(0, 300) ?? ''}`)
    process.exit(1)
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    loc: r.location ?? '',
    ...(r.ghin_course_id ? { ghinCourseId: r.ghin_course_id } : {}),
    ...(r.latitude != null ? { latitude: Number(r.latitude) } : {}),
    ...(r.longitude != null ? { longitude: Number(r.longitude) } : {}),
  }))
}
