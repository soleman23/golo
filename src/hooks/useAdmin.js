import { useEffect, useState } from 'react'
import { adminMe } from '../lib/db/admin'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import useAuthStore from '../store/authStore'
import useProfileStore from '../store/profileStore'

export const COMMISSIONER_EMAIL = 'devinp.sole@gmail.com'

export const isCommissionerEmail = (email) =>
  String(email ?? '').trim().toLowerCase() === COMMISSIONER_EMAIL

/**
 * Shared admin identity for You page + Commissioner's Desk guard.
 * @returns {{ isAdmin: boolean, loading: boolean, email: string, name: string, error: unknown }}
 */
export default function useAdmin() {
  const authUserId = useAuthStore((s) => s.user?.id ?? null)
  const authEmail = useAuthStore((s) => s.user?.email ?? '')
  const profileEmail = useProfileStore((s) => s.email ?? '')
  const [state, setState] = useState({
    isAdmin: false,
    loading: true,
    email: '',
    name: '',
    error: null,
  })

  useEffect(() => {
    let active = true
    const knownEmail = authEmail || profileEmail || ''
    const isCommissioner = isCommissionerEmail(authEmail) || isCommissionerEmail(profileEmail)

    // Show immediately for the known commissioner so the You-page row never
    // waits on (or dies with) a flaky admin_me RPC.
    if (isCommissioner) {
      setState((prev) => ({
        ...prev,
        isAdmin: true,
        email: knownEmail,
        loading: isSupabaseConfigured && !!authUserId,
      }))
    }

    if (!isSupabaseConfigured || !authUserId) {
      setState({
        isAdmin: isCommissioner,
        loading: false,
        email: knownEmail,
        name: '',
        error: null,
      })
      return undefined
    }

    if (!isCommissioner) {
      setState((prev) => ({ ...prev, loading: true }))
    }

    adminMe()
      .then((res) => {
        if (!active) return
        const nextAdmin = !!res.isAdmin || isCommissioner
        if (import.meta.env.DEV) {
          console.info('[useAdmin]', {
            authEmail,
            profileEmail,
            rpcIsAdmin: res.isAdmin,
            rpcError: res.error?.message ?? null,
            nextAdmin,
          })
        }
        setState({
          isAdmin: nextAdmin,
          loading: false,
          email: res.email || knownEmail,
          name: res.name ?? '',
          error: res.error ?? null,
        })
      })
      .catch((error) => {
        if (!active) return
        console.error('[useAdmin] adminMe failed', error)
        setState({
          isAdmin: isCommissioner,
          loading: false,
          email: knownEmail,
          name: '',
          error,
        })
      })

    return () => {
      active = false
    }
  }, [authUserId, authEmail, profileEmail])

  return state
}
