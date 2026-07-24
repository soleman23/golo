/**
 * Course and tee matching against GolfCourseAPI payloads.
 *
 * Pure scoring and validation — no network, no database, no npm dependencies —
 * so the whole matcher is testable in isolation. The provider access and cache
 * live in ./golfCourseApi.ts.
 *
 * The bar for accepting a match is deliberately high. Par and stroke index
 * drive handicap strokes and settle every game, so attaching a nearby course's
 * card to a round is worse than attaching nothing: a missing card is visible,
 * a wrong one is not.
 */

export const GCA_CACHE_VERSION = 2
export const GCA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const GCA_NO_MATCH_TTL_MS = 24 * 60 * 60 * 1000

export const MIN_COURSE_SCORE = 0.65
export const MIN_AMBIGUITY_GAP = 0.12
// A tee needs more than one weak signal. Exact name (3), rating within 0.2 (2),
// or yardage within 100 (2) each clear this alone; a lone substring-name or
// within-400-yards hit does not, because either can land on the wrong tee.
export const MIN_TEE_SCORE = 2

export type CourseHint = {
  cacheKey: string
  name?: string
  facility?: string
  course?: string
  city?: string
  state?: string
}

/** The tee shape scraped from NCRDB — the authoritative rating/slope/tee-id row. */
export type NcrdbTee = {
  name?: string
  gender?: string
  courseRating?: number | null
  slope?: number | null
  yards?: number | null
  par?: number | null
  teeId?: number | null
  [key: string]: unknown
}

export type GcaHole = {
  par?: number
  yardage?: number
  handicap?: number
}

export type GcaTee = {
  tee_name?: string
  course_rating?: number
  slope_rating?: number
  total_yards?: number
  par_total?: number
  number_of_holes?: number
  holes?: GcaHole[]
}

export type GcaCourse = {
  id: number
  club_name?: string
  course_name?: string
  location?: {
    address?: string
    city?: string
    state?: string
    country?: string
    latitude?: number
    longitude?: number
  }
  tees?: {
    male?: GcaTee[]
    female?: GcaTee[]
  }
}

// Words every other course shares. Left in, "Golf Club" would make any two
// clubs in a state look alike.
const STOP_WORDS = new Set([
  'a',
  'and',
  'at',
  'club',
  'country',
  'course',
  'gc',
  'gcc',
  'gl',
  'golf',
  'links',
  'national',
  'no',
  'of',
  'resort',
  'the',
])

const STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
}

export const normalizeCourseText = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function stateCode(value: unknown) {
  const normalized = normalizeCourseText(value)
  if (/^[a-z]{2}$/.test(normalized)) return normalized.toUpperCase()
  return STATE_CODES[normalized] ?? ''
}

function candidateState(course: GcaCourse) {
  const explicit = stateCode(course.location?.state)
  if (explicit) return explicit
  const address = String(course.location?.address ?? '')
  const match = address.match(/,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?(?:,|$)/i)
  return match?.[1]?.toUpperCase() ?? ''
}

function nameTokens(value: unknown) {
  return normalizeCourseText(value)
    .split(' ')
    .filter((token) => token && !STOP_WORDS.has(token) && !/^\d+$/.test(token))
}

/**
 * The distinctive part of a course name, with the words every club shares
 * removed. "Lost Tracks Golf Course" -> "lost tracks".
 */
export function distinctiveName(value: unknown) {
  return nameTokens(value).join(' ')
}

