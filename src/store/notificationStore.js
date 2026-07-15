import { create } from 'zustand'
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  archiveNotification,
} from '../lib/db/notifications'

/**
 * Notifications store, two layers:
 *
 *  - Transient toasts: the ephemeral top-of-screen alerts (unchanged from the
 *    live-round MVP). Not persisted — they auto-dismiss.
 *  - Durable inbox: a mirror of the signed-in user's public.notifications rows.
 *    NEVER persisted — the server is the source of truth and it's re-hydrated on
 *    login and kept live via Realtime (see components/shared/LiveNotifications).
 *    The unread badge is derived from these rows, not from local memory.
 *
 * Optimistic user actions (mark read / archive) update the inbox immediately and
 * then write to Supabase; the Realtime echo reconciles idempotently.
 */
const useNotificationStore = create((set, get) => ({
  // ------------------------------------------------------------ transient toasts
  toasts: [],

  pushToast: (toast) => {
    const id = toast.id ?? crypto.randomUUID()
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id, at: Date.now() }].slice(-3),
    }))
    return id
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clearToasts: () => set({ toasts: [] }),

  // ---------------------------------------------------------------- durable inbox
  inbox: [],
  inboxReady: false,

  hydrateInbox: async () => {
    const rows = await fetchNotifications({ archived: false, limit: 50 })
    set({ inbox: rows, inboxReady: true })
  },

  resetInbox: () => set({ inbox: [], inboxReady: false }),

  /** Realtime INSERT — a brand-new notification. Deduped by id. */
  addIncoming: (n) =>
    set((s) => {
      if (!n?.id || s.inbox.some((x) => x.id === n.id)) return s
      return { inbox: [n, ...s.inbox].slice(0, 100) }
    }),

  /**
   * Realtime UPDATE — reconcile a server echo. Three cases:
   *  - archived → drop from the active inbox,
   *  - re-surfaced unread (coalesce bump) → move to top,
   *  - read → update in place (e.g. our own mark-read, or another device's).
   */
  applyServerUpdate: (n) =>
    set((s) => {
      if (!n?.id) return s
      if (n.archived_at) return { inbox: s.inbox.filter((x) => x.id !== n.id) }
      const rest = s.inbox.filter((x) => x.id !== n.id)
      if (n.read_at) {
        // Keep original order; just refresh the row's fields.
        return { inbox: s.inbox.map((x) => (x.id === n.id ? n : x)) }
      }
      return { inbox: [n, ...rest].slice(0, 100) }
    }),

  // ---- optimistic local mutations ----
  applyRead: (id) =>
    set((s) => ({
      inbox: s.inbox.map((x) =>
        x.id === id && !x.read_at ? { ...x, read_at: new Date().toISOString() } : x,
      ),
    })),

  applyAllRead: () =>
    set((s) => ({
      inbox: s.inbox.map((x) => (x.read_at ? x : { ...x, read_at: new Date().toISOString() })),
    })),

  applyArchived: (id) => set((s) => ({ inbox: s.inbox.filter((x) => x.id !== id) })),

  // ---- server-backed actions (optimistic + write) ----
  markRead: async (id) => {
    get().applyRead(id)
    await markNotificationRead(id)
  },
  markAllRead: async () => {
    get().applyAllRead()
    await markAllNotificationsRead()
  },
  archive: async (id) => {
    get().applyArchived(id)
    await archiveNotification(id)
  },
}))

/** Unread count derived from the live inbox rows (never from local memory). */
export const selectUnreadCount = (s) =>
  s.inbox.reduce((acc, n) => acc + (n.read_at || n.archived_at ? 0 : 1), 0)

export default useNotificationStore
