import {
  adminClient,
  corsHeaders,
  ghinConfig,
  isGhinEnabled,
  jsonResponse,
  userFromRequest,
} from '../_shared/ghin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!isGhinEnabled()) {
    return jsonResponse({ configured: false, message: 'GHIN integration is not enabled yet.' })
  }

  const cfg = ghinConfig()
  if (!cfg.clientId || !cfg.redirectUri || !cfg.apiBase) {
    return jsonResponse({ configured: false, message: 'GHIN credentials are incomplete.' })
  }

  const user = await userFromRequest(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  const admin = adminClient()
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const { error: stateErr } = await admin.from('ghin_oauth_states').insert({
    token,
    user_id: user.id,
    expires_at: expiresAt,
  })
  if (stateErr) {
    console.error('[ghin-oauth-start]', stateErr)
    return jsonResponse({ error: 'Could not start GHIN connection.' }, 500)
  }

  const state = `${user.id}.${token}`
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'handicap scores',
    state,
  })
  const url = `${cfg.apiBase}/oauth/authorize?${params.toString()}`
  return jsonResponse({ configured: true, url })
})
