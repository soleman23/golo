import { useEffect, useState } from 'react'
import { adminMe } from '../lib/db/admin'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import useAuthStore from '../store/authStore'

const COMMISSIONER_EMAIL = 'devinp.sole@gmail.com'
const isCommissionerEmail = (email) =>
  String(email ?? '').trim().toLowerCase() === COMMISSIONER_EMAIL

/**
 * Shared admin identity for You page + Commissioner's Desk guard.
 * @returns {{ isAdmin: boolean, loading: boolean, email: string, name: string, error: unknown }}
 */
export default function useAdmin() {
  const authUserId = useAuthStore((s) => s.user?.id ?? null)
  const authEmail = useAuthStore((s) => s.user?.email ?? '')
  const [state, setState] = useState({
    isAdmin: false,
    loading: true,
    email: '',
    name: '',
    error: null,
  })

  useEffect(() => {
    let active = true
    const isCommissioner = isCommissionerEmail(authEmail)
    if (!isSupabaseConfigured || !authUserId) {
      setState({ isAdmin: false, loading: false, email: '', name: '', error: null })
      return undefined
    }

    setState((prev) => ({ ...prev, loading: true }))
    adminMe().then((res) => {
      if (!active) return
      setState({
        isAdmin: !!res.isAdmin || isCommissioner,
        loading: false,
        email: res.email || authEmail || '',
        name: res.name ?? '',
        error: res.error ?? null,
      })
    })

    return () => {
      active = false
    }
  }, [authUserId, authEmail])

  return state
}
