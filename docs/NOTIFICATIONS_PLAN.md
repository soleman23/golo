# Player-to-Player Notifications — Build Plan

Working brief for game invites (Flow A) and betting-terms agreement (Flow B).

Supersedes the uploaded Cursor brief, which was accurate about the database but
wrong about the frontend: **most of the UI it asks for already exists on the
unmerged PR #1.** See [Situation](#situation).

Branch: `feat/player-notifications` (off `main`). New migration: **0033**.

---

## Situation

Commit `4a247de chore(db): sync deployed migration history` copied migrations
`0022`–`0028` onto `main` so the repo matched what was **already deployed** to the
Supabase project. Main's copies are byte-identical to the branch's.

The result: production has notifications, betting terms and payments live in the
database, while the shipped app has no UI for any of it. That — not an oversight
in the design — is why nothing in `src/` calls `finalize_betting_terms`.

**PR #1 (`feat/notifications-inbox`, open since 2026-07-15)** holds ~1,200 lines
of the missing frontend. It is 14 commits ahead of the merge base and **18 behind
`main`**, which has since landed course-data enrichment, the unified course
browser, the GHIN flag and perf fixes. A straight rebase would fight a stale
`SetupWizard.jsx` (615 lines differ), `ScoringPage.jsx` (363) and `YouPage.jsx`
(194) — and on `featureFlags.js` / `golfCourseApi.js` the branch is now *behind*
main.

## Decisions

| # | Decision |
| --- | --- |
| D1 | Direct invites are a **second** entry path. The share-link / invite-code join stays as-is. |
| D2 | Accept lands the invitee on `/you` with an "Upcoming games" section. |
| D3 | In-app inbox only. Web Push groundwork (`0024`) stays dormant; jobs queue as `pending`. |
| D4 | "Review" = decline-with-comment, reusing `0025`'s versioning (supersede → new version → everyone re-pends). |
| D5 | `finalize_betting_terms` is called at **Start Round**. Already implemented on PR #1 as `lockBets()`. |
| D6 | On invite accept, membership reuses `join_live_round`'s **server-side key derivation** — claim the matching slot → role `player`, no match → `viewer`. Preserves *role `player` ⟺ owns a scorecard slot*. |
| D7 | Bell lives in a widened `AppHeader` right slot. Already implemented on PR #1 (`showBell`). |
| D8 | **Recovery by porting, not rebasing.** Copy PR #1's pure-addition files, hand-re-apply its integration hunks onto main's current files. |
| D9 | **Scope = notifications + betting + invites.** Payments UI and Web Push stay on the shelf. |

---

## Phase A — recover PR #1 (port, don't rebase)

### A1. Pure additions — copy verbatim, conflict with nothing

```text
src/lib/db/notifications.js        135 lines
src/lib/db/betting.js              142
src/pages/NotificationsPage.jsx    216
src/pages/BettingReviewPage.jsx    218
```

`git checkout feat/notifications-inbox -- <path>` each. Review, don't merge
blind: they were written against a July-15 `main` and must be re-read against
current `supabaseClient` / store APIs before they're trusted.

**Excluded per D9:** `payments.js`, `PaymentsPage.jsx`, `push.js`,
`PushSetupCard.jsx`, `supabase/functions/send-push/`, `public/sw.js`, and the
`main.jsx` service-worker registration.

### A2. Integration hunks — re-apply by hand onto main's current files

| File | Change | Risk |
| --- | --- | --- |
| `App.jsx` | 2 lazy imports + `/notifications` and `/betting/:roundId` routes (**drop the `/payments` route**) | trivial — main's `App.jsx` is unchanged since the merge base |
| `AppHeader.jsx` | `showBell` prop; right slot widened to `flex:1` holding bell + existing `rightAction`; lime `9+` badge | clean — main's copy is unchanged since the merge base |
| `notificationStore.js` | Replace toast-only store with the two-layer store (toasts + durable inbox), add `selectUnreadCount` | **must land together with `LiveNotifications.jsx`** — see below |
| `LiveNotifications.jsx` | Rewritten to subscribe to `public.notifications` instead of replaying `live_round_events` | see below |
| `LiveToast.jsx` | Deep-links on tap | low |
| `SetupWizard.jsx` | `lockBets()` calling `finalizeBettingTerms(liveRoundId, buildTermsSnapshot(rs), null)` at two call sites (branch lines 1461/1505/1543) | **highest** — main's wizard has been rewritten around it |
| `ScoringPage.jsx` | "Review betting terms & acceptance" link in the Active Bets sheet | medium |
| `PayoutsPage.jsx` | `fetchBettingGate` warning banner → `/betting/:roundId` | medium |
| `YouPage.jsx` | Combined notify toggle → a row opening the inbox | medium |

