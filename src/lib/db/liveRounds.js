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
    pressBets: state.pressBets ?? [],
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

/** Ensure the Supabase client has a user JWT before SECURITY DEFINER RPCs. */
async function requireAuthSession() {
  if (!supabase) return null
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) return session
  const { data: refreshed, error } = await supabase.auth.refreshSession()
  if (error) return null
  return refreshed.session ?? null
}

export async function startLiveRound({ roundId, state, roster, courseName }) {
  if (!isSupabaseConfigured || !roundId) {
    return { data: null, error: 'not configured' }
  }
  const session = await requireAuthSession()
  if (!session?.access_token) {
    return { data: null, error: 'not authenticated' }
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
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id ?? null
      if (
        existing?.invite_code &&
        uid &&
        existing.status === 'live' &&
        (existing.scorer_user_id === uid || existing.owner_id === uid)
      ) {
        return { data: { id: roundId, invite_code: existing.invite_code }, error: null }
      }
      if (existing?.invite_code) {
        return { data: null, error: 'not authorized to patch live round' }
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
  const session = await requireAuthSession()
  if (!session?.access_token) {
    return { error: { message: 'not authenticated' } }
  }
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
    .select('id, invite_code, status, state, course_name, owner_id, scorer_user_id, updated_at')
    .eq('id', roundId)
    .maybeSingle()
  if (error) {
    console.error('[db] fetchLiveRound', error)
    return null
  }
  return data
}

/** True when the signed-in user is the live scorer for an in-progress round. */
export async function assertLiveScorer(roundId) {
  if (!isSupabaseConfigured || !roundId) return { ok: false, reason: 'not configured' }
  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr || !auth?.user) return { ok: false, reason: 'not authenticated' }
  const row = await fetchLiveRound(roundId)
  if (!row) return { ok: false, reason: 'round not found' }
  if (row.status !== 'live') return { ok: false, reason: 'round not live' }
  const uid = auth.user.id
  if (row.scorer_user_id !== uid && row.owner_id !== uid) {
    return { ok: false, reason: 'not scorer', ownerId: row.owner_id, scorerUserId: row.scorer_user_id, uid }
  }
  return { ok: true, uid, inviteCode: row.invite_code }
}

/** Calls patch_live_round — the same gate used during scoring sync. */
export async function probeLivePatch(roundId, state) {
  if (!isSupabaseConfigured || !roundId || !state) return { ok: false, reason: 'not configured' }
  const { error } = await patchLiveRound(roundId, state, null, {})
  if (error) {
    const msg = error?.message ?? String(error)
    return { ok: false, reason: msg }
  }
  return { ok: true }
}

/**
 * Verify patch access; if missing, re-run start_live_round for this round id.
 * Returns invite code when the server accepts patches.
 */
export async function ensureLiveScorerAccess({ roundId, state, roster, courseName }) {
  if (!isSupabaseConfigured || !roundId) return { ok: false, reason: 'not configured' }
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth?.user?.id ?? null
  if (!uid) return { ok: false, reason: 'not authenticated' }

  const row = await fetchLiveRound(roundId)
  if (row?.status === 'live' && (row.scorer_user_id === uid || row.owner_id === uid)) {
    const probe = await probeLivePatch(roundId, state)
    if (probe.ok) {
      return { ok: true, inviteCode: row.invite_code, uid }
    }
  }

  const { data: res, error: liveErr } = await startLiveRound({ roundId, state, roster, courseName })
  if (liveErr || !res?.invite_code) {
    const staleComplete =
      /live round already exists/i.test(String(liveErr ?? '')) &&
      (await fetchLiveRound(roundId))?.status === 'complete'
    if (staleComplete) {
      return { ok: false, reason: 'live round complete on server', needsNewRoundId: true }
    }
    return { ok: false, reason: liveErr ?? 'start failed' }
  }

  const probe = await probeLivePatch(roundId, state)
  if (!probe.ok) {
    return { ok: false, reason: probe.reason, inviteCode: res.invite_code }
  }
  return { ok: true, inviteCode: res.invite_code, reRegistered: true, uid }
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

/**
 * One round-trip for every active membership's event backlog.
 * @param {string[]} liveRoundIds
 * @returns {Promise<Map<string, Array<object>>>}
 */
export async function fetchLiveRoundEventsForRounds(liveRoundIds) {
  const ids = [...new Set((liveRoundIds ?? []).filter(Boolean))]
  const byRound = new Map(ids.map((id) => [id, []]))
  if (!isSupabaseConfigured || !ids.length) return byRound

  const { data, error } = await supabase
    .from('live_round_events')
    .select('id, live_round_id, type, payload, created_at')
    .in('live_round_id', ids)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[db] fetchLiveRoundEventsForRounds', error)
    return byRound
  }
  for (const ev of data ?? []) {
    const list = byRound.get(ev.live_round_id)
    if (list) list.push(ev)
  }
  return byRound
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
    return 'Not authorized for this live round. Sign out, start a fresh round from Setup, and re-run supabase/migrations/0009_live_rounds_functions.sql if this keeps happening.'
  }
  return s
}
