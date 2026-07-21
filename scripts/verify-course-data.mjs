/**
 * verify-course-data.mjs — QA assertions for course import and card conversion.
 *
 * Covers the client half of the enrichment path: NCRDB course conversion,
 * hole-map normalization, selected-tee yardage, and the rule that an
 * uncorroborated tee must yield nothing rather than a plausible-looking guess.
 */
import {
  courseFromNcrdb,
  normalizeHoleRows,
  normalizeCourseForSave,
  scorecardFromNcrdbTees,
} from '../src/lib/courseValidation.js'
import {
  getHolesForTee,
  holeCardFromCourseTee,
  holeCardFromTees,
  locationHint,
  yardageMapFromCourseTee,
  yardageMapFromTees,
} from '../src/lib/scorecardData.js'

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    passed += 1
    return
  }
  failed += 1
  console.error('FAIL:', msg)
}

/* ------------------------------------------------------------------ fixtures */

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 4, 5, 3, 4, 4, 3, 5]
const SI = [11, 17, 15, 1, 9, 7, 13, 3, 5, 18, 6, 10, 8, 12, 2, 4, 14, 16]

/** An 18-row provider hole array, the shape GolfCourseAPI returns. */
const providerHoles = (baseYards) =>
  PARS.map((par, i) => ({ par, handicap: SI[i], yardage: baseYards + i * 3 }))

/** The enriched tee shape the resolver attaches to an NCRDB tee row. */
const enrichedNcrdbTee = (name, { gender = 'M', rating, slope, yards, teeId } = {}) => ({
  name,
  gender,
  courseRating: rating,
  slope,
  par: 72,
  yards,
  teeId,
  holes: PARS.map((par, i) => ({ hole: i + 1, par, strokeIndex: SI[i], yardage: 300 + i * 3 })),
})

const teesData = {
  male: [
    { tee_name: 'Black', total_yards: 6933, holes: providerHoles(340) },
    { tee_name: 'Tan', total_yards: 6485, holes: providerHoles(320) },
    { tee_name: 'Sage', total_yards: 5960, holes: providerHoles(290) },
  ],
  female: [{ tee_name: 'Red', total_yards: 5210, holes: providerHoles(250) }],
}

/* ------------------------------------------------- normalizeHoleRows: 9 vs 18 */

assert(normalizeHoleRows(providerHoles(300))?.length === 18, 'normalizeHoleRows accepts a complete 18-hole array')
assert(normalizeHoleRows(providerHoles(300).slice(0, 9))?.length === 9, 'normalizeHoleRows accepts a complete 9-hole array')
assert(normalizeHoleRows(providerHoles(300).slice(0, 17)) === null, 'normalizeHoleRows rejects a 17-hole array')
assert(normalizeHoleRows(providerHoles(300).slice(0, 12)) === null, 'normalizeHoleRows rejects a 12-hole array')
assert(normalizeHoleRows([]) === null, 'normalizeHoleRows rejects an empty array')
assert(normalizeHoleRows(null) === null, 'normalizeHoleRows rejects null')

// A hole with an invalid par drops out, which breaks completeness — the whole
// card is rejected rather than silently coming back short.
const withBadPar = providerHoles(300).map((row, i) => (i === 4 ? { ...row, par: 9 } : row))
assert(normalizeHoleRows(withBadPar) === null, 'normalizeHoleRows rejects a card containing an out-of-range par')

const withDuplicateHole = providerHoles(300).map((row, i) => ({ ...row, hole: i === 3 ? 3 : i + 1 }))
assert(normalizeHoleRows(withDuplicateHole) === null, 'normalizeHoleRows rejects duplicate hole numbers')

// Stroke index and yardage are optional per hole; par is not.
const noYardage = PARS.map((par, i) => ({ hole: i + 1, par, strokeIndex: SI[i] }))
const normalizedNoYardage = normalizeHoleRows(noYardage)
assert(normalizedNoYardage?.length === 18, 'normalizeHoleRows accepts holes without yardage')
assert(normalizedNoYardage?.every((row) => row.yardage === undefined), 'holes without yardage carry no yardage key')

