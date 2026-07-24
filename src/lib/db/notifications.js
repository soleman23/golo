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

/* ----------------------------------------------------------- game invites --
 * Player-to-player invites (Flow A, migration 0033). All writes go through
 * SECURITY DEFINER RPCs — the browser never inserts an invite or a notification.
 */

/**
 * Invite verified players to a live round. `inviteeIds` are auth user ids (from
 * the setup roster's resolved verified accounts). Returns
 * { invited, skipped: [{ id, name?, reason }] }; the server skips (never errors
 * on) anyone unverified, already a member, or already invited.
 */
export async function sendGameInvites(roundId, inviteeIds) {
  if (!isSupabaseConfigured || !roundId) return { data: null, error: null }
  const ids = [...new Set((inviteeIds ?? []).filter(Boolean))]
  if (!ids.length) return { data: { invited: 0, skipped: [] }, error: null }
  const { data, error } = await supabase.rpc('send_game_invites', {
    p_round_id: roundId,
    p_invitee_ids: ids,
  })
  if (error) console.error('[db] sendGameInvites', error)
  return { data, error }
}

/**
 * Accept or deny an invite (only ever the caller's own). On accept the server
 * joins the round — claiming the caller's roster slot when it matches, else
 * viewer — and the 0025 trigger enqueues any pending betting acceptance.
 *
 * Accept / already-accepted (while live) returns join-shaped hydrate fields:
 *   { status, live_round_id, role, invite_code, state, course_name, already? }
 * Decline / expired stay slim: { status, role? } | { status:'expired', message }.
 */
export async function respondGameInvite(inviteId, accept) {
  if (!isSupabaseConfigured || !inviteId) return { data: null, error: 'not configured' }
  const { data, error } = await supabase.rpc('respond_game_invite', {
    p_invite_id: inviteId,
    p_accept: accept,
  })
  if (error) console.error('[db] respondGameInvite', error)
  return { data, error }
}

/**
 * Ids of invites addressed to me that are still awaiting a response.
 *
 * The inbox gates its Accept/Deny buttons on this rather than on the
 * notification's read state: marking a row read (tapping the card, or "Mark all
 * read") must not strand an invite that is still pending on the server.
 * Readable directly — game_invites_select_party admits the invitee.
 */
export async function fetchMyPendingInviteIds() {
  if (!isSupabaseConfigured) return new Set()
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth?.user?.id
  if (!uid) return new Set()
  const { data, error } = await supabase
    .from('game_invites')
    .select('id')
    .eq('invitee_id', uid)
    .eq('status', 'pending')
  if (error) {
    console.error('[db] fetchMyPendingInviteIds', error)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.id))
}

/** Invite roster + response status for a round (any member). No contact fields:
 *  each row is { invitee_id, name, status, responded_at }. */
export async function fetchInviteStatus(roundId) {
  if (!isSupabaseConfigured || !roundId) return []
  const { data, error } = await supabase.rpc('invite_status_for_round', { p_round_id: roundId })
  if (error) {
    console.error('[db] fetchInviteStatus', error)
    return []
  }
  return data ?? []
}

/** The signed-in user's upcoming games (accepted invites / pending betting), for
 *  the locker. Each row: { round_id, course_name, status, organizer_name,
 *  started_at, has_terms, terms_status }. */
export async function fetchUpcomingGames() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase.rpc('my_upcoming_games')
  if (error) {
    console.error('[db] fetchUpcomingGames', error)
    return []
  }
  return data ?? []
}
