import useAuthStore from '../store/authStore'
import useProfileStore from '../store/profileStore'
import useHistoryStore from '../store/historyStore'
import { isSupabaseConfigured } from './supabaseClient'
import { fetchProfile, upsertProfile } from './db/profiles'
import { fetchRounds, saveRound as dbSaveRound } from './db/rounds'

/**
 * Bridges the local Zustand stores with Supabase on login/logout.
 *
 * On login:
 *  - Profile: if a remote row exists it wins (hydrates the local store); else we
 *    seed the remote row from whatever the user had locally (first-run migration).
 *  - History: push any local rounds the server doesn't have yet (one-time
 *    migration of pre-backend data), then hydrate the local cache from the server.
 *  - Subscribe to local profile edits and debounce-upsert them to the server.
 *
 * Everything is a no-op when the backend isn't configured, so the app keeps
 * working purely locally.
 */

const PROFILE_FIELDS = [
  'name', 'nickname', 'email', 'phone', 'handicapIndex', 'avatarUrl', 'homeClub',
  'venmo', 'ghinSync', 'notifySettle', 'notifyLive', 'skinsDefault',
]

let currentUserId = null
let unsubscribeProfile = null
let profileDebounce = null

function pickProfile(state) {
  const out = {}
  for (const k of PROFILE_FIELDS) out[k] = state[k]
  return out
}

function startProfileSync(userId) {
  stopProfileSync()
  unsubscribeProfile = useProfileStore.subscribe((state) => {
    clearTimeout(profileDebounce)
    profileDebounce = setTimeout(() => {
      upsertProfile(userId, pickProfile(state))
    }, 600)
  })
}

function stopProfileSync() {
  if (unsubscribeProfile) {
    unsubscribeProfile()
    unsubscribeProfile = null
  }
  clearTimeout(profileDebounce)
  profileDebounce = null
}

export async function syncOnLogin(userId) {
  if (!isSupabaseConfigured || !userId || userId === currentUserId) return

  // ---- profile ----
  const remote = await fetchProfile(userId)
  if (remote) {
    useProfileStore.setState(remote)
  } else {
    const local = pickProfile(useProfileStore.getState())
    const email = local.email ?? useAuthStore.getState().user?.email ?? null
    await upsertProfile(userId, { ...local, email })
  }

  // ---- history: migrate missing local rounds, then hydrate from server ----
  const localRounds = useHistoryStore.getState().rounds ?? []
  const remoteRounds = (await fetchRounds()) ?? []
  const remoteIds = new Set(remoteRounds.map((r) => r?.roundId))
  const toPush = localRounds.filter((r) => r?.roundId && !remoteIds.has(r.roundId))
  for (const r of toPush) await dbSaveRound(r, userId)
  const finalRounds = toPush.length ? ((await fetchRounds()) ?? remoteRounds) : remoteRounds
  useHistoryStore.getState().setRounds(finalRounds)

  // ---- keep the server in step with later profile edits ----
  startProfileSync(userId)
  currentUserId = userId
}

export function syncOnLogout() {
  currentUserId = null
  stopProfileSync()
  // Local cache is intentionally left intact for offline use.
}
