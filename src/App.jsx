import { Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './pages/HomePage'
import OnboardingPage from './pages/OnboardingPage'
import YouPage from './pages/YouPage'
import SetupWizard from './pages/SetupWizard'
import ScoringPage from './pages/ScoringPage'
import PayoutsPage from './pages/PayoutsPage'
import HistoryPage from './pages/HistoryPage'
import HistoryDetailPage from './pages/HistoryDetailPage'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
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
  )
}
