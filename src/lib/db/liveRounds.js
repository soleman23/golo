import { supabase, isSupabaseConfigured } from '../supabaseClient'

function normalizeRpcJsonb(data) {
  if (data == null) return null
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }
  return data
}

/** Subset of roundStore persisted to live_rounds.state. */
export function serializeRoundState(state) {
  return {
    round: state.round,
    // Strip contact PII — synced state reaches every member via RLS/Realtime.
    // Claim matching uses the server-side live_round_slots key map, not these fields.
    players: (state.players ?? []).map((p) => {
      const clean = { ...p }
      delete clean.email
      delete clean.phone
      return clean
    }),
    scores: state.scores,
    bets: state.bets,
    teams: state.teams,
    sideGameFlags: state.sideGameFlags,
    wolfPicks: state.wolfPicks,
    bbbFlags: state.bbbFlags,
    skinFlags: state.skinFlags,
    concededHoles: state.concededHoles,
    currentHole: state.currentHole,
    status: state.status,
  }
}

export async function startLiveRound({ roundId, state, roster, courseName }) {
  if (!isSupabaseConfigured || !roundId) {
    return { data: null, error: 'not configured' }
  }
  const { data, error } = await supabase.rpc('start_live_round', {
    p_round_id: roundId,
    p_state: state,
    // Full roster (with contacts) → server derives slot keys into live_round_slots.
    // Never stored in state; only the PII-free keys are persisted.
    p_roster: roster ?? [],
    p_course_name: courseName ?? null,
  })
  if (error) {
    console.error('[db] startLiveRound', error)
    const dup =
      error.code === '23505' ||
      /duplicate key|already exists/i.test(error.message ?? '')
    if (dup) {
      const existing = await fetchLiveRound(roundId)
      if (existing?.invite_code) {
        return { data: { id: roundId, invite_code: existing.invite_code }, error: null }
      }
    }
    return { data: null, error: error.message }
  }
  return { data: normalizeRpcJsonb(data), error: null }
}

export async function joinLiveRound(inviteCode, claimPlayerKey = null) {
  if (!isSupabaseConfigured || !inviteCode) return { error: 'not configured' }
  const { data, error } = await supabase.rpc('join_live_round', {
    p_invite_code: inviteCode,
    p_claim_player_key: claimPlayerKey,
  })
  if (error) {
    console.error('[db] joinLiveRound', error)
    return { error: error.message }
  }
  return { data: normalizeRpcJsonb(data) }
}

export async function patchLiveRound(roundId, state, eventType = null, eventPayload = {}) {
  if (!isSupabaseConfigured || !roundId) return { error: null }
  const { error } = await supabase.rpc('patch_live_round', {
    p_id: roundId,
    p_state: state,
    p_event_type: eventType,
    p_event_payload: eventPayload,
  })
  if (error) console.error('[db] patchLiveRound', error)
  return { error }
}

export async function completeLiveRound(roundId) {
  if (!isSupabaseConfigured || !roundId) return { error: null }
  const { error } = await supabase.rpc('complete_live_round', { p_id: roundId })
  if (error) console.error('[db] completeLiveRound', error)
  return { error }
}

export async function peekLiveRound(inviteCode) {
  if (!isSupabaseConfigured || !inviteCode) return null
  const { data, error } = await supabase.rpc('peek_live_round', {
    p_invite_code: inviteCode,
  })
  if (error) {
    console.error('[db] peekLiveRound', error)
    return null
  }
  return normalizeRpcJsonb(data)
}

export async function fetchClaimableLiveRounds() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase.rpc('fetch_claimable_live_rounds')
  if (error) {
    console.error('[db] fetchClaimableLiveRounds', error)
    return []
  }
  return data ?? []
}

export async function fetchLiveRound(roundId) {
  if (!isSupabaseConfigured || !roundId) return null
  const { data, error } = await supabase
    .from('live_rounds')
    .select('id, invite_code, status, state, course_name, owner_id, updated_at')
    .eq('id', roundId)
    .maybeSingle()
  if (error) {
    console.error('[db] fetchLiveRound', error)
    return null
  }
  return data
}

/** Active live rounds the signed-in user belongs to. */
export async function fetchMyActiveLiveRounds() {
  if (!isSupabaseConfigured) return []
  const { data: members, error: me } = await supabase
    .from('live_round_members')
    .select('live_round_id, role, player_key')
  if (me) {
    console.error('[db] fetchMyActiveLiveRounds members', me)
    return []
  }
  if (!members?.length) return []

  const ids = members.map((m) => m.live_round_id)
  const { data: rounds, error: re } = await supabase
    .from('live_rounds')
    .select('id, invite_code, status, course_name, state')
    .in('id', ids)
    .eq('status', 'live')
  if (re) {
    console.error('[db] fetchMyActiveLiveRounds rounds', re)
    return []
  }

  const roleById = Object.fromEntries(members.map((m) => [m.live_round_id, m]))
  return (rounds ?? []).map((r) => ({
    ...r,
    role: roleById[r.id]?.role,
    playerKey: roleById[r.id]?.player_key,
  }))
}

export async function fetchLiveRoundEvents(liveRoundId, since = null) {
  if (!isSupabaseConfigured || !liveRoundId) return []
  let q = supabase
    .from('live_round_events')
    .select('id, type, payload, created_at')
    .eq('live_round_id', liveRoundId)
    .order('created_at', { ascending: true })
  if (since) q = q.gt('created_at', since)
  const { data, error } = await q
  if (error) {
    console.error('[db] fetchLiveRoundEvents', error)
    return []
  }
  return data ?? []
}

/** Map Supabase/Postgres errors to actionable copy for toasts. */
export function liveRoundUserMessage(err) {
  if (!err) return 'Something went wrong with the live round.'
  const s = String(err)
  if (/Could not find the function|PGRST202|schema cache/i.test(s)) {
    return 'Live round functions are missing in Supabase. In the SQL editor, run supabase/migrations/0008_live_rounds.sql then 0009_live_rounds_functions.sql.'
  }
  if (/not authenticated/i.test(s)) {
    return 'Your session expired. Sign in again, then retry.'
  }
  if (/permission denied|not authorized/i.test(s)) {
    return 'Not authorized for this live round.'
  }
  return s
}
