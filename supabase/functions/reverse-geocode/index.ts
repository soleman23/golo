import { corsHeaders, jsonResponse } from '../_shared/http.ts'

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org'
const TIMEOUT_MS = 10_000
const USER_AGENT = 'GoLoGolfApp/1.0 (course-nearby; contact: support@golo.golf)'

type GeoCacheEntry = { city: string; state: string; stateCode: string; country: string; lat?: number; lng?: number }
const reverseCache = new Map<string, GeoCacheEntry>()
const forwardCache = new Map<string, { lat: number; lng: number }>()

const cacheKey = (lat: number, lng: number) => `${lat.toFixed(3)},${lng.toFixed(3)}`

function parseAddress(address: Record<string, string> = {}) {
  const city =
    address.city ??
    address.town ??
    address.village ??
    address.hamlet ??
    address.municipality ??
    address.county ??
    ''
  const state = address.state ?? ''
  const stateCode = address['ISO3166-2-lvl4']?.split('-')[1] ?? state
  const country = address.country_code?.toUpperCase() ?? address.country ?? ''
  return { city: String(city).trim(), state: String(state).trim(), stateCode: String(stateCode).trim(), country }
}

async function nominatimFetch(path: string) {
  const res = await fetch(`${NOMINATIM_BASE}${path}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`)
  return res.json()
}

async function reverseGeocode(lat: number, lng: number): Promise<GeoCacheEntry> {
  const key = cacheKey(lat, lng)
  const cached = reverseCache.get(key)
  if (cached) return cached

  const data = await nominatimFetch(`/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`)
  const parsed = parseAddress(data?.address ?? {})
  const result = { ...parsed, lat: Number(data?.lat ?? lat), lng: Number(data?.lon ?? lng) }
  reverseCache.set(key, result)
  return result
}

async function forwardGeocode(query: string) {
  const key = query.toLowerCase()
  const cached = forwardCache.get(key)
  if (cached) return cached

  const encoded = encodeURIComponent(query)
  const rows = await nominatimFetch(`/search?format=jsonv2&q=${encoded}&limit=1&addressdetails=0`)
  const hit = Array.isArray(rows) ? rows[0] : null
  if (!hit) throw new Error('No geocode results for that location.')

  const result = { lat: Number(hit.lat), lng: Number(hit.lon) }
  if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
    throw new Error('Invalid geocode coordinates returned.')
  }
  forwardCache.set(key, result)
  return result
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_body', message: 'Expected a JSON body.' }, 400)
  }

  try {
    const query = String(body.query ?? '').trim()
    if (query) {
      const coords = await forwardGeocode(query)
      return jsonResponse(coords)
    }

    const lat = Number(body.lat)
    const lng = Number(body.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return jsonResponse({ error: 'invalid_request', message: 'lat and lng are required.' }, 400)
    }

    const region = await reverseGeocode(lat, lng)
    return jsonResponse(region)
  } catch (err) {
    console.error('[reverse-geocode]', err)
    const message = err instanceof Error ? err.message : 'Geocode request failed'
    return jsonResponse({ error: 'geocode_failed', message }, 502)
  }
})
