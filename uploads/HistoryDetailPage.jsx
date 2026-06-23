import { Navigate, useNavigate, useParams } from 'react-router-dom'
import useHistoryStore from '../store/historyStore'
import BetResultCard from '../components/payouts/BetResultCard'
import SettlementCard from '../components/payouts/SettlementCard'
import ShareSummary from '../components/payouts/ShareSummary'

const fmtToPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`)

export default function HistoryDetailPage() {
  const { roundId } = useParams()
  const navigate = useNavigate()
  const round = useHistoryStore((s) => s.rounds.find((r) => r.roundId === roundId))
  const removeRound = useHistoryStore((s) => s.removeRound)

  // Round was deleted or the id is bad — back to the list.
  if (!round) return <Navigate to="/history" replace />

  const nameOf = (id) => round.players.find((p) => p.id === id)?.name ?? '—'
  const winners = (round.leaderboard ?? []).filter((e) => e.rank === 1)
  const settlements = round.settlements ?? []
  const totalAction = +settlements.reduce((sum, s) => sum + s.amount, 0).toFixed(2)

  const handleDelete = () => {
    if (window.confirm('Delete this round from history?')) {
      removeRound(round.roundId)
      navigate('/history', { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-8 pb-2">
        <button
          type="button"
          onClick={() => navigate('/history')}
          className="mb-2 min-h-[44px] -ml-1 px-1 text-sm font-semibold text-gray-500 active:text-gray-700"
        >
          ← History
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{round.course || 'Round'}</h1>
        <p className="text-sm text-gray-500">
          {round.date} · {round.holes ?? 18} holes
        </p>
      </header>

      {/* Final Leaderboard */}
      <section className="px-5 py-5">
        {winners.length > 0 && (
          <p className="mb-3 text-lg font-bold text-gray-900">
            🏆 Winner: {winners.map((w) => w.name).join(' & ')}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 font-medium">#</th>
              <th className="py-2 font-medium">Player</th>
              <th className="py-2 font-medium text-center">Gross</th>
              <th className="py-2 font-medium text-center">Net</th>
              <th className="py-2 font-medium text-right">+/- Par</th>
            </tr>
          </thead>
          <tbody>
            {(round.leaderboard ?? []).map((e) => (
              <tr
                key={e.name}
                className={`border-t border-gray-100 ${e.rank === 1 ? 'bg-amber-50' : ''}`}
              >
                <td className="py-3 font-semibold text-gray-700 tabular-nums">{e.rank}</td>
                <td className="py-3 text-gray-900">{e.name}</td>
                <td className="py-3 text-center text-gray-600 tabular-nums">{e.gross || '–'}</td>
                <td className="py-3 text-center font-bold text-gray-900 tabular-nums">
                  {e.net || '–'}
                </td>
                <td className="py-3 text-right text-gray-700 tabular-nums">{fmtToPar(e.toPar)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Bet Results */}
      <section className="px-5 py-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">Bet Results</h2>
        {(round.betResults ?? []).length === 0 ? (
          <p className="text-sm text-gray-400">No bets on this round.</p>
        ) : (
          <div className="space-y-3">
            {round.betResults.map((b, i) => (
              <BetResultCard
                key={i}
                result={{
                  icon: b.icon ?? '🎲',
                  name: b.name,
                  headline: b.headline,
                  lines: b.lines ?? [],
                }}
              />
            ))}
          </div>
        )}
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Settlements */}
      <section className="px-5 py-5">
        <h2 className="mb-2 text-lg font-bold text-gray-900">Settle Up</h2>
        {settlements.length === 0 ? (
          <p className="text-sm text-gray-400">All square — nobody owed anybody.</p>
        ) : (
          <>
            <div className="divide-y divide-gray-100">
              {settlements.map((s, i) => (
                <SettlementCard
                  key={`${s.from}-${s.to}-${i}`}
                  fromName={nameOf(s.from)}
                  toName={nameOf(s.to)}
                  amount={s.amount}
                />
              ))}
            </div>
            <p className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
              Total action:{' '}
              <span className="font-bold text-gray-900 tabular-nums">${totalAction}</span>
            </p>
          </>
        )}
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Share */}
      {round.summaryText && (
        <section className="px-5 py-5">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Share</h2>
          <ShareSummary
            summaryText={round.summaryText}
            title={`${round.course || 'Round'} — ${round.date}`}
          />
        </section>
      )}

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Manage */}
      <section className="px-5 py-5 pb-10">
        <button
          type="button"
          onClick={handleDelete}
          className="min-h-[48px] w-full rounded-xl border border-red-200 text-sm font-semibold text-red-600 active:bg-red-50"
        >
          Delete this round
        </button>
      </section>
    </div>
  )
}
