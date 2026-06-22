import {
  adminClient,
  exchangeCodeForTokens,
  fetchGhinHandicap,
  ghinConfig,
  isGhinEnabled,
} from '../_shared/ghin.ts'

Deno.serve(async (req) => {
  const cfg = ghinConfig()
  const appBase = cfg.appUrl || 'http://localhost:5173'
  const redirect = (params: Record<string, string>) => {
    const u = new URL(`${appBase}/you`)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return Response.redirect(u.toString(), 302)
  }

  if (!isGhinEnabled()) {
    return redirect({ ghin: 'pending' })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) {
    return redirect({ ghin: 'error', message: oauthError })
  }
  if (!code || !state) {
    return redirect({ ghin: 'error', message: 'missing_code' })
  }

  const [userId, token] = state.split('.')
  if (!userId || !token) {
    return redirect({ ghin: 'error', message: 'invalid_state' })
  }

  const admin = adminClient()
  const { data: oauthState, error: stateErr } = await admin
    .from('ghin_oauth_states')
    .select('*')
    .eq('token', token)
    .eq('user_id', userId)
    .maybeSingle()

  if (stateErr || !oauthState) {
    return redirect({ ghin: 'error', message: 'state_not_found' })
  }
  if (new Date(oauthState.expires_at).getTime() < Date.now()) {
    await admin.from('ghin_oauth_states').delete().eq('token', token)
    return redirect({ ghin: 'error', message: 'state_expired' })
  }

  try {
    const tokens = await exchangeCodeForTokens(code)
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null

    await admin.from('ghin_connections').upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expires_at: expiresAt,
    })

    let ghinNumber: string | null = null
    let handicapIndex: number | null = null
    try {
      const hdcp = await fetchGhinHandicap(tokens.access_token)
      ghinNumber = hdcp.ghinNumber
      handicapIndex = hdcp.handicapIndex
    } catch (e) {
      console.warn('[ghin-oauth-callback] handicap fetch after connect', e)
    }

    const now = new Date().toISOString()
    await admin
      .from('profiles')
      .update({
        ghin_connected_at: now,
        ghin_last_sync_at: handicapIndex != null ? now : null,
        ghin_number: ghinNumber,
        handicap_index: handicapIndex,
        ghin_sync: true,
      })
      .eq('id', userId)

    await admin.from('ghin_oauth_states').delete().eq('token', token)
    return redirect({ ghin: 'connected' })
  } catch (err) {
    console.error('[ghin-oauth-callback]', err)
    return redirect({ ghin: 'error', message: 'connect_failed' })
  }
})
