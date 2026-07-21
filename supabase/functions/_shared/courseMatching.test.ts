import { assert, assertEquals, assertExists } from 'jsr:@std/assert@1'
import {
  bestCourseMatch,
  cacheIsFresh,
  cardFromGcaTee,
  courseMatchScore,
  GCA_CACHE_TTL_MS,
  GCA_NO_MATCH_TTL_MS,
  matchGcaTee,
  nameSimilarity,
  negativeCacheIsActive,
  normalizeCourseText,
  type CourseHint,
  type GcaCourse,
  type GcaTee,
} from './courseMatching.ts'

/* ---------------------------------------------------------------- fixtures */

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 4, 5, 3, 4, 4, 3, 5]
const SI = [11, 17, 15, 1, 9, 7, 13, 3, 5, 18, 6, 10, 8, 12, 2, 4, 14, 16]

const holes = (baseYards: number, count = 18) =>
  PARS.slice(0, count).map((par, i) => ({ par, handicap: SI[i], yardage: baseYards + i * 3 }))

const tee = (name: string, over: Partial<GcaTee> = {}): GcaTee => ({
  tee_name: name,
  course_rating: 72.1,
  slope_rating: 132,
  total_yards: 6600,
  par_total: 72,
  number_of_holes: 18,
  holes: holes(340),
  ...over,
})

const course = (over: Partial<GcaCourse> = {}): GcaCourse => ({
  id: 1,
  club_name: 'Tetherow Golf Club',
  course_name: 'Tetherow Golf Club',
  location: { city: 'Bend', state: 'Oregon', country: 'United States' },
  tees: { male: [tee('Black')], female: [] },
  ...over,
})

const hint = (over: Partial<CourseHint> = {}): CourseHint => ({
  cacheKey: 'ncrdb-7817',
  name: 'Tetherow Golf Club',
  facility: 'Tetherow Golf Club',
  city: 'Bend',
  state: 'OR',
  ...over,
})

/* ------------------------------------------------------------ text handling */

Deno.test('normalizeCourseText folds punctuation and case', () => {
  assertEquals(normalizeCourseText('Pinehurst  No. 2 '), 'pinehurst no 2')
  assertEquals(normalizeCourseText("St. Andrew's Links"), 'st andrew s links')
  assertEquals(normalizeCourseText(null), '')
})

Deno.test('nameSimilarity ignores golf stop words', () => {
  // "Golf Club" carries no signal — every course has it.
  assertEquals(nameSimilarity('Tetherow Golf Club', 'Tetherow'), 1)
  assertEquals(nameSimilarity('Bandon Dunes Golf Resort', 'Bandon Dunes'), 1)
  assert(nameSimilarity('Tetherow', 'Bandon Dunes') === 0)
  assertEquals(nameSimilarity('', 'Tetherow'), 0)
})

/* ------------------------------------------------------------ course scoring */

Deno.test('courseMatchScore rewards an exact name in the right state', () => {
  const score = courseMatchScore(hint(), course())
  assert(score > 1.5, `expected a confident score, got ${score}`)
})

Deno.test('courseMatchScore penalizes the wrong state', () => {
  const right = courseMatchScore(hint(), course())
  const wrong = courseMatchScore(hint(), course({ location: { city: 'Bend', state: 'Indiana' } }))
  assert(wrong < right - 0.5, `wrong state should cost ~0.8, got ${right} vs ${wrong}`)
})

Deno.test('courseMatchScore treats a state code and a state name alike', () => {
  const byCode = courseMatchScore(hint({ state: 'OR' }), course())
  const byName = courseMatchScore(hint({ state: 'Oregon' }), course())
  assertEquals(byCode, byName)
})

Deno.test('courseMatchScore reads the state out of a bare address', () => {
  const addressOnly = course({ location: { address: '61240 Skyline Ranch Rd, Bend, OR 97702' } })
  const wrongState = course({ location: { address: '1 Main St, Bend, IN 46107' } })
  assert(courseMatchScore(hint(), addressOnly) > courseMatchScore(hint(), wrongState))
})

/* ------------------------------------------------------------- best match */

Deno.test('bestCourseMatch picks the corroborated candidate', () => {
  const best = bestCourseMatch(hint(), [
    course({ id: 9, club_name: 'Bandon Dunes', course_name: 'Bandon Dunes', location: { city: 'Bandon', state: 'Oregon' } }),
    course({ id: 7 }),
  ])
  assertEquals(best?.course.id, 7)
})

