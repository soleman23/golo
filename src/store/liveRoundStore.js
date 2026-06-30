import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import useRoundStore from './roundStore'
import { resolveLiveRoundRole } from '../lib/liveRoundRole'

export { resolveLiveRoundRole }

const useLiveRoundStore = create(
  persist(
    (set, get) => ({
      liveRoundId: null,
      inviteCode: null,
      role: null, // 'scorer' | 'player' | 'viewer' | null
      scorerName: null,

      setSession: ({ liveRoundId, inviteCode, role, scorerName = null }) =>
        set({ liveRoundId, inviteCode, role, scorerName }),

      clearSession: () =>
        set({ liveRoundId: null, inviteCode: null, role: null, scorerName: null }),

      isScorer: () => get().role === 'scorer',
      isViewer: () => {
        const r = get().role
        return r === 'player' || r === 'viewer'
      },
      isLive: () => !!get().liveRoundId && get().role != null,
    }),
    { name: 'golo-live-round' }
  )
)

/** scorer | player | viewer | local-only */
export function useLiveRoundRole() {
  const role = useLiveRoundStore((s) => s.role)
  const liveRoundId = useLiveRoundStore((s) => s.liveRoundId)
  const roundId = useRoundStore((s) => s.round?.roundId ?? null)
  return resolveLiveRoundRole(role, liveRoundId, roundId)
}

export default useLiveRoundStore
