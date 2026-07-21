import { supabase, isSupabaseConfigured } from './supabaseClient'
import { locationHint } from './scorecardData'

/**
 * Client for the golfcourseapi-holes edge function — the compatibility path for
 * catalogue courses that do not enter through NCRDB. Matching, validation and
 * caching all live in the function's shared resolver, so this module only
 * shapes the request and normalizes the response.
 */

async function invoke(body) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Backend not configured') }
  }
  const { data, error } = await supabase.functions.invoke('golfcourseapi-holes', { body })
  if (error) {
    let message = error.message
    try {
      const payload = await error.context?.json()
      if (payload?.message) message = payload.message
      else if (payload?.error) message = payload.error
    } catch {
      // Keep the generic FunctionsHttpError message when no JSON payload exists.
    }
    return { data: null, error: new Error(message) }
  }
  return { data, error: null }
}

/**
 * Resolve a bundled/catalog course's per-hole data. NCRDB imports already arrive
 * enriched by the same resolver and never make this second call.
 */
export async function getHoleData(course) {
  const id = String(course?.id ?? '').trim()
  const name = String(course?.name ?? '').trim()
  if (!id || !name) {
    return { teesData: null, enrichment: { matched: false, reason: 'invalid_course' } }
  }

  const location = locationHint(course?.loc)
  const { data, error } = await invoke({
    action: 'holes',
    courseId: id,
    courseName: name,
    facility: course?.facility,
    course: course?.course,
    city: course?.city ?? location.city,
    state: course?.state ?? location.state,
  })
  if (error) {
    console.warn('[golfCourseApi] holes fetch failed for', name, '-', error.message)
    return { teesData: null, enrichment: { matched: false, reason: error.message } }
  }
  return {
    teesData: data?.tees ?? null,
    enrichment: {
      matched: !!data?.matched,
      reason: data?.reason,
      cached: !!data?.cached,
      source: 'golfcourseapi',
      matchScore: data?.matchScore,
    },
  }
}
