# Live Rounds — Phase 1 QA Checklist

**Dev URL:** use the port from `npm run dev` (only one instance).  
**Logs:** `debug-ca0e1a.log` in project root after each test pass.

---

## Phase 1A — Scorer

| # | Test | Status | Evidence |
|---|------|--------|----------|
| A1 | Sign in, start round (all players have email/phone) | **PASS** | Log: `startLiveRound ok`, `hasInvite: true` |
| A2 | Scoring shows `/join/CODE` invite + copy | **PASS** | Log: `session snapshot` → `isLiveScorer: true`, `hasInvite: true` |
| A3 | Enter scores + change holes | **TODO** | Expect: `patch scheduled`, `patchLiveRound rpc ok` (no sync error toast) |

---

## Phase 1B — Viewer / Join

Use a **second browser or incognito** + second signed-in account.

| # | Test | Status | Log / UI signal |
|---|------|--------|-----------------|
| B1 | Open `/join/CODE` from scorer’s invite | TODO | `JoinRoundPage peek preview loaded` |
| B2 | Join as **viewer** | TODO | `join ok`, `role: viewer`; Scoring read-only |
| B3 | Scorer updates score → viewer board updates | TODO | Viewer: `realtime update`; scores match |
| B4 | Join as **player** (roster email/phone match) | TODO | `join ok`, `role: player` |
| B5 | Join finished round | TODO | Error: not found / finished |

---

## Phase 1C — Home + Notifications

| # | Test | Status | Notes |
|---|------|--------|-------|
| C1 | Roster player sees “Claim your spot” on Home | TODO | Profile email/phone must match roster |
| C2 | `notifyLive` on (You) → toasts on score/hole/join | TODO | Scorer should not get own `round_started` toast |
| C3 | Live watch banner when already a member | TODO | Hidden if local Resume round exists (known) |

---

## Phase 1D — Finish + Teardown

| # | Test | Status | Log / UI signal |
|---|------|--------|-----------------|
| D1 | Complete round on Payouts | TODO | `completeLiveRound rpc ok` |
| D2 | Session cleared; no invite on return to Scoring | TODO | `liveRoundId` null in store |
| D3 | Viewer after complete | TODO | Join/peek fails or shows finished |

---

## Quick commands

```bash
# Single dev server
npm run dev

# Clear log before a test pass (optional)
# delete debug-ca0e1a.log, then reproduce
```

## Exit criteria (Phase 1)

All **TODO** rows marked PASS → proceed to Phase 2 (fixes if any) → Phase 3 (remove debug instrumentation).
