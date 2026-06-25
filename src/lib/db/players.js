import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Map a profile row from search_verified_players to the setup picker shape.
 * The search endpoint deliberately returns no raw contact — only masked
 * email/phone for display — so this row carries `userId` (not an email/phone
 * identity key) and the picker resolves real contact via fetchPlayerContact()
 * at the moment the player is added.
 */
function fromSearchRow(row) {
  if (!row) return null
  return {
    // `u:<id>` is used only for picker-list dedup; it is NOT the persisted
    // identity key — the real e:/p: key is derived once contact is revealed.
    key: `u:${row.id}`,
    userId: row.id ?? null,
    name: row.name ?? '',
    nickname: row.nickname ?? '',
    emailMasked: row.email_masked ?? '',
    phoneMasked: row.phone_masked ?? '',
    hasEmail: !!row.has_email,
    hasPhone: !!row.has_phone,
    handicapIndex: row.handicap_index ?? null,
    verified: true,
  }
}

/**
 * Search onboarded players (for round setup / live invites). Returns masked
 * contact only — see get_player_contact / fetchPlayerContact for the real
 * contact, fetched per-player at add time. Requires 2+ characters; returns []
 * when backend is off or query is too short.
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

/**
 * Reveal one verified player's real contact, called when the organizer actually
 * adds them to a round. Returns { email, phone, name, nickname, handicapIndex }
 * or null (backend off, not found, or error).
 */
export async function fetchPlayerContact(userId) {
  if (!isSupabaseConfigured || !userId) return null

  const { data, error } = await supabase.rpc('get_player_contact', { p_id: userId })
  if (error) {
    console.error('[db] fetchPlayerContact', error)
    return null
  }
  if (!data) return null
  return {
    userId: data.id ?? userId,
    name: data.name ?? '',
    nickname: data.nickname ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    handicapIndex: data.handicap_index ?? null,
  }
}
