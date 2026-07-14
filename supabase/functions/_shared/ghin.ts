import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

export { corsHeaders, jsonResponse } from './http.ts'

export function isGhinEnabled() {
  return Deno.env.get('GHIN_ENABLED') === 'true'
}

export function ghinConfig() {
  return {
    enabled: isGhinEnabled(),
    clientId: Deno.env.get('GHIN_CLIENT_ID') ?? '',
    clientSecret: Deno.env.get('GHIN_CLIENT_SECRET') ?? '',
    apiBase: (Deno.env.get('GHIN_API_BASE_URL') ?? '').replace(/\/$/, ''),
    redirectUri: Deno.env.get('GHIN_REDIRECT_URI') ?? '',
    appUrl: (Deno.env.get('GOLO_APP_URL') ?? '').replace(/\/$/, ''),
  }
}

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export async function userFromRequest(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const jwt = authHeader.slice(7)
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data, error } = await client.auth.getUser(jwt)
  if (error || !data.user) return null
  return data.user
}

/** Exchange / refresh tokens — endpoint paths follow GPA docs; adjust when creds arrive. */
export async function exchangeCodeForTokens(code: string) {
  const { clientId, clientSecret, apiBase, redirectUri } = ghinConfig()
  const res = await fetch(`${apiBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GHIN token exchange failed: ${text}`)
  }
  return res.json()
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret, apiBase } = ghinConfig()
  const res = await fetch(`${apiBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GHIN token refresh failed: ${text}`)
  }
  return res.json()
}

export async function getValidAccessToken(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data: conn, error } = await admin
    .from('ghin_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!conn) return null

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  const stale = expiresAt > 0 && expiresAt < Date.now() + 60_000
  if (!stale) return conn.access_token as string
  if (!conn.refresh_token) return null

  const tokens = await refreshAccessToken(conn.refresh_token)
  const nextExpires = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null
  await admin
    .from('ghin_connections')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? conn.refresh_token,
      expires_at: nextExpires,
    })
    .eq('user_id', userId)
  return tokens.access_token as string
}

/** Fetch official handicap index — adjust path/shape per GPA sandbox docs. */
export async function fetchGhinHandicap(accessToken: string) {
  const { apiBase } = ghinConfig()
  const res = await fetch(`${apiBase}/api/v1/golfers/handicap`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GHIN handicap fetch failed: ${text}`)
  }
  const data = await res.json()
  const index = data.handicap_index ?? data.handicapIndex ?? data.index
  const ghinNumber = data.ghin_number ?? data.ghinNumber ?? data.number ?? null
  return { handicapIndex: index != null ? Number(index) : null, ghinNumber }
}

/** Post a gross score — adjust path/body per GPA sandbox docs. */
export async function postGhinScore(accessToken: string, payload: Record<string, unknown>) {
  const { apiBase } = ghinConfig()
  const res = await fetch(`${apiBase}/api/v1/scores`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GHIN score post failed: ${text}`)
  }
  return res.json()
}

export function grossTotal(scores: Record<string, number>, holes: number) {
  let total = 0
  for (let h = 1; h <= holes; h++) {
    const s = scores[String(h)] ?? scores[h]
    if (s == null || !Number.isFinite(Number(s))) return null
    total += Number(s)
  }
  return total
}
