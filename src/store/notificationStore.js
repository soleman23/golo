import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const useNotificationStore = create(
  persist(
    (set, get) => ({
      toasts: [],
      lastSeenByRound: {},

      pushToast: (toast) => {
        const id = toast.id ?? crypto.randomUUID()
        set((s) => ({
          toasts: [...s.toasts, { ...toast, id, at: Date.now() }].slice(-3),
        }))
        return id
      },

      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      clearToasts: () => set({ toasts: [] }),

      markEventSeen: (liveRoundId, eventId) =>
        set((s) => ({
          lastSeenByRound: { ...s.lastSeenByRound, [liveRoundId]: eventId },
        })),

      lastSeenFor: (liveRoundId) => get().lastSeenByRound[liveRoundId] ?? null,
    }),
    { name: 'golo-notifications' }
  )
)

export default useNotificationStore
