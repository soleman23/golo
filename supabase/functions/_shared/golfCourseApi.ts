import { createClient } from 'jsr:@supabase/supabase-js@2'

export const GCA_CACHE_VERSION = 2
export const GCA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const GCA_NO_MATCH_TTL_MS = 24 * 60 * 60 * 1000

const GCA_BASE = 'https://api.golfcourseapi.com/v1'
const GCA_TIMEOUT_MS = 10_000
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

export type GcaResolution =
  | {
      matched: true
      course: GcaCourse
      matchScore: number
      cached: boolean
    }
  | {
      matched: false
      reason: string
      cached: boolean
    }

type CacheRow = {
  course_id: string
  gcapi_id: number | null
  gcapi_name: string | null
  holes_data: GcaCourse['tees'] | null
  fetched_at: string
  payload_version: number
  match_status: 'matched' | 'no_match'
  match_score: number | null
  provider_meta: Omit<GcaCourse, 'tees'> | null
  retry_after: string | null
}

type AdminClient = ReturnType<typeof createClient>

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

  const hintCourse = normalizeCourseText(hint.course)
  const candidateCourse = normalizeCourseText(candidate.course_name)
  if (hintCourse && candidateCourse) {
    if (hintCourse === candidateCourse) score += 0.2
    else if (nameSimilarity(hintCourse, candidateCourse) < 0.34) score -= 0.15
  }

  const expectedState = stateCode(hint.state)
  const actualState = candidateState(candidate)
  if (expectedState && actualState) score += expectedState === actualState ? 0.3 : -0.5

  const expectedCity = normalizeCourseText(hint.city)
  const actualCity = normalizeCourseText(candidate.location?.city)
  if (expectedCity && actualCity) score += expectedCity === actualCity ? 0.1 : -0.05

  return score
}

export function bestCourseMatch(hint: CourseHint, candidates: GcaCourse[]) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => Number.isInteger(Number(candidate?.id)))
    .map((course) => ({ course, score: courseMatchScore(hint, course) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < MIN_COURSE_SCORE) return null
  const second = ranked[1]
  if (second && best.score < 1.15 && best.score - second.score < MIN_AMBIGUITY_GAP) return null
  return best
}

export function cacheIsFresh(fetchedAt: string, nowMs = Date.now()) {
  const fetchedMs = new Date(fetchedAt).getTime()
  return Number.isFinite(fetchedMs) && nowMs - fetchedMs <= GCA_CACHE_TTL_MS
}

export function negativeCacheIsActive(retryAfter: string | null, nowMs = Date.now()) {
  if (!retryAfter) return false
  const retryMs = new Date(retryAfter).getTime()
  return Number.isFinite(retryMs) && retryMs > nowMs
}

const validPar = (value: number) => Number.isInteger(value) && value >= 3 && value <= 6
const validStrokeIndex = (value: number) => Number.isInteger(value) && value >= 1 && value <= 18
const validYardage = (value: number) => Number.isFinite(value) && value > 0 && value < 1000

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

export function createGolfCourseAdminClient(): AdminClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null
}

class GcaRequestError extends Error {
  status: number

  constructor(status: number) {
    super(status === 429 ? 'gca_rate_limited' : `gca_http_${status}`)
    this.status = status
  }
}

