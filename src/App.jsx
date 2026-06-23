import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import useProfileStore from './store/profileStore'
import useAuthStore from './store/authStore'
import useSyncStore from './store/syncStore'
import { hasContact } from './lib/identity'
import { retrySyncOnLogin, syncOnLogin, syncOnLogout } from './lib/sync'

const HomePage = lazy(() => import('./pages/HomePage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const AuthPage = lazy(() => import('./pages/AuthPage'))
const YouPage = lazy(() => import('./pages/YouPage'))
const SetupWizard = lazy(() => import('./pages/SetupWizard'))
const ScoringPage = lazy(() => import('./pages/ScoringPage'))
const PayoutsPage = lazy(() => import('./pages/PayoutsPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const HistoryDetailPage = lazy(() => import('./pages/HistoryDetailPage'))

/** The signed-in app's full route tree. */
function MainRoutes() {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/onboarding" element={<Navigate to="/" replace />} />
        <Route path="/setup" element={<SetupWizard />} />
        {/* Legacy multi-page setup flow replaced by the single SetupWizard.
            Old routes redirect so any bookmarks still land on setup. */}
        <Route path="/setup/*" element={<Navigate to="/setup" replace />} />
        <Route path="/you" element={<YouPage />} />
        <Route path="/scoring" element={<ScoringPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:roundId" element={<HistoryDetailPage />} />
      </Routes>
    </Suspense>
  )
}

/** Profile-setup gate: collect a contact identity before entering the app. */
function OnboardingGate({ lockerOnly }) {
  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/onboarding" element={<OnboardingPage lockerOnly={lockerOnly} />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    </Suspense>
  )
}

/** Minimal splash shown while the initial Supabase session check resolves. */
function Splash() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
      }}
    />
  )
}

function SyncErrorGate({ message, syncing, userId, onRetry, onSignOut }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 22,
        boxSizing: 'border-box',
        background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
        color: '#fff',
        fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      }}
    >
      <div style={{ width: '100%', maxWidth: 380, borderRadius: 22, padding: 20, background: 'rgba(20,28,24,.72)', border: '1px solid rgba(255,255,255,.16)', boxShadow: '0 18px 48px rgba(0,0,0,.38)' }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.4, color: '#d4f23a', marginBottom: 8 }}>SYNC NEEDED</div>
        <div style={{ fontSize: 23, fontWeight: 850, letterSpacing: -0.4 }}>Could not load your locker.</div>
        <p style={{ margin: '10px 0 18px', fontSize: 14, lineHeight: 1.5, color: 'rgba(255,255,255,.72)' }}>
          {message}
        </p>
        <button
          type="button"
          onClick={() => userId && onRetry(userId)}
          disabled={syncing || !userId}
          style={{ width: '100%', border: 'none', borderRadius: 15, padding: 14, fontSize: 15, fontWeight: 850, color: '#13250a', background: '#d4f23a', cursor: syncing || !userId ? 'not-allowed' : 'pointer', opacity: syncing || !userId ? 0.65 : 1 }}
        >
          {syncing ? 'Retrying...' : 'Retry sync'}
        </button>
        <button
          type="button"
          onClick={onSignOut}
          style={{ width: '100%', marginTop: 11, border: '1px solid rgba(255,255,255,.16)', borderRadius: 15, padding: 13, fontSize: 14, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.08)', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const authEnabled = useAuthStore((s) => s.enabled)
  const session = useAuthStore((s) => s.session)
  const authLoading = useAuthStore((s) => s.loading)
  const initAuth = useAuthStore((s) => s.init)
  const signOut = useAuthStore((s) => s.signOut)

  const name = useProfileStore((s) => s.name)
  const nickname = useProfileStore((s) => s.nickname)
  const email = useProfileStore((s) => s.email)
  const phone = useProfileStore((s) => s.phone)
  const onboarded = useProfileStore((s) => s.onboarded)

  const userId = useAuthStore((s) => s.user?.id ?? null)
  const syncReady = useSyncStore((s) => s.ready)
  const syncing = useSyncStore((s) => s.syncing)
  const syncError = useSyncStore((s) => s.syncError)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  // Hydrate/migrate local stores to Supabase on login; tear down on logout.
  useEffect(() => {
    if (!authEnabled || authLoading) return
    if (session && userId) syncOnLogin(userId)
    else syncOnLogout()
  }, [authEnabled, authLoading, session, userId])

  const profileComplete = onboarded && hasContact({ name, nickname, email, phone })

  // Backend configured: a verified Supabase session is the real gate — everyone
  // must sign in before they can continue.
  if (authEnabled) {
    if (authLoading) return <Splash />
    if (!session) {
      return (
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="*" element={<AuthPage />} />
          </Routes>
        </Suspense>
      )
    }
    // Wait for the post-login cloud hydration so we route from the real profile,
    // not the empty local default — otherwise a returning user signing in on a
    // fresh device would flash the locker before their profile loads.
    if (!syncReady) {
      if (syncError) {
        return (
          <SyncErrorGate
            message={syncError}
            syncing={syncing}
            userId={userId}
            onRetry={retrySyncOnLogin}
            onSignOut={signOut}
          />
        )
      }
      return <Splash />
    }
    // Returning users already set up their locker (profile hydrated from the
    // backend) → straight to Home. Only brand-new accounts, with no completed
    // locker yet, get the "set up your locker" step.
    if (!profileComplete) return <OnboardingGate lockerOnly />
    return <MainRoutes />
  }

  // Local-only fallback (no backend): original behaviour — a contact identity on
  // the local profile is the gate, via the full onboarding flow.
  if (!profileComplete) return <OnboardingGate lockerOnly={false} />
  return <MainRoutes />
}
