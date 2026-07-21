import { supabase, isSupabaseConfigured } from './supabaseClient'

/**
 * Client for the ncrdb-course-search edge function, which proxies the USGA
 * NCRDB (no public API — CSRF-guarded AJAX, so calls must be server-side).
 */

async function invoke(body) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Backend not configured') }
  }
  const { data, error } = await supabase.functions.invoke('ncrdb-course-search', { body })
  if (error) {
    let message = error.message
    try {
      const body = await error.context?.json()
      if (body?.message) message = body.message
      else if (body?.error) message = body.error
    } catch {
      // Keep the generic FunctionsHttpError message when no JSON payload exists.
    }
    return { data: null, error: new Error(message) }
  }
  return { data, error: null }
}

/**
 * Search the NCRDB for courses matching name and/or city/state.
 * Regional nearby search can omit clubName when clubCity or clubState is provided.
 * @param {{ clubName?: string, clubCity?: string, clubState?: string, clubCountry?: string }} params
 * @returns {Promise<{ data: { courses: Array<object> } | null, error: Error | null }>}
 */
export async function searchNcrdbCourses({ clubName, clubCity, clubState, clubCountry }) {
  return invoke({ action: 'search', clubName, clubCity, clubState, clubCountry })
}

/**
 * Get all tee sets with rating/slope for an NCRDB courseID.
 * The descriptor lets the edge function conservatively match GolfCourseAPI and
 * enrich the NCRDB rows with validated hole pars, stroke indexes, and yardage.
 * @param {number} courseId
 * @param {{ name?: string, facility?: string, course?: string, city?: string, state?: string }} [course]
 * @returns {Promise<{ data: { tees: Array<object>, enrichment?: object } | null, error: Error | null }>}
 */
export async function getNcrdbTees(courseId, course) {
  return invoke({ action: 'tees', courseId, course })
}
