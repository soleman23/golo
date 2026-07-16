# GOLO Notifications — Implementation Plan & Status

Source of truth for building the notification system from `GOLO_Notification_Implementation_Guide.pdf` (July 2026). Build order and scope decisions live here so work resumes cleanly across sessions.

## Scope decisions (agreed)

- **First implementation pass:** Phases 1 + 2 (durable foundation + in-app inbox).
- **Web Push (Phase 3):** deferred. Schema is already push-ready (`notification_devices` is provider-neutral: `web_push` / `apns` / `fcm`).
- **Betting + payments (Phases 4–5):** build the **full** model (versioned frozen terms + per-player accept/decline; payer→recipient two-step payment confirmation with calculation snapshots + dispute/cancel).

## Guiding architecture

- Recipients = Supabase `auth.uid()`, resolved via existing `live_round_members`.
- All writes go through SECURITY-DEFINER functions/triggers — the browser never inserts a notification for anyone.
- Migrations follow the `0008`/`0009` split and are applied with `npx --no-install supabase db push --linked` (never the SQL editor).
- New functions pin `search_path` and revoke EXECUTE from `public/anon/authenticated` unless a client/RLS policy calls them (0020 hardening).
- Transient toasts (`notificationStore` + `LiveToast`) are kept; the durable inbox becomes their backing store.
- No Supabase session (local-only mode) → inbox hidden, toasts behave as today.

---

## Phase 1 — Durable foundation ✅ BUILT

- `supabase/migrations/0022_notifications.sql` — `notifications`, `notification_devices`, `notification_preferences`, `notification_deliveries` (+ indexes, RLS enable). `dedupe_key` unique per user for idempotent fan-out + score coalescing.
- `supabase/migrations/0023_notifications_functions.sql` — RLS (own-row read/update on notifications; full own-row CRUD on devices/preferences; deliveries server-only); `notif_in_app_enabled(uid, category)` helper that falls back to legacy `profiles.notify_live`/`notify_settle` so existing choices are preserved; `fan_out_live_event_notifications()` trigger on `live_round_events` (one durable row per member except the actor, honoring prefs); `notifications` added to the Realtime publication; EXECUTE hardening.
- `src/lib/liveRoundSync.js` — `score_updated` events now carry `{ playerId, playerName, hole, newScore, prevScore, toPar, changedCount }`.
- `src/components/shared/LiveNotifications.jsx` — toast copy renders the enriched score/hole detail.

**Whitelisted events → notifications:** `score_updated` (coalesced), `hole_changed`, `side_game_flagged` (coalesced), `round_finished` → `/payouts`, `player_joined`. `round_started` / `round_updated` / `state_updated` are skipped.

**Applied to production 2026-07-15** via `supabase db push --linked` (history in sync through 0023). Remaining verification: a two-account live-round check that the fan-out trigger actually creates rows for the non-actor member — happens naturally once the Phase 2 inbox surfaces them.

**Done when:** a notification survives refresh / second device; a user can't query another's rows; repeating a request doesn't duplicate; every row has a valid `action_url`.

---

## Phase 2 — In-app inbox & bell ✅ BUILT (lint + build clean 2026-07-15)

