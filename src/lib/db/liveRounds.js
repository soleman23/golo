import { supabase, isSupabaseConfigured } from '../supabaseClient'
import { debugLog } from '../debugLog'

// #region agent log
function dbg(hypothesisId, location, message, data = {}) {
  debugLog(hypothesisId, location, message, data)
}
// #endregion

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
    players: state.players,
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

export async function startLiveRound({ roundId, state, courseName }) {
  if (!isSupabaseConfigured || !roundId) {
    // #region agent log
    dbg('A', 'liveRounds.js:startLiveRound', 'skipped', { configured: isSupabaseConfigured, roundId: !!roundId })
    // #endregion
    return { data: null, error: 'not configured' }
  }
  const { data, error } = await supabase.rpc('start_live_round', {
    p_round_id: roundId,
    p_state: state,
    p_course_name: courseName ?? null,
  })
  // #region agent log
  const parsed = normalizeRpcJsonb(data)
  dbg('A', 'liveRounds.js:startLiveRound', 'rpc result', {
    ok: !error,
    errorCode: error?.code ?? null,
    errorMsg: error?.message?.slice(0, 120) ?? null,
    dataType: data == null ? null : typeof data,
    hasInvite: !!(parsed?.invite_code),
  })
  // #endregion
  if (error) {
    console.error('[db] startLiveRound', error)
    const dup =
      error.code === '23505' ||
      /duplicate key|already exists/i.test(error.message ?? '')
    if (dup) {
      const existing = await fetchLiveRound(roundId)
      if (existing?.invite_code) {
        dbg('A', 'liveRounds.js:startLiveRound', 'duplicate — reused existing', {
          hasInvite: true,
        })
        return { data: { id: roundId, invite_code: existing.invite_code }, error: null }
      }
    }
    return { data: null, error: error.message }
  }
  return { data: parsed, error: null }
}

export async function joinLiveRound(inviteCode, claimPlayerKey = null) {
  if (!isSupabaseConfigured || !inviteCode) return { error: 'not configured' }
  const { data, error } = await supabase.rpc('join_live_round', {
    p_invite_code: inviteCode,
    p_claim_player_key: claimPlayerKey,
  })
  if (error) {
    // #region agent log
    dbg('D', 'liveRounds.js:joinLiveRound', 'rpc error', { code: error.code, msg: error.message?.slice(0, 120) })
    // #endregion
    console.error('[db] joinLiveRound', error)
    return { error: error.message }
  }
  // #region agent log
  const parsed = normalizeRpcJsonb(data)
  dbg('D', 'liveRounds.js:joinLiveRound', 'rpc ok', { role: parsed?.role, already: !!parsed?.already_member })
  // #endregion
  return { data: parsed }
}

export async function patchLiveRound(roundId, state, eventType = null, eventPayload = {}) {
  if (!isSupabaseConfigured || !roundId) return { error: null }
  const { error } = await supabase.rpc('patch_live_round', {
    p_id: roundId,
    p_state: state,
    p_event_type: eventType,
    p_event_payload: eventPayload,
  })
  // #region agent log
  dbg('B', 'liveRounds.js:patchLiveRound', error ? 'rpc error' : 'rpc ok', {
    errorCode: error?.code ?? null,
    errorMsg: error?.message?.slice(0, 120) ?? null,
    eventType,
  })
  // #endregion
  if (error) console.error('[db] patchLiveRound', error)
  return { error }
}

export async function completeLiveRound(roundId) {
  if (!isSupabaseConfigured || !roundId) return { error: null }
  const { error } = await supabase.rpc('complete_live_round', { p_id: roundId })
  // #region agent log
  dbg('D', 'liveRounds.js:completeLiveRound', error ? 'rpc error' : 'rpc ok', {
    errorMsg: error?.message?.slice(0, 120) ?? null,
  })
  // #endregion
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
    // #region agent log
    dbg('D', 'liveRounds.js:peekLiveRound', 'rpc error', { code: error.code, msg: error.message?.slice(0, 120) })
    // #endregion
    return null
  }
  const parsed = normalizeRpcJsonb(data)
  // #region agent log
  dbg('D', 'liveRounds.js:peekLiveRound', 'rpc ok', { hasState: !!parsed?.state, already: !!parsed?.already_member })
  // #endregion
  return parsed
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
    // #region agent log
    dbg('C', 'liveRounds.js:fetchLiveRound', 'select error', { code: error.code, msg: error.message?.slice(0, 120) })
    // #endregion
    return null
  }
  // #region agent log
  dbg('C', 'liveRounds.js:fetchLiveRound', 'select ok', { hasState: !!data?.state, status: data?.status ?? null })
  // #endregion
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
    return 'Live round functions are missing in Supabase. Run supabase/migrations/0009_live_rounds_functions.sql in the SQL editor (use the policy+function drop block first if re-running).'
  }
  if (/not authenticated/i.test(s)) {
    return 'Your session expired. Sign in again, then retry.'
  }
  if (/permission denied|not authorized/i.test(s)) {
    return 'Not authorized for this live round.'
  }
  return s
}
