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
 * no real Venmo/GHIN/push backend in the MVP, so these are local preferences:
 * the toggles and handle persist and drive the row badges, nothing leaves the
 * device.
 */
const useProfileStore = create(
  persist(
    (set) => ({
      name: null, // full name, or null
      nickname: null, // handle (shown as @nickname), or null
      email: null, // primary identifier (one of email/phone is expected)
      phone: null, // alternate identifier
      handicapIndex: null, // saved handicap index, or null until known
      avatarUrl: null, // profile photo (Supabase Storage public URL), or null
      onboarded: false, // seen the first-run onboarding flow (set on finish or skip)
      homeClub: null, // optional home-club override; null = auto (most-played course)
      venmo: null, // payout handle, e.g. "@mike"; null = not linked
      ghinSync: false, // GHIN auto-sync preference (local toggle)
      notifySettle: true, // notify on settle-up
      notifyLive: true, // notify on live-round updates
      skinsDefault: null, // saved Skins setup (the wizard selection shape), or null
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
      setNotify: (settle, live) => set({ notifySettle: !!settle, notifyLive: !!live }),
      completeOnboarding: () => set({ onboarded: true }),
    }),
    { name: 'golo-profile' }
  )
)

export default useProfileStore
