# GoLo notifications & money — end-to-end verification

One two-account pass that exercises everything built in Phases 1–5 (they share
plumbing, so this validates all of it). ~15 minutes.

## Setup

- **Account A** (organizer/scorer) in browser 1; **Account B** (a player) in browser 2 (or a private window / second device). Both signed in.
- Backend must be configured (`.env.local` has `VITE_SUPABASE_*`). Migrations `0022`–`0026` are applied.
- In A: **Round Setup** → pick a course → add yourself **and B as a roster player using B's account email/phone** (so B can claim the slot) → turn on a **money game** (e.g. Nassau with a stake) → **Start Round**.
- In B: open the invite link (A's Play screen / share) → **claim your slot** (matches your email/phone).

## 1. In-app notifications + inbox (Phases 1–2)

- [ ] In A, enter/correct a score. In B **without refreshing**: the header **bell badge increments** and a **toast** appears.
- [ ] With B sitting on `/scoring`, a further score change shows **no toast** (already viewing that screen) but the inbox still updates.
- [ ] In B, tap the bell → inbox lists the item under **Today** → tap it → it **marks read** (badge drops) and deep-links.
- [ ] Reload B → **read/unread state persists**; the item is still in the inbox.
- [ ] In B, archive an item → it leaves the inbox (still retained server-side).
- [ ] A is the actor — A should **not** get toasts for A's own score entries.

## 2. Betting acceptance (Phase 4)

- [ ] When B joined, B received a **"Betting terms are ready for review"** notification. Open it → `/betting/:roundId`.
- [ ] B sees the terms and status **AWAITING ACCEPTANCE**; A shows as **Accepted** (organizer auto-accepts), B as **Pending**.
- [ ] In A, open the **Active Bets** sheet on Scoring → **"Review betting terms & acceptance"** → same screen, B still Pending.
- [ ] In B, tap **Accept terms**. In A's betting screen **without refresh**, B flips to **Accepted** and the banner turns **BET ACTIVE**.
- [ ] (Decline path) Repeat with B **Decline** → B shows Declined; the bet is not active.
- [ ] (Re-lock) In A's `/betting` screen, tap **Re-lock terms · new version** → B is re-pended and re-notified.
- [ ] A player **cannot** accept for another — only your own row has Accept/Decline.

## 3. Payment lifecycle (Phase 5)

- [ ] In A, on **Settle Up**, tap **Complete**. If B owes A (or vice-versa), a **payment request** is created and A lands on `/payments/:roundId`.
- [ ] The **payer** receives a **"new GoLo payment request"** notification → opens `/payments/:roundId` → sees the amount under **YOU OWE**.
- [ ] Payer taps **Mark as sent**. The **recipient** gets a **"marked as sent"** notification; the row shows **Marked sent** on both devices (Realtime).
- [ ] Recipient taps **Confirm received**. The **payer** gets a **"confirmed"** notification; both see **Confirmed**.
- [ ] Only the **payer** sees **Mark as sent**; only the **recipient** sees **Confirm received** (role-enforced in the RPCs — the other party's button never appears).
- [ ] **Dispute** from either side → status **Disputed**, actions stop.
- [ ] Re-completing the round does **not** create duplicate requests (unique per round+payer+recipient).

## 4. Security spot-checks

- [ ] `npm run verify:notifications` → 9/9 (schema + RLS: anon can't read rows or create notifications/devices/prefs).
- [ ] In B's browser devtools, B cannot read A-only rows (RLS): notifications are per-user; betting/payment reads are limited to round members.

## 5. Web Push (separate — needs setup)

Follow `docs/push-setup.md`: generate VAPID keys, set env + secrets, deploy the
`send-push` Edge Function, enable pg_net + pg_cron, add the Vault secrets + the
immediate trigger + the cron job. Then:

- [ ] Chrome/Edge receives a test push with GoLo **closed** (complete a round → payer gets a push).
- [ ] Tapping the push opens the right screen (focuses an existing tab).
- [ ] Denied permission doesn't break the app; expired subscriptions get revoked.
- [ ] iPhone: install to Home Screen first, then enable push, and test on a real device.

## Definition of done (from the guide)

- [ ] Notifications durable + consistent unread state across devices.
- [ ] In-app updates are immediate; deep links land correctly.
- [ ] All betting participants accepted the exact active terms version.
- [ ] Payers mark sent and recipients confirm; neither can act for the other.
- [ ] Ordinary score changes don't spam push (only settle/betting/payments push by default).
- [ ] RLS prevents reading/altering another user's private records.
