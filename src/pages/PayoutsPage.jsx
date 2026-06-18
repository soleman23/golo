import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import { buildLeaderboard } from '../engines/scoring'
import { buildStablefordLeaderboard } from '../engines/stableford'
import { buildBetResults, formatRoundSummary } from '../engines/betResults'
import { aggregatePayouts, calculateSettlements } from '../engines/payouts'
import { playerKey, autoKey } from '../lib/identity'
import { GoloWordmark } from '../components/shared/Logo'

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
 * so the footer can stay faithful to the mock (Share + Mark all paid → New
 * round). Preserves all formats: standings/recap adapt to Scramble teams and
 * Stableford points, and the per-game cards render whatever bets were played
 * (Nassau, Skins, Purse, CTP, Long Drive, Wolf, Bingo-Bango-Bongo).
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'

// Course name → backdrop photo (mirrors ScoringPage / SetupWizard).
const COURSE_BG = {
  'Pinehurst No.2': '/courses/course.png',
  'Harbor Dunes': '/courses/sunset.png',
  'Lincoln Park': '/courses/turf.png',
  'Tetherow': '/courses/tetherow.jpg',
  'Lost Tracks Golf Course': '/courses/losttracks.webp',
}

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
const round2 = (n) => Math.round(n * 100) / 100 // cents — avoids half-up sign asymmetry & matches History/You
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

  const [meOverride, setMe] = useState(null) // hero player id, once the user taps
  const [paid, setPaid] = useState({}) // settlement key `${from}>${to}` → true
  const [expanded, setExpanded] = useState({}) // bet id → true
  const [toast, setToast] = useState(false)
  const [celebrate, setCelebrate] = useState(false)
  const toastTimer = useRef()
  const savedRef = useRef(false)
  const expandedSeeded = useRef(false)

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

  // Entity-level board mirrors the round format (team gross / points / net).
  const leaderboard = useMemo(() => {
    if (isStableford) {
      return buildStablefordLeaderboard(players, scores, pars, strokeAllocations).map((e) => ({
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
    return buildLeaderboard(players, scores, strokeAllocations, pars, totalHoles)
  }, [isStableford, isScramble, teams, players, scores, strokeAllocations, pars, totalHoles])

  // Per-player gross/net (for hero + standings sub-lines). In scramble the
  // individuals have no own scores, so these come out zero and we fall back to
  // the player's team name instead.
  const playerStats = useMemo(() => {
    if (isStableford) {
      const lb = buildStablefordLeaderboard(players, scores, pars, strokeAllocations)
      return Object.fromEntries(
        lb.map((e) => [e.player.id, { gross: e.gross, net: e.points, points: e.points, thru: e.thru, toPar: 0 }])
      )
    }
    const lb = buildLeaderboard(players, scores, strokeAllocations, pars, totalHoles)
    return Object.fromEntries(
      lb.map((e) => [e.player.id, { gross: e.gross, net: e.net, thru: e.thru, toPar: e.toPar }])
    )
  }, [isStableford, players, scores, pars, strokeAllocations, totalHoles])

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

  const netPayouts = useMemo(() => aggregatePayouts(betResults.map((b) => b.payouts)), [betResults])
  const settlements = useMemo(() => calculateSettlements(netPayouts), [netPayouts])
  const moneyMoved = useMemo(
    () => round2(settlements.reduce((sum, s) => sum + s.amount, 0)),
    [settlements]
  )

  const summaryText = useMemo(
    () => formatRoundSummary({ round, players, leaderboard, betResults, settlements, scoringType }),
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

  // Expand the first game by default, once results are known.
  useEffect(() => {
    if (expandedSeeded.current || betResults.length === 0) return
    expandedSeeded.current = true
    setExpanded({ [betResults[0].id]: true })
  }, [betResults])

  // Auto-save the finished round to history on mount (feeds Home / You /
  // History). Runs once; the snapshot is the same shape History renders.
  useEffect(() => {
    if (savedRef.current || !round || players.length === 0) return
    savedRef.current = true
    completeRound()
    saveRound({
      roundId: round.roundId,
      course: round.course,
      date: round.date,
      holes: round.holes,
      completedAt: new Date().toISOString(),
      // Guests are kept in the snapshot so this round still renders their name,
      // colour and settlements — but playerKey() returns null for them, so they
      // never roll up into the season ledger, crew standings, or "you".
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        nickname: p.nickname ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        guest: !!p.guest,
      })),
      leaderboard: leaderboard.map((e) => ({
        rank: e.rank,
        name: e.player.name,
        key: playerKey(e.player),
        gross: e.gross,
        net: e.net,
        toPar: e.toPar,
        mix: scoringMix(scores[e.player.id], pars, totalHoles),
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
    { icon: '👑', label: 'CHAMPION', value: champName, sub: champSub },
    { icon: '🎯', label: 'LOW GROSS', value: lowGross ? lowGross.gross : '—', sub: lowGross ? lowGross.player.name : 'no scores' },
    { icon: '🐦', label: 'BIRDIES', value: String(birdies), sub: 'across the group' },
    { icon: '💸', label: 'CHANGED HANDS', value: `$${moneyMoved}`, sub: `${settlements.length} transfer${settlements.length === 1 ? '' : 's'}` },
  ]

  const scoringLabel = `FINAL · ${FORMAT_LABEL[scoringType] ?? 'STROKE'}`
  const headerDetail = `${totalHoles} holes · ${round.date || ''}`.trim().replace(/·\s*$/, '').trim()
  const backdrop = COURSE_BG[round.course] ?? '/courses/course.png'

  const settleLabel = settlements.length === 0 ? 'Done' : allPaid ? 'All settled ✓' : 'Mark all paid'

  /* ------------------------------------------------------------- interactions */

  const togglePaid = (key) => setPaid((p) => ({ ...p, [key]: !p[key] }))
  const toggleGame = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  const doShare = async () => {
    await copyText(summaryText)
    setToast(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(false), 1800)
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

  const handleNewRound = () => {
    resetRound()
    navigate('/setup')
  }

  /* -------------------------------------------------------------------- render */

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, backgroundImage: `url('${backdrop}')` }} />
      <div style={S.scrim} />

      <div style={S.column}>
        {/* header --------------------------------------------------------- */}
        <div style={S.header}>
          <GoloWordmark variant="white" fontPx={16} style={{ marginBottom: 12 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT }}>{scoringLabel}</span>
            <div style={S.coursePill}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: ACCENT }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {round.course || 'Round'}
              </span>
            </div>
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, marginTop: 8, letterSpacing: -0.5 }}>Settle Up</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.6)', marginTop: 2 }}>{headerDetail}</div>
        </div>

        {/* scroll body ---------------------------------------------------- */}
        <div style={S.scroll}>
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
          {standings.map((r, i) => {
            const isMe = r.id === me
            return (
              <button
                key={r.id}
                onClick={() => setMe(r.id)}
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
          })}

          {/* WHO PAYS WHOM · transfers */}
          <div style={S.sectionRow}>
            <span style={S.sectionLabel}>WHO PAYS WHOM</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: allPaid ? '#bef264' : 'rgba(255,255,255,.5)' }}>
              {transfers.length === 0 ? 'all square' : `${paidCount}/${transfers.length} paid`}
            </span>
          </div>
          {transfers.length === 0 ? (
            <div style={S.emptyCard}>All square — nobody owes anybody. Rare, and worth a photo.</div>
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
              return (
                <div key={g.id} style={S.gameCard}>
                  <button onClick={() => toggleGame(g.id)} style={S.gameHead}>
                    <span style={S.gameIcon}>{g.icon}</span>
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
                  <span style={{ fontSize: 13 }}>{s.icon}</span>
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
          <button onClick={doShare} style={S.shareBtn}>↗ Share</button>
          <button onClick={doSettleAll} style={S.settleBtn}>{settleLabel}</button>
        </div>
      </div>

      {/* SHARE TOAST */}
      {toast && (
        <div style={S.toastWrap}>
          <div style={S.toast}>Summary copied — paste it in the group chat</div>
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
            <button onClick={handleNewRound} style={S.modalPrimary}>New round →</button>
            <button onClick={() => setCelebrate(false)} style={S.modalGhost}>Back to summary</button>
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
  backdrop: { position: 'absolute', inset: 0, backgroundSize: 'cover', backgroundPosition: '50% 60%' },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.74) 0%, rgba(6,14,9,.6) 26%, rgba(6,16,10,.66) 58%, rgba(4,12,8,.9) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', width: '100%', maxWidth: 480, margin: '0 auto' },
  header: { flex: '0 0 auto', padding: 'max(10px, env(safe-area-inset-top)) 18px 12px', textShadow: '0 2px 12px rgba(0,0,0,.4)' },
  coursePill: { display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.16)', padding: '6px 12px', borderRadius: 9999, maxWidth: 210, minWidth: 0 },
  scroll: { flex: 1, overflowY: 'auto', padding: '4px 16px 14px' },

  avatar: { borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', boxShadow: '0 0 0 2px rgba(255,255,255,.25)' },

  hero: { position: 'relative', overflow: 'hidden', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid', borderRadius: 24, padding: '20px 18px', marginBottom: 14, boxShadow: '0 12px 32px rgba(0,0,0,.34)' },
  heroGlow: { position: 'absolute', right: -30, top: -30, width: 140, height: 140, borderRadius: '50%', filter: 'blur(34px)', pointerEvents: 'none' },

  sectionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 2px 9px' },
  sectionLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' },

  standRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, padding: '11px 13px', marginBottom: 9, cursor: 'pointer' },
  youBadge: { fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: ACCENT_DARK, background: ACCENT, padding: '2px 7px', borderRadius: 9999 },

  transferRow: { display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: 16, padding: '11px 13px', marginBottom: 9 },
  emptyCard: { fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 15, lineHeight: 1.5 },

  gameCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 18, padding: '13px 14px', marginBottom: 11, boxShadow: '0 8px 22px rgba(0,0,0,.26)' },
  gameHead: { width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' },
  gameIcon: { width: 40, height: 40, borderRadius: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' },
  netChip: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px 5px 5px', borderRadius: 9999, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)' },

  recapCard: { background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.13)', borderRadius: 16, padding: '13px 14px', minWidth: 0 },

  footer: { flex: '0 0 auto', padding: '10px 16px max(18px, env(safe-area-inset-bottom))', display: 'flex', gap: 10, alignItems: 'center' },
  shareBtn: { minHeight: 54, padding: '0 18px', borderRadius: 16, background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  settleBtn: { flex: 1, minHeight: 54, borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 800, cursor: 'pointer', background: ACCENT, color: ACCENT_DARK, boxShadow: `0 8px 22px ${hexA(ACCENT, 0.4)}` },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 96, display: 'flex', justifyContent: 'center', zIndex: 50, pointerEvents: 'none' },
  toast: { background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 14, padding: '12px 18px', fontSize: 13.5, fontWeight: 700, color: '#fff', boxShadow: '0 12px 30px rgba(0,0,0,.5)' },

  modalWrap: { position: 'fixed', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalScrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' },
  modalCard: { position: 'relative', background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(26px)', WebkitBackdropFilter: 'blur(26px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 24, padding: '26px 24px', width: '100%', maxWidth: 360, boxShadow: '0 30px 60px rgba(0,0,0,.5)', textAlign: 'center' },
  checkCircle: { width: 66, height: 66, borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 800, color: ACCENT_DARK, background: ACCENT, boxShadow: `0 8px 24px ${hexA(ACCENT, 0.45)}` },
  modalPrimary: { marginTop: 20, width: '100%', minHeight: 54, borderRadius: 16, background: ACCENT, color: ACCENT_DARK, fontSize: 16, fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: `0 8px 22px ${hexA(ACCENT, 0.45)}` },
  modalGhost: { marginTop: 9, width: '100%', minHeight: 48, borderRadius: 14, background: 'transparent', border: 'none', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)', cursor: 'pointer' },
}
