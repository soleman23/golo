# GHIN integration (USGA GPA)

GoLo syncs official Handicap Index values from [GHIN](https://www.ghin.com/) and lets golfers post eligible individual stroke-play rounds back to GHIN. This uses the **USGA Golfer Product Access (GPA)** program — GHIN is **not** a public API.

## Apply for GPA access

1. Read the [GPA Program Overview](https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/GPA-Program-Overview.html).
2. Review [GPA Approved Vendors](https://www.usga.org/content/usga/home-page/handicapping/world-handicap-system/GPA-Approved-Vendors.html) for comparable integrations.
3. Submit a vendor application requesting:
   - **Handicap Index read** (sync to profile)
   - **Course / tee lookup** (map GoLo courses to GHIN facility/course/tee-set ids)
   - **Score posting** (individual stroke play, 9- and 18-hole gross scores)
4. Expect **3–6 weeks** for approval and **2–4 weeks** for a basic integration once sandbox credentials are issued.

Do **not** scrape GHIN or use unofficial wrappers — that violates USGA terms and risks account bans.

## Architecture

- **Client (Vite SPA):** Connect / sync UI on You, “Post to GHIN” on Payouts for eligible rounds.
- **Supabase Edge Functions:** OAuth, handicap sync, score posting. GHIN client secrets never ship to the browser.
- **Database:** `ghin_connections` stores OAuth tokens (service-role only). `profiles` stores connection metadata the client may read.

## Database migration

Run after 0001–0004:

```bash
# Supabase SQL Editor
supabase/migrations/0005_ghin.sql
```

Verify:

```bash
npm run verify:prod
```

## Supabase secrets (Edge Functions)

Set in **Project Settings → Edge Functions → Secrets** (never commit):

| Secret | Purpose |
|--------|---------|
| `GHIN_ENABLED` | `true` when GPA credentials are ready; `false` (default) returns stub responses |
| `GHIN_CLIENT_ID` | OAuth client id from USGA |
| `GHIN_CLIENT_SECRET` | OAuth client secret |
| `GHIN_API_BASE_URL` | GPA API base URL (sandbox or production) |
| `GHIN_REDIRECT_URI` | OAuth callback URL → `https://<project-ref>.supabase.co/functions/v1/ghin-oauth-callback` |
| `GOLO_APP_URL` | Production SPA URL for post-OAuth redirect (e.g. `https://your-app.netlify.app`) |

Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` automatically to edge functions.

## Deploy edge functions

```bash
supabase functions deploy ghin-oauth-start
supabase functions deploy ghin-oauth-callback --no-verify-jwt
supabase functions deploy ghin-sync-handicap
supabase functions deploy ghin-post-score
```

Register `GHIN_REDIRECT_URI` with USGA to match the deployed `ghin-oauth-callback` URL.

## Course mapping

GHIN score posting requires official facility/course/tee-set ids. Until GPA provides a course catalog API, map rows manually in `courses`:

```sql
update public.courses
set
  ghin_facility_id = 'YOUR_FACILITY_ID',
  ghin_course_id = 'YOUR_COURSE_ID',
  ghin_tee_sets = '{"Tan": "TEE_SET_ID", "Sage": "TEE_SET_ID_2"}'::jsonb
where id = 'tetherow';
```

Courses without mapping show “Course not GHIN-mapped” on post.

## Posting rules (GoLo)

Posting is allowed only when **all** are true:

- Individual **stroke play** (not scramble, stableford, or match play)
- **9 or 18 holes** with a complete gross scorecard for the signed-in player
- User has an active GHIN connection
- Course + tee are GHIN-mapped
- Round has not already been posted

Side games (skins, wolf, etc.) do not block posting — only the gross stroke total is sent.

## Compliance

- Display “Official GHIN Handicap Index” only when data comes from the GPA API.
- Obtain explicit user consent before OAuth connect.
- Store tokens server-side only; never log access tokens.
- Follow USGA data retention and branding guidelines from your GPA agreement.

## Local development

With `GHIN_ENABLED=false`, edge functions return `{ configured: false }` and the UI shows “GHIN integration pending.” Enable sandbox credentials when USGA provides them.