const absurdYardage = providerHoles(300).map((row, i) => (i === 0 ? { ...row, yardage: 4200 } : row))
assert(normalizeHoleRows(absurdYardage)?.[0]?.yardage === undefined, 'normalizeHoleRows drops an implausible yardage but keeps the hole')

/* ------------------------------------------------------- tee matching by name */

assert(getHolesForTee(teesData, 'Black')?.length === 18, 'exact tee name matches')
assert(getHolesForTee(teesData, 'black')?.length === 18, 'tee name match is case-insensitive')
assert(getHolesForTee(teesData, 'Red', 'female')?.length === 18, 'female pool is used when asked for')
assert(getHolesForTee(null, 'Black') === null, 'no tee data yields null')
assert(getHolesForTee({ male: [] }, 'Black') === null, 'an empty tee list yields null')

// Nothing corroborates "Championship" here: no name overlap, and no yardage
// hint was given. Guessing the first or longest tee is exactly the old bug.
assert(getHolesForTee(teesData, 'Championship') === null, 'an unmatched tee name with no yardage hint yields null')
assert(
  getHolesForTee(teesData, 'Championship', 'male', 6950)?.[0]?.yardage === 340,
  'a yardage hint resolves an unmatched name to the closest tee',
)
assert(
  getHolesForTee(teesData, 'Championship', 'male', 4000) === null,
  'a yardage hint more than 400 yards off matches nothing',
)

/* -------------------------------------------------------------- card building */

const blackCard = holeCardFromTees(teesData, 'Black')
assert(blackCard?.pars[1] === 4 && blackCard?.pars[2] === 5, 'card carries per-hole pars')
assert(Object.keys(blackCard?.pars ?? {}).length === 18, 'card covers all 18 pars')
assert(blackCard?.strokeIndex[4] === 1, 'card carries the provider stroke index')
assert(new Set(Object.values(blackCard?.strokeIndex ?? {})).size === 18, 'stroke index is a full 1-18 permutation')
assert(blackCard?.yardages[1] === 340 && blackCard?.yardages[18] === 340 + 17 * 3, 'card carries per-hole yardage')
assert(holeCardFromTees(teesData, 'Championship') === null, 'no matched tee yields no card')

// Pars must vary — an all-par-4 card is the synthetic fallback, not real data.
assert(new Set(Object.values(blackCard?.pars ?? {})).size > 1, 'a real card has varying pars, not all par 4s')

/* ------------------------------------------------------------ yardage selection */

const tanYardage = yardageMapFromTees(teesData, 'Tan')
assert(tanYardage?.[1] === 320, 'yardageMapFromTees resolves the selected tee')
assert(Object.keys(tanYardage ?? {}).length === 18, 'yardage map covers all 18 holes')
assert(yardageMapFromTees(teesData, 'Championship') === null, 'yardageMapFromTees returns null without a match')
assert(
  yardageMapFromTees({ male: [{ tee_name: 'Black', holes: noYardage }] }, 'Black') === null,
  'a tee with no yardage data yields no yardage map',
)

const courseTee = enrichedNcrdbTee('Black', { rating: 73.7, slope: 145, yards: 6933, teeId: 91 })
assert(yardageMapFromCourseTee(courseTee)?.[1] === 300, 'yardageMapFromCourseTee reads validated tee holes')
assert(yardageMapFromCourseTee({ name: 'Black' }) === null, 'a tee without holes yields no yardage map')
assert(holeCardFromCourseTee(courseTee)?.pars[2] === 5, 'holeCardFromCourseTee reads validated tee holes')

/* --------------------------------------------------------- courseFromNcrdb */

