import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import useAuthStore from '../store/authStore'
import useLiveRoundStore from '../store/liveRoundStore'
import { saveRound as dbSaveRound } from '../lib/db/rounds'
import { completeLiveRound } from '../lib/db/liveRounds'
import { teardownLiveSync } from '../lib/liveRoundSync'
import { fetchCourseGhinMapping } from '../lib/db/courses'
import { postRoundToGhin } from '../lib/ghin/client'
import { canPostToGhin, isGhinConnected } from '../lib/ghin/eligibility'
import { getCourseImage } from '../lib/courseImages'
import { buildLeaderboard } from '../engines/scoring'
import { buildStablefordLeaderboard } from '../engines/stableford'
import { buildBetResults, formatRoundSummary, betGlyphName } from '../engines/betResults'
import { aggregatePayouts, calculateSettlements } from '../engines/payouts'
import { playerKey, autoKey, hasContact } from '../lib/identity'
import AppHeader from '../components/shared/AppHeader'
import { Icon } from '../components/shared/GoloIcons'

/**
 * PayoutsPage — the post-round "Settle Up", glass-over-turf design
 * (Golo Golf - Payout.dc.html). Recreates the immersive language used by
 * ScoringPage / SetupWizard with inline styles rather than the light Tailwind
 * theme: full-bleed course backdrop, a hero "your result" card, tap-to-switch
 * net-winnings standings, a who-pays-whom transfer list with per-transfer
 * mark-paid, expandable per-game breakdowns, round-recap tiles, a share toast
 * and an "all settled" celebration overlay.
 *
 * Wired to the real roundStore and every payout engine. It auto-saves the
 * finished round to history on mount (that snapshot feeds Home / You / History),
 * then the Complete action ends the live round and returns to the locker.
 * Preserves all formats: standings/recap adapt to Scramble teams and
 * Stableford points, and the per-game cards render whatever bets were played
 * (Nassau, Skins, Purse, CTP, Long Drive, Wolf, Bingo-Bango-Bongo).
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

const FORMAT_LABEL = {
  stroke: 'STROKE',
  scramble: 'SCRAMBLE',
  bestball: 'BEST BALL',
  stableford: 'STABLEFORD',
  matchplay: 'MATCH',
  match: 'MATCH',
}

/* ------------------------------------------------------------------- helpers */

function hexA(hex, a) {
  let h = (hex || ACCENT).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(255,255,255,${a})`
  return `rgba(${r},${g},${b},${a})`
}

const initial = (name) => (name || '').trim().charAt(0).toUpperCase() || '?'
// cents — avoids half-up sign asymmetry & matches History/You. Normalises -0 so
// money/signed never render a stray "−$0".
const round2 = (n) => {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return Object.is(v, -0) ? 0 : v
}
/** "$5" — magnitude only. */
const money = (n) => `$${Math.abs(round2(n))}`
/** Signed money the betting way: +$5, −$5, $0. */
const signed = (n) => {
  const v = round2(n)
  if (v > 0) return `+$${v}`
  if (v < 0) return `−$${-v}`
  return '$0'
}
/** Colour a winnings number: lime up, red down, neutral at even. */
const ncd = (n) => (n > 0 ? '#bef264' : n < 0 ? '#fb7185' : 'rgba(255,255,255,.72)')
/** Net-to-par the golf way. */
const vpl = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`)
const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Copy text to clipboard, with a legacy execCommand fallback. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/**
 * Per-entity scoring distribution (gross vs par) over played holes — feeds the
 * You page's Scoring Mix. Saved into each round's snapshot so it can be
 * aggregated by name later (history doesn't keep per-hole scores otherwise).
 */
function scoringMix(holeScores, pars, totalHoles) {
  const m = { birdie: 0, par: 0, bogey: 0, double: 0 }
  for (let h = 1; h <= totalHoles; h++) {
    const sc = holeScores?.[h]
    const p = pars?.[h]
    if (sc == null || p == null) continue
    const d = sc - p
    if (d <= -1) m.birdie += 1
    else if (d === 0) m.par += 1
    else if (d === 1) m.bogey += 1
    else m.double += 1
  }
  return m
}

/* --------------------------------------------------------------- component */

