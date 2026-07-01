# Live Rounds — Fix Strategy

Work top-to-bottom. Each phase is independent and leaves the app working, so you can
commit after any phase. Phase 0 first — it shrinks the diff and makes everything else
reviewable.

> This file is a working checklist. Delete it (or keep it untracked) before the final commit.

---

## Phase 0 — Cleanup (no behavior change, do first)  ✅ DONE (committed `1d2beaa`)

### 0.1 Strip the agent debug scaffolding ✅
- [x] Delete `src/lib/debugLog.js`
- [x] Revert `vite.config.js` to its original (removed `debugLogPlugin` + `fs`/`path` imports)
- [x] In `src/App.jsx`: dropped `flushDebugLog`/`probeLiveRoundHealth` import + the mount `useEffect`
- [x] Removed every `// #region agent log` block + `debugLog`/`dbg` call + imports in
  `SetupWizard.jsx`, `ScoringPage.jsx`, `PayoutsPage.jsx`, `JoinRoundPage.jsx`,
  `liveRounds.js` (incl. `dbg` wrapper), `liveRoundSync.js`

Verified: `grep -rn "#region agent log\|debugLog\|…" src vite.config.js` → no matches; `npm run build` ✓

### 0.2 Remove build/QA artifacts ✅
- [x] Deleted `output/`, `LIVE_ROUNDS_QA.md`, `debug-ca0e1a.log`, `.cursor/debug-ca0e1a.log`
- [x] Added `output/` and `.cursor/` to `.gitignore` (`*.log` already covered the logs)

> Note: `.gitignore` + the `LIVE_ROUNDS_QA.md` deletion are still **uncommitted** — they weren't part of `1d2beaa`. Commit them with your next commit.

---

## Phase 1 — Security (must fix)

> ⚠️ **Deploy step:** 1.1 + 1.2 edit `0009_live_rounds_functions.sql`. They are
> `create or replace`, so re-run that file (or just the two functions) in the
> Supabase SQL editor to apply — code changes alone don't update the live DB.
>
> **1.4 also needs a deploy:** it removes an RLS policy, so the two-function paste
> is NOT enough — either re-run the whole file, or run this one statement:
> `drop policy if exists live_members_insert_self on public.live_round_members;`

### 1.4 ✅ Drop `live_members_insert_self` RLS policy *(direct-insert slot takeover — bypassed 1.1)* — DONE
The self-insert policy only checked `user_id`, letting any authed user POST a
membership row with an arbitrary `role`/`player_key` and claim a slot without
going through `join_live_round`. Removed it (kept the `drop`). Memberships now
come only from the `join_live_round` / `start_live_round` SECURITY DEFINER RPCs.
Verified the client only ever *selects* `live_round_members`, so nothing breaks.

### 1.1 ✅ Stop `join_live_round` from trusting a client-supplied key  *(slot takeover)* — DONE
**File:** `supabase/migrations/0009_live_rounds_functions.sql`, in `join_live_round`.

Replace the claim block (the `if p_claim_player_key is not null …` section) so the slot
is matched against the caller's **own profile key**, derived server-side:

```sql
  -- caller wants to claim a player slot
  if p_claim_player_key is not null and length(trim(p_claim_player_key)) > 0 then
    -- derive the caller's identity key from their profile — never trust the client value
    select public.player_key_from_player_json(
      jsonb_build_object('email', email, 'phone', phone, 'name', name, 'guest', false)
    ) into slot_key
    from public.profiles where id = uid;

    if slot_key is not null then
      select (elem->>'id')::uuid
        into slot_id
        from jsonb_array_elements(lr_state->'players') elem
       where public.player_key_from_player_json(elem) = slot_key
       limit 1;

      if slot_id is not null then
        if exists (
          select 1 from public.live_round_members
          where live_round_id = lr_id and player_key = slot_key
        ) then
          raise exception 'slot already claimed';
        end if;
        member_role := 'player';
      else
        slot_key := null;  -- caller isn't on the roster; fall back to viewer
      end if;
    end if;
  end if;
```
The `p_claim_player_key` argument now signals *intent* only; its value is ignored.
**Done when:** a user whose profile email is NOT on the roster can no longer claim a slot, even if they pass someone else's key.

### 1.2 ✅ Redact PII from `peek_live_round`  *(pre-join contact leak)* — DONE (client switched to `preview.my_slot`)
**File:** same migration, in `peek_live_round`. Strip `email`/`phone` from the returned
roster and hand back the caller's own slot computed server-side:

