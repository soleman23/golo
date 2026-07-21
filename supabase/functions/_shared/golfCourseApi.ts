import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  bestCourseMatch,
  cacheIsFresh,
  cardFromGcaTee,
  courseMatchScore,
  GCA_CACHE_VERSION,
  matchGcaTee,
  MIN_COURSE_SCORE,
  negativeCacheIsActive,
  GCA_NO_MATCH_TTL_MS,
  type CourseHint,
  type GcaCourse,
  type NcrdbTee,
} from './courseMatching.ts'

/**
 * GolfCourseAPI access and its cache — the single provider entry point for both
 * the NCRDB tee action and the catalogue compatibility endpoint. All matching
 * and validation rules live in ./courseMatching.ts so the two callers cannot
 * drift apart.
 *
 * The free tier allows 50 requests a day, so the cache is not an optimization:
 * a positive match is held for 30 days, a miss for 24 hours, and a stale
 * provider id costs one detail refresh rather than a fresh search plus detail.
 */

export type { CourseHint, GcaCourse, NcrdbTee }
export { GCA_CACHE_VERSION }

const GCA_BASE = 'https://api.golfcourseapi.com/v1'
const GCA_TIMEOUT_MS = 10_000

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

/** course_scorecard_cache as of migration 0031. */
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

// The one table this module touches. Declaring it keeps the client's row types
// real instead of inferring `never` from an untyped schema.
type CacheDatabase = {
  public: {
    Tables: {
      course_scorecard_cache: {
        Row: CacheRow
        Insert: CacheRow
        Update: Partial<CacheRow>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type AdminClient = ReturnType<typeof createClient<CacheDatabase>>

export function createGolfCourseAdminClient(): AdminClient | null {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return url && key
    ? createClient<CacheDatabase>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
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

/** Remember a miss briefly, so a course we cannot match does not re-search on every setup. */
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

/** Search on the facility, not the full "Facility - Course" label the provider never uses. */
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

  // Rows written by the older name-only matcher carry version 1 and are ignored
  // here, so each one is rematched under the current rules exactly once.
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
    // Stale but previously matched: one detail call refreshes it. Re-searching
    // would cost two requests to reach the same course.
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

  // The search result is a summary; re-score against the full detail payload,
  // which carries the location the summary may have omitted.
  const detailScore = courseMatchScore(hint, course)
  if (detailScore < MIN_COURSE_SCORE) {
    await writeNegativeCache(admin, hint.cacheKey)
    return { matched: false, reason: 'detail_mismatch', cached: false }
  }

  await writeMatchedCache(admin, hint.cacheKey, course, detailScore)
  return { matched: true, course, matchScore: detailScore, cached: false }
}

/**
 * Attach validated hole data to NCRDB's tee rows. NCRDB stays authoritative for
 * rating, slope, and tee ids; the provider only supplies par, stroke index, and
 * yardage. Always fails open to the raw NCRDB tees — a round without a card is
 * recoverable, a round that cannot start is not.
 */
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
