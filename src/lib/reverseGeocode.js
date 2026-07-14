import { supabase, isSupabaseConfigured } from './supabaseClient'

/**
 * Reverse-geocode device coordinates to city/state via the reverse-geocode edge function.
 * @param {number} lat
 * @param {number} lng
 * @returns {Promise<{ data: { city: string, state: string, stateCode: string, country: string } | null, error: Error | null }>}
 */
export async function reverseGeocode(lat, lng) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Backend not configured') }
  }
  const { data, error } = await supabase.functions.invoke('reverse-geocode', {
    body: { lat, lng },
  })
  if (error) {
    let message = error.message
    try {
      const body = await error.context?.json()
      if (body?.message) message = body.message
      else if (body?.error) message = body.error
    } catch {
      // Keep generic message.
    }
    return { data: null, error: new Error(message) }
  }
  return { data, error: null }
}

/**
 * Forward-geocode a location string to coordinates (city centroid).
 * @param {string} query
 * @returns {Promise<{ data: { lat: number, lng: number } | null, error: Error | null }>}
 */
export async function forwardGeocode(query) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Backend not configured') }
  }
  const { data, error } = await supabase.functions.invoke('reverse-geocode', {
    body: { query: String(query ?? '').trim() },
  })
  if (error) {
    let message = error.message
    try {
      const body = await error.context?.json()
      if (body?.message) message = body.message
      else if (body?.error) message = body.error
    } catch {
      // Keep generic message.
    }
    return { data: null, error: new Error(message) }
  }
  return { data, error: null }
}
