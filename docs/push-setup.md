# Web Push setup runbook (Phase 3)

Exact steps to turn on Web Push. Client code (3A) and the delivery model + sender
(3B) are already in the repo; this wires up the keys, secrets, deploy, and the
DB→function invocation. Do the steps in order. Nothing here is destructive.

**Chosen delivery model:** immediate (pg_net trigger) **+** cron backstop (pg_cron).

---

## 1. Generate VAPID keys

```bash
node scripts/gen-vapid.mjs
```

Copy the two keys it prints. The **private** key is a secret — never commit it.

## 2. Client public key

Add to `.env.local` (and your Netlify/host env), then restart the dev server:

```
VITE_VAPID_PUBLIC_KEY=<public key>
```

At this point the client half works: open **Notifications → Enable** and confirm a
row lands in `notification_devices` (this is testable before the server is wired).

## 3. Server secrets

Pick any long random string for `PUSH_INVOKE_SECRET` (e.g. `openssl rand -hex 24`).

```bash
npx --no-install supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private> \
  VAPID_SUBJECT=mailto:you@example.com \
  PUSH_INVOKE_SECRET=<random-string>
```

## 4. Apply the delivery-model migration

```bash
npx --no-install supabase db push --linked      # applies 0024_push_delivery.sql
```

## 5. Deploy the Edge Function

`--no-verify-jwt` so the database (cron / pg_net) can call it with just the
shared-secret header:

```bash
npx --no-install supabase functions deploy send-push --no-verify-jwt
```

Function URL will be: `https://<PROJECT_REF>.supabase.co/functions/v1/send-push`

## 6. Enable extensions

Dashboard → Database → Extensions, enable **pg_net** and **pg_cron** (or run the
SQL below via a migration / the CLI — not the SQL editor per project convention):

```sql
create extension if not exists pg_net;
create extension if not exists pg_cron;
```

## 7. Store the function URL + invoke secret in Vault

So the DB can call the function without secrets living in trigger/cron SQL:

```sql
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1/send-push', 'push_fn_url');
select vault.create_secret('<PUSH_INVOKE_SECRET>', 'push_invoke_secret');
```

## 8. Immediate delivery — pg_net trigger

Fires once per enqueue statement and asks the function to drain:

```sql
create or replace function public.invoke_send_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  fn_url text;
  secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'push_fn_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_invoke_secret';
  if fn_url is null then
    return null;  -- not configured yet; the cron backstop will still deliver
  end if;
  perform net.http_post(
    url     := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', coalesce(secret, '')),
    body    := '{}'::jsonb
  );
  return null;
end;
$$;

drop trigger if exists deliveries_invoke_send_push on public.notification_deliveries;
create trigger deliveries_invoke_send_push
  after insert on public.notification_deliveries
  for each statement execute function public.invoke_send_push();

revoke all on function public.invoke_send_push() from public, anon, authenticated;
```

## 9. Cron backstop — every 2 minutes

Retries transient failures and covers any missed immediate call:

```sql
select cron.schedule('drain-push', '*/2 * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'push_fn_url'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret',
                 (select decrypted_secret from vault.decrypted_secrets where name = 'push_invoke_secret')),
    body    := '{}'::jsonb
  );
$$);
```

To change/remove later: `select cron.unschedule('drain-push');`

---

## How it flows

1. A live event fans out `notifications` rows (migration 0023).
2. `notifications_enqueue_push` (0024) inserts one `notification_deliveries` job
   per active device **when the recipient wants push for that category**
   (default: only `settle` / round-finished; everything else is opt-in via
   `notification_preferences.push_enabled`).
3. The `deliveries_invoke_send_push` trigger pings `send-push` immediately; the
   cron job sweeps every 2 min as a backstop.
4. `send-push` sends via VAPID, records `sent`/`failed`/`skipped`, and revokes
   `410 Gone` subscriptions so they stop retrying.

## Test checklist

- [ ] `node scripts/gen-vapid.mjs` → keys set (client env + server secrets).
- [ ] Enable push in the app → row in `notification_devices` (`enabled=true`).
- [ ] Complete a round (fires `round_finished`) as another member → a system push
      arrives with GoLo closed; tapping it opens `/payouts`.
- [ ] `select status, count(*) from notification_deliveries group by 1;` shows
      `sent`.
- [ ] Manually break a subscription (or wait for expiry) → its device flips to
      `enabled=false` / `revoked_at` set, and it stops being retried.
- [ ] Deny permission in the browser → in-app still works; no crash.

## Notes

- **Privacy-safe payloads:** the function sends only the notification's `title` /
  `message` (already privacy-safe) + the deep-link URL. Amounts/betting details
  stay inside the authenticated app.
- **web-push in Deno:** the function imports `npm:web-push`. If the edge runtime
  ever rejects it, swap to a Deno-native sender (e.g. `jsr:@negrel/webpush`) —
  the surrounding drain/record logic is unchanged.
- **Native later:** `notification_devices.provider` already allows `apns`/`fcm`;
  a native app adds device rows and a provider branch in `send-push` with no
  change to events, preferences, or the enqueue rules.