> **Coupling trap.** The branch drops `persist` and `lastSeenByRound` from
> `notificationStore`, because its rewritten `LiveNotifications` reads the
> `notifications` table rather than replaying the `live_round_events` backlog.
> Main's `LiveNotifications` still calls `lastSeenFor` / `markEventSeen`. Porting
> either file alone breaks the build — port both in one commit.

### A3. Gate

`npm run ci` (test + lint + build) green, and the app boots with the bell
rendering a live unread count, before any Phase B work starts.

---

## Phase B — the genuinely new work

Everything below is new; none of it exists on PR #1.

### B1. `supabase/migrations/0033_game_invites.sql`

House conventions: idempotent (`if not exists`, drop-then-recreate for
policies/functions/triggers), `security definer`, `set search_path = public`,
then `revoke all ... from public, anon, authenticated` and `grant execute` only
for client-facing RPCs.

**`public.game_invites`**

```text
id           uuid pk default extensions.gen_random_uuid()
round_id     uuid not null references public.live_rounds(id) on delete cascade
inviter_id   uuid not null references auth.users(id) on delete cascade
invitee_id   uuid not null references auth.users(id) on delete cascade
status       text not null default 'pending'
             check (status in ('pending','accepted','declined','expired','cancelled'))
responded_at timestamptz
created_at   timestamptz not null default now()
unique (round_id, invitee_id)
```

Indexes on `(invitee_id, created_at desc)` and `(round_id)`. RLS enabled. One
policy — `for select to authenticated using (invitee_id = auth.uid() or
inviter_id = auth.uid())`. No insert/update/delete policy; all writes via RPC.

**`send_game_invites(p_round_id uuid, p_invitee_ids uuid[]) → jsonb`**
Caller must be `owner_id`/`scorer_user_id`, round `status = 'live'`. Each invitee
must satisfy the `0011` predicate (`onboarded = true AND (email or phone
non-empty)`). Skip — don't error — anyone already a member or already invited;
return them in `skipped`. Insert one notification each: `game_invite_received`,
`action_url = '/notifications'`, payload `{invite_id, round_id, inviter_name}`,
`dedupe_key = 'invite:' || invite_id`. **No email/phone in the payload**, mirroring
the `0023` fan-out's key stripping. Returns `{ invited: n, skipped: [...] }`.

**`respond_game_invite(p_invite_id uuid, p_accept boolean) → jsonb`**
Invite must be `pending` with `invitee_id = auth.uid()`; re-check status under
`for update` so a double-tap can't double-apply. Round must still be `live`, else
mark the invite `expired`. On accept, mirror `join_live_round` exactly:

```sql
select public.player_key_from_player_json(
         jsonb_build_object('email', email, 'phone', phone, 'name', name, 'guest', false))
  into v_key
  from public.profiles where id = uid;

select s.slot_id into v_slot
  from public.live_round_slots s
 where s.live_round_id = v_round and s.player_key = v_key
 limit 1;
-- slot already claimed by someone else → fall back to 'viewer', never raise
v_role := case when v_slot is not null then 'player' else 'viewer' end;

insert into public.live_round_members
  (live_round_id, user_id, role, player_key, slot_player_id)
values (v_round, uid, v_role, v_key, v_slot)
on conflict (live_round_id, user_id) do nothing;
```

