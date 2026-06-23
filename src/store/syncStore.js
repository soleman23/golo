import { create } from 'zustand'

/**
 * Cloud sync status for the signed-in session. Surfaces errors on Home when
 * profile/history hydration fails instead of failing silently in the console.
 */
const useSyncStore = create((set) => ({
  syncing: false,
  syncError: null,
  // True once the first post-login cloud hydration has finished (or been torn
  // down on logout). Lets route gating wait for the real profile before deciding
  // between Home (returning user) and the locker (brand-new account).
  ready: false,

  setSyncing: (syncing) => set({ syncing }),
  setReady: (ready) => set({ ready }),
  setSyncError: (syncError) => set({ syncError: syncError || null }),
  clearSyncError: () => set({ syncError: null }),
}))

export default useSyncStore
