import { supabase, isSupabaseConfigured } from '../supabaseClient'
import { playerKey } from '../identity'

/** Map a profile row from search_verified_players to the setup picker shape. */
function fromSearchRow(row) {
  if (!row) return null
  const name = row.name ?? ''
  const nickname = row.nickname ?? ''
  const email = row.email ?? ''
  const phone = row.phone ?? ''
  const key = playerKey({ name, nickname, email, phone }) ?? row.id
  return {
    key,
    userId: row.id ?? null,
    name,
    nickname,
    email,
    phone,
    handicapIndex: row.handicap_index ?? null,
    verified: true,
  }
}

/**
 * Search onboarded players with contact info (for round setup / live invites).
 * Requires 2+ characters; returns [] when backend is off or query is too short.
 */
export async function searchVerifiedPlayers(query, limit = 20) {
  if (!isSupabaseConfigured) return []
  const q = String(query ?? '').trim()
  if (q.length < 2) return []

  const { data, error } = await supabase.rpc('search_verified_players', {
    p_query: q,
    p_limit: limit,
  })
  if (error) {
    console.error('[db] searchVerifiedPlayers', error)
    return []
  }
  return (data ?? []).map(fromSearchRow).filter(Boolean)
}
