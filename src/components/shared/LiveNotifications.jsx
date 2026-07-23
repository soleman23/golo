import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import useNotificationStore from '../../store/notificationStore'
import { subscribeToMyNotifications } from '../../lib/liveRoundSync'
import { isSupabaseConfigured } from '../../lib/supabaseClient'

/**
 * Bridges the durable public.notifications table to the in-app experience:
 * hydrates the inbox on login, keeps it live via Realtime, and raises a transient
 * toast for incoming/re-surfaced items. The bell badge + inbox read from the same
 * store, so unread state is consistent everywhere. Toasts (not the inbox) are
 * suppressed when the user is already on the screen the notification links to.
 */

const KICKER = {
  score_updated: 'SCORES',
  hole_changed: 'LIVE ROUND',
  side_game_flagged: 'SIDE GAME',
  round_finished: 'SETTLE UP',
  player_joined: 'LIVE ROUND',
}

export default function LiveNotifications() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const location = useLocation()

  // Read the current path through a ref so the subscription callback always sees
  // the latest route without re-subscribing on every navigation.
  const pathRef = useRef(location.pathname)
  useEffect(() => {
    pathRef.current = location.pathname
  }, [location.pathname])

  const hydrateInbox = useNotificationStore((s) => s.hydrateInbox)
  const resetInbox = useNotificationStore((s) => s.resetInbox)
  const addIncoming = useNotificationStore((s) => s.addIncoming)
  const applyServerUpdate = useNotificationStore((s) => s.applyServerUpdate)
  const pushToast = useNotificationStore((s) => s.pushToast)

  useEffect(() => {
    if (!isSupabaseConfigured || !userId) {
      resetInbox()
      return undefined
    }

    hydrateInbox()

    const toastFor = (n) => {
      // Redundant when the user is already viewing that exact screen.
      if (n.action_url && pathRef.current === n.action_url) return
      pushToast({
        kicker: KICKER[n.type] ?? 'GOLO',
        title: n.title || 'Round update',
        body: n.message || undefined,
        actionUrl: n.action_url || undefined,
        notificationId: n.id,
      })
    }

    const unsub = subscribeToMyNotifications(userId, {
      onInsert: (n) => {
        addIncoming(n)
        if (!n.read_at) toastFor(n)
      },
      onUpdate: (n) => {
        applyServerUpdate(n)
        // Re-alert only on a server re-surface (unread bump) — not on the
        // read/archive echoes our own actions produce.
        if (!n.archived_at && !n.read_at) toastFor(n)
      },
    })

    return () => { unsub() }
  }, [userId, hydrateInbox, resetInbox, addIncoming, applyServerUpdate, pushToast])

  return null
}
