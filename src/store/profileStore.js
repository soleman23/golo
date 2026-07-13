import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The player's own identity. Users are identified by EMAIL and/or PHONE (player
 * ids are regenerated every round, so contact info is the stable key — see
 * lib/identity.js). The profile also carries a full `name` and a `nickname`
 * (handle). When the profile has no identity at all, Home/You fall back to the
 * most-frequent player across saved history. Persisted so it sticks across
 * sessions.
 *
 * The account/payout fields below back the "You" page's settings rows. There's
 * Venmo is still a local preference. GHIN connection state syncs via Supabase
 * edge functions when the backend and GPA credentials are configured.
 */
const DEFAULT_PROFILE = {
  name: null, // full name, or null
  nickname: null, // handle (shown as @nickname), or null
  email: null, // primary identifier (one of email/phone is expected)
  phone: null, // alternate identifier
  handicapIndex: null, // saved handicap index, or null until known
  avatarUrl: null, // profile photo (Supabase Storage public URL), or null
  onboarded: false, // seen the first-run onboarding flow (set on finish or skip)
  homeClub: null, // optional home-club override; null = auto (most-played course)
  venmo: null, // payout handle, e.g. "@mike"; null = not linked
  ghinNumber: null, // official GHIN # after connect, or null
  ghinConnectedAt: null, // ISO timestamp when OAuth completed
  ghinLastSyncAt: null, // ISO timestamp of last handicap pull
  ghinSync: false, // auto-sync handicap from GHIN on login when connected
  notifySettle: true, // notify on settle-up
  notifyLive: true, // notify on live-round updates
  skinsDefault: null, // saved Skins setup (the wizard selection shape), or null
}

const useProfileStore = create(
  persist(
    (set) => ({
      ...DEFAULT_PROFILE,
      setName: (name) => set({ name: name?.trim() || null }),
      setAvatarUrl: (url) => set({ avatarUrl: url || null }),
      setSkinsDefault: (cfg) => set({ skinsDefault: cfg ?? null }),
      setHandicapIndex: (val) => set({ handicapIndex: val }),
      // Merge any subset of identity fields; pass null to clear a field. Name and
      // phone are kept as typed (they contain spaces) so a controlled input can
      // edit them freely — identity.js normalizes for matching at the point of
      // use. Nickname/email have no spaces, so they're tidied here.
      setIdentity: (fields = {}) =>
        set((state) => {
          const next = {}
          if ('name' in fields) next.name = fields.name?.trim() ? fields.name : null
          if ('phone' in fields) next.phone = fields.phone?.trim() ? fields.phone : null
          if ('nickname' in fields) next.nickname = fields.nickname?.trim().replace(/^@+/, '') || null
          if ('email' in fields) next.email = fields.email?.trim().toLowerCase() || null
          return { ...state, ...next }
        }),
      setHomeClub: (club) => set({ homeClub: club?.trim() ? club : null }),
      setVenmo: (handle) => {
        const h = handle?.trim().replace(/^@/, '') || null
        set({ venmo: h ? `@${h}` : null })
      },
      setGhinSync: (on) => set({ ghinSync: !!on }),
      setGhinMeta: (fields = {}) =>
        set((state) => ({
          ghinNumber: 'ghinNumber' in fields ? fields.ghinNumber : state.ghinNumber,
          ghinConnectedAt: 'ghinConnectedAt' in fields ? fields.ghinConnectedAt : state.ghinConnectedAt,
          ghinLastSyncAt: 'ghinLastSyncAt' in fields ? fields.ghinLastSyncAt : state.ghinLastSyncAt,
          handicapIndex: 'handicapIndex' in fields ? fields.handicapIndex : state.handicapIndex,
        })),
      clearGhinConnection: () =>
        set({
          ghinNumber: null,
          ghinConnectedAt: null,
          ghinLastSyncAt: null,
          ghinSync: false,
        }),
      setNotify: (settle, live) => set({ notifySettle: !!settle, notifyLive: !!live }),
      completeOnboarding: () => set({ onboarded: true }),
      // Back to a blank profile — used when a different account signs in on this
      // device, so the previous owner's identity never leaks into the new one.
      resetProfile: () => set({ ...DEFAULT_PROFILE }),
    }),
    { name: 'golo-profile' }
  )
)

export default useProfileStore
