import { supabase, isSupabaseConfigured } from '../supabaseClient'
import { courseFromDb } from './courses'

const callError = (label, error) => {
  if (error) console.error(`[db] ${label}`, error)
  return error
}

const profileFromRow = (row) => {
  if (!row) return null
  return {
    id: row.id,
    email: row.email ?? '',
    name: row.name ?? '',
    nickname: row.nickname ?? '',
    phone: row.phone ?? '',
    homeClub: row.home_club ?? '',
    venmo: row.venmo ?? '',
    handicapIndex: row.handicap_index == null ? null : Number(row.handicap_index),
    isAdmin: !!row.is_admin,
    isActive: row.is_active !== false,
    onboarded: !!row.onboarded,
    ghinNumber: row.ghin_number ?? '',
    ghinConnectedAt: row.ghin_connected_at ?? null,
    ghinLastSyncAt: row.ghin_last_sync_at ?? null,
    ghinSync: !!row.ghin_sync,
    notifyLive: row.notify_live !== false,
    notifySettle: row.notify_settle !== false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    roundCount: Number(row.round_count ?? 0),
    roundsOwned: Number(row.rounds_owned ?? 0),
  }
}

const liveRoundFromRow = (row) => {
  if (!row) return null
  return {
    id: row.id,
    inviteCode: row.invite_code ?? '',
    courseName: row.course_name ?? '',
    status: row.status ?? '',
    scorerUserId: row.scorer_user_id ?? null,
    scorerName: row.scorer_name ?? '',
    scorerEmail: row.scorer_email ?? '',
    ownerId: row.owner_id ?? null,
    memberCount: Number(row.member_count ?? 0),
    startedAt: row.started_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

const gameVisibilityFromRow = (row) => {
  if (!row) return null
  return {
    appType: row.app_type ?? '',
    visibleInSetup: row.visible_in_setup !== false,
    updatedAt: row.updated_at ?? null,
  }
}

export async function adminMe() {
  if (!isSupabaseConfigured) return { isAdmin: false, email: '', name: '', error: null }
  const { data, error } = await supabase.rpc('admin_me')
  callError('adminMe', error)

  let payload = data
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      payload = null
    }
  }

  return {
    isAdmin: payload?.is_admin === true || payload?.is_admin === 'true',
    email: payload?.email ?? '',
    name: payload?.name ?? '',
    error,
  }
}

export async function adminDeskStats() {
  if (!isSupabaseConfigured) {
    return {
      stats: { activePlayers: 0, adminCount: 0, adminSeatsCap: 2, roundsPosted: 0 },
      error: null,
    }
  }
  const { data, error } = await supabase.rpc('admin_desk_stats')
  callError('adminDeskStats', error)
  return {
    stats: {
      activePlayers: Number(data?.active_players ?? 0),
      adminCount: Number(data?.admin_count ?? 0),
      adminSeatsCap: Number(data?.admin_seats_cap ?? 2),
      roundsPosted: Number(data?.rounds_posted ?? 0),
    },
    error,
  }
}

export async function adminListProfiles({ search = '', limit = 50, offset = 0 } = {}) {
  if (!isSupabaseConfigured) return { profiles: [], error: null }
  const { data, error } = await supabase.rpc('admin_list_profiles', {
    p_search: search || null,
    p_limit: limit,
    p_offset: offset,
  })
  callError('adminListProfiles', error)
  return {
    profiles: error ? [] : (data ?? []).map(profileFromRow),
    error,
  }
}

export async function adminGetProfile(userId) {
  if (!isSupabaseConfigured) return { profile: null, error: null }
  const { data, error } = await supabase.rpc('admin_get_profile', { p_user_id: userId })
  callError('adminGetProfile', error)
  return { profile: error ? null : profileFromRow(data), error }
}

export async function adminUpdateProfile(userId, fields) {
  if (!isSupabaseConfigured) return { profile: null, error: null }
  const payload = {}
  if ('name' in fields) payload.name = fields.name
  if ('nickname' in fields) payload.nickname = fields.nickname
  if ('handicapIndex' in fields) {
    payload.handicap_index = fields.handicapIndex == null || fields.handicapIndex === ''
      ? null
      : fields.handicapIndex
  }
  if ('isActive' in fields) payload.is_active = !!fields.isActive

  const { data, error } = await supabase.rpc('admin_update_profile', {
    p_user_id: userId,
    p_fields: payload,
  })
  callError('adminUpdateProfile', error)
  return { profile: error ? null : profileFromRow(data), error }
}

export async function adminListLiveRounds(status = 'live') {
  if (!isSupabaseConfigured) return { rounds: [], error: null }
  const { data, error } = await supabase.rpc('admin_list_live_rounds', { p_status: status })
  callError('adminListLiveRounds', error)
  return {
    rounds: error ? [] : (data ?? []).map(liveRoundFromRow),
    error,
  }
}

export async function adminForceCompleteLiveRound(id) {
  if (!isSupabaseConfigured) return { error: null }
  const { error } = await supabase.rpc('admin_force_complete_live_round', { p_id: id })
  callError('adminForceCompleteLiveRound', error)
  return { error }
}

export async function adminListCourses() {
  if (!isSupabaseConfigured) return { courses: [], error: null }
  const { data, error } = await supabase.rpc('admin_list_courses')
  callError('adminListCourses', error)
  return { courses: error ? [] : (data ?? []).map(courseFromDb), error }
}

export async function adminUpsertCourse(course) {
  if (!isSupabaseConfigured) return { course: null, error: null }
  const { data, error } = await supabase.rpc('admin_upsert_course', { p_course: course })
  callError('adminUpsertCourse', error)
  return { course: data ? courseFromDb(data) : null, error }
}

export async function adminSetCourseVisibility(id, visible) {
  if (!isSupabaseConfigured) return { course: null, error: null }
  const { data, error } = await supabase.rpc('admin_set_course_visibility', {
    p_id: id,
    p_visible: visible,
  })
  callError('adminSetCourseVisibility', error)
  return { course: data ? courseFromDb(data) : null, error }
}

export async function adminListGameTypeVisibility() {
  if (!isSupabaseConfigured) return { games: [], error: null }
  const { data, error } = await supabase.rpc('admin_list_game_type_visibility')
  callError('adminListGameTypeVisibility', error)
  return {
    games: error ? [] : (data ?? []).map(gameVisibilityFromRow).filter(Boolean),
    error,
  }
}

export async function adminSetGameTypeVisibility(appType, visible) {
  if (!isSupabaseConfigured) return { game: null, error: null }
  const { data, error } = await supabase.rpc('admin_set_game_type_visibility', {
    p_app_type: appType,
    p_visible: visible,
  })
  callError('adminSetGameTypeVisibility', error)
  return { game: data ? gameVisibilityFromRow(data) : null, error }
}
