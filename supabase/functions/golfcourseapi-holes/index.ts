import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, jsonResponse } from '../_shared/http.ts'

/**
 * GolfCourseAPI proxy + cache.
 *
 * NCRDB gives us par + stroke index per hole but no yardage. This function
 * fills yardage from GolfCourseAPI.com and caches the raw tee payload in
 * course_scorecard_cache so repeat loads are instant and we stay under the
 * free-tier quota.
 *
 * All GolfCourseAPI calls and every cache read/write happen here with the
 * service role — the browser never sees the API key and never touches the cache
 * table directly (RLS denies it), so there's no new client-write surface.
 *
 *   POST { action: 'holes', courseId, courseName }
 *     -> { tees, gcapiId, courseName, cached }   (tees is null when no match)
 *   POST { action: 'search', query }
 *     -> { courses }                             (diagnostic / future manual match)
 */

const GCAPI_KEY = Deno.env.get('GOLFCOURSEAPI_KEY') ?? ''
const BASE = 'https://api.golfcourseapi.com/v1'
const TIMEOUT_MS = 10_000

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin =
  SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null

async function gcapiFetch(path: string) {
  if (!GCAPI_KEY) throw new Error('GOLFCOURSEAPI_KEY not configured')
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${GCAPI_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`GolfCourseAPI error: ${res.status}`)
  return res.json()
}

const normalizeName = (text: unknown) =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Generic words that don't identify a course, so they can't anchor a match.
const STOP_WORDS = new Set([
  'golf', 'club', 'course', 'cc', 'gc', 'gcc', 'resort', 'the', 'links',
  'country', 'national', 'at', 'no', 'and', 'of', 'a',
])

function distinctiveTokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t && !STOP_WORDS.has(t) && !/^\d+$/.test(t))
}

/**
 * GolfCourseAPI search is fuzzy and returns *some* result even for courses it
 * doesn't carry, so position can't be trusted (e.g. "Harbor Dunes" surfaces
 * "Wild Dunes" first). Accept an exact normalized name, else require the query's
 * first distinctive token — skipping generic words like "golf"/"club" and hole
 * numbers — to appear in the candidate. That still matches "Pinehurst No 2" ->
 * "Pinehurst CC" while rejecting "Harbor Dunes" -> "Wild Dunes". Returns null
 * when nothing is confident, so callers fall back rather than take wrong data.
 */
function bestCourseMatch(courses: Array<Record<string, unknown>>, courseName: string) {
  if (!courses.length) return null
  const target = normalizeName(courseName)
  if (!target) return null

  const nameOf = (c: Record<string, unknown>) => normalizeName(c.club_name ?? c.course_name ?? c.name)
  const exact = courses.find((c) => nameOf(c) === target)
  if (exact) return exact

  const keyTokens = distinctiveTokens(courseName)
  if (!keyTokens.length) {
    return courses.find((c) => {
      const name = nameOf(c)
      return name && (name.includes(target) || target.includes(name))
    }) ?? null
  }

  // Whole-word match only. A substring hit (e.g. 'lincoln' inside 'lincolnshire')
  // pulls in unrelated courses, so the token must appear as its own word.
  const key = keyTokens[0]
  return courses.find((c) => nameOf(c).split(' ').includes(key)) ?? null
}

async function getHoles(courseId: string, courseName: string) {
  // 1. Cache hit — return the stored tee payload untouched.
  if (admin) {
    const { data: cached } = await admin
      .from('course_scorecard_cache')
      .select('holes_data, gcapi_id, gcapi_name')
      .eq('course_id', courseId)
      .maybeSingle()
    if (cached?.holes_data) {
      return { tees: cached.holes_data, gcapiId: cached.gcapi_id, courseName: cached.gcapi_name, cached: true }
    }
  }

  // 2. Find the GolfCourseAPI course by name. Search already returns each
  //    course's full tee payload (per-hole par/yardage/handicap) inline, so use
  //    it directly; only fall back to the course-detail endpoint if a match
  //    somehow lacks tees. Saves an API call per uncached course.
  const search = await gcapiFetch(`/search?search_query=${encodeURIComponent(courseName)}`)
  const match = bestCourseMatch(Array.isArray(search?.courses) ? search.courses : [], courseName)
  if (!match?.id) return { tees: null, cached: false }

  let tees = match.tees ?? null
  let gcapiName = match.club_name ?? null
  if (!tees) {
    const detail = await gcapiFetch(`/courses/${Number(match.id)}`)
    tees = detail?.course?.tees ?? null
    gcapiName = detail?.course?.club_name ?? gcapiName
  }

  // 3. Only cache real payloads so a transient miss can be retried later.
  //    Store the tees keyed by the app's own course id.
  if (admin && tees) {
    await admin.from('course_scorecard_cache').upsert({
      course_id: courseId,
      gcapi_id: Number(match.id),
      gcapi_name: gcapiName,
      holes_data: tees,
      fetched_at: new Date().toISOString(),
    })
  }

  return { tees, gcapiId: Number(match.id), courseName: gcapiName, cached: false }
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
    if (body?.action === 'search') {
      const query = String(body.query ?? '').trim()
      if (!query) return jsonResponse({ error: 'invalid_request', message: 'query is required.' }, 400)
      const data = await gcapiFetch(`/search?search_query=${encodeURIComponent(query)}`)
      return jsonResponse({ courses: data?.courses ?? [] })
    }

    if (body?.action === 'holes') {
      const courseId = String(body.courseId ?? '').trim()
      const courseName = String(body.courseName ?? '').trim()
      if (!courseId) return jsonResponse({ error: 'invalid_request', message: 'courseId is required.' }, 400)
      if (!courseName) return jsonResponse({ error: 'invalid_request', message: 'courseName is required.' }, 400)
      return jsonResponse(await getHoles(courseId, courseName))
    }

    return jsonResponse({ error: 'invalid_request', message: 'action must be "search" or "holes".' }, 400)
  } catch (err) {
    console.error('[golfcourseapi-holes]', err)
    const message = err instanceof Error ? err.message : 'GolfCourseAPI request failed'
    return jsonResponse({ error: 'gcapi_failed', message }, 502)
  }
})
