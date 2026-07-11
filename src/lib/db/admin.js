import { supabase, isSupabaseConfigured } from '../supabaseClient'
import { courseFromDb } from './courses'

const callError = (label, error) => {
  if (error) console.error(`[db] ${label}`, error)
  return error
}

export async function adminMe() {
  if (!isSupabaseConfigured) return { isAdmin: false, error: null }
  const { data, error } = await supabase.rpc('admin_me')
  callError('adminMe', error)
  return { isAdmin: !!data?.is_admin, error }
}

export async function adminListCourses() {
  if (!isSupabaseConfigured) return { courses: [], error: null }
  const { data, error } = await supabase.rpc('admin_list_courses')
  callError('adminListCourses', error)
  return { courses: error ? [] : (data ?? []).map(courseFromDb), error }
}

export async function adminUpsertCourse(course) {
  if (!isSupabaseConfigured) return { course: null, error: null }
  const { data, error } = await supabase.rpc('admin_upsert_course', { p_course: course })
  callError('adminUpsertCourse', error)
  return { course: data ? courseFromDb(data) : null, error }
}

export async function adminSetCourseVisibility(id, visible) {
  if (!isSupabaseConfigured) return { course: null, error: null }
  const { data, error } = await supabase.rpc('admin_set_course_visibility', {
    p_id: id,
    p_visible: visible,
  })
  callError('adminSetCourseVisibility', error)
  return { course: data ? courseFromDb(data) : null, error }
}
