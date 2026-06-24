import { supabase, isSupabaseConfigured } from './supabaseClient'
import useRoundStore from '../store/roundStore'
import useLiveRoundStore from '../store/liveRoundStore'
import useNotificationStore from '../store/notificationStore'
import { serializeRoundState, patchLiveRound, liveRoundUserMessage } from './db/liveRounds'

let debounceTimer = null
let storeUnsub = null
let roundChannel = null
let eventsChannel = null
// The last state we actually pushed to the server. Events are detected against
// this (not the previous store tick) so a change isn't dropped when several land
// inside one debounce window.
let lastPushed = null

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
  return null
}

function schedulePush(state) {
  const { liveRoundId, role } = useLiveRoundStore.getState()
  if (role !== 'scorer' || !liveRoundId) return

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const payload = serializeRoundState(state)
    const event = detectEvent(state, lastPushed)
    const { error } = await patchLiveRound(
      liveRoundId,
      payload,
      event?.type ?? null,
      event?.payload ?? {}
    )
    if (error) {
      const msg = error?.message ?? String(error)
      useNotificationStore.getState().pushToast({
        kicker: 'LIVE SYNC',
        title: 'Could not sync scores',
        body: liveRoundUserMessage(msg),
        duration: 6000,
      })
      return
    }
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
  if (storeUnsub) {
    storeUnsub()
    storeUnsub = null
  }
}

export function hydrateFromServer(liveState) {
  if (!liveState) return
  useRoundStore.getState().hydrateFromLiveState(liveState)
}

export function subscribeToLiveRound(liveRoundId, onStateUpdate) {
  if (!isSupabaseConfigured || !liveRoundId) return () => {}

  if (roundChannel) {
    supabase.removeChannel(roundChannel)
    roundChannel = null
  }

  roundChannel = supabase
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

  return () => {
    if (roundChannel) {
      supabase.removeChannel(roundChannel)
      roundChannel = null
    }
  }
}

export function subscribeToLiveEvents(liveRoundId, onEvent) {
  if (!isSupabaseConfigured || !liveRoundId) return () => {}

  if (eventsChannel) {
    supabase.removeChannel(eventsChannel)
    eventsChannel = null
  }

  eventsChannel = supabase
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

  return () => {
    if (eventsChannel) {
      supabase.removeChannel(eventsChannel)
      eventsChannel = null
    }
  }
}

export function teardownLiveSync() {
  detachLiveSync()
  if (roundChannel) {
    supabase.removeChannel(roundChannel)
    roundChannel = null
  }
  if (eventsChannel) {
    supabase.removeChannel(eventsChannel)
    eventsChannel = null
  }
}
