import { supabase, isSupabaseConfigured } from './supabaseClient'
import useRoundStore from '../store/roundStore'
import useLiveRoundStore from '../store/liveRoundStore'
import useNotificationStore from '../store/notificationStore'
import { resolveLiveRoundRole } from './liveRoundRole'
import { serializeRoundState, patchLiveRound, ensureLiveScorerAccess, liveRoundUserMessage } from './db/liveRounds'

let debounceTimer = null
let storeUnsub = null
const roundChannels = new Map()
const eventChannels = new Map()
// The last state we actually pushed to the server. Events are detected against
// this (not the previous store tick) so a change isn't dropped when several land
// inside one debounce window.
let lastPushed = null
let hadSyncFailure = false

/**
 * Structured detail for a score change, so the durable notification + toast can
 * read "Dave made 4 on 7 (bogey)" instead of a bare "Scores updated". Reports
 * the first changed cell (scores[playerId][hole]) plus a count when several
 * landed in one debounce window. Names only — no email/phone — matching the
 * PII redaction in serializeRoundState.
 */
function scoreChangePayload(state, prev) {
  const cur = state.scores ?? {}
  const old = prev.scores ?? {}
  const pars = state.round?.pars ?? {}
  let changed = null
  let count = 0
  for (const pid of Object.keys(cur)) {
    const curHoles = cur[pid] ?? {}
    const oldHoles = old[pid] ?? {}
    for (const h of Object.keys(curHoles)) {
      if (curHoles[h] !== oldHoles[h]) {
        count += 1
        if (!changed) {
          changed = { pid, hole: Number(h), newScore: curHoles[h], prevScore: oldHoles[h] ?? null }
        }
      }
    }
  }
  if (!changed) return {}
  const player = (state.players ?? []).find((p) => p.id === changed.pid)
  const par = pars[changed.hole] ?? null
  return {
    playerId: changed.pid,
    playerName: player?.name ?? null,
    hole: changed.hole,
    newScore: changed.newScore,
    prevScore: changed.prevScore,
    toPar: par != null && changed.newScore != null ? changed.newScore - par : null,
    changedCount: count,
  }
}

function detectEvent(state, prev) {
  if (!prev) return null
  if (state.currentHole !== prev.currentHole) {
    return { type: 'hole_changed', payload: { hole: state.currentHole } }
  }
  if (JSON.stringify(state.scores) !== JSON.stringify(prev.scores)) {
    return { type: 'score_updated', payload: scoreChangePayload(state, prev) }
  }
  if (JSON.stringify(state.sideGameFlags) !== JSON.stringify(prev.sideGameFlags)) {
    return { type: 'side_game_flagged', payload: {} }
  }
  if (
    JSON.stringify(state.wolfPicks) !== JSON.stringify(prev.wolfPicks) ||
    JSON.stringify(state.bbbFlags) !== JSON.stringify(prev.bbbFlags) ||
    JSON.stringify(state.skinFlags) !== JSON.stringify(prev.skinFlags)
  ) {
    return { type: 'side_game_flagged', payload: {} }
  }
  if (
    JSON.stringify(state.bets) !== JSON.stringify(prev.bets) ||
    JSON.stringify(state.pressBets) !== JSON.stringify(prev.pressBets) ||
    JSON.stringify(state.teams) !== JSON.stringify(prev.teams) ||
    JSON.stringify(state.players) !== JSON.stringify(prev.players) ||
    state.status !== prev.status
  ) {
    return { type: 'round_updated', payload: {} }
  }
  return null
}

function schedulePush(state) {
  const { liveRoundId, role: storedRole } = useLiveRoundStore.getState()
  const roundId = useRoundStore.getState().round?.roundId ?? null
  const role = resolveLiveRoundRole(storedRole, liveRoundId, roundId)
  if (role !== 'scorer' || !liveRoundId) return

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const payload = serializeRoundState(state)
    let event = detectEvent(state, lastPushed)
    if (!event && hadSyncFailure) {
      event = { type: 'state_updated', payload: {} }
    }
    const pushOnce = () =>
      patchLiveRound(liveRoundId, payload, event?.type ?? null, event?.payload ?? {})

    let { error } = await pushOnce()
    if (error && /not authorized/i.test(error?.message ?? '')) {
      const rs = useRoundStore.getState()
      const ensured = await ensureLiveScorerAccess({
        roundId: liveRoundId,
        state: serializeRoundState(rs),
        roster: rs.players,
        courseName: rs.round?.course ?? '',
      })
      if (ensured.ok) {
        if (ensured.inviteCode) {
          const live = useLiveRoundStore.getState()
          useLiveRoundStore.getState().setSession({
            liveRoundId,
            inviteCode: ensured.inviteCode,
            role: 'scorer',
            scorerName: live.scorerName,
          })
        }
        ;({ error } = await pushOnce())
      }
    }

    if (error) {
      const msg = error?.message ?? String(error)
      hadSyncFailure = true
      if (/not authorized/i.test(msg)) {
        detachLiveSync()
        useLiveRoundStore.getState().clearSession()
      }
      useNotificationStore.getState().pushToast({
        kicker: 'LIVE SYNC',
        title: 'Could not sync scores',
        body: /not authenticated/i.test(msg)
          ? 'Your session expired. Sign in again, then start a fresh round to sync.'
          : /not authorized/i.test(msg)
            ? 'This account is not the scorer for this live round. Scoring continues locally — start a new round to sync again.'
            : liveRoundUserMessage(msg),
        duration: 8000,
      })
      return
    }
    hadSyncFailure = false
    lastPushed = state
  }, 450)
}

