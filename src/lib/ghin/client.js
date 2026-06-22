import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Client for GHIN edge functions. Credentials stay server-side; these calls
 * require a signed-in Supabase session.
 */

async function invoke(name, body) {
  if (!isSupabaseConfigured || !supabase) {
    return { data: null, error: new Error('Backend not configured') }
  }
  const { data, error } = await supabase.functions.invoke(name, body ? { body } : undefined)
  if (error) return { data: null, error }
  if (data?.error && !data?.configured) {
    return { data, error: new Error(data.message ?? data.error) }
  }
  return { data, error: null }
}

/** Start GHIN OAuth — returns { configured, url? } or stub when disabled. */
export async function startGhinConnect() {
  return invoke('ghin-oauth-start')
}

/** Pull the latest official Handicap Index from GHIN. */
export async function syncGhinHandicap() {
  return invoke('ghin-sync-handicap')
}

/**
 * Post an eligible stroke-play round to GHIN.
 * @param {{ roundId: string, playerId: string }} payload
 */
export async function postRoundToGhin(payload) {
  return invoke('ghin-post-score', payload)
}

/** True when edge functions report GHIN is configured (credentials present). */
export function isGhinConfiguredResponse(data) {
  return data?.configured === true
}
