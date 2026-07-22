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

/* ------------------------------------------------------------ course photos */

const COURSE_IMAGE_BUCKET = 'course-images'
// Landscape: these render as full-bleed page backdrops, not thumbnails.
const COURSE_IMAGE_WIDTH = 1600
const COURSE_IMAGE_HEIGHT = 1000
const COURSE_IMAGE_QUALITY = 0.85

/** Resize + center-crop to a landscape JPEG blob (cf. uploadAvatar in avatars.js). */
async function toLandscapeJpeg(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = url
    })

    const targetRatio = COURSE_IMAGE_WIDTH / COURSE_IMAGE_HEIGHT
    const sourceRatio = img.naturalWidth / img.naturalHeight
    const cropW = sourceRatio > targetRatio ? img.naturalHeight * targetRatio : img.naturalWidth
    const cropH = sourceRatio > targetRatio ? img.naturalHeight : img.naturalWidth / targetRatio

    const canvas = document.createElement('canvas')
    canvas.width = COURSE_IMAGE_WIDTH
    canvas.height = COURSE_IMAGE_HEIGHT
    canvas
      .getContext('2d')
      .drawImage(
        img,
        (img.naturalWidth - cropW) / 2,
        (img.naturalHeight - cropH) / 2,
        cropW,
        cropH,
        0,
        0,
        COURSE_IMAGE_WIDTH,
        COURSE_IMAGE_HEIGHT
      )

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', COURSE_IMAGE_QUALITY))
    if (!blob) throw new Error('Could not process this image.')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Upload a curated course photo and mark it `curated`, which stops the
 * course-image edge function from ever replacing it with a fetched one.
 */
export async function adminUploadCourseImage(courseId, file) {
  if (!isSupabaseConfigured) return { course: null, error: null }
  if (!courseId) return { course: null, error: new Error('Save the course before adding a photo.') }
  if (!file?.type?.startsWith('image/')) return { course: null, error: new Error('Please choose an image file.') }

  let blob
  try {
    blob = await toLandscapeJpeg(file)
  } catch (e) {
    return { course: null, error: e instanceof Error ? e : new Error('Could not read that image.') }
  }

  const path = `${courseId}.jpg`
  const { error: uploadError } = await supabase.storage
    .from(COURSE_IMAGE_BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
  if (uploadError) {
    callError('adminUploadCourseImage', uploadError)
    return { course: null, error: uploadError }
  }

  // The object path is stable across re-uploads, so without a cache-buster the
  // browser and CDN keep serving the photo this one just replaced.
  const { data: pub } = supabase.storage.from(COURSE_IMAGE_BUCKET).getPublicUrl(path)
  return adminSetCourseImage(courseId, `${pub.publicUrl}?v=${Date.now()}`)
}

/** Clear the photo. Leaves the storage object; the next upload overwrites it. */
export async function adminRemoveCourseImage(courseId) {
  return adminSetCourseImage(courseId, null)
}

export async function adminSetCourseImage(
  id,
  imageUrl,
  source = 'curated',
  attribution = null,
  attributionUrl = null
) {
  if (!isSupabaseConfigured) return { course: null, error: null }
  const { data, error } = await supabase.rpc('admin_set_course_image', {
    p_id: id,
    p_image_url: imageUrl,
    p_source: imageUrl ? source : null,
    p_attribution: attribution,
    p_attribution_url: attributionUrl,
  })
  callError('adminSetCourseImage', error)
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