The `0025` `enqueue_betting_acceptance_on_join` trigger then creates their pending
acceptance + notification automatically. Notify the organizer either way
(`game_invite_responded`; accept → "*name* is in for *course*", decline → "*name*
can't make *course*"), and mark the invitee's own `game_invite_received` row read
so the badge clears.

**`invite_status_for_round(p_round_id uuid)`** — any round member; returns invitee
id, display name, status, `responded_at`. **No contact fields**, matching
`peek_live_round`'s redaction discipline.

**`my_upcoming_games()`** — rounds where I accepted an invite, or where I'm a
member with a pending betting acceptance; returns round id, course, organizer
name and terms status so the locker renders in one round-trip.

**Extend `notif_category()`** — redefine carrying **all** existing cases forward
(`0025`'s version is current; dropping its `'betting'` mappings would be a silent
regression), plus `game_invite_received` / `game_invite_responded` →
`'game_changes'`.

**Rewrite `respond_betting_terms`** — closes the doc's gaps #3 and #4.
`drop function public.respond_betting_terms(uuid, boolean)`, recreate as
`(uuid, boolean, text)` with `p_comment text default null` so existing two-arg
PostgREST calls still work. Add `decline_comment` to
`round_betting_acceptances` and store it. After updating the caller's own row,
notify `round_betting_terms.created_by`: `betting_terms_responded`, accept →
"Terms accepted", decline → "Terms sent back for review" plus the quoted comment;
`dedupe_key = 'lr:'||round_id||':betting-resp:'||terms_id||':'||responder_id`.
Skip when responder = creator. Re-apply revoke/grant for the new signature.

`is_betting_active` needs no change — the organizer auto-accepts on finalize, so
it already encodes "everyone except the organizer has accepted."

### B2. Client additions

Extend the ported `src/lib/db/notifications.js` with `sendGameInvites`,
`respondGameInvite`, `fetchInviteStatus`, `fetchUpcomingGames` — each guarding on
`isSupabaseConfigured` and returning a safe empty value on error, matching
`src/lib/db/players.js`.

### B3. Actionable invite cards — `NotificationsPage`

Add a `game_invite_received` branch with **Accept** / **Deny**. Both disabled
while the RPC is in flight; on error show the message and re-enable. Accept →
navigate `/you`, toast "You're in — see your locker." Deny → toast "Organizer
notified." `game_invite_responded` is informational. Rows with `round_id = null`
(deleted round) render text-only with no navigation.

### B4. Invite composer — `SetupWizard`

After `startLiveRound` succeeds (alongside the ported `lockBets()`), call
`sendGameInvites(roundId, ids)` where `ids` comes from **`st.players`** —
`p.userId`, excluding the signed-in organizer.

> The wizard's own rows carry `userId` (`SetupWizard.jsx:1154`), but `commit()`'s
> mapping (`SetupWizard.jsx:1473-1489`) **strips it**. Building invites from the
> committed roster silently sends zero invites.

Surface the summary ("3 invites sent · 1 already in the game") and add a
pending-invite chip list on the review screen from `invite_status_for_round`.
Share-link UI untouched (D1).

### B5. Review-with-comment — `BettingReviewPage`

The ported page has Accept/Decline. Add the **Review** path: a sheet with an
optional comment → `respond_betting_terms(terms_id, false, comment)` → toast
"Sent back for review." Organizer view shows status pills **with comments**. The
existing "Re-lock terms · new version" button already covers the resubmit loop.

**Soft gate.** Drive the banner off `is_betting_active()`, but distinguish three
states — it also returns false when no terms exist at all: *no bets in this round*
(no banner), *terms pending* (amber), *all accepted* (lime).

### B6. Locker — `YouPage`

"Upcoming games" section above the fold from `my_upcoming_games()`. Each card:
course/game, organizer, status pill — "Awaiting betting terms" (disabled) or
"Terms ready → review now" → `/betting/:roundId`.

---

## Edge cases to cover

1. **Double-respond race** — re-check `pending` under `for update`; raise a
   friendly "already responded" the client treats as a refresh.
2. **Invited someone who joined by link first** — `send_game_invites` skips
   existing members. Test it.
3. **Accept after the round completed** — verify `status = 'live'`, else `expired`.
4. **Terms finalized before the invitee accepts** — covered by the `0025`
   late-joiner trigger; test that it fires in this order.
5. **Slot already claimed** — fall back to `viewer`; never raise, or Accept fails.
6. **Re-finalize storm** — 3 resubmits → 3 versions, old acceptances superseded,
   exactly one notification per player per version (`dedupe_key` includes
   `terms_id`). Confirm no duplicate inbox rows.
7. **Self-notification** — invite responses go only to the inviter.
8. **RLS negatives** — a non-party user can read neither the invite nor the
   notifications; no client INSERT on either table.
9. **Round deleted** — `notifications.round_id` is `on delete set null`; cards
   must tolerate it.
10. **Realtime duplicates** — the bell subscription and the inbox page can both be
    mounted; upsert by `id`, never blind-append.
11. **Offline/PWA reload** — inbox is server-fetched on mount; nothing new is
    persisted locally.
12. **Migration order** — `0033` redefines `notif_category` and
    `respond_betting_terms`, so it must run after `0025`; keep it re-runnable.

## Test plan

**Built: `scripts/verify-game-invites.mjs`** (48 assertions, in `npm test`).
A *structural* check over the 0033 SQL — hermetic, so it runs in CI with no
credentials. It guards: the single SELECT-only RLS policy, the verified
predicate, the skip-don't-error paths, the `for update` race lock, the
slot-claim/viewer fallback, payload PII hygiene, the revoke/grant posture, and —
most valuably — that a redefined `notif_category` still maps **every** type
0024/0025 mapped. Verified by mutation: dropping a betting case, adding an INSERT
policy, or granting `notif_category` each make it fail.

> The repo has **no service-role key** and `npm test` is deliberately hermetic
> (the network-dependent verifiers live outside it as `verify:*` scripts). A
> two-account integration test can't run in CI, so the behavioural pass stays
> manual — see below.

**Built: `scripts/verify-invites-e2e.mjs`** (41 assertions, `npm run verify:invites-e2e`).
The real two-account behavioural pass, against a **local** stack
(`npx supabase start && npx supabase db reset --local`). It creates three auth
users and calls every RPC as each of them, so `auth.uid()` and RLS are genuinely
exercised. Talks to PostgREST/GoTrue over plain `fetch` — `@supabase/supabase-js`
eagerly builds a realtime socket that needs Node 22+, and this repo runs Node 20.
Kept out of `npm test` (needs Docker). All 41 pass, including: the slot claim
(`role = 'player'` with the right `slot_player_id`), the organizer notification
with the review comment, the legacy two-arg `respond_betting_terms` call still
resolving, `is_betting_active` false → true → false across a re-finalize, and
every RLS negative.

### Found and fixed while testing: the migrations carried no table grants

On a fresh database **every** table was unreadable by `authenticated` —
`permission denied for table notifications`, and the same for `profiles`,
`live_rounds`, everything. Recent Supabase versions ship a hardened default ACL
for schema `public`: tables created by `postgres` grant anon/authenticated only
`Dxtm` (truncate/references/trigger/maintain), **not**
select/insert/update/delete. RLS filters rows only *after* table privileges are
checked, so no policy could compensate.

The hosted project was provisioned under the older default (full `arwdDxtm`), so
this was latent rather than a live outage — but the chain was not self-contained:
a fresh project, a restore, or a platform default change would have produced a
completely non-functional app.

**`0034_table_grants.sql`** makes the privileges explicit, following the
precedent 0027 already set for `game_type_visibility`. The posture is
deliberately *narrower* than the legacy Supabase default:

| surface | grant |
| --- | --- |
| `courses`, `rounds`, `round_participants`, `profiles`, `notification_devices`, `notification_preferences` | select, insert, update, delete |
| `notifications`, `live_rounds` | select, update |
| `live_round_members`, `live_round_events`, `round_betting_terms`, `round_betting_acceptances`, `payment_requests`, `game_invites` | select |
| `live_round_slots`, `notification_deliveries`, `course_scorecard_cache`, `ghin_connections`, `ghin_oauth_states` | **none** — server-only, definer RPCs |
| `anon` | **nothing on any of these tables** (the `public_profiles` view keeps its own anon SELECT from 0001/0018) |

Each grant mirrors that table's RLS policies exactly. A useful consequence: the
browser can no longer INSERT a `notification` or a `game_invite` even at the
privilege level, not just the policy level. Verified against a fresh
`db reset` — `verify-invites-e2e.mjs` passes 41/41 with no fixture, so the
migration alone covers everything the client touches.

**Remaining manual/PWA pass** (needs a browser, not covered above):
invite → accept → assert membership with the **correct role and claimed slot** →
organizer gets `game_invite_responded`; decline a second invite → "not available"
copy, no membership; finalize terms → late-joiner trigger fires → send back with
a comment → organizer notification carries it and `is_betting_active()` is false
→ re-finalize supersedes + re-notifies → all accept → true. RLS negative: a
non-party C can read neither the invite nor the notifications. Also: bell badge
increments live across two browsers, unread survives reload, and live scoring
toasts still behave after the `LiveNotifications` rewrite.

**Manual/PWA pass:** bell badge increments live across two browsers/accounts;
Accept lands on `/you` with the upcoming-games card; terms round-trip including
Review-with-comment; unread survives reload; live scoring toasts still behave
after the `LiveNotifications` rewrite. `docs/verify-e2e.md` on PR #1 is an
existing two-account script worth recovering alongside the code.

## Out of scope

Payments UI (`PaymentsPage`, `payment_requests` — deployed but dormant), Web Push
(`send-push`, VAPID, service worker) and the missing `docs/push-setup.md`
referenced by `0024`. Invite expiry sweeps (pg_cron), rate limiting on invite
sends, and invite-by-contact for non-registered players.
