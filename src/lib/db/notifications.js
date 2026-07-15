import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Durable notification inbox access (Phase 2). All reads/writes are scoped to the
 * signed-in user by RLS (migration 0023) — a client can only ever see or mutate
 * its own rows, and can never create a notification (those come only from the
 * server-side fan-out trigger). No-ops when the backend isn't configured.
 */

const SELECT =
  'id, type, title, message, round_id, actor_user_id, action_url, payload, read_at, archived_at, created_at'

/** The in-app notification categories surfaced in Settings. `legacy` is the
 *  profileStore boolean the server falls back to when no preference row exists. */
export const NOTIFICATION_CATEGORIES = [
  { key: 'live_score',   label: 'Live scoring',   sub: 'Scores as players enter them',       legacy: 'notifyLive' },
  { key: 'game_changes', label: 'Round activity', sub: 'Players joining, side games flagged', legacy: 'notifyLive' },
  { key: 'settle',       label: 'Round finished', sub: 'When it’s time to settle up',         legacy: 'notifySettle' },
]

/** Newest-first inbox items. `archived: true` returns the archived tail instead. */
export async function fetchNotifications({ archived = false, limit = 50 } = {}) {
  if (!isSupabaseConfigured) return []
  let q = supabase
    .from('notifications')
    .select(SELECT)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null)
  const { data, error } = await q
  if (error) {
    console.error('[db] fetchNotifications', error)
    return []
  }
  return data ?? []
}

export async function markNotificationRead(id) {
  if (!isSupabaseConfigured || !id) return { error: null }
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)
  if (error) console.error('[db] markNotificationRead', error)
  return { error }
}

export async function markAllNotificationsRead() {
  if (!isSupabaseConfigured) return { error: null }
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .is('archived_at', null)
  if (error) console.error('[db] markAllNotificationsRead', error)
  return { error }
}

/** Archive without deleting — the row is retained for audit, just hidden. */
export async function archiveNotification(id) {
  if (!isSupabaseConfigured || !id) return { error: null }
  const { error } = await supabase
    .from('notifications')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('[db] archiveNotification', error)
  return { error }
}

/** Per-category preference rows for the signed-in user (may be empty — the
 *  server falls back to the legacy profile booleans when a row is absent). */
export async function fetchPreferences() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('event_type, in_app_enabled, push_enabled')
  if (error) {
    console.error('[db] fetchPreferences', error)
    return []
  }
  return data ?? []
}

/** Upsert one category preference. `patch` is a subset of
 *  { in_app_enabled, push_enabled }; unspecified columns keep their value. */
export async function upsertPreference(eventType, patch) {
  if (!isSupabaseConfigured || !eventType) return { error: null }
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth?.user?.id
  if (!uid) return { error: { message: 'not authenticated' } }
  const row = { user_id: uid, event_type: eventType, updated_at: new Date().toISOString(), ...patch }
  const { error } = await supabase
    .from('notification_preferences')
    .upsert(row, { onConflict: 'user_id,event_type' })
  if (error) console.error('[db] upsertPreference', error)
  return { error }
}
