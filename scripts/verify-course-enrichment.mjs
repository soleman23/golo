/**
 * verify-course-enrichment.mjs — production smoke test for course enrichment.
 *
 * Exercises the deployed edge functions end to end: an NCRDB import must come
 * back with a real card (varying pars, a valid 1-18 stroke index, per-tee
 * yardage), the second call must be served from cache, and a course we cannot
 * confidently identify must fail open rather than attach a different course.
 *
 * Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (.env.local or env).
 * Override the course under test with GOLO_NCRDB_ID and GOLO_NCRDB_NAME.
 */
import { requireSupabaseEnv, invokeEdgeFunction, searchNcrdb } from './_shared.mjs'

const env = requireSupabaseEnv()
const NCRDB_ID = String(process.env.GOLO_NCRDB_ID ?? '7817')
const NCRDB_NAME = process.env.GOLO_NCRDB_NAME ?? 'Pebble Beach'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    passed += 1
    console.log('  ok  ', msg)
    return
  }
  failed += 1
  console.error('  FAIL', msg)
}

const value = (row, ...keys) => {
  for (const key of keys) {
    const v = row?.[key]
    if (v != null && String(v).trim()) return v
  }
  return ''
}

/** The descriptor SetupWizard sends with a tee request. */
function descriptorFor(hit) {
  return {
    name: String(value(hit, 'fullName', 'courseName', 'clubName', 'name')).trim(),
    facility: String(value(hit, 'facilityName', 'clubName', 'FacilityName')),
    course: String(value(hit, 'courseName', 'CourseName')),
    city: String(value(hit, 'city', 'clubCity', 'City')),
    state: String(value(hit, 'stateDisplay', 'state', 'clubState', 'State')),
  }
}

const isPermutation = (values, n) =>
  values.length === n &&
  values.every((v) => Number.isInteger(v) && v >= 1 && v <= n) &&
  new Set(values).size === n

const holeValues = (tee, key) =>
  (tee?.holes ?? []).map((hole) => hole?.[key]).filter((v) => v != null)

/* ------------------------------------------------------- 1. NCRDB enrichment */

console.log(`\nNCRDB import — ${NCRDB_NAME} (courseID ${NCRDB_ID})`)

const search = await searchNcrdb(env, { clubName: NCRDB_NAME, clubCountry: 'USA' })
if (!search.ok) {
  console.error(`NCRDB search failed: ${search.error}`)
  process.exit(1)
}
const hit =
  (search.hits ?? []).find((row) => String(value(row, 'courseID', 'courseId', 'CourseID')) === NCRDB_ID) ??
  (search.hits ?? [])[0]
if (!hit) {
  console.error(`No NCRDB hit for "${NCRDB_NAME}".`)
  process.exit(1)
}

const courseId = Number(value(hit, 'courseID', 'courseId', 'CourseID'))
const descriptor = descriptorFor(hit)
console.log(`  using ${descriptor.name} — ${descriptor.city}, ${descriptor.state} (courseID ${courseId})`)

const first = await invokeEdgeFunction(env, 'ncrdb-course-search', { action: 'tees', courseId, course: descriptor }, { timeoutMs: 30_000 })
assert(first.ok, `tees request succeeded${first.ok ? '' : ` — ${first.error}`}`)

const tees = first.json?.tees ?? []
const enrichment = first.json?.enrichment ?? {}
assert(tees.length > 0, 'NCRDB returned tee rows')
assert(
  tees.every((tee) => tee.courseRating != null && tee.slope != null),
  'NCRDB rating and slope survived enrichment',
)
assert(enrichment.matched === true, `GolfCourseAPI matched the course${enrichment.matched ? '' : ` — reason: ${enrichment.reason}`}`)

const enriched = tees.find((tee) => tee.holes?.length === 18)
assert(!!enriched, 'at least one tee carries an 18-hole card')

