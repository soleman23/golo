import { supabase, isSupabaseConfigured } from '../supabaseClient'
import { playerKey, displayName, normEmail, normPhone } from '../identity'

/**
 * Rounds repository. A completed round is stored as the full self-contained
 * `snapshot` (exactly what PayoutsPage.saveRound builds, which the History
 * screens render from), plus queryable columns. We also derive a
 * round_participants row per stable identity so a player's history can be
 * aggregated across rounds server-side, mirroring src/lib/identity.js.
 */

const round2 = (n) => +Number(n || 0).toFixed(2)

/** Build round_participants rows from a round snapshot. Guests (no key) skip. */
function deriveParticipants(entry) {
  const players = entry.players ?? []

  // per-round playerId -> stable identity key
  const idKey = {}
  for (const p of players) idKey[p.id] = playerKey(p)

  // net winnings by key, summed across every bet's payouts
  const netByKeyMap = {}
  for (const b of entry.betResults ?? []) {
    for (const [pid, amt] of Object.entries(b.payouts ?? {})) {
      const k = idKey[pid]
      if (k == null) continue
      netByKeyMap[k] = (netByKeyMap[k] ?? 0) + amt
    }
  }

  // leaderboard finish by key (carries gross/net/toPar on new snapshots)
  const lbByKey = {}
  for (const e of entry.leaderboard ?? []) {
    if (e.key != null && lbByKey[e.key] == null) lbByKey[e.key] = e
  }

  const seen = new Set()
  const rows = []
  for (const p of players) {
    const key = playerKey(p)
    if (key == null || seen.has(key)) continue
    seen.add(key)
    const lb = lbByKey[key]
    rows.push({
      player_key: key,
      display_name: displayName(p) || null,
      email: normEmail(p.email),
      phone: normPhone(p.phone),
      gross: lb?.gross ?? null,
      net: lb?.net ?? null,
      to_par: lb?.toPar ?? null,
      net_payout: round2(netByKeyMap[key] ?? 0),
    })
  }
  return rows
}

/** All rounds visible to the user, newest first, returned as snapshots. */
export async function fetchRounds() {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase
    .from('rounds')
    .select('snapshot')
    .order('completed_at', { ascending: false })
  if (error) {
    console.error('[db] fetchRounds', error)
    return null
  }
  return data.map((r) => r.snapshot).filter(Boolean)
}

/** Upsert a completed round (snapshot + participants) for the signed-in owner. */
export async function saveRound(entry, userId) {
  if (!isSupabaseConfigured || !userId || !entry?.roundId) return { error: null }

  const row = {
    id: entry.roundId,
    owner_id: userId,
    course_id: entry.courseId ?? null,
    course_name: entry.course ?? null,
    date: entry.date ?? null,
    holes: entry.holes ?? null,
    scoring: entry.scoring ?? null,
    scoring_type: entry.scoringType ?? null,
    completed_at: entry.completedAt ?? new Date().toISOString(),
    snapshot: entry,
  }

  const { error } = await supabase.from('rounds').upsert(row)
  if (error) {
    console.error('[db] saveRound', error)
    return { error }
  }

  const parts = deriveParticipants(entry).map((p) => ({ ...p, round_id: entry.roundId }))
  if (parts.length) {
    const { error: pe } = await supabase
      .from('round_participants')
      .upsert(parts, { onConflict: 'round_id,player_key' })
    if (pe) console.error('[db] saveRound participants', pe)
  }

  // Link any participant whose email matches a registered profile so they can
  // read rounds they played in (RLS uses round_participants.user_id).
  const { error: le } = await supabase.rpc('link_round_participants', { rid: entry.roundId })
  if (le) console.error('[db] link participants', le)

  return { error: null }
}

/** Delete a round the user owns. */
export async function deleteRound(roundId) {
  if (!isSupabaseConfigured || !roundId) return { error: null }
  const { error } = await supabase.from('rounds').delete().eq('id', roundId)
  if (error) console.error('[db] deleteRound', error)
  return { error }
}

/** Delete every round owned by the user (RLS also scopes this to the owner). */
export async function deleteAllRounds(userId) {
  if (!isSupabaseConfigured || !userId) return { error: null }
  const { error } = await supabase.from('rounds').delete().eq('owner_id', userId)
  if (error) console.error('[db] deleteAllRounds', error)
  return { error }
}
