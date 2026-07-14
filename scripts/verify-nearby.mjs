/**
 * Smoke-test the reverse-geocode and ncrdb-course-search edge functions.
 *
 * Usage: node scripts/verify-nearby.mjs
 * Region defaults to Bend, OR; override via GOLO_LAT/GOLO_LNG/GOLO_CITY/GOLO_STATE.
 */

import { extraRegionalSearchTerms } from '../src/lib/nearbyCourses.js'
import { requireSupabaseEnv, invokeEdgeFunction, searchNcrdb, regionFromEnv } from './_shared.mjs'

const env = requireSupabaseEnv()
const region = regionFromEnv()
let failed = false

const rev = await invokeEdgeFunction(env, 'reverse-geocode', { lat: region.lat, lng: region.lng })
if (rev.ok && rev.json?.city) {
  console.log(`✓ reverse-geocode: ${rev.status} ${rev.json.city}, ${rev.json.stateCode || rev.json.state}`)
} else {
  failed = true
  console.error(`✗ reverse-geocode: ${rev.error ?? 'no city in response'} (status ${rev.status})`)
}

const terms = [`${region.city} Golf`, ...extraRegionalSearchTerms(region.city)]
const results = await Promise.all(
  terms.map(async (term) => ({ term, ...(await searchNcrdb(env, { clubName: term, clubCountry: 'USA' })) })),
)
for (const r of results) {
  if (r.ok) {
    console.log(`✓ NCRDB "${r.term}": ${r.status} courses: ${r.hits.length}`)
  } else {
    failed = true
    console.error(`✗ NCRDB "${r.term}": ${r.error} (status ${r.status})`)
  }
}

if (failed) process.exitCode = 1
