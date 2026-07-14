/**
 * End-to-end check of the SetupWizard "MORE NEARBY" pipeline against live
 * NCRDB, using the production query/dedupe logic imported from src/lib so the
 * script always tests what actually ships.
 *
 * Usage: node scripts/verify-nearby-pipeline.mjs
 * Region defaults to Bend, OR; override via GOLO_LAT/GOLO_LNG/GOLO_CITY/GOLO_STATE.
 */

import {
  buildNearbySearchQueries,
  catalogCourseKeys,
  dedupeNcrdbAgainstCatalog,
  ncrdbHitMatchesRegion,
} from '../src/lib/nearbyCourses.js'
import { requireSupabaseEnv, fetchVisibleCourses, searchNcrdb, regionFromEnv } from './_shared.mjs'

const env = requireSupabaseEnv()
const region = regionFromEnv()

const catalog = await fetchVisibleCourses(env)
console.log(
  `catalog: ${catalog.length} visible courses (${catalog.filter((c) => c.ghinCourseId).length} with GHIN id)`,
)

const queries = buildNearbySearchQueries(region, catalog)
console.log(`queries (${queries.length}):`, queries.map((q) => q.clubName).join(' | '))

const t0 = Date.now()
const results = await Promise.all(
  queries.map(async (q) => ({ term: q.clubName, ...(await searchNcrdb(env, q)) })),
)
const elapsedMs = Date.now() - t0

const errors = results.filter((r) => !r.ok)
const empty = results.filter((r) => r.ok && r.hits.length === 0)
console.log(
  `parallel fetch: ${elapsedMs}ms — ${results.length - errors.length} ok (${empty.length} with zero hits), ${errors.length} errored`,
)
for (const r of errors) console.error(`  ✗ "${r.term}": ${r.error} (status ${r.status})`)

const seen = new Set()
const hits = []
for (const r of results) {
  for (const hit of r.hits ?? []) {
    const id = String(hit?.courseID ?? hit?.courseId ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    hits.push(hit)
  }
}

const regional = hits.filter((h) => ncrdbHitMatchesRegion(h, region))
const kept = dedupeNcrdbAgainstCatalog(catalog, regional)
const keys = catalogCourseKeys(catalog)
const blocked = regional.filter((h) => !kept.includes(h))

console.log(
  `unique hits: ${hits.length} — in ${region.stateCode}: ${regional.length} — MORE NEARBY after dedupe: ${kept.length}`,
)
console.log('kept samples:', kept.slice(0, 8).map((h) => h.fullName))
console.log(
  'blocked by catalog:',
  blocked.map((h) => ({
    name: h.fullName,
    id: h.courseID,
    byGhinId: keys.has(`ncrdb:${String(h.courseID ?? '').trim()}`),
  })),
)

if (errors.length > 0) process.exitCode = 1
