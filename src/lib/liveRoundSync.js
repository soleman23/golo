import { supabase, isSupabaseConfigured } from './supabaseClient'
import useRoundStore from '../store/roundStore'
import useLiveRoundStore from '../store/liveRoundStore'
import useNotificationStore from '../store/notificationStore'
import { serializeRoundState, patchLiveRound, liveRoundUserMessage } from './db/liveRounds'
import { debugLog } from './debugLog'

let debounceTimer = null
let storeUnsub = null
let roundChannel = null
let eventsChannel = null
let hydrating = false

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

function schedulePush(state, prev) {
  const { liveRoundId, role } = useLiveRoundStore.getState()
  if (role !== 'scorer' || !liveRoundId || hydrating) return

  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const payload = serializeRoundState(state)
    const event = detectEvent(state, prev)
    // #region agent log
    debugLog('B', 'liveRoundSync.js:schedulePush', 'patch scheduled', {
      liveRoundId,
      eventType: event?.type ?? null,
      hole: state.currentHole,
    })
    // #endregion
    const { error } = await patchLiveRound(
      liveRoundId,
      payload,
      event?.type ?? null,
      event?.payload ?? {}
    )
    if (error) {
      // #region agent log
      debugLog('B', 'liveRoundSync.js:schedulePush', 'patch failed', {
        errorMsg: (error?.message ?? String(error)).slice(0, 120),
      })
      // #endregion
      const msg = error?.message ?? String(error)
      useNotificationStore.getState().pushToast({
        kicker: 'LIVE SYNC',
        title: 'Could not sync scores',
        body: liveRoundUserMessage(msg),
        duration: 6000,
      })
    }
  }, 450)
}

export function attachLiveSync() {
  detachLiveSync()
  if (!isSupabaseConfigured) return

  let prev = useRoundStore.getState()
  storeUnsub = useRoundStore.subscribe((state) => {
    schedulePush(state, prev)
    prev = state
  })
}

export function detachLiveSync() {
  clearTimeout(debounceTimer)
  debounceTimer = null
  if (storeUnsub) {
    storeUnsub()
    storeUnsub = null
  }
}

export function hydrateFromServer(liveState) {
  if (!liveState) return
  hydrating = true
  useRoundStore.getState().hydrateFromLiveState(liveState)
  requestAnimationFrame(() => {
    hydrating = false
  })
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
        // #region agent log
        debugLog('C', 'liveRoundSync.js:subscribeToLiveRound', 'realtime update', {
          hasState: !!payload.new?.state,
          status: payload.new?.status ?? null,
        })
        // #endregion
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