```sql
  -- caller's identity key (server-derived)
  select public.player_key_from_player_json(
    jsonb_build_object('email', email, 'phone', phone, 'name', name, 'guest', false)
  ) into my_key
  from public.profiles where id = uid;

  -- roster without contact details
  select coalesce(jsonb_agg(elem - 'email' - 'phone'), '[]'::jsonb)
    into redacted_players
    from jsonb_array_elements(lr_state->'players') elem;

  -- the caller's own slot (id + name only), if on the roster
  if my_key is not null then
    select jsonb_build_object('id', elem->>'id', 'name', elem->>'name')
      into my_slot
      from jsonb_array_elements(lr_state->'players') elem
     where public.player_key_from_player_json(elem) = my_key
     limit 1;
  end if;

  return jsonb_build_object(
    'live_round_id', lr_id,
    'course_name', lr_course,
    'invite_code', lr_invite,
    'state', jsonb_set(lr_state, '{players}', redacted_players),
    'my_slot', my_slot,
    'already_member', exists ( … unchanged … ),
    'member_role', ( … unchanged … )
  );
```
Add `my_key text; redacted_players jsonb; my_slot jsonb;` to the `declare` block.

**Client change** — `src/pages/JoinRoundPage.jsx`: the roster match can no longer be
computed client-side (no email/phone in preview). Use the server's answer:
```js
const rosterMatch = preview?.my_slot ?? null
```
Delete the `rosterMatch` `useMemo` and the `playerKey`-on-preview logic. `doJoin` can keep
passing `myKey` (server ignores the value after 1.1).
**Done when:** hitting `/join/CODE` for a round you're not in returns no emails/phones in the network response.

### 1.3 ✅ Keep PII out of synced state entirely — DONE (needs 0008 + 0009 redeploy)
Implemented: new PII-free `live_round_slots(live_round_id, slot_id, player_key)` table
(RLS on, no policy — only the definer RPCs touch it; NOT in the realtime publication).
`start_live_round` gains `p_roster` (full players w/ contacts) and derives slot keys into
it; `serializeRoundState` strips `email`/`phone` so synced `state`/Realtime carry none.
`join`/`peek`/`fetch_claimable` now match claims against `live_round_slots`, not `state`.
Combined with 1.3a (members-table `player_key` no longer co-member-readable), both PII
vectors are closed. Build clean.

_Original plan below:_
1.2 closes the *pre-join* leak, but once someone joins as a viewer, RLS lets them read
the full `live_rounds` row — and Realtime ships every column — so contacts still reach
viewers. The durable fix is to never put email/phone in the synced `state`:

- [ ] `serializeRoundState` (`src/lib/db/liveRounds.js`): map `players` to drop `email`/`phone` (keep `id, name, nickname, color, hdcp, courseHandicap, team, guest, verified`).
- [ ] Persist match keys separately: add a scorer-only `live_round_roster` table (`live_round_id, slot_id uuid, player_key text`), **not** in the `supabase_realtime` publication, RLS = owner/scorer only. Populate it inside `start_live_round` from the full (pre-strip) roster the client passes as a new `p_roster jsonb` arg.
- [ ] `join_live_round` / `peek_live_round` / `fetch_claimable_live_rounds` match the caller's profile key against `live_round_roster`, not against `state`.

Mark this as its own task/PR — it's a schema + RPC-signature change, larger than 1.1/1.2.

---

## Phase 2 — Correctness  ✅ DONE (client-only, no DB redeploy)

### 2.1 ✅ Don't drop events during the debounce window — DONE
**File:** `src/lib/liveRoundSync.js`. `detectEvent` currently compares the final state to
the *last store change*, so a score-then-hole-change inside one 450 ms window loses the
`score_updated` event. Compare against the **last state actually pushed** instead:

```js
let lastPushed = null
// …
debounceTimer = setTimeout(async () => {
  const payload = serializeRoundState(state)
  const event = detectEvent(state, lastPushed ?? prev)
  const { error } = await patchLiveRound(liveRoundId, payload, event?.type ?? null, event?.payload ?? {})
  if (!error) lastPushed = state
  // … existing error toast …
}, 450)
```
Reset `lastPushed = null` in `detachLiveSync()`.
**Optional, fuller fix:** have `patch_live_round` accept `p_events jsonb[]` and insert each, then emit every changed type. Skip unless missing toasts prove annoying.
**Done when:** entering a score and advancing a hole quickly produces both a "Scores updated" and a "Now on hole N" event.

