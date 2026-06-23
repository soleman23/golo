import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import { buildLeaderboard } from '../engines/scoring'
import {
  buildStablefordLeaderboard,
  calculateStablefordPoints,
} from '../engines/stableford'
import { calculateHoleResult, calculateMatchStatus } from '../engines/matchplay'
import { getWolfOrder } from '../engines/wolf'
import { summarizeBets } from '../engines/betStatus'
import HoleHeader from '../components/scoring/HoleHeader'
import ScoreRow from '../components/scoring/ScoreRow'
import ScoreKeypad from '../components/scoring/ScoreKeypad'
import ActiveBetsBar from '../components/scoring/ActiveBetsBar'
import LeaderboardSheet from '../components/scoring/LeaderboardSheet'
import WolfPanel from '../components/scoring/WolfPanel'
import BingoBangoBongoPanel from '../components/scoring/BingoBangoBongoPanel'
import MatchStatusCard from '../components/scoring/MatchStatusCard'

export default function ScoringPage() {
  const navigate = useNavigate()

  const round = useRoundStore((s) => s.round)
  const players = useRoundStore((s) => s.players)
  const teams = useRoundStore((s) => s.teams)
  const scores = useRoundStore((s) => s.scores)
  const bets = useRoundStore((s) => s.bets)
  const sideGameFlags = useRoundStore((s) => s.sideGameFlags)
  const wolfPicks = useRoundStore((s) => s.wolfPicks)
  const bbbFlags = useRoundStore((s) => s.bbbFlags)
  const concededHoles = useRoundStore((s) => s.concededHoles)
  const currentHole = useRoundStore((s) => s.currentHole)

  const updateScore = useRoundStore((s) => s.updateScore)
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole)
  const startScoring = useRoundStore((s) => s.startScoring)
  const flagCTP = useRoundStore((s) => s.flagCTP)
  const flagLD = useRoundStore((s) => s.flagLD)
  const setWolfPick = useRoundStore((s) => s.setWolfPick)
  const clearWolfPick = useRoundStore((s) => s.clearWolfPick)
  const flagBBB = useRoundStore((s) => s.flagBBB)
  const concedeHole = useRoundStore((s) => s.concedeHole)
  const completeRound = useRoundStore((s) => s.completeRound)
  const getStrokeAllocations = useRoundStore((s) => s.getStrokeAllocations)

  const [keypadFor, setKeypadFor] = useState(null) // entity id or null
  const [leaderboardOpen, setLeaderboardOpen] = useState(false)

  const scoringType = round?.scoringType ?? 'stroke'
  const isScramble = scoringType === 'scramble'
  const isStableford = scoringType === 'stableford'
  const isMatchplay = scoringType === 'matchplay'

  const totalHoles = round?.holes ?? 18
  const pars = useMemo(() => round?.pars ?? {}, [round?.pars])
  const par = pars[currentHole] ?? 4
  const isLastHole = currentHole >= totalHoles

  // The things that get a score row: teams in scramble, otherwise players.
  const entities = isScramble ? teams : players

  // Mark the round in progress the first time the screen mounts.
  useEffect(() => {
    startScoring()
  }, [startScoring])

  // Score defaults to par when a hole is opened: seed any untouched entity.
  useEffect(() => {
    if (!round) return
    const holePar = round.pars?.[currentHole] ?? 4
    const live = useRoundStore.getState().scores
    entities.forEach((e) => {
      if (live[e.id]?.[currentHole] == null) {
        updateScore(e.id, currentHole, holePar)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentHole, round?.roundId, isScramble])

  // Player handicap allocations (individual formats only; scramble plays gross).
  const playerAllocations = useMemo(
    () => getStrokeAllocations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, round?.strokeIndex, round?.holes]
  )
  const allocations = useMemo(
    () => (isScramble ? {} : playerAllocations),
    [isScramble, playerAllocations]
  )

  // Leaderboard / status data depends on the format.
  const leaderboard = useMemo(() => {
    if (isStableford) {
      return buildStablefordLeaderboard(players, scores, pars, playerAllocations).map(
        (e) => ({ rank: e.rank, player: e.player, thru: e.thru, gross: e.gross, net: e.points })
      )
    }
    return buildLeaderboard(entities, scores, allocations, pars, totalHoles)
  }, [isStableford, entities, players, scores, allocations, playerAllocations, pars, totalHoles])

  // Match Play standing (singles; first two players).
  const matchInfo = useMemo(() => {
    if (!isMatchplay || players.length < 2) return null
    const side1 = players[0]
    const side2 = players[1]
    const a1 = playerAllocations[side1.id] ?? {}
    const a2 = playerAllocations[side2.id] ?? {}
    const results = []
    for (let h = 1; h <= totalHoles; h++) {
      const conceded = concededHoles[h]
      if (conceded) {
        results.push(conceded === side1.id ? 'p1' : 'p2')
        continue
      }
      const s1 = scores[side1.id]?.[h]
      const s2 = scores[side2.id]?.[h]
      if (s1 == null || s2 == null) continue
      const n1 = Math.max(0, s1 - (a1[h] ?? 0))
      const n2 = Math.max(0, s2 - (a2[h] ?? 0))
      results.push(calculateHoleResult(n1, n2))
    }
    return { side1, side2, status: calculateMatchStatus(results, totalHoles) }
  }, [isMatchplay, players, playerAllocations, scores, concededHoles, totalHoles])

  const pills = useMemo(
    () =>
      summarizeBets({
        bets,
        players,
        scores,
        pars,
        strokeAllocations: playerAllocations,
        sideGameFlags,
        scoringType,
        teams,
      }),
    [bets, players, scores, pars, playerAllocations, sideGameFlags, scoringType, teams]
  )

  // Side games / bets active on *this* hole.
  const ctpBet = bets.find(
    (b) => b.type === 'ctp' && (b.config.holes ?? []).includes(currentHole)
  )
  const ldBet = bets.find(
    (b) => b.type === 'longestDrive' && b.config.hole === currentHole
  )
  const wolfBet = bets.find((b) => b.type === 'wolf')
  const bbbBet = bets.find((b) => b.type === 'bingobangobongo')
  // Wolf / BBB need individual scoring, so they're hidden in scramble.
  const wolfActive = !isScramble && wolfBet && players.length === 4
  const bbbActive = !isScramble && bbbBet
  const wolfId = wolfActive ? getWolfOrder(players, currentHole) : null

  // No round set up yet — bounce back to setup.
  if (!round || entities.length === 0) {
    return <Navigate to="/setup" replace />
  }

  const scoreFor = (id) => scores[id]?.[currentHole] ?? par

  const adjust = (id, delta) => {
    const next = Math.max(1, scoreFor(id) + delta)
    updateScore(id, currentHole, next)
  }

  const goPrev = () => currentHole > 1 && setCurrentHole(currentHole - 1)
  const goNext = () => !isLastHole && setCurrentHole(currentHole + 1)

  const finishRound = () => {
    completeRound()
    navigate('/payouts')
  }

  const leaderboardTitle = isMatchplay
    ? 'Match'
    : isStableford
      ? 'Stableford'
      : isScramble
        ? 'Teams'
        : 'Leaderboard'

  return (
    <div className="flex flex-col h-screen bg-white">
      <HoleHeader
        hole={currentHole}
        par={par}
        strokeIndex={round.strokeIndex?.[currentHole]}
        canPrev={currentHole > 1}
        canNext={!isLastHole}
        onPrev={goPrev}
        onNext={goNext}
      />

      {/* Match Play status replaces the leaderboard. */}
      {isMatchplay && matchInfo && (
        <MatchStatusCard
          status={matchInfo.status}
          side1={matchInfo.side1}
          side2={matchInfo.side2}
          hole={currentHole}
          concededTo={concededHoles[currentHole] ?? null}
          onConcede={(pid) => concedeHole(currentHole, pid)}
        />
      )}

      <main className="flex-1 overflow-y-auto">
        {entities.map((entity) => {
          const reduction = allocations[entity.id]?.[currentHole] ?? 0
          const points = isStableford
            ? calculateStablefordPoints(scoreFor(entity.id), par, reduction)
            : undefined
          return (
            <ScoreRow
              key={entity.id}
              player={entity}
              score={scores[entity.id]?.[currentHole] ?? null}
              par={par}
              strokeReduction={reduction}
              points={points}
              onDecrement={() => adjust(entity.id, -1)}
              onIncrement={() => adjust(entity.id, +1)}
              onOpenKeypad={() => setKeypadFor(entity.id)}
            />
          )
        })}

        {wolfActive && (
          <WolfPanel
            hole={currentHole}
            players={players}
            wolfId={wolfId}
            pick={wolfPicks[currentHole]}
            onPick={(decision) => setWolfPick(currentHole, decision)}
            onClear={() => clearWolfPick(currentHole)}
          />
        )}

        {bbbActive && (
          <BingoBangoBongoPanel
            hole={currentHole}
            players={players}
            flags={bbbFlags[currentHole]}
            onFlag={(type, pid) => flagBBB(currentHole, type, pid)}
          />
        )}

        {ctpBet && (
          <SideGamePrompt
            title={`📍 Closest to pin · Hole ${currentHole}`}
            players={players}
            selectedId={sideGameFlags.closestToPin[currentHole]}
            onSelect={(pid) => flagCTP(currentHole, pid)}
          />
        )}
        {ldBet && (
          <SideGamePrompt
            title={`🚀 Longest drive · Hole ${currentHole}`}
            players={players}
            selectedId={sideGameFlags.longestDrive[currentHole]}
            onSelect={(pid) => flagLD(currentHole, pid)}
          />
        )}

        {!isLastHole && (
          <div className="px-4 py-4">
            <button
              type="button"
              onClick={goNext}
              className="w-full min-h-[44px] rounded-xl border border-green-200 bg-green-50 text-green-700 font-semibold active:bg-green-100"
            >
              Next Hole →
            </button>
          </div>
        )}
      </main>

      <ActiveBetsBar pills={pills} />

      {/* Bottom navigation */}
      <nav className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-200 bg-white">
        <button
          type="button"
          onClick={goPrev}
          disabled={currentHole === 1}
          className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-gray-700 active:bg-gray-100 disabled:opacity-30"
        >
          ◀ Hole {Math.max(1, currentHole - 1)}
        </button>

        <button
          type="button"
          onClick={() => setLeaderboardOpen(true)}
          className="flex-1 min-h-[44px] rounded-xl bg-gray-900 text-white text-sm font-semibold active:bg-gray-800"
        >
          {leaderboardTitle}
        </button>

        {isLastHole ? (
          <button
            type="button"
            onClick={finishRound}
            className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-green-700 active:bg-green-50"
          >
            Finish Round
          </button>
        ) : (
          <button
            type="button"
            onClick={goNext}
            className="min-h-[44px] px-3 rounded-xl text-sm font-semibold text-gray-700 active:bg-gray-100"
          >
            Hole {currentHole + 1} ▶
          </button>
        )}
      </nav>

      {keypadFor && (
        <ScoreKeypad
          playerName={entities.find((e) => e.id === keypadFor)?.name ?? ''}
          value={scoreFor(keypadFor)}
          par={par}
          onCommit={(score) => updateScore(keypadFor, currentHole, score)}
          onClose={() => setKeypadFor(null)}
        />
      )}

      <LeaderboardSheet
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        entries={leaderboard}
        netLabel={isStableford ? 'Pts' : 'Net'}
        title={leaderboardTitle}
      />
    </div>
  )
}

/**
 * SideGamePrompt — pick the winner of a per-hole side game (CTP / LD).
 * A horizontal row of player chips; the selected player is highlighted.
 */
function SideGamePrompt({ title, players, selectedId, onSelect }) {
  return (
    <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
      <p className="text-sm font-semibold text-gray-700 mb-2">{title}</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {players.map((p) => {
          const on = selectedId === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              aria-pressed={on}
              className={`shrink-0 px-3 min-h-[44px] flex items-center gap-2 rounded-full border text-sm font-medium transition-colors ${
                on
                  ? 'bg-green-700 text-white border-green-700'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: p.color }}
                aria-hidden="true"
              />
              {p.name.slice(0, 10)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
