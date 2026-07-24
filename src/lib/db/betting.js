import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Betting-term acceptance (Phase 4). Terms are frozen at Start Round via
 * finalize_betting_terms; each participant accepts/declines their own row. All
 * mutations go through SECURITY DEFINER RPCs (migration 0025) — the client can
 * read terms/acceptances (RLS: round members) but never forge or respond for
 * someone else.
 */

/** Freeze the betting-relevant slice of round state as the terms snapshot. */
export function buildTermsSnapshot(state) {
  return {
    scoringType: state.round?.scoringType ?? 'stroke',
    scoring: state.round?.scoring ?? 'net',
    bets: state.bets ?? [],
    pressBets: state.pressBets ?? [],
    teams: state.teams ?? [],
    sideGameFlags: state.sideGameFlags ?? {},
    players: (state.players ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      handicapIndex: p.handicapIndex ?? null,
      courseHandicap: p.courseHandicap ?? null,
      color: p.color ?? null,
    })),
  }
}

export async function finalizeBettingTerms(roundId, terms, maxExposure = null) {
  if (!isSupabaseConfigured || !roundId) return { error: null }
  const { data, error } = await supabase.rpc('finalize_betting_terms', {
    p_round_id: roundId,
    p_terms: terms,
    p_max_exposure: maxExposure,
  })
  if (error) console.error('[db] finalizeBettingTerms', error)
  return { data, error }
}

/**
 * Accept, or send the terms back for review. `comment` rides along on a
 * send-back (accept = false) and reaches the organizer in their notification —
 * see migration 0033, which also notifies the terms creator on every response.
 */
export async function respondBettingTerms(termsId, accept, comment = null) {
  if (!isSupabaseConfigured || !termsId) return { error: 'not configured' }
  const { error } = await supabase.rpc('respond_betting_terms', {
    p_terms_id: termsId,
    p_accept: accept,
    p_comment: accept ? null : (comment?.trim() || null),
  })
  if (error) console.error('[db] respondBettingTerms', error)
  return { error }
}

/** Current (non-superseded) terms for a round, or null. */
export async function fetchCurrentTerms(roundId) {
  if (!isSupabaseConfigured || !roundId) return null
  const { data, error } = await supabase
    .from('round_betting_terms')
    .select('id, round_id, version, terms, max_exposure, created_by, created_at')
    .eq('round_id', roundId)
    .is('superseded_at', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[db] fetchCurrentTerms', error)
    return null
  }
  return data
}

export async function fetchAcceptances(termsId) {
  if (!isSupabaseConfigured || !termsId) return []
  const { data, error } = await supabase
    .from('round_betting_acceptances')
    .select('id, terms_id, user_id, status, accepted_at, declined_at, decline_comment')
    .eq('terms_id', termsId)
  if (error) {
    console.error('[db] fetchAcceptances', error)
    return []
  }
  return data ?? []
}

/** Display names for a set of auth user ids (via get_profile_names RPC). */
export async function fetchProfileNames(ids) {
  if (!isSupabaseConfigured || !ids?.length) return {}
  const { data, error } = await supabase.rpc('get_profile_names', { p_ids: ids })
  if (error) {
    console.error('[db] fetchProfileNames', error)
    return {}
  }
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.name || p.nickname || 'Player']))
}

export function subscribeToAcceptances(termsId, onChange) {
  if (!isSupabaseConfigured || !termsId) return () => {}
  const channel = supabase
    .channel(`betting-acceptances-${termsId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'round_betting_acceptances', filter: `terms_id=eq.${termsId}` },
      () => onChange(),
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

/**
 * Payout gate: is the bet binding? Returns whether the round has locked terms,
 * whether everyone accepted, and the names of anyone still pending/declined.
 * `active` is true (and non-blocking) when there are no betting terms at all.
 */
export async function fetchBettingGate(roundId) {
  if (!isSupabaseConfigured || !roundId) return { hasTerms: false, active: true, notAccepted: [] }
  const terms = await fetchCurrentTerms(roundId)
  if (!terms) return { hasTerms: false, active: true, notAccepted: [] }
  const acceptances = await fetchAcceptances(terms.id)
  const outstanding = acceptances.filter((a) => a.status !== 'accepted')
  const names = await fetchProfileNames(outstanding.map((a) => a.user_id))
  return {
    hasTerms: true,
    termsId: terms.id,
    active: outstanding.length === 0,
    notAccepted: outstanding.map((a) => ({ status: a.status, name: names[a.user_id] ?? 'Player' })),
  }
}

/** Defensive human-readable summary of a terms snapshot for the review screen. */
export function summarizeTerms(terms) {
  if (!terms) return []
  const lines = []
  const fmt = String(terms.scoringType || 'stroke').toUpperCase()
  lines.push(`Format · ${fmt}${terms.scoring ? ` · ${String(terms.scoring).toUpperCase()}` : ''}`)
  for (const b of terms.bets ?? []) {
    const amt = b.amount != null ? ` · $${b.amount}` : b.stake != null ? ` · $${b.stake}` : ''
    lines.push(`${b.name || b.type || 'Game'}${amt}`)
  }
  const teamNames = (terms.teams ?? []).map((t) => t.name).filter(Boolean)
  if (teamNames.length) lines.push(`Teams · ${teamNames.join(', ')}`)
  return lines
}