if (enriched) {
  const pars = holeValues(enriched, 'par')
  const strokeIndex = holeValues(enriched, 'strokeIndex')
  const yardages = holeValues(enriched, 'yardage')

  assert(pars.length === 18, 'the card has all 18 pars')
  assert(new Set(pars).size > 1, `pars vary rather than all being 4 (${[...new Set(pars)].sort().join('/')})`)
  assert(pars.every((par) => par >= 3 && par <= 6), 'every par is between 3 and 6')
  assert(isPermutation(strokeIndex, 18), 'stroke index is a valid 1-18 permutation')
  assert(yardages.length === 18, 'the card has all 18 yardages')
  assert(yardages.every((y) => y > 50 && y < 800), 'yardages are plausible')
  console.log(`  card: pars ${pars.slice(0, 9).join(' ')} | ${pars.slice(9).join(' ')}`)
  console.log(`  tee "${enriched.name}" ${enriched.yards}y — holes ${yardages[0]}y … ${yardages[17]}y`)
}

/* ------------------------------------------------------------- 2. cache hit */

console.log('\nCache')
const second = await invokeEdgeFunction(env, 'ncrdb-course-search', { action: 'tees', courseId, course: descriptor }, { timeoutMs: 30_000 })
assert(second.ok, 'repeat tees request succeeded')
assert(second.json?.enrichment?.cached === true, 'the repeat request was served from cache — no provider quota used')

/* ------------------------------------------------- 3. fail open, never wrong */

console.log('\nFailing open')

// Fixed cache keys, so repeat runs overwrite these two rows instead of leaving
// a new one behind each time. After the first run these are served from the
// negative cache, which is the behaviour we want anyway — the matcher rules
// themselves are covered by the Deno tests.

// The right club name in the wrong state must not resolve. Same-name clubs in
// different states are the most likely way to attach a stranger's scorecard.
const wrongState = await invokeEdgeFunction(env, 'golfcourseapi-holes', {
  action: 'holes',
  courseId: 'smoke-wrong-state',
  courseName: 'Tetherow Golf Club',
  facility: 'Tetherow Golf Club',
  city: 'Bend',
  state: 'IN',
}, { timeoutMs: 30_000 })
assert(wrongState.ok, 'wrong-state request returned cleanly rather than erroring')
assert(wrongState.json?.matched === false, `a wrong-state course did not match (reason: ${wrongState.json?.reason})`)
assert(wrongState.json?.tees == null, 'no tee data was attached from another course')

const nonsense = await invokeEdgeFunction(env, 'golfcourseapi-holes', {
  action: 'holes',
  courseId: 'smoke-nonsense',
  courseName: 'Zzyzx Phantom Links Xyzzy',
  facility: 'Zzyzx Phantom Links Xyzzy',
  city: 'Nowhere',
  state: 'OR',
}, { timeoutMs: 30_000 })
assert(nonsense.ok, 'unknown-course request returned cleanly')
assert(nonsense.json?.matched === false, 'an unknown course did not match')

/* ------------------------------------------- 4. bundled courses still resolve */

console.log('\nBundled courses')
for (const [id, name, city] of [['tetherow', 'Tetherow', 'Bend'], ['losttracks', 'Lost Tracks Golf Course', 'Bend']]) {
  const res = await invokeEdgeFunction(env, 'golfcourseapi-holes', {
    action: 'holes', courseId: id, courseName: name, facility: name, city, state: 'OR',
  }, { timeoutMs: 30_000 })
  assert(res.ok, `${name} lookup returned cleanly${res.ok ? '' : ` — ${res.error}`}`)
  if (res.json?.matched) {
    const male = res.json?.tees?.male ?? []
    const full = male.filter((tee) => tee.holes?.length === 18)
    assert(full.length > 0, `${name} matched with 18-hole tee data`)
    console.log(`    ${name}: matched "${res.json.courseName}" — ${full.length}/${male.length} men's tees with full cards`)
  } else {
    // Not a failure: these courses ship their own verified card, so a provider
    // miss only means no yardage. The bundled pars are what the round uses.
    console.log(`    ${name}: no provider match (${res.json?.reason}) — bundled card still applies`)
  }
}

/* ------------------------------------------------------------------ results */

console.log(`\nverify-course-enrichment: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