Deno.test('bestCourseMatch rejects a weak best candidate', () => {
  const best = bestCourseMatch(hint({ name: 'Tetherow', facility: 'Tetherow' }), [
    course({ id: 9, club_name: 'Bandon Dunes Golf Resort', course_name: 'Pacific Dunes' }),
  ])
  assertEquals(best, null)
})

Deno.test('bestCourseMatch rejects two indistinguishable candidates', () => {
  // A real 36-hole facility: same club, two courses, and the hint names neither.
  const ambiguous = bestCourseMatch(hint({ name: 'Pinehurst Resort', facility: 'Pinehurst Resort', course: '', state: 'NC', city: 'Pinehurst' }), [
    course({ id: 1, club_name: 'Pinehurst Resort', course_name: 'Course No. 4', location: { city: 'Pinehurst', state: 'NC' } }),
    course({ id: 2, club_name: 'Pinehurst Resort', course_name: 'Course No. 8', location: { city: 'Pinehurst', state: 'NC' } }),
  ])
  assertEquals(ambiguous, null)
})

Deno.test('bestCourseMatch resolves a named course at an ambiguous facility', () => {
  const resolved = bestCourseMatch(
    hint({ name: 'Pinehurst Resort - Course No. 2', facility: 'Pinehurst Resort', course: 'Course No. 2', city: 'Pinehurst', state: 'NC' }),
    [
      course({ id: 1, club_name: 'Pinehurst Resort', course_name: 'Course No. 2', location: { city: 'Pinehurst', state: 'NC' } }),
      course({ id: 2, club_name: 'Pinehurst Resort', course_name: 'Course No. 8', location: { city: 'Pinehurst', state: 'NC' } }),
    ],
  )
  assertEquals(resolved?.course.id, 1)
})

Deno.test('bestCourseMatch rejects the right name in the wrong state', () => {
  const best = bestCourseMatch(hint({ state: 'OR' }), [
    course({ id: 5, location: { city: 'Bend', state: 'Indiana' } }),
  ])
  assertEquals(best, null)
})

Deno.test('bestCourseMatch ignores candidates with no usable id', () => {
  const best = bestCourseMatch(hint(), [
    { ...course(), id: undefined as unknown as number },
    course({ id: 4 }),
  ])
  assertEquals(best?.course.id, 4)
})

Deno.test('bestCourseMatch on an empty search yields null', () => {
  assertEquals(bestCourseMatch(hint(), []), null)
})

/* ------------------------------------------------------- hole array validation */

Deno.test('cardFromGcaTee accepts a complete 18-hole tee', () => {
  const card = cardFromGcaTee(tee('Black'))
  assertExists(card)
  assertEquals(Object.keys(card.pars).length, 18)
  assertEquals(card.pars[2], 5)
  assertEquals(card.strokeIndex?.[4], 1)
  assertEquals(card.yardages?.[1], 340)
  assertEquals(card.holes.length, 18)
})

Deno.test('cardFromGcaTee rejects a 9-hole tee for an 18-hole round', () => {
  assertEquals(cardFromGcaTee(tee('Black', { holes: holes(340, 9) })), null)
})

Deno.test('cardFromGcaTee accepts a 9-hole tee when 9 holes are expected', () => {
  const card = cardFromGcaTee(tee('Black', { holes: holes(340, 9) }), 9)
  assertExists(card)
  assertEquals(Object.keys(card.pars).length, 9)
})

Deno.test('cardFromGcaTee rejects a tee with no holes', () => {
  assertEquals(cardFromGcaTee(tee('Black', { holes: [] })), null)
  assertEquals(cardFromGcaTee(tee('Black', { holes: undefined })), null)
})

Deno.test('cardFromGcaTee rejects an incomplete par set', () => {
  const gapped = holes(340).map((hole, i) => (i === 6 ? { ...hole, par: 0 } : hole))
  assertEquals(cardFromGcaTee(tee('Black', { holes: gapped })), null)
})

Deno.test('cardFromGcaTee keeps pars but drops a broken stroke index', () => {
  // Two holes both ranked 7 is not a valid allocation; the pars are still good.
  const duped = holes(340).map((hole, i) => (i === 5 ? { ...hole, handicap: SI[6] } : hole))
  const card = cardFromGcaTee(tee('Black', { holes: duped }))
  assertExists(card)
  assertEquals(Object.keys(card.pars).length, 18)
  assertEquals(card.strokeIndex, undefined)
})

