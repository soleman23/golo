import { create } from 'zustand'

/**
 * Cloud sync status for the signed-in session. Surfaces errors on Home when
 * profile/history hydration fails instead of failing silently in the console.
 */
const useSyncStore = create((set) => ({
  syncing: false,
  syncError: null,

  setSyncing: (syncing) => set({ syncing }),
  setSyncError: (syncError) => set({ syncError: syncError || null }),
  clearSyncError: () => set({ syncError: null }),
}))

export default useSyncStore
