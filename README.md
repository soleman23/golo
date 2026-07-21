# GoLo

A React + Vite golf betting app. Scoring runs client-side; auth and persistent
data (profiles, completed rounds, the course catalogue) are backed by Supabase.

## Backend setup (Supabase)

The app runs in a local-only mode out of the box. To enable accounts and the
shared database:

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env.local` and fill in the values from
   **Project Settings -> API**:

   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

   `.env.local` is gitignored. The anon key is public (protected by row-level
   security) and safe to ship in the client bundle.
3. Apply **every** file in `supabase/migrations/` in filename order. Use the CLI
   against a linked project:

   ```bash
   npx --no-install supabase db push --linked
   ```

   Prefer this over pasting migrations into the SQL Editor. The editor applies
   the SQL but doesn't record it in the migration history, and the resulting
   drift has to be repaired by hand later.

   The set grows over time — don't work from a hand-copied list. The milestones,
   for orientation only:

   | Migration | What it adds |
   |-----------|--------------|
   | `0001_init.sql` | Tables, row-level security, helpers |
   | `0002_seed_courses.sql` | Seeds the course catalogue |
   | `0003_avatars.sql` | Profile photos + `avatars` storage bucket |
   | `0012_admin_course_management.sql` | Admin-only course catalogue management |
   | `0018`–`0021` | Security hardening (security-invoker views, function search paths, revoked anon grants) |
   | `0022`–`0024` | Notifications + push delivery |
   | `0025`–`0028` | Betting terms and payment requests |
   | `0029`–`0031` | Course scorecard cache |

   Verify a linked project with `node scripts/verify-production.mjs` (reads
   `.env.local`). See [docs/LAUNCH.md](docs/LAUNCH.md) for the full crew launch checklist.
   GHIN sync/posting setup: [docs/GHIN.md](docs/GHIN.md).
4. Authentication uses **email + password**. By default Supabase requires email
   confirmation; toggle that under **Authentication -> Providers -> Email** to
   suit your testing.
5. Restart `npm run dev`. The app now gates on a real session, syncs profile and
   round history to Supabase, and loads courses from the database. Existing
   local data is migrated to your account on first login.

To manage courses, bootstrap your owner account once in the Supabase SQL
editor (after applying `0012_admin_course_management.sql`):

```
update public.profiles set is_admin = true where email = 'YOUR_EMAIL@example.com';
```

Clients cannot self-grant `is_admin`. After bootstrap, open **You → Course admin**
(or go to `/admin/courses`) to edit the catalogue and setup visibility.

When the env vars are absent the app silently falls back to the original
local-only behaviour (no login wall, data stays in `localStorage`).

## Deploy to Netlify

The repo includes a [netlify.toml](netlify.toml) with the build command, publish
directory (`dist`), and SPA redirects so routes like `/history` work on refresh.

### 1. Connect the site

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In [Netlify](https://app.netlify.com), **Add new site → Import an existing project**.
3. Pick the repo. Netlify reads `netlify.toml` automatically — no build settings
   to type in by hand.

### 2. Set environment variables

In **Site configuration → Environment variables**, add (same names as `.env.example`):

| Variable | Value |
|----------|--------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon (public) key |

Vite bakes these in at **build** time. After changing them, trigger a new deploy.

### 3. Configure Supabase Auth for your Netlify URL

After the first deploy, copy your site URL (e.g. `https://your-app.netlify.app`).

In the Supabase dashboard (**Authentication → URL configuration**):

- **Site URL**: `https://your-app.netlify.app`
- **Redirect URLs**: add `https://your-app.netlify.app/**`

Without this, sign-in and email confirmation links may fail on production.

See [docs/LAUNCH.md](docs/LAUNCH.md) for the full crew launch checklist (migrations,
auth URLs, QA table, and group-chat onboarding copy).

### 4. Deploy

Netlify builds with `npm run build` and publishes `dist/`. Each push to your main
branch redeploys automatically if continuous deployment is enabled.

**CLI (optional):** `npx netlify-cli deploy --prod` from the project root after
`npm run build`, with the same env vars set locally or in the Netlify UI.

## Development

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
