import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import useProfileStore from './store/profileStore'
import useAuthStore from './store/authStore'
import { hasContact } from './lib/identity'
import { syncOnLogin, syncOnLogout } from './lib/sync'

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

export default function App() {
  const authEnabled = useAuthStore((s) => s.enabled)
  const session = useAuthStore((s) => s.session)
  const authLoading = useAuthStore((s) => s.loading)
  const initAuth = useAuthStore((s) => s.init)

  const name = useProfileStore((s) => s.name)
  const nickname = useProfileStore((s) => s.nickname)
  const email = useProfileStore((s) => s.email)
  const phone = useProfileStore((s) => s.phone)
  const onboarded = useProfileStore((s) => s.onboarded)

  const userId = useAuthStore((s) => s.user?.id ?? null)

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

  // Backend configured: the Supabase session is the real gate.
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
    // Signed in but no contact identity yet — finish the locker step.
    if (!profileComplete) return <OnboardingGate lockerOnly />
    return <MainRoutes />
  }

  // Local-only fallback (no backend): original behaviour — a contact identity on
  // the local profile is the gate, via the full onboarding flow.
  if (!profileComplete) return <OnboardingGate lockerOnly={false} />
  return <MainRoutes />
}
