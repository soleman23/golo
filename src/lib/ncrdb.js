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
 * @param {number} courseId
 * @returns {Promise<{ data: { tees: Array<{ name, gender, par, courseRating, bogeyRating, slope, yards, teeId }> } | null, error: Error | null }>}
 */
export async function getNcrdbTees(courseId) {
  return invoke({ action: 'tees', courseId })
}
