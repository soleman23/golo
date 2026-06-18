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
})

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
