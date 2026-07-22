import { supabase, isSupabaseConfigured } from './supabaseClient'

/**
 * Client for the course-image edge function. Provider choice, matching and
 * caching all live server-side; this module only shapes the request.
 *
 * Every caller treats this as fire-and-forget decoration: a course without a
 * photo still works fine, so a failure resolves to null and is never surfaced.
 */
export async function fetchCourseImage(course) {
  const courseId = String(course?.id ?? '').trim()
  const name = String(course?.name ?? '').trim()
  if (!isSupabaseConfigured || !supabase || !courseId || !name) return null

  try {
    const { data, error } = await supabase.functions.invoke('course-image', {
      body: { courseId, name, location: course?.loc ?? course?.location ?? '' },
    })
    if (error || !data?.imageUrl) return null
    return {
      imageUrl: data.imageUrl,
      source: data.source ?? null,
      attribution: data.attribution ?? null,
      attributionUrl: data.attributionUrl ?? null,
      cached: !!data.cached,
    }
  } catch {
    return null
  }
}
