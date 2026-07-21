import { create } from 'zustand'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

/**
 * Supabase auth session, surfaced as a Zustand store so route guards and the
 * "You" page can react to login/logout. Supabase persists the session itself
 * (localStorage), so this store is NOT persisted — it just mirrors the live
 * session and exposes email/password actions.
 *
 * When Supabase isn't configured (`isSupabaseConfigured === false`) the store
 * stays in a benign "disabled" state: `enabled` is false and the app falls back
 * to its original local-only verification gate (see App.jsx).
 */
const useAuthStore = create((set, get) => ({
  enabled: isSupabaseConfigured,
  session: null,
  user: null,
  loading: isSupabaseConfigured, // true until the first session check resolves
  initialized: false,

  // Call once on app start. Loads the current session and subscribes to changes.
  init: async () => {
    if (get().initialized) return
    set({ initialized: true })

    if (!isSupabaseConfigured) {
      set({ loading: false })
      return
    }

    const { data } = await supabase.auth.getSession()
    set({ session: data.session ?? null, user: data.session?.user ?? null, loading: false })

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session: session ?? null, user: session?.user ?? null, loading: false })
    })
  },

  // Create an account. Returns { error } so the form can show backend messages.
  signUp: async ({ email, password }) => {
    if (!isSupabaseConfigured) return { error: new Error('Auth backend is not configured.') }
    const emailRedirectTo = typeof window !== 'undefined' ? `${window.location.origin}/` : undefined
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: emailRedirectTo ? { emailRedirectTo } : undefined,
    })
    if (!error) set({ session: data.session ?? null, user: data.session?.user ?? null })
    return { data, error }
  },

  signIn: async ({ email, password }) => {
    if (!isSupabaseConfigured) return { error: new Error('Auth backend is not configured.') }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    // Derive `user` from the session only — never treat someone as logged in
    // without a valid session (that would trigger RLS-failing writes).
    if (!error) set({ session: data.session ?? null, user: data.session?.user ?? null })
    return { data, error }
  },

  signOut: async () => {
    if (!isSupabaseConfigured) return { error: null }
    const { error } = await supabase.auth.signOut()
    if (!error) set({ session: null, user: null })
    return { error }
  },

  resetPassword: async (email) => {
    if (!isSupabaseConfigured) return { error: new Error('Auth backend is not configured.') }
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo,
    })
    return { error }
  },
}))

export default useAuthStore
