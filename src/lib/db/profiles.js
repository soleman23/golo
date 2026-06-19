import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Profiles repository — maps between the camelCase shape used by
 * src/store/profileStore.js and the snake_case `profiles` table columns.
 * All calls no-op gracefully when the backend isn't configured.
 */

const cleanHandicapIndex = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const toDb = (f = {}) => ({
  email: f.email ?? null,
  name: f.name ?? null,
  nickname: f.nickname ?? null,
  phone: f.phone ?? null,
  handicap_index: cleanHandicapIndex(f.handicapIndex),
  avatar_url: f.avatarUrl ?? null,
  home_club: f.homeClub ?? null,
  venmo: f.venmo ?? null,
  ghin_sync: !!f.ghinSync,
  notify_settle: f.notifySettle !== false,
  notify_live: f.notifyLive !== false,
  skins_default: f.skinsDefault ?? null,
})

const fromDb = (r) =>
  r && {
    email: r.email ?? null,
    name: r.name ?? null,
    nickname: r.nickname ?? null,
    phone: r.phone ?? null,
    handicapIndex: cleanHandicapIndex(r.handicap_index),
    avatarUrl: r.avatar_url ?? null,
    homeClub: r.home_club ?? null,
    venmo: r.venmo ?? null,
    ghinSync: !!r.ghin_sync,
    notifySettle: r.notify_settle !== false,
    notifyLive: r.notify_live !== false,
    skinsDefault: r.skins_default ?? null,
  }

export async function fetchProfile(userId) {
  if (!isSupabaseConfigured || !userId) return null
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[db] fetchProfile', error)
    return null
  }
  return fromDb(data)
}

export async function upsertProfile(userId, fields) {
  if (!isSupabaseConfigured || !userId) return { error: null }
  const row = { id: userId, ...toDb(fields) }
  const { error } = await supabase.from('profiles').upsert(row)
  if (error) console.error('[db] upsertProfile', error)
  return { error }
}
