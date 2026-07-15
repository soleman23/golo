// send-push — drains pending Web Push delivery jobs and sends them via VAPID.
//
// Invoked by a pg_net trigger (immediate) AND a pg_cron job (retry backstop) —
// both defined in docs/push-setup.md. Idempotent: it only processes 'pending' /
// retryable-'failed' jobs and marks each terminal, so re-invocation never sends
// the same (notification, device) twice.
//
// Auth: a shared secret header `x-push-secret` matching PUSH_INVOKE_SECRET.
// Deploy with `--no-verify-jwt` so the DB (cron / pg_net) can call it with just
// that header.
//
// Secrets (set via `supabase secrets set`): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT, PUSH_INVOKE_SECRET. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// injected automatically.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
const INVOKE_SECRET = Deno.env.get('PUSH_INVOKE_SECRET') ?? ''

const MAX_ATTEMPTS = 5
const BATCH = 50

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

Deno.serve(async (req) => {
  // Only the DB (cron / pg_net) may invoke this.
  if (INVOKE_SECRET && req.headers.get('x-push-secret') !== INVOKE_SECRET) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: 'VAPID keys not configured' }, 500)
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  // Pending or retryable-failed jobs, oldest first, with the notification copy and
  // the target device's subscription keys.
  const { data: jobs, error } = await admin
    .from('notification_deliveries')
    .select(
      'id, attempts, notification:notifications(id, title, message, action_url, dedupe_key), device:notification_devices(id, endpoint_or_token, web_p256dh, web_auth, enabled, revoked_at)',
    )
    .in('status', ['pending', 'failed'])
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  if (error) return json({ error: error.message }, 500)

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const job of jobs ?? []) {
    const n = job.notification
    const d = job.device
    const attempts = (job.attempts ?? 0) + 1

    if (!n || !d || !d.enabled || d.revoked_at || !d.web_p256dh || !d.web_auth) {
      await mark(job.id, { status: 'skipped', attempts, last_error: 'no active device' })
      skipped += 1
      continue
    }

    const payload = JSON.stringify({
      title: n.title || 'GoLo',
      body: n.message || '',
      url: n.action_url || '/',
      tag: n.dedupe_key || undefined,
      notificationId: n.id,
    })

    try {
      await webpush.sendNotification(
        { endpoint: d.endpoint_or_token, keys: { p256dh: d.web_p256dh, auth: d.web_auth } },
        payload,
      )
      await mark(job.id, { status: 'sent', delivered_at: new Date().toISOString(), attempts, last_error: null })
      await admin.from('notification_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', d.id)
      sent += 1
    } catch (err) {
      const code = Number((err as { statusCode?: number })?.statusCode ?? 0)
      if (code === 404 || code === 410) {
        // Subscription gone — revoke it and stop retrying.
        await admin
          .from('notification_devices')
          .update({ enabled: false, revoked_at: new Date().toISOString() })
          .eq('id', d.id)
        await mark(job.id, { status: 'failed', attempts, last_error: `gone ${code}` })
        skipped += 1
      } else {
        // Transient — leave pending for the cron backstop until attempts run out.
        await mark(job.id, {
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          last_error: String((err as Error)?.message ?? err).slice(0, 300),
        })
        failed += 1
      }
    }
  }

  return json({ processed: jobs?.length ?? 0, sent, failed, skipped })
})

function mark(id: string, patch: Record<string, unknown>) {
  return admin.from('notification_deliveries').update(patch).eq('id', id)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
