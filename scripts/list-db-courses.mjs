/** List setup-visible courses from the live Supabase DB. Usage: node scripts/list-db-courses.mjs */

import { requireSupabaseEnv, fetchVisibleCourses } from './_shared.mjs'

const env = requireSupabaseEnv()
const courses = await fetchVisibleCourses(env)
console.log('visible courses:', courses.length)
for (const c of courses) {
  console.log(`- ${c.name} | ${c.loc} | ghin=${c.ghinCourseId ?? 'null'}`)
}