Deno.test('cardFromGcaTee drops partial yardage but keeps the card', () => {
  const partial = holes(340).map((hole, i) => (i === 2 ? { ...hole, yardage: 0 } : hole))
  const card = cardFromGcaTee(tee('Black', { holes: partial }))
  assertExists(card)
  assertEquals(card.yardages, undefined)
  assertEquals(Object.keys(card.pars).length, 18)
})

/* ------------------------------------------------------------- tee matching */

Deno.test('matchGcaTee takes an exact tee name', () => {
  const matched = matchGcaTee({ name: 'Black', gender: 'M' }, course({
    tees: { male: [tee('Sage', { total_yards: 5960 }), tee('Black')] },
  }))
  assertEquals(matched?.tee.tee_name, 'Black')
})

Deno.test('matchGcaTee corroborates a renamed tee by course rating', () => {
  const matched = matchGcaTee(
    { name: 'Championship', gender: 'M', courseRating: 73.7, yards: null },
    course({ tees: { male: [tee('Sage', { course_rating: 69.2 }), tee('Tips', { course_rating: 73.7 })] } }),
  )
  assertEquals(matched?.tee.tee_name, 'Tips')
})

Deno.test('matchGcaTee corroborates a renamed tee by total yardage', () => {
  const matched = matchGcaTee(
    { name: 'Championship', gender: 'M', courseRating: null, yards: 6930 },
    course({ tees: { male: [tee('Sage', { total_yards: 5960 }), tee('Tips', { total_yards: 6933 })] } }),
  )
  assertEquals(matched?.tee.tee_name, 'Tips')
})

Deno.test('matchGcaTee refuses a single weak signal', () => {
  // 380 yards apart is within the loose band but corroborates nothing else —
  // taking it would attach another tee's card to this round.
  const matched = matchGcaTee(
    { name: 'Championship', gender: 'M', courseRating: null, yards: 6220 },
    course({ tees: { male: [tee('Sage', { course_rating: 69.2, total_yards: 6600 })] } }),
  )
  assertEquals(matched, null)
})

Deno.test('matchGcaTee ignores tees with an unusable hole array', () => {
  const matched = matchGcaTee({ name: 'Black', gender: 'M' }, course({
    tees: { male: [tee('Black', { holes: holes(340, 9) })] },
  }))
  assertEquals(matched, null)
})

Deno.test('matchGcaTee reads the female pool for a female tee', () => {
  const matched = matchGcaTee({ name: 'Red', gender: 'F' }, course({
    tees: { male: [tee('Black')], female: [tee('Red', { total_yards: 5210 })] },
  }))
  assertEquals(matched?.tee.tee_name, 'Red')
})

Deno.test('matchGcaTee treats an absent gender as male', () => {
  const matched = matchGcaTee({ name: 'Black' }, course())
  assertEquals(matched?.tee.tee_name, 'Black')
})

Deno.test('matchGcaTee on an empty pool yields null', () => {
  assertEquals(matchGcaTee({ name: 'Black', gender: 'M' }, course({ tees: { male: [] } })), null)
})

/* -------------------------------------------------------------- cache windows */

Deno.test('cacheIsFresh holds for 30 days', () => {
  const now = Date.parse('2026-07-20T00:00:00Z')
  assert(cacheIsFresh(new Date(now - 1000).toISOString(), now))
  assert(cacheIsFresh(new Date(now - GCA_CACHE_TTL_MS + 60_000).toISOString(), now))
  assert(!cacheIsFresh(new Date(now - GCA_CACHE_TTL_MS - 60_000).toISOString(), now))
})

Deno.test('cacheIsFresh rejects an unparseable timestamp', () => {
  assert(!cacheIsFresh('not-a-date', Date.now()))
})

Deno.test('negativeCacheIsActive holds until retry_after passes', () => {
  const now = Date.parse('2026-07-20T00:00:00Z')
  assert(negativeCacheIsActive(new Date(now + GCA_NO_MATCH_TTL_MS).toISOString(), now))
  assert(!negativeCacheIsActive(new Date(now - 1000).toISOString(), now))
  assert(!negativeCacheIsActive(null, now))
})