export function attachLiveSync() {
  detachLiveSync()
  if (!isSupabaseConfigured) return

  lastPushed = useRoundStore.getState()
  storeUnsub = useRoundStore.subscribe(schedulePush)
}

export function detachLiveSync() {
  clearTimeout(debounceTimer)
  debounceTimer = null
  lastPushed = null
  hadSyncFailure = false
  if (storeUnsub) {
    storeUnsub()
    storeUnsub = null
  }
}

export function hydrateFromServer(liveState, { force = false } = {}) {
  if (!liveState) return
  const { role } = useLiveRoundStore.getState()
  const local = useRoundStore.getState()
  const localId = local.round?.roundId ?? null
  const incomingId = liveState.round?.roundId ?? null
  const localEmpty =
    !localId ||
    local.status === 'setup' ||
    local.status == null ||
    (Object.keys(local.scores ?? {}).length === 0 && Object.keys(liveState.scores ?? {}).length > 0)
  const mismatch = !!(incomingId && localId && incomingId !== localId)
  const skipScorerEcho = role === 'scorer' && !force && !localEmpty && !mismatch
  // Scorers own local state while actively scoring; still hydrate on reopen when
  // local is empty / wrong round so we never push a blank board afterward.
  if (skipScorerEcho) return
  useRoundStore.getState().hydrateFromLiveState(liveState)
}

function removeRoundChannel(liveRoundId) {
  const ch = roundChannels.get(liveRoundId)
  if (ch) {
    supabase.removeChannel(ch)
    roundChannels.delete(liveRoundId)
  }
}

function removeEventChannel(liveRoundId) {
  const ch = eventChannels.get(liveRoundId)
  if (ch) {
    supabase.removeChannel(ch)
    eventChannels.delete(liveRoundId)
  }
}

export function subscribeToLiveRound(liveRoundId, onStateUpdate) {
  if (!isSupabaseConfigured || !liveRoundId) return () => {}

  removeRoundChannel(liveRoundId)

  const channel = supabase
    .channel(`live-round-${liveRoundId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'live_rounds',
        filter: `id=eq.${liveRoundId}`,
      },
      (payload) => {
        if (payload.new?.state) onStateUpdate(payload.new.state)
        if (payload.new?.status === 'complete') onStateUpdate(null, 'complete')
      }
    )
    .subscribe()

  roundChannels.set(liveRoundId, channel)

  return () => {
    removeRoundChannel(liveRoundId)
  }
}

export function subscribeToLiveEvents(liveRoundId, onEvent) {
  if (!isSupabaseConfigured || !liveRoundId) return () => {}

  removeEventChannel(liveRoundId)

  const channel = supabase
    .channel(`live-events-${liveRoundId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_round_events',
        filter: `live_round_id=eq.${liveRoundId}`,
      },
      (payload) => {
        if (payload.new) onEvent(payload.new)
      }
    )
    .subscribe()

  eventChannels.set(liveRoundId, channel)

  return () => {
    removeEventChannel(liveRoundId)
  }
}

/**
 * Subscribe to the signed-in user's own notification rows. Handles INSERT (a new
 * notification) and UPDATE (a coalesce bump that re-surfaces a row, or a
 * read/archive echo from another device) — the fan-out trigger uses ON CONFLICT
 * DO UPDATE, so re-alerts arrive as UPDATEs. RLS + the user_id filter guarantee
 * a player never receives another user's rows.
 */
export function subscribeToMyNotifications(userId, { onInsert, onUpdate } = {}) {
  if (!isSupabaseConfigured || !userId) return () => {}
  const channel = supabase
    .channel(`my-notifications-${userId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => { if (payload.new) onInsert?.(payload.new) },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => { if (payload.new) onUpdate?.(payload.new) },
    )
    .subscribe()

  return () => { supabase.removeChannel(channel) }
}

/** Stop scorer push + the current session's round-state channel only. */
export function teardownLiveSync() {
  detachLiveSync()
  const { liveRoundId } = useLiveRoundStore.getState()
  if (liveRoundId) removeRoundChannel(liveRoundId)
}

/** Remove every live round + event channel (e.g. starting a fresh local round). */
export function teardownAllLiveChannels() {
  for (const id of [...roundChannels.keys()]) removeRoundChannel(id)
  for (const id of [...eventChannels.keys()]) removeEventChannel(id)
}
