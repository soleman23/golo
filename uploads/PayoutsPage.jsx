import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import { buildLeaderboard } from '../engines/scoring'
import { buildStablefordLeaderboard } from '../engines/stableford'
import { buildBetResults, formatRoundSummary } from '../engines/betResults'
import { aggregatePayouts, calculateSettlements } from '../engines/payouts'
import Button from '../components/shared/Button'
import BetResultCard from '../components/payouts/BetResultCard'
import SettlementCard from '../components/payouts/SettlementCard'
import ShareSummary from '../components/payouts/ShareSummary'

const fmtToPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`)

export default function PayoutsPage() {
  const navigate = useNavigate()

  const round = useRoundStore((s) => s.round)
  const players = useRoundStore((s) => s.players)
  const scores = useRoundStore((s) => s.scores)
  const bets = useRoundStore((s) => s.bets)
  const sideGameFlags = useRoundStore((s) => s.sideGameFlags)
  const wolfPicks = useRoundStore((s) => s.wolfPicks)
  const bbbFlags = useRoundStore((s) => s.bbbFlags)
  const teams = useRoundStore((s) => s.teams)
  const getStrokeAllocations = useRoundStore((s) => s.getStrokeAllocations)
  const completeRound = useRoundStore((s) => s.completeRound)
  const resetRound = useRoundStore((s) => s.resetRound)
  const saveRound = useHistoryStore((s) => s.saveRound)

  const [saved, setSaved] = useState(false)

  const totalHoles = round?.holes ?? 18
  const pars = useMemo(() => round?.pars ?? {}, [round?.pars])

  const scoringType = round?.scoringType ?? 'stroke'
  const isScramble = scoringType === 'scramble'
  const isStableford = scoringType === 'stableford'

  const strokeAllocations = useMemo(
    () => getStrokeAllocations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, round?.strokeIndex, round?.holes]
  )

  // Leaderboard mirrors the round format: team gross (scramble), points
  // (stableford), or net strokes (everything else).
  const leaderboard = useMemo(() => {
    if (isStableford) {
      return buildStablefordLeaderboard(players, scores, pars, strokeAllocations).map((e) => ({
        rank: e.rank,
        player: e.player,
        gross: e.gross,
        thru: e.thru,
        points: e.points,
        net: e.points, // so winner detection / share text can read a single field
        toPar: 0,
      }))
    }
    if (isScramble && teams.length > 0) {
      return buildLeaderboard(teams, scores, {}, pars, totalHoles)
    }
    return buildLeaderboard(players, scores, strokeAllocations, pars, totalHoles)
  }, [isStableford, isScramble, teams, players, scores, strokeAllocations, pars, totalHoles])

  const betResults = useMemo(
    () =>
      buildBetResults({
        bets,
        players,
        scores,
        pars,
        strokeAllocations,
        sideGameFlags,
        wolfPicks,
        bbbFlags,
        scoringType: round?.scoringType,
        teams,
      }),
    [bets, players, scores, pars, strokeAllocations, sideGameFlags, wolfPicks, bbbFlags, round?.scoringType, teams]
  )

  const netPayouts = useMemo(
    () => aggregatePayouts(betResults.map((b) => b.payouts)),
    [betResults]
  )
  const settlements = useMemo(() => calculateSettlements(netPayouts), [netPayouts])
  const totalAction = useMemo(
    () => +settlements.reduce((sum, s) => sum + s.amount, 0).toFixed(2),
    [settlements]
  )

  const summaryText = useMemo(
    () =>
      formatRoundSummary({
        round,
        players,
        leaderboard,
        betResults,
        settlements,
        scoringType,
      }),
    [round, players, leaderboard, betResults, settlements, scoringType]
  )

  // No round set up yet — bounce back to setup.
  if (!round || players.length === 0) {
    return <Navigate to="/setup" replace />
  }

  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'
  const winners = leaderboard.filter((e) => e.rank === 1 && e.thru > 0)

  const handleSave = () => {
    completeRound()
    saveRound({
      roundId: round.roundId,
      course: round.course,
      date: round.date,
      holes: round.holes,
      completedAt: new Date().toISOString(),
      players: players.map((p) => ({ id: p.id, name: p.name })),
      leaderboard: leaderboard.map((e) => ({
        rank: e.rank,
        name: e.player.name,
        gross: e.gross,
        net: e.net,
        toPar: e.toPar,
      })),
      betResults: betResults.map((b) => ({
        type: b.type,
        name: b.name,
        icon: b.icon,
        headline: b.headline,
        lines: b.lines,
        payouts: b.payouts,
      })),
      settlements,
      summaryText,
    })
    setSaved(true)
    navigate('/history')
  }

  const handleNewRound = () => {
    resetRound()
    navigate('/setup')
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="px-5 pt-8 pb-2">
        <h1 className="text-2xl font-bold text-gray-900">Payouts</h1>
        <p className="text-sm text-gray-500">
          {round.course || 'Round'} — {round.date}
        </p>
      </header>

      {/* Section 1 — Final Leaderboard */}
      <section className="px-5 py-5">
        {winners.length > 0 && (
          <p className="mb-3 text-lg font-bold text-gray-900">
            🏆 Winner: {winners.map((w) => w.player.name).join(' & ')}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="py-2 font-medium">#</th>
              <th className="py-2 font-medium">{isScramble ? 'Team' : 'Player'}</th>
              <th className="py-2 font-medium text-center">Gross</th>
              {isStableford ? (
                <th className="py-2 font-medium text-right">Points</th>
              ) : (
                <>
                  <th className="py-2 font-medium text-center">Net</th>
                  <th className="py-2 font-medium text-right">+/- Par</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((e) => (
              <tr
                key={e.player.id}
                className={`border-t border-gray-100 ${
                  e.rank === 1 ? 'bg-amber-50' : ''
                }`}
              >
                <td className="py-3 font-semibold text-gray-700 tabular-nums">
                  {e.rank}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="shrink-0 w-3 h-3 rounded-full"
                      style={{ backgroundColor: e.player.color }}
                      aria-hidden="true"
                    />
                    <span className="text-gray-900">{e.player.name}</span>
                  </div>
                </td>
                <td className="py-3 text-center text-gray-600 tabular-nums">
                  {e.gross || '–'}
                </td>
                {isStableford ? (
                  <td className="py-3 text-right font-bold text-gray-900 tabular-nums">
                    {e.thru > 0 ? e.points : '–'}
                  </td>
                ) : (
                  <>
                    <td className="py-3 text-center font-bold text-gray-900 tabular-nums">
                      {e.net || '–'}
                    </td>
                    <td className="py-3 text-right text-gray-700 tabular-nums">
                      {e.thru > 0 ? fmtToPar(e.toPar) : '–'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Section 2 — Bet Results */}
      <section className="px-5 py-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">Bet Results</h2>
        {betResults.length === 0 ? (
          <p className="text-sm text-gray-400">No bets on this round.</p>
        ) : (
          <div className="space-y-3">
            {betResults.map((result) => (
              <BetResultCard key={result.id} result={result} />
            ))}
          </div>
        )}
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Section 3 — Settlements */}
      <section className="px-5 py-5">
        <h2 className="mb-2 text-lg font-bold text-gray-900">Settle Up</h2>
        {settlements.length === 0 ? (
          <p className="text-sm text-gray-400">All square — nobody owes anybody.</p>
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
              <span className="font-bold text-gray-900 tabular-nums">
                ${totalAction}
              </span>
            </p>
          </>
        )}
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Section 4 — Share */}
      <section className="px-5 py-5">
        <h2 className="mb-3 text-lg font-bold text-gray-900">Share</h2>
        <ShareSummary summaryText={summaryText} title={`${round.course || 'Round'} — ${round.date}`} />
      </section>

      <div className="h-2 bg-gray-50 border-y border-gray-100" />

      {/* Section 5 — Action Buttons */}
      <section className="px-5 py-5 space-y-3">
        <Button onClick={handleSave} disabled={saved}>
          {saved ? '✓ Saved to History' : 'Save to History'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/scoring')}>
          Back to Scoring
        </Button>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/history')}
            className="min-h-[48px] text-sm font-semibold text-gray-500 active:text-gray-700"
          >
            View History
          </button>
          <button
            type="button"
            onClick={handleNewRound}
            className="min-h-[48px] text-sm font-semibold text-gray-500 active:text-gray-700"
          >
            New Round
          </button>
        </div>
      </section>
    </div>
  )
}
