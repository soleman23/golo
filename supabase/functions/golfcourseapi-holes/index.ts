import { corsHeaders, jsonResponse } from '../_shared/http.ts'
import { resolveGolfCourse, type CourseHint } from '../_shared/golfCourseApi.ts'

/**
 * Compatibility wrapper for catalogue courses that do not enter through the
 * NCRDB tee action. Matching, provider access, validation, and caching all live
 * in the shared resolver so this endpoint cannot drift from NCRDB enrichment.
 *
 * POST { action: 'holes', courseId, courseName, facility?, course?, city?, state? }
 *   -> { tees, gcapiId?, courseName?, cached, matched, reason? }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_body', message: 'Expected a JSON body.' }, 400)
  }

  if (body.action !== 'holes') {
    return jsonResponse({ error: 'invalid_request', message: 'action must be "holes".' }, 400)
  }

  const courseId = String(body.courseId ?? '').trim().slice(0, 160)
  const courseName = String(body.courseName ?? '').trim().slice(0, 160)
  if (!courseId) return jsonResponse({ error: 'invalid_request', message: 'courseId is required.' }, 400)
  if (!courseName) return jsonResponse({ error: 'invalid_request', message: 'courseName is required.' }, 400)

  const hint: CourseHint = {
    cacheKey: courseId,
    name: courseName,
    facility: String(body.facility ?? '').trim().slice(0, 160),
    course: String(body.course ?? '').trim().slice(0, 160),
    city: String(body.city ?? '').trim().slice(0, 100),
    state: String(body.state ?? '').trim().slice(0, 100),
  }

  try {
    const resolution = await resolveGolfCourse(hint)
    if (!resolution.matched) {
      return jsonResponse({
        tees: null,
        matched: false,
        reason: resolution.reason,
        cached: resolution.cached,
      })
    }
    return jsonResponse({
      tees: resolution.course.tees ?? null,
      gcapiId: resolution.course.id,
      courseName: resolution.course.club_name ?? resolution.course.course_name ?? '',
      matched: true,
      matchScore: Math.round(resolution.matchScore * 100) / 100,
      cached: resolution.cached,
    })
  } catch (error) {
    console.error('[golfcourseapi-holes]', error)
    const message = error instanceof Error ? error.message : 'GolfCourseAPI request failed'
    return jsonResponse({ error: 'gcapi_failed', message }, 502)
  }
})
