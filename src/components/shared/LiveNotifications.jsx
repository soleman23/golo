import { useEffect, useRef } from 'react'
import useAuthStore from '../../store/authStore'
import useProfileStore from '../../store/profileStore'
import useLiveRoundStore from '../../store/liveRoundStore'
import useNotificationStore from '../../store/notificationStore'
import { fetchMyActiveLiveRounds, fetchLiveRoundEventsForRounds } from '../../lib/db/liveRounds'
import { subscribeToLiveEventsMany } from '../../lib/liveRoundSync'
import { isSupabaseConfigured } from '../../lib/supabaseClient'

function eventCopy(type, payload, courseName) {
  switch (type) {
    case 'round_started':
      return { kicker: 'LIVE ROUND', title: `Round started${courseName ? ` · ${courseName}` : ''}` }
    case 'player_joined':
      return { kicker: 'LIVE ROUND', title: 'Someone joined the round', body: payload?.role === 'player' ? 'A roster player claimed their spot.' : 'A viewer is watching.' }
    case 'score_updated':
      return { kicker: 'SCORES', title: 'Scores updated' }
    case 'hole_changed':
      return { kicker: 'LIVE ROUND', title: `Now on hole ${payload?.hole ?? '—'}` }
    case 'side_game_flagged':
      return { kicker: 'SIDE GAME', title: 'Side game updated' }
    case 'round_finished':
      return { kicker: 'SETTLE UP', title: 'Round finished', body: 'Head to History when results are saved.' }
    default:
      return { kicker: 'LIVE ROUND', title: 'Round update' }
  }
}

function shouldNotify(type, notifyLive, notifySettle) {
  if (type === 'round_finished') return notifySettle
  return notifyLive
}

function processBacklog(r, backlog, { notifyLive, notifySettle, pushToast, markSeen }) {
  const lastSeen = useNotificationStore.getState().lastSeenFor(r.id)

  if (!lastSeen && backlog.length) {
    markSeen(r.id, backlog[backlog.length - 1].id)
    return
  }

  let afterMarker = !lastSeen
  for (const ev of backlog) {
    if (!afterMarker) {
      if (ev.id === lastSeen) afterMarker = true
      continue
    }
    if (!shouldNotify(ev.type, notifyLive, notifySettle)) continue
    if (ev.type === 'round_started' && r.role === 'scorer') continue
    const copy = eventCopy(ev.type, ev.payload, r.course_name)
    pushToast({ ...copy, liveRoundId: r.id })
    markSeen(r.id, ev.id)
  }
}

/** Subscribes to live_round_events for active memberships; respects profile prefs. */
export default function LiveNotifications() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const notifyLive = useProfileStore((s) => s.notifyLive)
  const notifySettle = useProfileStore((s) => s.notifySettle)
  const liveRoundId = useLiveRoundStore((s) => s.liveRoundId)
  const pushToast = useNotificationStore((s) => s.pushToast)
  const markSeen = useNotificationStore((s) => s.markEventSeen)

  const roundsRef = useRef([])

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) return undefined

    let cancelled = false
    let unsub = () => {}

    async function wire() {
      const rounds = await fetchMyActiveLiveRounds()
      if (cancelled) return
      roundsRef.current = rounds
      if (!rounds.length) return

      const byRound = await fetchLiveRoundEventsForRounds(rounds.map((r) => r.id))
      if (cancelled) return

      for (const r of rounds) {
        if (cancelled) return
        processBacklog(r, byRound.get(r.id) ?? [], {
          notifyLive,
          notifySettle,
          pushToast,
          markSeen,
        })
      }
      if (cancelled) return

      const roundById = Object.fromEntries(rounds.map((r) => [r.id, r]))
      const nextUnsub = subscribeToLiveEventsMany(rounds.map((r) => r.id), (ev) => {
        const r = roundById[ev.live_round_id]
        if (!r) return
        if (!shouldNotify(ev.type, notifyLive, notifySettle)) return
        if (ev.type === 'round_started' && r.role === 'scorer') return
        const copy = eventCopy(ev.type, ev.payload, r.course_name)
        pushToast({ ...copy, liveRoundId: r.id })
        markSeen(r.id, ev.id)
      })
      if (cancelled) {
        nextUnsub()
        return
      }
      unsub = nextUnsub
    }

    wire()
    return () => {
      cancelled = true
      unsub()
    }
  }, [userId, liveRoundId, notifyLive, notifySettle, pushToast, markSeen])

  return null
}