/** Jaccard overlap of significant name tokens, 0..1. */
export function nameSimilarity(a: unknown, b: unknown) {
  const left = new Set(nameTokens(a))
  const right = new Set(nameTokens(b))
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const token of left) {
    if (right.has(token)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function hintNames(hint: CourseHint) {
  const full = String(hint.name ?? '').trim()
  const stem = full.split(/\s+-\s+/)[0]?.trim()
  return [...new Set([
    full,
    stem,
    String(hint.facility ?? '').trim(),
    String(hint.course ?? '').trim(),
  ].filter(Boolean))]
}

export function courseMatchScore(hint: CourseHint, candidate: GcaCourse) {
  const variants = hintNames(hint)
  const candidateNames = [
    candidate.club_name,
    candidate.course_name,
    `${candidate.club_name ?? ''} ${candidate.course_name ?? ''}`,
  ].filter(Boolean)
  if (!variants.length || !candidateNames.length) return Number.NEGATIVE_INFINITY

  let score = Math.max(
    ...variants.flatMap((variant) => candidateNames.map((name) => nameSimilarity(variant, name))),
  )

  const normalizedVariants = new Set(variants.map(normalizeCourseText))
  if (candidateNames.some((name) => normalizedVariants.has(normalizeCourseText(name)))) score += 0.35

  // At a multi-course facility the club name matches everything, so the course
  // name is what separates No. 2 from No. 8.
  const hintCourse = normalizeCourseText(hint.course)
  const candidateCourse = normalizeCourseText(candidate.course_name)
  if (hintCourse && candidateCourse) {
    if (hintCourse === candidateCourse) score += 0.2
    else if (nameSimilarity(hintCourse, candidateCourse) < 0.34) score -= 0.15
  }

  // A wrong state disqualifies outright. "Lakewood Country Club" exists in a
  // dozen states, and the hint's state comes from NCRDB, which is authoritative
  // — so a conflict means this is a different club with the same name, however
  // well the name scores.
  const expectedState = stateCode(hint.state)
  const actualState = candidateState(candidate)
  if (expectedState && actualState) {
    if (expectedState !== actualState) return Number.NEGATIVE_INFINITY
    score += 0.3
  }

  const expectedCity = normalizeCourseText(hint.city)
  const actualCity = normalizeCourseText(candidate.location?.city)
  if (expectedCity && actualCity) score += expectedCity === actualCity ? 0.1 : -0.05

  return score
}

/**
 * Best candidate, or null when nothing clears the bar or two candidates are
 * too close to tell apart. A tie at a 36-hole resort means we genuinely do not
 * know which course was booked.
 */
export function bestCourseMatch(hint: CourseHint, candidates: GcaCourse[]) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => Number.isInteger(Number(candidate?.id)))
    .map((course) => ({ course, score: courseMatchScore(hint, course) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < MIN_COURSE_SCORE) return null
  // Two candidates too close to separate means we do not know which course was
  // played. At a 36-hole resort every course shares the club name, so this is
  // the normal case there, not an edge case — and the absolute score is high
  // for all of them, which is exactly why the gap is what has to decide.
  const second = ranked[1]
  if (second && best.score - second.score < MIN_AMBIGUITY_GAP) return null
  return best
}

/** `ttlMs` defaults to the scorecard window; photo caching passes its own. */
export function cacheIsFresh(fetchedAt: string, nowMs = Date.now(), ttlMs = GCA_CACHE_TTL_MS) {
  const fetchedMs = new Date(fetchedAt).getTime()
  return Number.isFinite(fetchedMs) && nowMs - fetchedMs <= ttlMs
}

export function negativeCacheIsActive(retryAfter: string | null, nowMs = Date.now()) {
  if (!retryAfter) return false
  const retryMs = new Date(retryAfter).getTime()
  return Number.isFinite(retryMs) && retryMs > nowMs
}

const validPar = (value: number) => Number.isInteger(value) && value >= 3 && value <= 6
const validStrokeIndex = (value: number) => Number.isInteger(value) && value >= 1 && value <= 18
const validYardage = (value: number) => Number.isFinite(value) && value > 0 && value < 1000

/**
 * Card for one provider tee, or null. Pars must be complete — a partial card is
 * no card. Stroke index and yardage are dropped independently when incomplete,
 * since a usable par card is still worth having without them.
 */
export function cardFromGcaTee(tee: GcaTee, expectedHoles = 18) {
  const raw = Array.isArray(tee?.holes) ? tee.holes : []
  if (raw.length !== expectedHoles) return null

  const pars: Record<number, number> = {}
  const strokeIndex: Record<number, number> = {}
  const yardages: Record<number, number> = {}
  const holes = raw.map((row, index) => {
    const hole = index + 1
    const par = Number(row?.par)
    const handicap = Number(row?.handicap)
    const yardage = Number(row?.yardage)
    if (validPar(par)) pars[hole] = par
    if (validStrokeIndex(handicap)) strokeIndex[hole] = handicap
    if (validYardage(yardage)) yardages[hole] = yardage
    return {
      hole,
      ...(validPar(par) ? { par } : {}),
      ...(validStrokeIndex(handicap) ? { strokeIndex: handicap } : {}),
      ...(validYardage(yardage) ? { yardage } : {}),
    }
  })

  if (Object.keys(pars).length !== expectedHoles) return null
  // A stroke index that repeats a rank is not an allocation — drop the whole map.
  const completeStrokeIndex =
    Object.keys(strokeIndex).length === expectedHoles &&
    new Set(Object.values(strokeIndex)).size === expectedHoles
  const completeYardages = Object.keys(yardages).length === expectedHoles

  return {
    holes,
    pars,
    ...(completeStrokeIndex ? { strokeIndex } : {}),
    ...(completeYardages ? { yardages } : {}),
  }
}

function femaleGender(value: unknown) {
  const gender = normalizeCourseText(value)
  return gender === 'f' || gender.startsWith('female') || gender.startsWith('women') || gender.startsWith('lad')
}

/**
 * Pair an NCRDB tee with the provider tee that carries its hole data. Scores
 * name, rating, and yardage; anything short of MIN_TEE_SCORE is treated as no
 * match, because tee names differ between sources far more often than ratings do.
 */
export function matchGcaTee(
  ncrdbTee: NcrdbTee,
  course: GcaCourse,
  expectedHoles = 18,
) {
  const pool = femaleGender(ncrdbTee.gender) ? course.tees?.female ?? [] : course.tees?.male ?? []
  let best: { tee: GcaTee; score: number } | null = null
  for (const tee of pool) {
    if (!cardFromGcaTee(tee, expectedHoles)) continue
    let score = 0
    const teeName = normalizeCourseText(tee.tee_name)
    const ncrdbName = normalizeCourseText(ncrdbTee.name)
    if (teeName && ncrdbName && teeName === ncrdbName) score += 3
    else if (teeName && ncrdbName && (teeName.includes(ncrdbName) || ncrdbName.includes(teeName))) score += 1

    const ratingDiff = Math.abs(Number(tee.course_rating) - Number(ncrdbTee.courseRating))
    if (Number.isFinite(ratingDiff)) score += ratingDiff <= 0.2 ? 2 : ratingDiff <= 0.6 ? 1 : 0

    const yardDiff = Math.abs(Number(tee.total_yards) - Number(ncrdbTee.yards))
    if (Number.isFinite(yardDiff)) score += yardDiff <= 100 ? 2 : yardDiff <= 400 ? 1 : 0

    if (!best || score > best.score) best = { tee, score }
  }
  return best && best.score >= MIN_TEE_SCORE ? best : null
}
