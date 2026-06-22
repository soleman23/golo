import {
  adminClient,
  corsHeaders,
  getValidAccessToken,
  grossTotal,
  isGhinEnabled,
  jsonResponse,
  postGhinScore,
  userFromRequest,
} from '../_shared/ghin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!isGhinEnabled()) {
    return jsonResponse({ configured: false, message: 'GHIN integration is not enabled yet.' })
  }

  const user = await userFromRequest(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  let body: { roundId?: string; playerId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'invalid_body' }, 400)
  }

  const { roundId, playerId } = body
  if (!roundId || !playerId) {
    return jsonResponse({ error: 'missing_fields', message: 'roundId and playerId are required.' }, 400)
  }

  const admin = adminClient()
  const { data: roundRow, error: roundErr } = await admin
    .from('rounds')
    .select('id, owner_id, course_id, ghin_posted_at, snapshot')
    .eq('id', roundId)
    .maybeSingle()

  if (roundErr || !roundRow) {
    return jsonResponse({ error: 'round_not_found' }, 404)
  }
  if (roundRow.owner_id !== user.id) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }
  if (roundRow.ghin_posted_at) {
    return jsonResponse({ error: 'already_posted', message: 'This round was already posted to GHIN.' }, 409)
  }

  const snapshot = roundRow.snapshot as Record<string, unknown>
  const scoringType = snapshot.scoringType ?? snapshot.scoring_type ?? 'stroke'
  const teams = (snapshot.teams as unknown[]) ?? []
  const holes = Number(snapshot.holes ?? 18)

  if (scoringType !== 'stroke') {
    return jsonResponse({ error: 'ineligible', message: 'Only individual stroke play rounds can be posted.' }, 400)
  }
  if (teams.length > 0) {
    return jsonResponse({ error: 'ineligible', message: 'Scramble and team rounds cannot be posted.' }, 400)
  }
  if (holes !== 9 && holes !== 18) {
    return jsonResponse({ error: 'ineligible', message: 'Only 9- or 18-hole rounds can be posted.' }, 400)
  }

  const scores = (snapshot.scores as Record<string, Record<string, number>>) ?? {}
  const playerScores = scores[playerId] ?? {}
  const total = grossTotal(playerScores, holes)
  if (total == null) {
    return jsonResponse({ error: 'incomplete_card', message: 'Complete all hole scores before posting.' }, 400)
  }

  const courseId = (snapshot.courseId as string) ?? roundRow.course_id
  if (!courseId) {
    return jsonResponse({ error: 'no_course', message: 'Round is missing course metadata.' }, 400)
  }

  const { data: course, error: courseErr } = await admin
    .from('courses')
    .select('ghin_facility_id, ghin_course_id, ghin_tee_sets')
    .eq('id', courseId)
    .maybeSingle()

  if (courseErr || !course?.ghin_course_id) {
    return jsonResponse({ error: 'course_not_mapped', message: 'This course is not GHIN-mapped yet.' }, 400)
  }

  const tee = (snapshot.tee as { name?: string }) ?? {}
  const teeSets = (course.ghin_tee_sets as Record<string, string>) ?? {}
  const teeSetId = tee.name ? teeSets[tee.name] : null
  if (tee.name && !teeSetId) {
    return jsonResponse({ error: 'tee_not_mapped', message: `Tee "${tee.name}" is not GHIN-mapped yet.` }, 400)
  }

  const accessToken = await getValidAccessToken(admin, user.id)
  if (!accessToken) {
    return jsonResponse({ error: 'not_connected', message: 'Connect GHIN in your locker first.' }, 400)
  }

  const { data: profile } = await admin
    .from('profiles')
    .select('ghin_number')
    .eq('id', user.id)
    .maybeSingle()

  const payload = {
    ghin_number: profile?.ghin_number,
    facility_id: course.ghin_facility_id,
    course_id: course.ghin_course_id,
    tee_set_id: teeSetId,
    played_at: snapshot.date,
    holes,
    gross_score: total,
    score_type: 'home',
    adjusted_gross_score: total,
  }

  try {
    const result = await postGhinScore(accessToken, payload)
    const postId = String(result.id ?? result.score_id ?? result.post_id ?? '')
    const postedAt = new Date().toISOString()

    const nextSnapshot = {
      ...snapshot,
      ghinPostedAt: postedAt,
      ghinPostId: postId || null,
    }

    await admin
      .from('rounds')
      .update({
        ghin_posted_at: postedAt,
        ghin_post_id: postId || null,
        ghin_post_error: null,
        snapshot: nextSnapshot,
      })
      .eq('id', roundId)

    return jsonResponse({
      configured: true,
      postedAt,
      postId: postId || null,
      grossScore: total,
    })
  } catch (err) {
    console.error('[ghin-post-score]', err)
    const message = err instanceof Error ? err.message : 'Post failed'
    await admin
      .from('rounds')
      .update({ ghin_post_error: message.slice(0, 500) })
      .eq('id', roundId)
    if (message.includes('401') || message.includes('403')) {
      return jsonResponse({ error: 'reconnect', message: 'GHIN session expired — reconnect in your locker.' }, 401)
    }
    return jsonResponse({ error: 'post_failed', message }, 502)
  }
})
