# GoLo crew launch checklist

Private beta for your foursome — not a public launch. Use this doc for production
wiring, QA, and the group-chat onboarding blurb.

**Supabase project:** `https://kycqhpiejkvjbunyoqhf.supabase.co`  
**GitHub:** `https://github.com/soleman23/golo`

After connecting the repo in Netlify, copy your site URL from **Site configuration → Domain management**
(e.g. `https://your-name.netlify.app`) and substitute it everywhere below as `YOUR-SITE`.

---

## Day 1 — Production is live

### Netlify

1. **Deploys** tab — latest build is green.
2. **Critical:** After importing env vars, **Trigger deploy → Deploy site**. Without a post-env rebuild, the app runs in local-only mode (no auth wall). A quick check: view page source on the live site and search the JS bundles for `supabase.co` — it should appear after a good build.
3. **Site configuration → General → Site details** — pick a readable name (`YOUR-SITE.netlify.app`).
4. Confirm continuous deployment from `main` is on.

### Supabase migrations

Run in order in **SQL Editor** (or Supabase CLI), if not already applied:

| File | Purpose |
|------|---------|
| `supabase/migrations/0001_init.sql` | Tables, RLS, helpers |
| `supabase/migrations/0002_seed_courses.sql` | Course catalogue |
| `supabase/migrations/0003_avatars.sql` | Profile photos + storage bucket |
| `supabase/migrations/0004_profile_handicap.sql` | Handicap on profile |
| `supabase/migrations/0005_ghin.sql` | GHIN OAuth tokens, course mapping, post status |
| `supabase/migrations/0011_admin_course_management.sql` | Admin course catalogue management |
| `supabase/migrations/0012_complete_live_round_any_member.sql` | Any live member can end a live round |

Verify locally:

```bash
npm run verify:prod
```

**GHIN:** Shelved until USGA GPA approval — the edge functions are not deployed and no GHIN UI ships. Nothing to configure for crew week. Players set their Handicap Index by hand on **You → Handicap**. To bring it back later, see [docs/GHIN.md](docs/GHIN.md).

**If 0004 fails**, run in SQL Editor:

```sql
alter table public.profiles add column if not exists handicap_index numeric;
```

Profile sync sends `handicap_index` on every upsert — the column must exist before crew sign-in.

### Supabase Auth URLs

**Authentication → URL configuration**

- **Site URL:** `https://YOUR-SITE.netlify.app`
- **Redirect URLs:** `https://YOUR-SITE.netlify.app/**`

Also add `http://localhost:5173/**` if you test password reset locally.

### Email confirmation (crew week)

**Authentication → Providers → Email**

- **Recommended for crew:** turn **Confirm email OFF** so nobody waits for inbox links on the course.
- If left ON, test sign-up → confirm → sign-in yourself first.

### 5-minute sanity check (production URL)

- [ ] Page loads (not blank — env vars baked into build)
- [ ] Sign up → locker step → Home
- [ ] No `[db] upsertProfile … 42501` in browser console after sign-in
- [ ] Home shows no red sync banner (or Retry clears it)

---

## Day 2 — Crew onboarding (copy/paste)

```
GoLo is live: https://YOUR-SITE.netlify.app

1. Create account (email + password)
2. Add your name on the locker step — signup email counts as contact
3. Add to Home Screen (Safari/Chrome share menu)

Heads up:
• One phone scores the round — live scores don't sync mid-round
• History sharing: other players see shared rounds when emails match profiles
• Settle-up is honor-system — app calculates, no real money movement
```

---

## Day 3 — End-to-end QA (2–4 phones, production)

| Step | Pass |
|------|------|
| Sign up (each player) | Lands on Home after locker |
| Profile | Edit name; optional photo upload |
| New round | Courses load (5 seeded); pick Tetherow / Lost Tracks |
| Players | 2–4 names; Wolf only at 4 |
| Scoring | Hole-by-hole; side games if enabled |
| Settle up | Snapshot saves; history shows round |
| Second device | Same account → history + profile sync |
| Deep link | Refresh `/history`, `/you` — no 404 |

**Multi-player history:** Other players only see a round if their **profile email** matches the email entered when they were added to the round.

### Automated preflight (local, with `.env.local`)

After `npm run build && npm run preview`, open `http://localhost:4173` and confirm auth gate + routes. Run `npm run verify:prod` before crew sign-in.

---

## Day 4 — Launch blockers (fixed in this release)

- Sync errors surface on Home with **Retry** (`src/lib/sync.js`, `src/store/syncStore.js`)
- Forgot password on Auth (`resetPasswordForEmail`)
- Name-only players included in round snapshots (`PayoutsPage`)
- README lists migrations 0003 + 0004

---

## Day 5 — Real round

1. Send the live link before tee time.
2. One person creates the round; use profile emails for cross-device history.
3. Debrief bugs → hotfix → push → Netlify redeploy if critical.

---

## Printable production checklist

- [ ] Netlify build green with env vars (Supabase URL in JS bundle)
- [ ] `npm run verify:prod` passes after all migrations are applied
- [ ] Supabase Site URL + Redirect URLs match `https://YOUR-SITE.netlify.app`
- [ ] Email confirm OFF for crew week (or tested ON flow)
- [ ] Sign up / sign in / sign out on phone
- [ ] Full round saved to history + visible after reload
- [ ] Course picker loads from Supabase
- [ ] Avatar upload works
- [ ] SPA routes work on refresh

---

## After crew week

1. Branded email templates in Supabase
2. Terms + Privacy pages
3. Custom domain on Netlify
4. Avatars on Home/History rosters
5. Analytics / error monitoring (e.g. Sentry)
6. Shared live scoring (larger feature)