- `src/lib/db/notifications.js` — `fetchNotifications({archived})`, `markNotificationRead`, `markAllNotificationsRead`, `archiveNotification`, `fetchPreferences`, `upsertPreference` (direct table ops under RLS — no new RPCs), plus `NOTIFICATION_CATEGORIES`.
- `src/store/notificationStore.js` — durable inbox slice (`inbox`, `inboxReady`, `hydrateInbox`, `addIncoming`, `applyServerUpdate`, optimistic `markRead`/`markAllRead`/`archive`) alongside the transient toasts. **Not persisted** — always hydrated from the server. Unread badge derived via `selectUnreadCount`.
- `src/lib/liveRoundSync.js` — `subscribeToMyNotifications(userId, { onInsert, onUpdate })`; **both** INSERT and UPDATE handled (the trigger's ON CONFLICT DO UPDATE re-surfaces coalesced score/side-game rows as UPDATEs).
- `src/components/shared/LiveNotifications.jsx` — rewritten: hydrates on `userId`, subscribes to the durable table (toasts now come from `notifications`, **not** `live_round_events` → no double toasts, and the actor never self-toasts). Toast suppressed when already on that `action_url`.
- `src/components/shared/LiveToast.jsx` — tapping a toast deep-links to `action_url` + marks read.
- `src/components/shared/AppHeader.jsx` — symmetric 3-column layout + opt-in `showBell` (badge from `selectUnreadCount`, navigates to `/notifications`). Bell added on Home / You / History.
- `src/pages/NotificationsPage.jsx` + `/notifications` route — glass-over-turf inbox (Today/Earlier, tap = mark read + deep-link, archive без delete, empty "No notifications yet.") **plus the split in-app category settings** (`live_score` / `game_changes` / `settle`), each writing `notification_preferences`, falling back to the legacy profile booleans.
- `YouPage` — old combined notify toggle replaced by a "Notifications" row that opens the inbox and shows the unread badge.

**Verification done:** lint (0 errors) + production build pass. **Still to do (manual):** two browsers / one live round → enter + correct a score, confirm the other member's inbox + bell badge update without refresh and survive reload. This is also the end-to-end check of Phase 1's fan-out trigger.

---

## Phases 3–6 — designed, deferred

Schema laid in Phase 1 means these are additive only.

- **Phase 3 · Web Push**
  - **3A — client (✅ BUILT, lint + build clean 2026-07-15):** `public/sw.js` (push display + click routing, focuses an existing tab), registration in `main.jsx` (guarded on `isPushConfigured`, never prompts on load), `src/lib/push.js` (support/permission/standalone checks, subscribe, save/revoke), device persistence via `db/notifications.js` `saveDevice`/`revokeDeviceByEndpoint` (existing owner-CRUD RLS on `notification_devices` — no migration), `PushSetupCard` on the NotificationsPage settings (gated Enable button, iOS Add-to-Home-Screen note, denied-state copy), SW-message→SPA-navigate listener in `LiveNotifications`, and `scripts/gen-vapid.mjs`. Env `VITE_VAPID_PUBLIC_KEY` (blank = push disabled).
    - **Setup before push works:** `node scripts/gen-vapid.mjs` → public key into `.env.local` as `VITE_VAPID_PUBLIC_KEY`; private key + `VAPID_SUBJECT` as Supabase secrets for the Edge Function.
  - **3B — server (✅ CODE BUILT 2026-07-15, not yet deployed):** migration `0024_push_delivery.sql` — per-device delivery jobs (`notification_deliveries.device_id` + unique), `notif_category`/`notif_push_enabled` (conservative default: only `settle`/round-finished pushes; rest opt-in), and the `notifications_enqueue_push` trigger. Edge Function `supabase/functions/send-push/index.ts` drains pending jobs, sends via `npm:web-push` VAPID, records `sent`/`failed`/`skipped`, revokes `410 Gone`. **Chosen invocation: both** — pg_net immediate trigger + pg_cron 2-min backstop. All wiring (VAPID keys, secrets, deploy, extensions, Vault, trigger + cron SQL) is a copy-paste runbook: `docs/push-setup.md`. Migration 0024 is safe to `db push` on its own (no pg_net/pg_cron dependency); pending jobs just wait until the sender is wired.
- **Phase 4 · Betting acceptance**
  - **Foundation (✅ CODE BUILT 2026-07-15, not applied):** `0025_betting_terms.sql` — `round_betting_terms` (versioned, `md5` hash, frozen `terms` jsonb, client-computed `max_exposure`) + `round_betting_acceptances` (per participant, pending/accepted/declined/superseded). RLS: members read both; writes only via RPCs. RPCs: `finalize_betting_terms(round, terms, max_exposure)` (scorer/owner only — supersedes prior version + acceptances, creates pending acceptances for scorer+player members, **auto-accepts the organizer's own**, notifies the rest with `betting_terms_requested`), `respond_betting_terms(terms_id, accept)` (only ever the caller's own row — organizer can't accept for others), `is_betting_active(round)` (current version + all accepted). Betting wired into notifications: `notif_category` maps `betting_terms_requested`→`betting`, push default on; acceptances added to Realtime for live organizer status.
  - **Lock-at-Start-Round model:** terms are frozen at Start Round when only the scorer is a member (organizer auto-accepts). The `live_member_betting_acceptance` trigger (0025) then creates a pending acceptance + `betting_terms_requested` notification for each **player as they join** the live round. Re-finalizing (material change) supersedes the version and re-pends everyone.
  - **UI (✅ BUILT, lint + build clean 2026-07-15):** `src/lib/db/betting.js` (finalize/respond/fetch terms+acceptances/names/Realtime + `buildTermsSnapshot`/`summarizeTerms`), `BettingReviewPage` at `/betting/:roundId` (status banner, terms summary, Accept/Decline own row, live per-player status), and `finalize_betting_terms` wired into SetupWizard Start Round (`lockBets`, guarded on scorer session + bets present). Participants deep-link in from the notification.
  - **Remaining (next increment):** gate the payout as binding on `is_betting_active` (banner on PayoutsPage); an organizer "betting status" entry point from Scoring; re-finalize when bets are edited mid-round. **0025 not yet applied; UI not yet committed.**
- **Phase 5 · Payment lifecycle** — `payment_requests` from **locked** settlements (`engines/payouts.js`), with `calculation_snapshot`. States `pending→viewed→marked_sent→confirmed` (+ `disputed`/`cancelled`); only payer marks sent, only recipient confirms (functions + RLS); Venmo links external, GOLO still waits for both steps.
- **Phase 6 · Selective score push** — enrichment already done; ordinary score push stays off; throttled opt-in pushes for hole-complete / relevant lead changes / decided side-games; never notify the actor.

## Testing & rollout

- Feature-flag the inbox UI; enable for test accounts, then all — the guide's safe-rollout order.
- `scripts/verify-notifications.mjs` (run via `npm run verify:notifications`) — anon-key smoke check of 0022 schema + 0023 RLS (anon can't read rows or create notifications/devices/prefs). Standalone like `verify:prod`, NOT in the credential-free `test`/`ci` chain. ✅ passing as of 2026-07-15.
- Still needed for full Phase 1 coverage: the fan-out trigger's runtime behavior + dedupe coalescing + authenticated cross-user cases — two browsers / one live round: enter + correct a score, confirm the other inbox + badge update without refresh and survive reload.