export default function PayoutsPage() {
  const navigate = useNavigate()

  const round = useRoundStore((s) => s.round)
  const players = useRoundStore((s) => s.players)
  const scores = useRoundStore((s) => s.scores)
  const bets = useRoundStore((s) => s.bets)
  const sideGameFlags = useRoundStore((s) => s.sideGameFlags)
  const wolfPicks = useRoundStore((s) => s.wolfPicks)
  const bbbFlags = useRoundStore((s) => s.bbbFlags)
  const skinFlags = useRoundStore((s) => s.skinFlags)
  const teams = useRoundStore((s) => s.teams)
  const getStrokeAllocations = useRoundStore((s) => s.getStrokeAllocations)
  const completeRound = useRoundStore((s) => s.completeRound)
  const resetRound = useRoundStore((s) => s.resetRound)

  const saveRound = useHistoryStore((s) => s.saveRound)
  const historyRounds = useHistoryStore((s) => s.rounds)
  const profileName = useProfileStore((s) => s.name)
  const profileNick = useProfileStore((s) => s.nickname)
  const profileEmail = useProfileStore((s) => s.email)
  const profilePhone = useProfileStore((s) => s.phone)
  const ghinConnectedAt = useProfileStore((s) => s.ghinConnectedAt)
  const authEnabled = useAuthStore((s) => s.enabled)

  const [meOverride, setMe] = useState(null) // hero player id, once the user taps
  const [paid, setPaid] = useState({}) // settlement key `${from}>${to}` → true
  const [expanded, setExpanded] = useState({}) // bet id → true
  const [toast, setToast] = useState(null) // share-feedback message, or null
  const [celebrate, setCelebrate] = useState(false)
  const [confirming, setConfirming] = useState(false) // final-complete confirm modal
  const [completing, setCompleting] = useState(false)
  const [courseGhinResult, setCourseGhinResult] = useState(null)
  const [ghinConfirm, setGhinConfirm] = useState(false)
  const [ghinPosting, setGhinPosting] = useState(false)
  const [ghinPostErrorState, setGhinPostErrorState] = useState(null)
  const [ghinPostResult, setGhinPostResult] = useState(null)
  const toastTimer = useRef()
  const savedRef = useRef(false)
  const expandedSeeded = useRef(false)

  const totalHoles = round?.holes ?? 18
  const pars = useMemo(() => round?.pars ?? {}, [round?.pars])

  const scoringType = round?.scoringType ?? 'stroke'
  const isScramble = scoringType === 'scramble'
  const isStableford = scoringType === 'stableford'
  const useGrossScoring = round?.scoring === 'gross'

  const strokeAllocations = useMemo(
    () => getStrokeAllocations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, round?.strokeIndex, round?.holes]
  )
  const scoringAllocations = useMemo(
    () => (isScramble || useGrossScoring ? {} : strokeAllocations),
    [isScramble, useGrossScoring, strokeAllocations]
  )

  // Entity-level board mirrors the round format (team gross / points / net).
  const leaderboard = useMemo(() => {
    if (isStableford) {
      return buildStablefordLeaderboard(players, scores, pars, scoringAllocations).map((e) => ({
        rank: e.rank,
        player: e.player,
        gross: e.gross,
        thru: e.thru,
        points: e.points,
        net: e.points,
        toPar: 0,
      }))
    }
    if (isScramble && teams.length > 0) {
      return buildLeaderboard(teams, scores, {}, pars, totalHoles)
    }
    return buildLeaderboard(players, scores, scoringAllocations, pars, totalHoles)
  }, [isStableford, isScramble, teams, players, scores, scoringAllocations, pars, totalHoles])

  // Per-player gross/net (for hero + standings sub-lines). In scramble the
  // individuals have no own scores, so these come out zero and we fall back to
  // the player's team name instead.
  const playerStats = useMemo(() => {
    if (isStableford) {
      const lb = buildStablefordLeaderboard(players, scores, pars, scoringAllocations)
      return Object.fromEntries(
        lb.map((e) => [e.player.id, { gross: e.gross, net: e.points, points: e.points, thru: e.thru, toPar: 0 }])
      )
    }
    const lb = buildLeaderboard(players, scores, scoringAllocations, pars, totalHoles)
    return Object.fromEntries(
      lb.map((e) => [e.player.id, { gross: e.gross, net: e.net, thru: e.thru, toPar: e.toPar }])
    )
  }, [isStableford, players, scores, pars, scoringAllocations, totalHoles])

  const betResults = useMemo(
    () =>
      buildBetResults({
        bets,
        players,
        scores,
        pars,
        strokeAllocations,
        sideGameFlags,
        skinFlags,
        wolfPicks,
        bbbFlags,
        scoringType: round?.scoringType,
        teams,
      }),
    [bets, players, scores, pars, strokeAllocations, sideGameFlags, skinFlags, wolfPicks, bbbFlags, round?.scoringType, teams]
  )

  const netPayouts = useMemo(() => aggregatePayouts(betResults.map((b) => b.payouts)), [betResults])
  const settlements = useMemo(() => calculateSettlements(netPayouts), [netPayouts])
  const moneyMoved = useMemo(
    () => round2(settlements.reduce((sum, s) => sum + s.amount, 0)),
    [settlements]
  )

  const summaryText = useMemo(
    () => formatRoundSummary({ round, players, leaderboard, betResults, settlements, scoringType, scoring: round?.scoring ?? 'net' }),
    [round, players, leaderboard, betResults, settlements, scoringType]
  )

  // "You" identity = the profile's email/phone/name, else the most-frequent
  // player across history (mirrors Home / You).
  const meKey = useMemo(
    () => playerKey({ name: profileName, nickname: profileNick, email: profileEmail, phone: profilePhone }) ?? autoKey(historyRounds),
    [profileName, profileNick, profileEmail, profilePhone, historyRounds]
  )

  // Hero defaults to "you" (matched by identity), else the first player; a tap
  // on any standings row overrides it.
  const defaultMeId = useMemo(() => {
    if (players.length === 0) return null
    return players.find((p) => meKey != null && playerKey(p) === meKey)?.id ?? players[0].id
  }, [players, meKey])
  const me = meOverride ?? defaultMeId

  const existingHistoryEntry = useMemo(
    () => historyRounds.find((r) => r.roundId === round?.roundId),
    [historyRounds, round?.roundId]
  )

  const localGhinPost = ghinPostResult?.roundId === round?.roundId ? ghinPostResult : null
  const ghinPostedAt = localGhinPost?.postedAt ?? existingHistoryEntry?.ghinPostedAt ?? null
  const ghinPostId = localGhinPost?.postId ?? existingHistoryEntry?.ghinPostId ?? null
  const ghinPostError =
    ghinPostErrorState?.roundId === round?.roundId ? ghinPostErrorState.message : null
  const setCurrentGhinPostError = (message) =>
    setGhinPostErrorState(message ? { roundId: round?.roundId ?? null, message } : null)
  const courseGhin =
    authEnabled && courseGhinResult?.courseId === round?.courseId
      ? courseGhinResult.mapping
      : null

  useEffect(() => {
    const courseId = round?.courseId
    if (!courseId || !authEnabled) return
    let cancelled = false
    fetchCourseGhinMapping(courseId).then((mapping) => {
      if (!cancelled) setCourseGhinResult({ courseId, mapping })
    })
    return () => { cancelled = true }
  }, [round?.courseId, authEnabled])

  const ghinEligibility = useMemo(
    () =>
      canPostToGhin({
        round,
        teams,
        scores,
        playerId: defaultMeId,
        courseGhin,
        ghinConnected: authEnabled && isGhinConnected({ ghinConnectedAt }),
        ghinPostedAt,
      }),
    [round, teams, scores, defaultMeId, courseGhin, authEnabled, ghinConnectedAt, ghinPostedAt]
  )

  const handlePostToGhin = async () => {
    if (!round?.roundId || !defaultMeId || ghinPosting || ghinPostedAt) return
    setGhinPosting(true)
    setCurrentGhinPostError(null)
    try {
      await persistRound()
      const { data, error } = await postRoundToGhin({ roundId: round.roundId, playerId: defaultMeId })
      if (error) throw error
      if (data?.configured === false) {
        setCurrentGhinPostError('GHIN integration is not enabled yet.')
        return
      }
      if (data?.error) throw new Error(data.message ?? data.error)
      const postedAt = data.postedAt ?? new Date().toISOString()
      const postId = data.postId ?? null
      setGhinPostResult({ roundId: round.roundId, postedAt, postId })
      const patch = { ghinPostedAt: postedAt, ghinPostId: postId }
      saveRound({ ...(existingHistoryEntry ?? {}), roundId: round.roundId, ...patch })
      setGhinConfirm(false)
      setToast('Score posted to GHIN')
      clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 2200)
    } catch (err) {
      setCurrentGhinPostError(err?.message ?? 'Could not post to GHIN.')
    } finally {
      setGhinPosting(false)
    }
  }

  // Expand the first game by default, once results are known.
  useEffect(() => {
    if (expandedSeeded.current || betResults.length === 0) return
    expandedSeeded.current = true
    setExpanded({ [betResults[0].id]: true })
  }, [betResults])

  // Build + save the round snapshot to history (and mirror to Supabase). This is
  // pure persistence — it does NOT finalize the live round. Always rebuilds the
  // snapshot from current live state so re-saves capture the latest scores/bets
  // (e.g. a just-toggled skin); both the local history store and dbSaveRound
  // upsert by roundId, so a remount or repeated effect updates in place rather
  // than duplicating. The original completedAt is preserved so re-saves don't
  // churn the timestamp or reorder history.
  async function persistRound() {
    if (!round || players.length === 0) return null
    const existingEntry = historyRounds.find((r) => r.roundId === round.roundId)
    const playerGameData = players.map((p) => {
        const team = teams.find((t) => t.playerIds?.includes(p.id))
        return {
          playerId: p.id,
          key: playerKey(p),
          verified: hasContact(p),
          player: {
            id: p.id,
            name: p.name,
            nickname: p.nickname ?? null,
            email: p.email ?? null,
            phone: p.phone ?? null,
            handicapIndex: p.handicapIndex ?? null,
            courseHandicap: p.courseHandicap ?? null,
            color: p.color ?? null,
            teamId: team?.id ?? null,
            teamName: team?.name ?? null,
          },
          scores: scores[p.id] ?? {},
          teamScores: team ? scores[team.id] ?? {} : {},
          strokeAllocations: strokeAllocations[p.id] ?? {},
          netPayout: netPayouts[p.id] ?? 0,
          betPayouts: betResults.map((b) => ({
            id: b.id,
            type: b.type,
            name: b.name,
            payout: b.payouts[p.id] ?? 0,
          })),
          settlements: settlements.filter((s) => s.from === p.id || s.to === p.id),
        }
      })
    const entry = {
      roundId: round.roundId,
      courseId: round.courseId ?? null,
      course: round.course,
      courseBg: getCourseImage(round),
      tee: round.tee ?? null,
      date: round.date,
      holes: round.holes,
      scoring: round.scoring ?? 'net',
      scoringType: round.scoringType ?? 'stroke',
      pars,
      strokeIndex: round.strokeIndex ?? {},
      completedAt: existingEntry?.completedAt ?? new Date().toISOString(),
      ghinPostedAt: ghinPostedAt ?? existingEntry?.ghinPostedAt ?? null,
      ghinPostId: ghinPostId ?? existingEntry?.ghinPostId ?? null,
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        nickname: p.nickname ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        handicapIndex: p.handicapIndex ?? null,
        courseHandicap: p.courseHandicap ?? null,
        color: p.color ?? null,
        guest: false,
        loggedIn: true,
        verified: hasContact(p),
      })),
      teams,
      scores,
      bets,
      sideGameFlags,
      skinFlags,
      wolfPicks,
      bbbFlags,
      strokeAllocations,
      playerGameData,
      leaderboard: leaderboard.map((e) => ({
        rank: e.rank,
        name: e.player.name,
        key: playerKey(e.player),
        gross: e.gross,
        net: e.net,
        toPar: e.toPar,
        // Scramble has no per-player score rows — the leaderboard entities are
        // teams there — so omit the mix rather than persist misleading zeros.
        mix: isScramble ? null : scoringMix(scores[e.player.id], pars, totalHoles),
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
    }
    saveRound(entry)
    // Mirror to Supabase when signed in (no-op offline / local-only mode).
    const userId = useAuthStore.getState().user?.id
    if (userId) await dbSaveRound(entry, userId)
    return entry
  }

  // Auto-save the finished round to history on mount (feeds Home / You /
  // History). Runs once; the snapshot is the same shape History renders.
  useEffect(() => {
    if (savedRef.current || !round || players.length === 0) return
    savedRef.current = true
    void persistRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, players])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  // No round set up yet — bounce back to setup.
  if (!round || players.length === 0) {
    return <Navigate to="/setup" replace />
  }

  /* ------------------------------------------------------------ derived model */

  const playerById = Object.fromEntries(players.map((p) => [p.id, p]))
  const teamNameOf = (pid) => teams.find((t) => t.playerIds?.includes(pid))?.name

  const subFor = (pid) => {
    const st = playerStats[pid]
    if (isStableford) return `${st?.points ?? 0} pts`
    if (isScramble) return teamNameOf(pid) ?? 'No team'
    return `${st?.gross || 0} gross · ${st?.net || 0} net`
  }

  // Standings sorted by winnings (then by net score as a tiebreak).
  const standings = players
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      win: netPayouts[p.id] ?? 0,
      net: playerStats[p.id]?.net ?? 0,
    }))
    .sort((a, b) => b.win - a.win || a.net - b.net)

  const meRank = Math.max(1, standings.findIndex((r) => r.id === me) + 1)
  const meWin = netPayouts[me] ?? 0
  const mePlayer = playerById[me] ?? players[0]
  const heroHeadline =
    meWin > 0 ? 'collected from the group' : meWin < 0 ? 'owed to the group' : 'dead even — keep your cash'

  // Transfers (who pays whom), tagged from the hero's perspective.
  const transfers = settlements.map((s) => {
    const key = `${s.from}>${s.to}`
    const from = playerById[s.from]
    const to = playerById[s.to]
    const meTag = s.from === me ? 'YOU PAY' : s.to === me ? 'YOU COLLECT' : ''
    return {
      key,
      paid: !!paid[key],
      meTag,
      involvesMe: s.from === me || s.to === me,
      fromColor: from?.color,
      fromInitial: initial(from?.name),
      toColor: to?.color,
      toInitial: initial(to?.name),
      label: `${from?.name ?? '—'} pays ${to?.name ?? '—'}`,
      amount: money(s.amount),
    }
  })
  const paidCount = transfers.filter((t) => t.paid).length
  const allPaid = transfers.length > 0 && paidCount === transfers.length

  // Per-game cards.
  const games = betResults.map((b) => {
    const pot = round2(Object.values(b.payouts).reduce((s, v) => (v > 0 ? s + v : s), 0))
    const chips = Object.entries(b.payouts)
      .map(([id, v]) => ({ id, v, color: playerById[id]?.color, name: playerById[id]?.name }))
      .sort((a, b2) => b2.v - a.v)
    return { ...b, pot, chips }
  })

  // Recap tiles.
  const entities = isScramble && teams.length > 0 ? teams : players
  const winners = leaderboard.filter((e) => e.rank === 1 && e.thru > 0)
  const champName = winners.map((w) => w.player.name).join(' & ') || '—'
  const champSub = isStableford
    ? `${leaderboard[0]?.points ?? 0} pts`
    : leaderboard[0]
    ? `Net ${leaderboard[0].net} · ${vpl(leaderboard[0].toPar)}`
    : '—'

  const lowGross = leaderboard
    .filter((e) => e.thru > 0)
    .reduce((best, e) => (best == null || e.gross < best.gross ? e : best), null)

  let birdies = 0
  for (const e of entities) {
    const es = scores[e.id] ?? {}
    for (let h = 1; h <= totalHoles; h++) {
      const sc = es[h]
      const par = pars[h]
      if (sc != null && par != null && sc < par) birdies += 1
    }
  }

  const recap = [
    { icon: '👑', iconName: 'leader', label: 'CHAMPION', value: champName, sub: champSub },
    { icon: '🎯', iconName: 'target', label: 'LOW GROSS', value: lowGross ? lowGross.gross : '—', sub: lowGross ? lowGross.player.name : 'no scores' },
    { icon: '🐦', iconName: 'birdie', label: 'BIRDIES', value: String(birdies), sub: 'across the group' },
    { icon: '💸', iconName: 'swap', label: 'CHANGED HANDS', value: `$${moneyMoved}`, sub: `${settlements.length} transfer${settlements.length === 1 ? '' : 's'}` },
  ]

  const scoringLabel = `FINAL · ${FORMAT_LABEL[scoringType] ?? 'STROKE'} · ${useGrossScoring ? 'GROSS' : 'NET'}`
  const headerDetail = `${totalHoles} holes · ${round.date || ''}`.trim().replace(/·\s*$/, '').trim()
  const backdrop = getCourseImage(round)

  const settleLabel = settlements.length === 0 ? 'Done' : allPaid ? 'All settled ✓' : 'Mark all paid'

  /* ------------------------------------------------------------- interactions */

  const togglePaid = (key) => setPaid((p) => ({ ...p, [key]: !p[key] }))
  const toggleGame = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  const doShare = async () => {
    const ok = await copyText(summaryText)
    setToast(ok ? 'Summary copied — paste it in the group chat' : 'Couldn’t copy summary.')
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 1800)
  }

  const doSettleAll = () => {
    if (settlements.length === 0 || allPaid) {
      setCelebrate(true)
      return
    }
    const next = {}
    transfers.forEach((t) => { next[t.key] = true })
    setPaid(next)
  }

  // The explicit, final user action. Reached only from a deliberate gate — the
  // footer Complete's confirm modal, or the "all settled" celebration overlay
  // (itself entered via Mark all paid, with a Back-to-summary escape). Marks the
  // live round complete, guarantees the snapshot is saved, then wipes the live
  // round and heads to the locker. resetRound() never fires on its own.
  const handleCompleteRound = async () => {
    if (completing) return
    setCompleting(true)
    try {
      completeRound()
      await persistRound()
      const liveRoundId = useLiveRoundStore.getState().liveRoundId
      if (liveRoundId) {
        await completeLiveRound(liveRoundId)
      }
    } finally {
      teardownLiveSync()
      useLiveRoundStore.getState().clearSession()
      resetRound()
      navigate('/you', { replace: true })
    }
  }

  /* -------------------------------------------------------------------- render */

  return (
    <div style={S.root}>
      <div
        style={{
          ...S.backdrop,
          // Layer the course photo over a turf gradient so a missing/slow image
          // never leaves a blank backdrop.
          backgroundImage: `url(${backdrop}), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)`,
        }}
      />
      <div style={S.scrim} />

      <div style={S.column}>
        <AppHeader accent={ACCENT} backTo="/scoring" logo="wordmark" rightAction="pin" kicker={scoringLabel} title="Settle Up" contextPill={round.course || 'Round'} />
        <div style={S.headerDetail}>{headerDetail}</div>

        {/* scroll body ---------------------------------------------------- */}
        <div className="golo-scroll" style={S.scroll}>
          {/* HERO · your result */}
          <div style={{ ...S.hero, borderColor: hexA(ACCENT, 0.5) }}>
            <span style={{ ...S.heroGlow, background: hexA(mePlayer?.color, 0.5) }} />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ ...S.avatar, width: 40, height: 40, fontSize: 17, background: mePlayer?.color ?? '#2dd4bf' }}>
                {initial(mePlayer?.name)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.55)' }}>
                  {mePlayer?.name} · {ord(meRank)} of {players.length}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.6)', marginTop: 1 }}>
                  You {meWin >= 0 ? 'collected' : 'owe'} · {heroHeadline}
                </div>
              </div>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 52, fontWeight: 800, lineHeight: 0.95, letterSpacing: -1, color: ncd(meWin) }}>
                {signed(meWin)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.6)', paddingBottom: 8 }}>
                {subFor(me)}
              </span>
            </div>
            <div style={{ position: 'relative', fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 8 }}>
              ${moneyMoved} changed hands across {betResults.length} game{betResults.length === 1 ? '' : 's'}
            </div>
          </div>

          {/* NET WINNINGS · standings */}
          <div style={S.sectionRow}>
            <span style={S.sectionLabel}>NET WINNINGS</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.42)' }}>tap to view as</span>
          </div>
          {standings.length === 0 ? (
            <div style={S.emptyCard}>No completed results yet.</div>
          ) : (
            standings.map((r, i) => {
            const isMe = r.id === me
            return (
              <button
                key={r.id}
                onClick={() => setMe(r.id)}
                aria-pressed={!!isMe}
                aria-label={`Show payouts as ${r.name}`}
                style={{ ...S.standRow, border: `1px solid ${isMe ? hexA(ACCENT, 0.6) : 'rgba(255,255,255,.12)'}` }}
              >
                <span style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,.5)', width: 16, flex: '0 0 auto', textAlign: 'center' }}>
                  {i + 1}
                </span>
                <span style={{ ...S.avatar, width: 38, height: 38, fontSize: 15, background: r.color ?? '#2dd4bf', boxShadow: `0 0 0 2px ${isMe ? ACCENT : 'rgba(255,255,255,.25)'}` }}>
                  {initial(r.name)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 7 }}>
                    {r.name}
                    {isMe && <span style={S.youBadge}>YOU</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>{subFor(r.id)}</div>
                </div>
                <span style={{ fontSize: 20, fontWeight: 800, color: ncd(r.win), flex: '0 0 auto' }}>{signed(r.win)}</span>
              </button>
            )
          })
          )}

          {/* WHO PAYS WHOM · transfers */}
          <div style={S.sectionRow}>
            <span style={S.sectionLabel}>WHO PAYS WHOM</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: allPaid ? '#bef264' : 'rgba(255,255,255,.5)' }}>
              {transfers.length === 0 ? 'all square' : `${paidCount}/${transfers.length} paid`}
            </span>
          </div>
          {transfers.length === 0 ? (
            <div style={S.emptyCard}>All square — no payouts to settle.</div>
          ) : (
            transfers.map((t) => (
              <div
                key={t.key}
                style={{
                  ...S.transferRow,
                  border: `1px solid ${t.paid ? 'rgba(190,242,100,.4)' : t.involvesMe ? hexA(ACCENT, 0.4) : 'rgba(255,255,255,.12)'}`,
                  opacity: t.paid ? 0.55 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                  <span style={{ ...S.avatar, width: 32, height: 32, fontSize: 13, boxShadow: 'none', background: t.fromColor ?? '#2dd4bf' }}>{t.fromInitial}</span>
                  <span style={{ fontSize: 18, color: 'rgba(255,255,255,.45)', flex: '0 0 auto' }}>→</span>
                  <span style={{ ...S.avatar, width: 32, height: 32, fontSize: 13, boxShadow: 'none', background: t.toColor ?? '#2dd4bf' }}>{t.toInitial}</span>
                  <div style={{ minWidth: 0, marginLeft: 2 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</div>
                    {t.meTag && <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: ACCENT }}>{t.meTag}</div>}
                  </div>
                </div>
                <span style={{ fontSize: 17, fontWeight: 800, color: '#fff', flex: '0 0 auto' }}>{t.amount}</span>
                <button
                  onClick={() => togglePaid(t.key)}
                  aria-pressed={!!t.paid}
                  aria-label={`${t.label}, ${t.amount}. ${t.paid ? 'Paid — tap to undo' : 'Mark paid'}`}
                  style={{
                    flex: '0 0 auto',
                    minHeight: 36,
                    padding: '0 13px',
                    borderRadius: 11,
                    border: `1px solid ${t.paid ? 'rgba(190,242,100,.5)' : 'rgba(255,255,255,.18)'}`,
                    background: t.paid ? 'rgba(190,242,100,.18)' : 'rgba(255,255,255,.08)',
                    color: t.paid ? '#bef264' : '#fff',
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {t.paid ? '✓ Paid' : 'Mark paid'}
                </button>
              </div>
            ))
          )}

          {/* THE GAMES */}
          <div style={{ ...S.sectionLabel, margin: '18px 2px 9px' }}>THE GAMES</div>
          {games.length === 0 ? (
            <div style={S.emptyCard}>No games on this round.</div>
          ) : (
            games.map((g) => {
              const open = !!expanded[g.id]
              const glyph = betGlyphName(g.type)
              return (
                <div key={g.id} style={S.gameCard}>
                  <button
                    onClick={() => toggleGame(g.id)}
                    aria-expanded={!!open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${g.name} breakdown`}
                    style={S.gameHead}
                  >
                    <span style={S.gameIcon}>{glyph ? <Icon name={glyph} size={20} color={ACCENT} /> : g.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: '#fff' }}>{g.name}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.headline}
                      </div>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT, flex: '0 0 auto' }}>${g.pot} pot</span>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', flex: '0 0 auto', width: 14, textAlign: 'center' }}>{open ? '▾' : '▸'}</span>
                  </button>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
                    {g.chips.map((c) => (
                      <span key={c.id} style={S.netChip}>
                        <span style={{ ...S.avatar, width: 22, height: 22, fontSize: 10, boxShadow: 'none', background: c.color ?? '#2dd4bf' }}>{initial(c.name)}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: ncd(c.v) }}>{signed(c.v)}</span>
                      </span>
                    ))}
                  </div>

                  {open && g.lines.length > 0 && (
                    <div style={{ marginTop: 13, paddingTop: 13, borderTop: '1px solid rgba(255,255,255,.1)' }}>
                      {g.lines.map((line, i) => (
                        <div key={i} style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.62)', padding: '6px 0', lineHeight: 1.35 }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}

          {/* ROUND RECAP */}
          <div style={{ ...S.sectionLabel, margin: '18px 2px 9px' }}>ROUND RECAP</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
            {recap.map((s) => (
              <div key={s.label} style={S.recapCard}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800, letterSpacing: 1, color: 'rgba(255,255,255,.5)' }}>
                  <span style={{ display: 'flex', fontSize: 13 }}>{s.iconName ? <Icon name={s.iconName} size={14} color={ACCENT} /> : s.icon}</span>
                  {s.label}
                </div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 6, letterSpacing: -0.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.value}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* footer --------------------------------------------------------- */}
        <div style={S.footer}>
          {authEnabled && (
            <div style={{ marginBottom: 10 }}>
              {ghinPostedAt ? (
                <div style={{ ...S.ghinBanner, borderColor: hexA(ACCENT, 0.45) }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>Posted to GHIN</span>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>
                    Gross {ghinEligibility.gross ?? '—'} · {round.date || 'today'}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => ghinEligibility.ok && setGhinConfirm(true)}
                  disabled={!ghinEligibility.ok || ghinPosting}
                  style={{
                    ...S.ghinBtn,
                    opacity: ghinEligibility.ok && !ghinPosting ? 1 : 0.55,
                    cursor: ghinEligibility.ok && !ghinPosting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {ghinPosting ? 'Posting to GHIN…' : 'Post to GHIN'}
                </button>
              )}
              {!ghinPostedAt && !ghinEligibility.ok && ghinEligibility.reasons[0] && (
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,.45)', marginTop: 6, lineHeight: 1.35 }}>
                  {ghinEligibility.reasons[0]}
                </div>
              )}
              {ghinPostError && (
                <div style={{ fontSize: 11.5, fontWeight: 600, color: '#fb7185', marginTop: 6 }}>{ghinPostError}</div>
              )}
            </div>
          )}
          <button onClick={() => setConfirming(true)} disabled={completing} style={{ ...S.completeBtn, opacity: completing ? 0.68 : 1, cursor: completing ? 'wait' : 'pointer' }}>
            {completing ? 'Completing...' : 'Complete'}
          </button>
          <div style={S.footerRow}>
            <button onClick={doShare} style={S.shareBtn}>↗ Share</button>
            <button onClick={doSettleAll} style={S.settleBtn}>{settleLabel}</button>
          </div>
        </div>
      </div>

      {/* SHARE TOAST */}
      {toast && (
        <div style={S.toastWrap}>
          <div style={S.toast} role="status" aria-live="polite">{toast}</div>
        </div>
      )}

      {/* ALL SETTLED OVERLAY */}
      {celebrate && (
        <div style={S.modalWrap}>
          <div onClick={() => setCelebrate(false)} style={S.modalScrim} />
          <div style={S.modalCard}>
            <div style={S.checkCircle}>✓</div>
            <div style={{ fontSize: 23, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>All settled</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.62)', marginTop: 8, lineHeight: 1.5 }}>
              {round.course || 'Round'} settled — ${moneyMoved} moved across {settlements.length} transfer{settlements.length === 1 ? '' : 's'}.
            </div>
            <button onClick={handleCompleteRound} disabled={completing} style={{ ...S.modalPrimary, opacity: completing ? 0.68 : 1, cursor: completing ? 'wait' : 'pointer' }}>
              {completing ? 'Completing...' : 'Complete'}
            </button>
            <button onClick={() => setCelebrate(false)} style={S.modalGhost}>Back to summary</button>
          </div>
        </div>
      )}

      {/* CONFIRM · post to GHIN */}
      {ghinConfirm && (
        <div style={{ ...S.modalWrap, zIndex: 60 }} role="dialog" aria-modal="true" aria-label="Post to GHIN">
          <div onClick={() => !ghinPosting && setGhinConfirm(false)} style={S.modalScrim} />
          <div style={S.modalCard}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>Post to GHIN?</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.62)', marginTop: 10, lineHeight: 1.5 }}>
              Submit your official gross score ({ghinEligibility.gross ?? '—'}) for {round.course || 'this round'}
              {round.tee?.name ? ` · ${round.tee.name} tees` : ''}. Side-game results are not sent.
            </div>
            {ghinPostError && (
              <div style={{ fontSize: 13, color: '#fb7185', marginTop: 10 }}>{ghinPostError}</div>
            )}
            <button onClick={handlePostToGhin} disabled={ghinPosting} style={{ ...S.modalPrimary, opacity: ghinPosting ? 0.68 : 1, cursor: ghinPosting ? 'wait' : 'pointer' }}>
              {ghinPosting ? 'Posting…' : 'Post score'}
            </button>
            <button onClick={() => setGhinConfirm(false)} disabled={ghinPosting} style={S.modalGhost}>Cancel</button>
          </div>
        </div>
      )}

      {/* CONFIRM · final completion (gates the destructive resetRound) */}
      {confirming && (
        <div style={{ ...S.modalWrap, zIndex: 60 }} role="dialog" aria-modal="true" aria-label="Complete round">
          <div onClick={() => !completing && setConfirming(false)} style={S.modalScrim} />
          <div style={S.modalCard}>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -0.3 }}>Complete this round?</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.62)', marginTop: 10, lineHeight: 1.5 }}>
              Your results are already saved to history — completing just closes out
              the live round. You can still review payouts before you leave.
            </div>
            <button onClick={handleCompleteRound} disabled={completing} style={{ ...S.modalPrimary, opacity: completing ? 0.68 : 1, cursor: completing ? 'wait' : 'pointer' }}>
              {completing ? 'Completing...' : 'Complete round'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={completing} style={S.modalGhost}>Keep reviewing</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------------------------- styles */

const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff',
    background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)',
  },
  backdrop: {
    position: 'absolute', inset: 0,
    // Gradient fallback first, then size/position so they survive the shorthand.
    background: 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)',
    backgroundSize: 'cover', backgroundPosition: 'center',
  },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.74) 0%, rgba(6,14,9,.6) 26%, rgba(6,16,10,.66) 58%, rgba(4,12,8,.9) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  headerDetail: { flex: '0 0 auto', padding: '0 18px 10px', fontSize: 13, color: 'rgba(255,255,255,.6)', textShadow: '0 2px 12px rgba(0,0,0,.4)' },
  scroll: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '4px 16px 14px' },

  avatar: { borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', boxShadow: '0 0 0 2px rgba(255,255,255,.25)' },

  hero: { position: 'relative', overflow: 'hidden', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid', borderRadius: 24, padding: '20px 18px', marginBottom: 14, boxShadow: '0 12px 32px rgba(0,0,0,.34)' },
  heroGlow: { position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: '50%', filter: 'blur(34px)', pointerEvents: 'none' },

  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 2px 9px' },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },

  standRow: { width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, padding: '11px 13px', marginBottom: 9, cursor: 'pointer' },
  youBadge: { fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: ACCENT_DARK, background: ACCENT, padding: '2px 7px', borderRadius: 9999 },

  transferRow: { display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, padding: '11px 13px', marginBottom: 9 },
  emptyCard: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 15, lineHeight: 1.5 },

  gameCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 18, padding: '13px 14px', marginBottom: 11, boxShadow: '0 8px 22px rgba(0,0,0,.26)' },
  gameHead: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' },
  gameIcon: { width: 40, height: 40, borderRadius: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' },
  netChip: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 5px', borderRadius: 9999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' },

  recapCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 16, padding: '13px 14px', minWidth: 0 },

  footer: { flex: '0 0 auto', padding: '10px 16px max(18px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 9 },
  ghinBtn: { width: '100%', minHeight: 48, borderRadius: 15, border: `1px solid ${hexA(ACCENT, 0.38)}`, fontSize: 15, fontWeight: 800, background: hexA(ACCENT, 0.1), color: ACCENT },
  ghinBanner: { width: '100%', boxSizing: 'border-box', borderRadius: 15, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', padding: '12px 14px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' },
  footerRow: { display: 'flex', gap: 10, alignItems: 'center' },
  completeBtn: { width: '100%', minHeight: 54, borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 800, background: ACCENT, color: ACCENT_DARK, boxShadow: `0 8px 22px ${hexA(ACCENT, 0.4)}` },
  shareBtn: { minHeight: 48, padding: '0 18px', borderRadius: 15, background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  settleBtn: { flex: 1, minHeight: 48, borderRadius: 15, border: `1px solid ${hexA(ACCENT, 0.38)}`, fontSize: 15, fontWeight: 800, cursor: 'pointer', background: hexA(ACCENT, 0.12), color: ACCENT },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 96, display: 'flex', justifyContent: 'center', zIndex: 50, pointerEvents: 'none' },
  toast: { background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 14, padding: '12px 18px', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 12px 30px rgba(0,0,0,.5)' },

  modalWrap: { position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalScrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' },
  modalCard: { position: 'relative', background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(26px)', WebkitBackdropFilter: 'blur(26px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 24, padding: '26px 24px', width: '100%', maxWidth: 360, boxShadow: '0 30px 60px rgba(0,0,0,.5)', textAlign: 'center' },
  checkCircle: { width: 66, height: 66, borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 800, color: ACCENT_DARK, background: ACCENT, boxShadow: `0 8px 24px ${hexA(ACCENT, 0.45)}` },
  modalPrimary: { marginTop: 20, width: '100%', minHeight: 54, borderRadius: 16, background: ACCENT, color: ACCENT_DARK, fontSize: 16, fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: `0 8px 22px ${hexA(ACCENT, 0.45)}` },
  modalGhost: { marginTop: 9, width: '100%', minHeight: 48, borderRadius: 14, background: 'transparent', border: 'none', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)', cursor: 'pointer' },
}
