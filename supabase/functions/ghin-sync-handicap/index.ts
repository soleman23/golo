import {
  adminClient,
  corsHeaders,
  fetchGhinHandicap,
  getValidAccessToken,
  isGhinEnabled,
  jsonResponse,
  userFromRequest,
} from '../_shared/ghin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!isGhinEnabled()) {
    return jsonResponse({ configured: false, message: 'GHIN integration is not enabled yet.' })
  }

  const user = await userFromRequest(req)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)

  const admin = adminClient()
  const accessToken = await getValidAccessToken(admin, user.id)
  if (!accessToken) {
    return jsonResponse({ error: 'not_connected', message: 'Connect GHIN in your locker first.' }, 400)
  }

  try {
    const { handicapIndex, ghinNumber } = await fetchGhinHandicap(accessToken)
    const now = new Date().toISOString()
    const { data: profile } = await admin
      .from('profiles')
      .select('ghin_connected_at')
      .eq('id', user.id)
      .maybeSingle()

    await admin
      .from('profiles')
      .update({
        handicap_index: handicapIndex,
        ghin_number: ghinNumber,
        ghin_last_sync_at: now,
        ghin_connected_at: profile?.ghin_connected_at ?? now,
      })
      .eq('id', user.id)

    return jsonResponse({
      configured: true,
      handicapIndex,
      ghinNumber,
      lastSyncAt: now,
    })
  } catch (err) {
    console.error('[ghin-sync-handicap]', err)
    const message = err instanceof Error ? err.message : 'Sync failed'
    if (message.includes('401') || message.includes('403')) {
      return jsonResponse({ error: 'reconnect', message: 'GHIN session expired — reconnect in your locker.' }, 401)
    }
    return jsonResponse({ error: 'sync_failed', message }, 502)
  }
})