### 2.2 ✅ Delete dead code — DONE
- [x] `src/lib/liveRoundSync.js`: removed the `hydrating` flag + its `requestAnimationFrame` reset
- [x] `src/pages/JoinRoundPage.jsx`: removed `if (role === 'scorer') attachLiveSync()` in `doJoin` + the now-unused `attachLiveSync` import

### 2.3 ✅ Stronger invite codes — DONE (needs 0009 redeploy)
`gen_invite_code` now uses `extensions.gen_random_bytes` with rejection sampling
(reject bytes ≥ 248 = 31×8) for unbiased, cryptographically-random 6-char codes.
`gen_invite_code` uses `random()`. If you want unguessable codes:
```sql
-- inside the loop, replace the per-char random() build with:
result := upper(translate(encode(extensions.gen_random_bytes(5), 'base32'), '=', ''));
result := substr(regexp_replace(result, '[01OI]', '', 'g'), 1, 6);
```
Low priority — joining already requires auth.

---

## Phase 3 — Migration hygiene  ✅ DONE

Collapsed the three overlapping SQL files into a clean, reproducible pair.
- [x] `0008_live_rounds.sql` = **tables + indexes + extension** (all 3 tables). Replaced the "skip this / part 1 of 2" header with a "run this first, then 0009" note.
- [x] `0009_live_rounds_functions.sql` = **functions + RLS + grants only**. Removed the duplicated `create extension`, the `live_rounds missing` guard, and the `live_round_members` / `live_round_events` table+index blocks. Kept the top cleanup drops (idempotent re-runs). New header states it requires 0008 first.
- [x] Deleted `supabase/scripts/live_rounds_finish.sql` and the now-empty `supabase/scripts/` dir.
- [x] Updated the `liveRoundUserMessage` "functions missing" copy to point at `0008` then `0009`.

**Verified:** no stale refs (`live_rounds_finish` / "Step A" / "part 1 of 2") remain; `0009` has no `CREATE TABLE`; `0008` owns all 3 tables; `npm run build` clean.
**Deploy note:** no DB redeploy needed — these are just file/comment reorganizations. The live DB is unchanged; the existing objects already match.

---

## Phase 4 — Polish  ✅ DONE (client-only, no DB redeploy)

- [x] **Extracted `hexA`** to `src/lib/colors.js` and imported it in `JoinRoundPage.jsx` + `LiveToast.jsx` (the two duplicates this feature added). The ~10 pre-existing copies in unrelated pages were left as-is to keep this branch focused — see follow-up below.
- [x] **Re-indented** the `<>…</>` fragment children in `src/App.jsx`.
- [x] **Commented** the `loggedIn: !p.guest` mapping in `SetupWizard.jsx` `commit()`.

**Verified:** `npm run build` clean; eslint clean on all touched files.

### Follow-ups
- [x] **Swept all remaining `hexA` copies** onto `src/lib/colors.js` (`AuthPage`, `YouPage`, `HistoryPage`, `HistoryDetailPage`, `OnboardingPage`, `ScoringPage`, `PayoutsPage`, `HomePage`, `SetupWizard`, `GoloIcons`). 12 consumers now import one helper; build clean, no new lint. (`92cdc0e`)
- Pre-existing lint errors surfaced along the way (`react-hooks/set-state-in-effect` in `SetupWizard.jsx:578` and `YouPage.jsx:191`; `no-empty`/`no-unused-vars` in `support.js`). `npm run lint` is red because of these, none from this feature. Worth a separate cleanup pass.

---

## Phase 5 — Verify

- [ ] **Manual matrix** (two browser profiles / incognito):
  - Scorer starts round → invite chip shows, code copyable
  - Roster player opens `/join/CODE` → can **Claim spot**, lands read-only, sees live scores update as scorer enters them
  - Non-roster user opens `/join/CODE` → only **Watch as viewer**, no contacts in network tab (verifies 1.2)
  - Second user tries to claim an already-claimed slot → blocked (verifies unique index + 1.1)
  - Scorer finishes on Payouts → `complete_live_round` runs, viewers stop updating, sessions torn down
- [ ] `npm run build` clean; no `debugLog`/`#region` left (re-run the Phase 0 grep).

---

### Suggested commit slicing
1. `chore: remove live-round debug scaffolding` (Phase 0)
2. `fix(live): server-side slot-claim auth + peek PII redaction` (Phase 1.1–1.2)
3. `fix(live): preserve events across debounce; drop dead code` (Phase 2)
4. `chore(db): consolidate live-round migrations` (Phase 3)
5. polish (Phase 4) — optional, separate