async function gcaFetch(path: string, apiKey: string) {
  const response = await fetch(`${GCA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(GCA_TIMEOUT_MS),
  })
  if (!response.ok) throw new GcaRequestError(response.status)
  return response.json()
}

async function readCache(admin: AdminClient | null, cacheKey: string): Promise<CacheRow | null> {
  if (!admin) return null
  const { data, error } = await admin
    .from('course_scorecard_cache')
    .select('course_id, gcapi_id, gcapi_name, holes_data, fetched_at, payload_version, match_status, match_score, provider_meta, retry_after')
    .eq('course_id', cacheKey)
    .maybeSingle()
  if (error) {
    console.warn('[gca-cache] read failed', error.message)
    return null
  }
  return data as CacheRow | null
}

async function writeMatchedCache(
  admin: AdminClient | null,
  cacheKey: string,
  course: GcaCourse,
  matchScore: number,
) {
  if (!admin) return
  const providerMeta = {
    id: course.id,
    club_name: course.club_name,
    course_name: course.course_name,
    location: course.location,
  }
  const { error } = await admin.from('course_scorecard_cache').upsert({
    course_id: cacheKey,
    gcapi_id: course.id,
    gcapi_name: course.club_name ?? course.course_name ?? null,
    holes_data: course.tees ?? null,
    fetched_at: new Date().toISOString(),
    payload_version: GCA_CACHE_VERSION,
    match_status: 'matched',
    match_score: matchScore,
    provider_meta: providerMeta,
    retry_after: null,
  })
  if (error) console.warn('[gca-cache] matched write failed', error.message)
}

async function writeNegativeCache(admin: AdminClient | null, cacheKey: string) {
  if (!admin) return
  const now = Date.now()
  const { error } = await admin.from('course_scorecard_cache').upsert({
    course_id: cacheKey,
    gcapi_id: null,
    gcapi_name: null,
    holes_data: null,
    fetched_at: new Date(now).toISOString(),
    payload_version: GCA_CACHE_VERSION,
    match_status: 'no_match',
    match_score: null,
    provider_meta: null,
    retry_after: new Date(now + GCA_NO_MATCH_TTL_MS).toISOString(),
  })
  if (error) console.warn('[gca-cache] negative write failed', error.message)
}

function courseFromCache(row: CacheRow): GcaCourse | null {
  if (!row.provider_meta || !row.holes_data || !row.gcapi_id) return null
  return {
    ...row.provider_meta,
    id: Number(row.gcapi_id),
    tees: row.holes_data,
  }
}

function searchQuery(hint: CourseHint) {
  return (
    String(hint.facility ?? '').trim() ||
    String(hint.name ?? '').split(/\s+-\s+/)[0]?.trim() ||
    String(hint.course ?? '').trim()
  )
}

export async function resolveGolfCourse(
  hint: CourseHint,
  admin: AdminClient | null = createGolfCourseAdminClient(),
): Promise<GcaResolution> {
  const apiKey = Deno.env.get('GOLFCOURSEAPI_KEY') ?? ''
  if (!apiKey) return { matched: false, reason: 'no_api_key', cached: false }
  if (!hint.cacheKey || !searchQuery(hint)) {
    return { matched: false, reason: 'no_course_name', cached: false }
  }

  const cached = await readCache(admin, hint.cacheKey)
  if (cached?.payload_version === GCA_CACHE_VERSION) {
    if (cached.match_status === 'no_match' && negativeCacheIsActive(cached.retry_after)) {
      return { matched: false, reason: 'no_matching_course', cached: true }
    }
    if (cached.match_status === 'matched' && cacheIsFresh(cached.fetched_at)) {
      const course = courseFromCache(cached)
      if (course) {
        return {
          matched: true,
          course,
          matchScore: Number(cached.match_score ?? 1),
          cached: true,
        }
      }
    }
    if (cached.match_status === 'matched' && cached.gcapi_id) {
      try {
        const payload = await gcaFetch(`/courses/${Number(cached.gcapi_id)}`, apiKey)
        const course = (payload?.course ?? payload) as GcaCourse
        if (course?.id && course.tees) {
          const matchScore = Number(cached.match_score ?? courseMatchScore(hint, course))
          await writeMatchedCache(admin, hint.cacheKey, course, matchScore)
          return { matched: true, course, matchScore, cached: false }
        }
      } catch (error) {
        if (error instanceof GcaRequestError && error.status === 429) throw error
        console.warn('[gca-cache] cached detail refresh failed; rematching', error)
      }
    }
  }

  const query = searchQuery(hint)
  const search = await gcaFetch(`/search?search_query=${encodeURIComponent(query)}`, apiKey)
  const best = bestCourseMatch(hint, Array.isArray(search?.courses) ? search.courses : [])
  if (!best) {
    await writeNegativeCache(admin, hint.cacheKey)
    return { matched: false, reason: 'no_matching_course', cached: false }
  }

  const payload = await gcaFetch(`/courses/${Number(best.course.id)}`, apiKey)
  const course = (payload?.course ?? payload) as GcaCourse
  if (!course?.id || !course.tees) {
    return { matched: false, reason: 'invalid_course_payload', cached: false }
  }

  const detailScore = courseMatchScore(hint, course)
  if (detailScore < MIN_COURSE_SCORE) {
    await writeNegativeCache(admin, hint.cacheKey)
    return { matched: false, reason: 'detail_mismatch', cached: false }
  }

  await writeMatchedCache(admin, hint.cacheKey, course, detailScore)
  return { matched: true, course, matchScore: detailScore, cached: false }
}

export async function enrichNcrdbTees(
  tees: NcrdbTee[],
  hint: CourseHint,
  admin: AdminClient | null = createGolfCourseAdminClient(),
) {
  try {
    const resolution = await resolveGolfCourse(hint, admin)
    if (!resolution.matched) {
      return {
        tees,
        enrichment: { matched: false, source: 'golfcourseapi', reason: resolution.reason, cached: resolution.cached },
      }
    }

    const enriched = tees.map((tee) => {
      const match = matchGcaTee(tee, resolution.course)
      const card = match ? cardFromGcaTee(match.tee) : null
      return card ? { ...tee, ...card } : tee
    })
    if (!enriched.some((tee) => tee.pars)) {
      return {
        tees,
        enrichment: { matched: false, source: 'golfcourseapi', reason: 'no_matching_tee', cached: resolution.cached },
      }
    }

    return {
      tees: enriched,
      enrichment: {
        matched: true,
        source: 'golfcourseapi',
        gcaId: resolution.course.id,
        gcaClub: resolution.course.club_name ?? resolution.course.course_name ?? '',
        matchScore: Math.round(resolution.matchScore * 100) / 100,
        cached: resolution.cached,
      },
    }
  } catch (error) {
    console.error('[gca-enrichment]', error)
    return {
      tees,
      enrichment: {
        matched: false,
        source: 'golfcourseapi',
        reason: error instanceof Error ? error.message : 'gca_failed',
        cached: false,
      },
    }
  }
}
