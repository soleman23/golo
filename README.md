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
3. Run the SQL migrations in order (Supabase Dashboard -> SQL Editor, or the
   Supabase CLI):
   - `supabase/migrations/0001_init.sql` - tables, row-level security, helpers.
   - `supabase/migrations/0002_seed_courses.sql` - seeds the course catalogue.
4. Authentication uses **email + password**. By default Supabase requires email
   confirmation; toggle that under **Authentication -> Providers -> Email** to
   suit your testing.
5. Restart `npm run dev`. The app now gates on a real session, syncs profile and
   round history to Supabase, and loads courses from the database. Existing
   local data is migrated to your account on first login.

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
