import useRoundStore from '../store/roundStore'
import useAuthStore from '../store/authStore'
import useLiveRoundStore from '../store/liveRoundStore'
import { teardownLiveSync } from './liveRoundSync'
import useProfileStore from '../store/profileStore'
import useHistoryStore from '../store/historyStore'
import useSyncStore from '../store/syncStore'
import { isSupabaseConfigured } from './supabaseClient'
import { fetchProfile, upsertProfile, isMissingColumnError } from './db/profiles'
import { GHIN_ENABLED } from './featureFlags'
import { syncGhinHandicap, isGhinConfiguredResponse } from './ghin/client'
import { isGhinConnected } from './ghin/eligibility'
import { fetchRounds, saveRound as dbSaveRound } from './db/rounds'
import { assertLiveScorer, probeLivePatch, serializeRoundState } from './db/liveRounds'

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
  'venmo', 'ghinNumber', 'ghinConnectedAt', 'ghinLastSyncAt', 'ghinSync',
  'notifySettle', 'notifyLive', 'skinsDefault', 'onboarded',
]

let currentUserId = null
let unsubscribeProfile = null
let profileDebounce = null

// The persisted local cache (live round, history, profile) belongs to the last
// account that synced on this device. If a *different* account signs in, the
// cache must be wiped before hydrating — otherwise the new user inherits the
// old user's in-progress round on Home, their local history gets migrated into
// the new cloud account, and a missing remote profile gets seeded from the old
// identity. A null owner means "never synced" (pre-backend local data), which
// keeps the intentional first-login migration path.
const CACHE_OWNER_KEY = 'golo:cache-owner'

function readCacheOwner() {
  try { return localStorage.getItem(CACHE_OWNER_KEY) } catch { return null }
}

function writeCacheOwner(userId) {
  try { localStorage.setItem(CACHE_OWNER_KEY, userId) } catch { /* private mode */ }
}

function wipeLocalCacheForUserSwitch() {
  teardownLiveSync()
  useLiveRoundStore.getState().clearSession()
  useRoundStore.getState().resetRound()
  useHistoryStore.getState().setRounds([])
  useProfileStore.getState().resetProfile()
}

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

export async function syncOnLogin(userId, { force = false } = {}) {
  if (!isSupabaseConfigured || !userId) return
  if (!force && userId === currentUserId) return

  const prevOwner = readCacheOwner()
  if (prevOwner && prevOwner !== userId) wipeLocalCacheForUserSwitch()
  writeCacheOwner(userId)

  const { setSyncing, setSyncError, clearSyncError, setReady } = useSyncStore.getState()
  setSyncing(true)
  setReady(false)
  clearSyncError()

  try {
    // ---- profile ----
    const remote = await fetchProfile(userId)
    if (remote) {
      useProfileStore.setState(remote)
    } else {
      const local = pickProfile(useProfileStore.getState())
      const email = local.email ?? useAuthStore.getState().user?.email ?? null
      const { error } = await upsertProfile(userId, { ...local, email })
      if (error) throw error
    }

    // ---- history: migrate missing local rounds, then hydrate from server ----
    const localRounds = useHistoryStore.getState().rounds ?? []
    const remoteRounds = (await fetchRounds()) ?? []
    const remoteIds = new Set(remoteRounds.map((r) => r?.roundId))
    const toPush = localRounds.filter((r) => r?.roundId && !remoteIds.has(r.roundId))
    // Cap concurrency so first-login migration isn't M sequential round-trips,
    // without flooding Supabase with unbounded parallel upserts.
    const MIGRATE_CONCURRENCY = 4
    for (let i = 0; i < toPush.length; i += MIGRATE_CONCURRENCY) {
      const chunk = toPush.slice(i, i + MIGRATE_CONCURRENCY)
      const results = await Promise.all(
        chunk.map((r) => dbSaveRound(r, userId).then((res) => ({ roundId: r.roundId, ...res }))),
      )
      for (const res of results) {
        if (res.error) {
          console.warn('[sync] skipped local round migration', res.roundId, res.error)
        }
      }
    }
    const finalRounds = toPush.length ? ((await fetchRounds()) ?? remoteRounds) : remoteRounds
    useHistoryStore.getState().setRounds(finalRounds)

    // Optional: pull official handicap when GHIN is connected and auto-sync is on.
    // Skipped while GHIN is shelved — the edge function isn't deployed, so this
    // would be a failed invoke on every login for anyone holding stale GHIN state.
    const prof = useProfileStore.getState()
    if (GHIN_ENABLED && prof.ghinSync && isGhinConnected(prof)) {
      try {
        const { data, error } = await syncGhinHandicap()
        if (!error && isGhinConfiguredResponse(data)) {
          useProfileStore.getState().setGhinMeta({
            handicapIndex: data.handicapIndex,
            ghinNumber: data.ghinNumber,
            ghinLastSyncAt: data.lastSyncAt,
          })
        }
      } catch (e) {
        console.warn('[sync] GHIN auto-sync skipped', e)
      }
    }

    startProfileSync(userId)
    currentUserId = userId

    const live = useLiveRoundStore.getState()
    if (live.liveRoundId && live.role === 'scorer') {
      const rs = useRoundStore.getState()
      if (rs.round?.roundId === live.liveRoundId) {
        // Only drop the live session on a *definitive* denial: the server says
        // this account is no longer the scorer, or the round is over. Transient
        // failures (auth refresh, a network blip, or a failed fetch that surfaces
        // as "round not found") must NOT kill an otherwise-valid session —
        // schedulePush/ensureLiveScorerAccess re-verify when scoring resumes.
        const check = await assertLiveScorer(live.liveRoundId)
        let denied = check.reason === 'not scorer' || check.reason === 'round not live'
        if (check.ok) {
          const probe = await probeLivePatch(live.liveRoundId, serializeRoundState(rs))
          if (!probe.ok && /not authorized/i.test(probe.reason ?? '')) denied = true
        }
        if (denied) {
          teardownLiveSync()
          useLiveRoundStore.getState().clearSession()
        }
      } else {
        // Persisted session points at a different local round — always stale.
        teardownLiveSync()
        useLiveRoundStore.getState().clearSession()
      }
    }

    setReady(true)
  } catch (err) {
    console.error('[sync] syncOnLogin', err)
    const migrationHint = isMissingColumnError(err)
      ? ' The database is missing migrations — run 0004_profile_handicap.sql and 0005_ghin.sql in the Supabase SQL editor, then retry.'
      : ''
    setSyncError(
      `Could not sync your profile and history.${migrationHint || ' Check your connection, then tap Retry below or sign out and back in.'}`
    )
    setReady(false)
  } finally {
    setSyncing(false)
  }
}

/** Re-run cloud sync (e.g. after a transient error). */
export async function retrySyncOnLogin(userId) {
  currentUserId = null
  await syncOnLogin(userId, { force: true })
}

export function syncOnLogout() {
  currentUserId = null
  stopProfileSync()
  teardownLiveSync()
  useLiveRoundStore.getState().clearSession()
  const { clearSyncError, setReady } = useSyncStore.getState()
  clearSyncError()
  setReady(false)
  // Local cache is intentionally left intact for offline use.
}
