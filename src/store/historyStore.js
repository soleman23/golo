import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import useAuthStore from './authStore'
import { deleteRound as dbDeleteRound, deleteAllRounds as dbDeleteAllRounds } from '../lib/db/rounds'

/**
 * Completed-round history, persisted separately from the live round so finishing
 * a round and starting a new one never clobbers past results. Each entry is a
 * self-contained snapshot (standings, bet results, settlements, share text) so a
 * future History screen can render it without re-running the engines.
 */
const useHistoryStore = create(
  persist(
    (set) => ({
      rounds: [],

      // Replace the whole cache — used after hydrating from Supabase on login.
      setRounds: (rounds) => set({ rounds: Array.isArray(rounds) ? rounds : [] }),

      // Upsert by roundId so re-saving the same round (e.g. after an edit) updates
      // in place rather than duplicating. Newest first.
      saveRound: (entry) =>
        set((state) => {
          const exists = state.rounds.some((r) => r.roundId === entry.roundId)
          return {
            rounds: exists
              ? state.rounds.map((r) => (r.roundId === entry.roundId ? entry : r))
              : [entry, ...state.rounds],
          }
        }),

      removeRound: (roundId) => {
        const userId = useAuthStore.getState().user?.id
        if (userId) dbDeleteRound(roundId)
        set((state) => ({
          rounds: state.rounds.filter((r) => r.roundId !== roundId),
        }))
      },

      clearHistory: () => {
        const userId = useAuthStore.getState().user?.id
        if (userId) dbDeleteAllRounds(userId)
        set({ rounds: [] })
      },
    }),
    { name: 'golf-history' }
  )
)

export default useHistoryStore
