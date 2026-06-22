import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Courses repository. The client course shape uses `loc` and `strokeIndex`;
 * the table uses `location` and `stroke_index`. `pars` / `stroke_index` / `tees`
 * are stored as JSONB, matching the constants the SetupWizard used to hardcode.
 */

const fromDb = (r) => ({
  id: r.id,
  name: r.name,
  loc: r.location ?? '',
  holes: r.holes ?? 18,
  bg: r.bg ?? null,
  ...(r.pars ? { pars: r.pars } : {}),
  ...(r.stroke_index ? { strokeIndex: r.stroke_index } : {}),
  ...(r.tees ? { tees: r.tees } : {}),
  ...(r.ghin_facility_id ? { ghinFacilityId: r.ghin_facility_id } : {}),
  ...(r.ghin_course_id ? { ghinCourseId: r.ghin_course_id } : {}),
  ...(r.ghin_tee_sets ? { ghinTeeSets: r.ghin_tee_sets } : {}),
})

/** GHIN mapping subset for score-posting eligibility checks. */
export function ghinMappingFromCourse(course) {
  if (!course) return null
  return {
    ghinFacilityId: course.ghinFacilityId ?? course.ghin_facility_id ?? null,
    ghinCourseId: course.ghinCourseId ?? course.ghin_course_id ?? null,
    ghinTeeSets: course.ghinTeeSets ?? course.ghin_tee_sets ?? null,
  }
}

export async function fetchCourseGhinMapping(courseId) {
  if (!isSupabaseConfigured || !courseId) return null
  const { data, error } = await supabase
    .from('courses')
    .select('ghin_facility_id, ghin_course_id, ghin_tee_sets')
    .eq('id', courseId)
    .maybeSingle()
  if (error) {
    console.error('[db] fetchCourseGhinMapping', error)
    return null
  }
  return ghinMappingFromCourse(data)
}

export async function fetchCourses() {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase.from('courses').select('*').order('name')
  if (error) {
    console.error('[db] fetchCourses', error)
    return null
  }
  return data.map(fromDb)
}

export async function upsertCourse(course, userId) {
  if (!isSupabaseConfigured) return { error: null }
  const row = {
    id: course.id,
    name: course.name,
    location: course.loc ?? null,
    holes: course.holes ?? 18,
    bg: course.bg ?? null,
    pars: course.pars ?? null,
    stroke_index: course.strokeIndex ?? null,
    tees: course.tees ?? null,
    is_public: course.isPublic ?? true,
    created_by: userId ?? null,
  }
  const { error } = await supabase.from('courses').upsert(row)
  if (error) console.error('[db] upsertCourse', error)
  return { error }
}