const ncrdbCourse = { fullName: 'Tetherow Golf Club', city: 'Bend', stateDisplay: 'OR', facilityID: 1234, courseID: 7817 }
const ncrdbTees = [
  enrichedNcrdbTee('Black', { rating: 73.7, slope: 145, yards: 6933, teeId: 91 }),
  enrichedNcrdbTee('Tan', { rating: 71.4, slope: 139, yards: 6485, teeId: 92 }),
  enrichedNcrdbTee('Red', { gender: 'F', rating: 70.1, slope: 128, yards: 5210, teeId: 93 }),
]
const imported = courseFromNcrdb(ncrdbCourse, ncrdbTees)

assert(imported.name === 'Tetherow Golf Club', 'imported course keeps its name')
assert(imported.loc === 'Bend, OR', 'imported course builds "city, state"')
assert(imported.ghinCourseId === '7817' && imported.ghinFacilityId === '1234', 'imported course keeps NCRDB ids as strings')
assert(imported.tees.length === 2, "women's tees are filtered out")
assert(imported.tees.every((tee) => tee.holes?.length === 18), 'validated holes[] survive conversion')
assert(imported.tees[0].rating === 73.7 && imported.tees[0].slope === 145, 'NCRDB rating/slope are preserved')
assert(imported.ghinTeeSets.Black === '91', 'tee ids are mapped by tee name')
assert(imported.ghinTeeSets.Red === undefined, "women's tee ids are not mapped")
assert(imported.pars?.[2] === 5 && imported.pars?.[3] === 3, 'shared pars are derived from the enriched tees')
assert(imported.strokeIndex?.[4] === 1, 'shared stroke index is derived from the enriched tees')
assert(new Set(Object.values(imported.strokeIndex ?? {})).size === 18, 'derived stroke index is a full permutation')

// The fallback: NCRDB rows with no enrichment must not fabricate a card.
const bare = courseFromNcrdb(ncrdbCourse, [
  { name: 'Black', gender: 'M', courseRating: 73.7, slope: 145, par: 72, yards: 6933, teeId: 91 },
])
assert(bare.tees.length === 1, 'an unenriched tee still imports for rating/slope')
assert(bare.tees[0].holes === undefined, 'an unenriched tee carries no holes[]')
assert(bare.pars === undefined, 'an unenriched import derives no pars — no synthetic par 4s')
assert(bare.strokeIndex === undefined, 'an unenriched import derives no stroke index')
assert(yardageMapFromCourseTee(bare.tees[0]) === null, 'an unenriched tee yields no yardage')

// A partial card is not a card.
const partial = courseFromNcrdb(ncrdbCourse, [
  { ...enrichedNcrdbTee('Black', { rating: 73.7, yards: 6933 }), holes: providerHoles(300).slice(0, 14) },
])
assert(partial.pars === undefined, 'a partial hole array derives no pars')
assert(partial.tees[0].holes === undefined, 'a partial hole array is dropped from the tee')

assert(scorecardFromNcrdbTees([]).pars === undefined, 'no tees derives no scorecard')

/* ----------------------------------------------------------- save normalization */

const saved = normalizeCourseForSave({
  id: '', name: 'Tetherow Golf Club', loc: 'Bend, OR',
  pars: imported.pars, strokeIndex: imported.strokeIndex, tees: imported.tees,
})
assert(saved.id === 'tetherow-golf-club', 'a missing id is slugified from the name')
assert(saved.tees[0].holes?.length === 18, 'normalizeCourseForSave preserves validated holes[]')
assert(saved.tees[0].holes[0].yardage === 300, 'preserved holes keep their yardage')
assert(saved.pars[1] === 4 && Object.keys(saved.pars).length === 18, 'normalizeCourseForSave keeps the full par map')

/* ------------------------------------------------------------- location hints */

assert(locationHint('Bend, OR').city === 'Bend', 'locationHint reads the city')
assert(locationHint('Bend, OR').state === 'OR', 'locationHint reads the state')
assert(locationHint('Pawleys Island, SC').city === 'Pawleys Island', 'locationHint handles multi-word cities')
assert(locationHint('Bend').city === '', 'a bare city yields no hint rather than a wrong one')
assert(locationHint('').state === '', 'an empty location yields no hint')

/* ------------------------------------------------------------------- results */

console.log(`verify-course-data: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
