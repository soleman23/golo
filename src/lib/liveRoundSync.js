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

function detectEvent(state, prev) {
  if (!prev) return null
  if (state.currentHole !== prev.currentHole) {
    return { type: 'hole_changed', payload: { hole: state.currentHole } }
  }
  if (JSON.stringify(state.scores) !== JSON.stringify(prev.scores)) {
    return { type: 'score_updated', payload: {} }
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

export function hydrateFromServer(liveState) {
  if (!liveState) return
  const { role } = useLiveRoundStore.getState()
  // Scorers own local state while scoring; never overwrite from server echoes.
  if (role === 'scorer') return
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
 * Single Realtime channel for all active memberships (avoids N channel fan-out).
 * Uses a unique channel key so overlapping effect re-runs cannot tear down
 * each other's subscription via a shared map entry.
 * @param {string[]} liveRoundIds
 * @param {(ev: object) => void} onEvent
 */
export function subscribeToLiveEventsMany(liveRoundIds, onEvent) {
  const ids = [...new Set((liveRoundIds ?? []).filter(Boolean))]
  if (!isSupabaseConfigured || !ids.length) return () => {}

  const filter =
    ids.length === 1
      ? `live_round_id=eq.${ids[0]}`
      : `live_round_id=in.(${ids.join(',')})`

  const key = `many-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const channel = supabase
    .channel(`live-events-${key}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'live_round_events',
        filter,
      },
      (payload) => {
        if (payload.new) onEvent(payload.new)
      }
    )
    .subscribe()

  eventChannels.set(key, channel)

  return () => {
    removeEventChannel(key)
  }
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
