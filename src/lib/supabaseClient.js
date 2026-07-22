import { createClient } from '@supabase/supabase-js'

/**
 * Single shared Supabase client for the whole app.
 *
 * Credentials come from Vite env vars (see .env.example). When they're missing
 * — e.g. a fresh clone with no .env.local — we export `null` instead of a broken
 * client and flip `isSupabaseConfigured` to false. Every caller (auth store, db
 * repositories) checks that flag and falls back to the original local-only
 * behaviour, so the app keeps working offline / before the backend is wired up.
 */

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
// Lets local visual tests exercise the offline path even when .env.local has a
// live project configured. DEV is compile-time false in production builds.
const forceLocalOnly = import.meta.env.DEV && import.meta.env.VITE_LOCAL_ONLY === 'true'

export const isSupabaseConfigured = !forceLocalOnly && Boolean(url && anonKey)

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. ' +
      'Running in local-only mode — copy .env.example to .env.local to enable the backend.'
  )
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
