import { useNavigate } from 'react-router-dom'
import useHistoryStore from '../store/historyStore'

/** Sum of all settlement transfers in a saved round ("total action"). */
function totalAction(round) {
  return +(round.settlements ?? []).reduce((sum, s) => sum + s.amount, 0).toFixed(2)
}

/** Rank-1 finisher name(s) from a saved leaderboard snapshot. */
function winnerName(round) {
  const winners = (round.leaderboard ?? []).filter((e) => e.rank === 1)
  return winners.length ? winners.map((w) => w.name).join(' & ') : '—'
}

export default function HistoryPage() {
  const navigate = useNavigate()
  const rounds = useHistoryStore((s) => s.rounds)
  const clearHistory = useHistoryStore((s) => s.clearHistory)

  const handleClear = () => {
    if (rounds.length === 0) return
    if (window.confirm('Clear all saved rounds? This cannot be undone.')) {
      clearHistory()
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="flex items-center justify-between px-5 pt-8 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">History</h1>
          <p className="text-sm text-gray-500">
            {rounds.length} saved {rounds.length === 1 ? 'round' : 'rounds'}
          </p>
        </div>
        {rounds.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="min-h-[44px] px-3 text-sm font-semibold text-red-600 active:bg-red-50 rounded-lg"
          >
            Clear all
          </button>
        )}
      </header>

      {rounds.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <p className="text-4xl mb-3" aria-hidden="true">
            ⛳
          </p>
          <p className="text-gray-500">No saved rounds yet.</p>
          <p className="text-sm text-gray-400">
            Finish a round and tap “Save to History”.
          </p>
        </div>
      ) : (
        <ul className="px-5 pb-8 space-y-3">
          {rounds.map((round) => (
            <li key={round.roundId}>
              <button
                type="button"
                onClick={() => navigate(`/history/${round.roundId}`)}
                className="w-full text-left rounded-xl border border-gray-200 px-4 py-3 active:bg-gray-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-900 truncate">
                    {round.course || 'Round'}
                  </span>
                  <span className="shrink-0 text-sm text-gray-500 tabular-nums">
                    {round.date}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray-600 truncate">
                    🏆 {winnerName(round)} · {round.holes ?? 18} holes
                  </span>
                  <span className="shrink-0 text-gray-500 tabular-nums">
                    ${totalAction(round)} action
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 pb-10">
        <button
          type="button"
          onClick={() => navigate('/setup')}
          className="min-h-[48px] w-full text-sm font-semibold text-gray-500 active:text-gray-700"
        >
          ← Back to Setup
        </button>
      </div>
    </div>
  )
}
