import { supabase, isSupabaseConfigured } from './supabaseClient'

/**
 * Ask the course-image edge function to find + cache a photo for a course.
 * Returns { imageUrl, source, attribution, cached } or null on any failure —
 * callers should treat null as "keep the current background".
 *
 * Works for catalogue courses and for not-yet-persisted NCRDB imports
 * (pass the same id the wizard assigns, e.g. `ncrdb-12345`, plus name/location).
 */
export async function fetchCourseImage(course) {
  if (!isSupabaseConfigured || !course) return null
  const courseId = course.id ?? course.courseId
  if (!courseId) return null

  try {
    const { data, error } = await supabase.functions.invoke('course-image', {
      body: { courseId: String(courseId), name: course.name ?? course.course ?? '', location: course.location ?? course.loc ?? '' },
    })
    if (error || !data?.imageUrl) return null
    return data
  } catch {
    return null
  }
}
