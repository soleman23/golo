import { hexA } from '../lib/colors'
import { initial, vpl, ncd, youBadge } from '../lib/scoreDisplay'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useLiveRoundStore, { useLiveRoundRole } from '../store/liveRoundStore'
import { buildLeaderboard } from '../engines/scoring'
import {
  buildStablefordLeaderboard,
  calculateStablefordPoints,
} from '../engines/stableford'
import { buildMatchPairings } from '../engines/matchplay'
import { getWolfOrder, calculateWolfResult, calculateWolfTotals } from '../engines/wolf'
import { calculateBBBPayouts } from '../engines/bingobangobongo'
import { summarizeBets } from '../engines/betStatus'
import { buildBetResults, betGlyphName } from '../engines/betResults'
import { skinsLongestDriveHole } from '../engines/skins'
import useProfileStore from '../store/profileStore'
import { playerKey } from '../lib/identity'
import { getCourseImage } from '../lib/courseImages'
import AppHeader from '../components/shared/AppHeader'
import { Icon } from '../components/shared/GoloIcons'
import { fetchLiveRound, ensureLiveScorerAccess, liveRoundUserMessage, serializeRoundState } from '../lib/db/liveRounds'
import { attachLiveSync, detachLiveSync, hydrateFromServer, subscribeToLiveRound, teardownLiveSync } from '../lib/liveRoundSync'
import useNotificationStore from '../store/notificationStore'
import { getPressEligibility, findOverallPurseBet, MAX_ACTIVE_PRESSES } from '../engines/pressBets'
import PressSheet from '../components/scoring/PressSheet'
import PlayerScoreRow from '../components/scoring/PlayerScoreRow'
import ScorecardGrid from '../components/scoring/ScorecardGrid'

/**
 * ScoringPage — the live round, "Scoring (Immersive)".
 *
 * Recreates the glass-over-turf design (Golo Golf - Scoring (Immersive).dc.html):
 * a full-bleed course photo, frosted player cards with oversized numerals, an
 * electric-lime accent, tappable ± / keypad scoring, ‹ › hole navigation, a
 * progress dot strip, a persistent Active Bets strip, and bottom-sheet
 * Leaderboard / Bets / Keypad / Finish overlays. Inline styles match the
 * prototype rather than fighting the app's light Tailwind theme — the same
 * approach used by SetupWizard.
 *
 * Wired to the real roundStore and reusing every engine, it folds in the app's
 * extras beyond the design's stroke-only mock: Scramble (team cards), Stableford
 * (points badges + board), Match Play (status + concede), and the Wolf / Bingo
 * Bango Bongo per-hole panels, plus CTP / Longest Drive winner pickers.
 *
 * Scorers start each hole showing that hole's par as the default; par only counts
 * once they advance to the next hole (Next) or Finish — stepping back via Prev
 * never commits. Viewers stay read-only until scores sync from the scorer.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a'
const COURSE_FALLBACK_BG = 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)'
const DASH = '–'

const BET_ICONS = {
  skins: '🎯',
  nassau: '🏆',
  strokePurse: '💰',
  ctp: '📍',
  longestDrive: '🚀',
  wolf: '🐺',
  bingobangobongo: '🟢',
}

/** A bet's GoLo glyph, falling back to its emoji when no glyph exists (BBB). */
function BetGlyph({ bet, size = 18, color = ACCENT }) {
  return bet.iconName ? <Icon name={bet.iconName} size={size} color={color} /> : <span>{bet.icon}</span>
}

/* ------------------------------------------------------------------- helpers */

/** Money the golf-bet way: +$5, −$3, $0 (rounded to the dollar for display). */
const fmtMoney = (n) => { const r = Number.isFinite(Number(n)) ? Math.round(Number(n)) : 0; return r > 0 ? `+$${r}` : r < 0 ? `−$${-r}` : '$0' }
const moneyColor = (n) => (n > 0.5 ? '#bef264' : n < -0.5 ? '#fb7185' : 'rgba(255,255,255,.72)')
const clampHole = (hole, totalHoles) => {
  const max = Math.max(1, Math.round(Number(totalHoles) || 1))
  const n = Math.round(Number(hole))
  return Math.max(1, Math.min(max, Number.isFinite(n) ? n : 1))
}
const scoreValue = (value) => {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
const clampScore = (value) => {
  const n = scoreValue(value)
  if (n == null) return null
  return Math.max(1, Math.min(20, Math.round(n)))
}
/** Truncate a per-player score map to holes ≤ k (for the "previous hole" rank). */
const limitScores = (scores, k) => {
  const out = {}
  for (const id in scores) {
    const src = scores[id] || {}
    const dst = {}
    for (const h in src) if (Number(h) <= k) dst[h] = src[h]
    out[id] = dst
  }
  return out
}
/** Keep only hole-keyed entries ≤ k (wolf picks, BBB flags, side-game flags). */
const limitHoleKeys = (obj, k) => {
  const out = {}
  for (const h in (obj || {})) if (Number(h) <= k) out[h] = obj[h]
  return out
}
const playersInBet = (players, bet) =>
  bet?.playerIds?.length ? players.filter((p) => bet.playerIds.includes(p.id)) : players

/** Write par for every unscored entity on a hole (no-op when already entered). */
function seedParForHole(hole, { entities, pars, totalHoles, updateScore }) {
  if (!entities.length) return
  const h = clampHole(hole, totalHoles)
  const holePar = pars[h] ?? 4
  entities.forEach((e) => {
    const live = useRoundStore.getState().scores
    if (scoreValue(live[e.id]?.[h]) == null) updateScore(e.id, h, holePar)
  })
}

/* --------------------------------------------------------------- component */

export default function ScoringPage() {
  const navigate = useNavigate()

  const round = useRoundStore((s) => s.round)
  const players = useRoundStore((s) => s.players)
  const teams = useRoundStore((s) => s.teams)
  const scores = useRoundStore((s) => s.scores)
  const bets = useRoundStore((s) => s.bets)
  const pressBets = useRoundStore((s) => s.pressBets)
  const sideGameFlags = useRoundStore((s) => s.sideGameFlags)
  const wolfPicks = useRoundStore((s) => s.wolfPicks)
  const bbbFlags = useRoundStore((s) => s.bbbFlags)
  const skinFlags = useRoundStore((s) => s.skinFlags)
  const concededHoles = useRoundStore((s) => s.concededHoles)
  const storedHole = useRoundStore((s) => s.currentHole)
  const roundStatus = useRoundStore((s) => s.status)

  const updateScore = useRoundStore((s) => s.updateScore)
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole)
  const startScoring = useRoundStore((s) => s.startScoring)
  const flagCTP = useRoundStore((s) => s.flagCTP)
  const flagLD = useRoundStore((s) => s.flagLD)
  const setWolfPick = useRoundStore((s) => s.setWolfPick)
  const clearWolfPick = useRoundStore((s) => s.clearWolfPick)
  const flagBBB = useRoundStore((s) => s.flagBBB)
  const toggleSkinFlag = useRoundStore((s) => s.toggleSkinFlag)
  const concedeHole = useRoundStore((s) => s.concedeHole)
  const completeRound = useRoundStore((s) => s.completeRound)
  const getStrokeAllocations = useRoundStore((s) => s.getStrokeAllocations)
  const createPressBet = useRoundStore((s) => s.createPressBet)

  const [sheet, setSheet] = useState(null) // 'leaderboard' | 'bets' | 'finish' | 'press' | null
  const [keypadFor, setKeypadFor] = useState(null) // { id, hole } | null
  const [lbView, setLbView] = useState(() => (round?.scoring === 'gross' ? 'gross' : 'net')) // 'net' | 'gross' | 'money' | 'card'
  const [cardNine, setCardNine] = useState('front') // scorecard view: 'front' | 'back'
  const [copiedInvite, setCopiedInvite] = useState(false)
  const [liveLoading, setLiveLoading] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(() => players.length >= 4)
  const liveEndedHandled = useRef(false)

  const liveRole = useLiveRoundRole()
  const liveRoundId = useLiveRoundStore((s) => s.liveRoundId)
  const inviteCode = useLiveRoundStore((s) => s.inviteCode)
  const scorerName = useLiveRoundStore((s) => s.scorerName)
  const readOnly = liveRole === 'player' || liveRole === 'viewer' || roundStatus === 'complete'
  const isLiveScorer = liveRole === 'scorer'

  // "You" detection for the YOU badge — profile identity, else the organizer.
  const profName = useProfileStore((s) => s.name)
  const profNick = useProfileStore((s) => s.nickname)
  const profEmail = useProfileStore((s) => s.email)
  const profPhone = useProfileStore((s) => s.phone)

  const scoringType = round?.scoringType ?? 'stroke'
  const isScramble = scoringType === 'scramble'
  const isStableford = scoringType === 'stableford'
  const isMatchplay = scoringType === 'matchplay'
  const useGrossScoring = round?.scoring === 'gross'

  const totalHoles = round?.holes ?? 18
  const currentHole = clampHole(storedHole, totalHoles)
  const pars = useMemo(() => round?.pars ?? {}, [round?.pars])
  const par = pars[currentHole] ?? 4
  const si = round?.strokeIndex?.[currentHole]
  const atFirstHole = currentHole <= 1
  const isLastHole = currentHole >= totalHoles

  // Score rows: teams in scramble, otherwise players.
  const entities = isScramble ? teams : players

  // The signed-in player (matched by contact identity, else the organizer/first
  // player), and the entity carrying them (their team in scramble).
  const meKey = playerKey({ name: profName, nickname: profNick, email: profEmail, phone: profPhone })
  const meId = players.find((p) => meKey != null && playerKey(p) === meKey)?.id ?? players[0]?.id ?? null
  const meEntityId = isScramble ? (teams.find((t) => t.playerIds?.includes(meId))?.id ?? null) : meId

  // Flip the round into scoring mode the first time this screen mounts.
  useEffect(() => {
    if (round && roundStatus === 'setup' && !readOnly) startScoring()
  }, [round, roundStatus, startScoring, readOnly])

  // Live round sync: scorer pushes patches; everyone (including scorer) listens
  // for remote completion so Home "End for everyone" tears down Scoring.
  useEffect(() => {
    liveEndedHandled.current = false
  }, [liveRoundId])

  useEffect(() => {
    if (!liveRoundId || liveRole === 'local-only') return undefined

    let cancelled = false
    let unsubComplete = () => {}

    const finishLive = (source = 'remote') => {
      if (liveEndedHandled.current) return
      liveEndedHandled.current = true
      teardownLiveSync()
      useLiveRoundStore.getState().clearSession()
      useNotificationStore.getState().pushToast({
        kicker: 'LIVE ROUND',
        title: 'Round finished',
        body: source === 'remote' && isLiveScorer
          ? 'Someone ended this live round.'
          : 'This live round has ended.',
        duration: 6000,
      })
      navigate('/', { replace: true })
    }

    if (isLiveScorer && roundStatus !== 'complete') {
      ;(async () => {
        const rs = useRoundStore.getState()
        const ensured = await ensureLiveScorerAccess({
          roundId: liveRoundId,
          state: serializeRoundState(rs),
          roster: rs.players,
          courseName: round?.course ?? '',
        })
        if (cancelled) return
        if (!ensured.ok) {
          teardownLiveSync()
          useLiveRoundStore.getState().clearSession()
          useNotificationStore.getState().pushToast({
            kicker: 'LIVE SYNC',
            title: 'Live sync unavailable',
            body: liveRoundUserMessage(ensured.reason),
            duration: 10000,
          })
          return
        }
        if (ensured.inviteCode) {
          const live = useLiveRoundStore.getState()
          useLiveRoundStore.getState().setSession({
            liveRoundId,
            inviteCode: ensured.inviteCode,
            role: 'scorer',
            scorerName: live.scorerName,
          })
        }
        attachLiveSync()
      })()

      // Scorer must also watch for remote end (player/viewer ending from Home).
      unsubComplete = subscribeToLiveRound(liveRoundId, (_state, status) => {
        if (status === 'complete') finishLive('remote')
      })

      return () => {
        cancelled = true
        detachLiveSync()
        unsubComplete()
      }
    }

    setLiveLoading(true)
    fetchLiveRound(liveRoundId).then((row) => {
      if (cancelled) return
      if (row?.status === 'complete') {
        finishLive('remote')
        return
      }
      if (row?.state) hydrateFromServer(row.state)
      setLiveLoading(false)
    })

    unsubComplete = subscribeToLiveRound(liveRoundId, (state, status) => {
      if (status === 'complete') {
        finishLive('remote')
        return
      }
      if (state) hydrateFromServer(state)
    })

    return () => {
      cancelled = true
      unsubComplete()
    }
  }, [liveRoundId, liveRole, isLiveScorer, roundStatus, navigate, round?.roundId, round?.course])

  // Scorer (local or live): each hole opens showing that hole's par as the default
  // (the ± baseline — see showScoreFor), but par is only written to the store —
  // and so only counts toward the leaderboard / bets / payout — once the scorer
  // advances to the next hole (Next) or Finishes. Stepping back via Prev never
  // commits. Viewers see a dash until a score syncs from the scorer.

  // Per-player handicap strokes by hole (individual formats; scramble plays gross).
  const playerAllocations = useMemo(
    () => getStrokeAllocations(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, round?.strokeIndex, round?.holes]
  )
  const allocations = useMemo(
    () => (isScramble || useGrossScoring ? {} : playerAllocations),
    [isScramble, useGrossScoring, playerAllocations]
  )

  const overallPurseBet = useMemo(() => findOverallPurseBet(bets), [bets])
  const pressEligibility = useMemo(
    () =>
      getPressEligibility({
        bets,
        pressBets,
        scores,
        pars,
        strokeAllocations: playerAllocations,
        teams,
        currentHole,
        totalHoles,
        status: roundStatus,
      }),
    [bets, pressBets, scores, pars, playerAllocations, teams, currentHole, totalHoles, roundStatus]
  )
  const activePressCount = useMemo(() => {
    if (!overallPurseBet) return 0
    return pressBets.filter((p) => p.parentBetId === overallPurseBet.id && p.status === 'active').length
  }, [pressBets, overallPurseBet])
  const activePresses = useMemo(() => {
    if (!overallPurseBet) return []
    return pressBets.filter((p) => p.parentBetId === overallPurseBet.id && p.status === 'active')
  }, [pressBets, overallPurseBet])

  const pressChipLabel = useMemo(() => {
    if (!pressEligibility.allowed || pressEligibility.targets.length === 0) return 'Press'
    const t = pressEligibility.targets[0]
    if (t.label) return `Press · ${t.label}`
    const down = t.targetTeamId
      ? teams.find((x) => x.id === t.targetTeamId)?.name
      : players.find((p) => p.id === t.targetPlayerId)?.name
    return down ? `Press · ${down} ${t.margin} down` : 'Press'
  }, [pressEligibility, players, teams])

  const hasAnyScore = useMemo(
    () => entities.some((e) => Object.values(scores[e.id] ?? {}).some((v) => scoreValue(v) != null)),
    [entities, scores]
  )

  // Sorted leaderboard for the sheet (format-aware).
  const leaderboard = useMemo(() => {
    if (!hasAnyScore) return []
    if (isStableford) {
      return buildStablefordLeaderboard(players, scores, pars, allocations).map((e) => ({
        rank: e.rank,
        player: e.player,
        thru: e.thru,
        gross: e.gross,
        net: e.points,
        toPar: null,
      }))
    }
    return buildLeaderboard(entities, scores, allocations, pars, totalHoles)
  }, [hasAnyScore, isStableford, entities, players, scores, allocations, pars, totalHoles])

  const leaderName = hasAnyScore ? (leaderboard[0]?.player?.name ?? DASH) : DASH

  const matchInfoList = useMemo(() => {
    if (!isMatchplay || players.length < 2) return []
    return buildMatchPairings(players, scores, allocations, concededHoles, pars, totalHoles)
  }, [isMatchplay, players, allocations, scores, concededHoles, pars, totalHoles])

  const canConcedeMatch = isMatchplay && players.length === 2

  // Side games / panels active on *this* hole.
  const skinsBet = bets.find((b) => b.type === 'skins')
  const skinsCfg = skinsBet?.config?.skinsConfig
  const skinSel = skinsCfg?.selectedSkins ?? {}
  const skinsCtpHoles = useMemo(() => {
    if (!skinsBet || !skinSel.closestToPin) return []
    const par3 = Object.keys(pars).map(Number).filter((h) => pars[h] === 3)
    return (skinsCfg?.ctpHoles ?? 0) === 1 ? par3.filter((h) => h > 9) : par3
  }, [skinsBet, skinSel.closestToPin, skinsCfg?.ctpHoles, pars])
  const skinsLdHole = useMemo(() => {
    if (!skinsBet || !skinSel.longestDrive) return null
    return skinsLongestDriveHole(skinsCfg, pars)
  }, [skinsBet, skinSel.longestDrive, skinsCfg, pars])

  const ctpBet =
    bets.find((b) => b.type === 'ctp' && (b.config.holes ?? []).includes(currentHole)) ??
    (skinsBet && skinSel.closestToPin && !skinSel.greenie && skinsCtpHoles.includes(currentHole) ? skinsBet : null)
  const ldBet =
    bets.find((b) => b.type === 'longestDrive' && b.config.hole === currentHole && pars[currentHole] === 5) ??
    (skinsBet && skinSel.longestDrive && skinsLdHole === currentHole && par === 5 ? skinsBet : null)
  const wolfBet = bets.find((b) => b.type === 'wolf')
  const bbbBet = bets.find((b) => b.type === 'bingobangobongo')
  const ctpPlayers = playersInBet(players, ctpBet)
  const ldPlayers = playersInBet(players, ldBet)
  const wolfPlayers = playersInBet(players, wolfBet)
  const bbbPlayers = playersInBet(players, bbbBet)
  const skinPlayers = playersInBet(players, skinsBet)
  const wolfActive = !isScramble && wolfBet && wolfPlayers.length === 4
  const bbbActive = !isScramble && bbbBet && bbbPlayers.length > 0
  const wolfId = wolfActive ? getWolfOrder(wolfPlayers, currentHole) : null

  // Manual skins (greenie/sandie) tracked live on this hole. Greenie is par-3
  // only; both stack and only show when the Skins bet enabled them in setup.
  const baseSkinValue = skinsBet?.config?.skinsConfig?.baseSkinValue ?? skinsBet?.config?.valuePerSkin ?? 0
  const manualSkinTypes = []
  if (skinsBet && skinSel.greenie && par === 3) manualSkinTypes.push({ type: 'greenie', label: 'Greenie', hint: 'Closest on a par 3, par or better' })
  if (skinsBet && skinSel.sandie) manualSkinTypes.push({ type: 'sandie', label: 'Sandie', hint: 'In bunker, par or better' })
  const skinsActive = !isScramble && manualSkinTypes.length > 0 && skinPlayers.length >= 2

  // Active-bet pills: the five "standard" bets via the engine, plus Wolf / BBB
  // running totals derived locally (those aren't covered by summarizeBets).
  const pills = useMemo(() => {
    const standard = summarizeBets({
      bets: bets.filter((b) => b.type !== 'wolf' && b.type !== 'bingobangobongo'),
      players,
      scores,
      pars,
      strokeAllocations: allocations,
      sideGameFlags,
      skinFlags,
      scoringType,
      teams,
    }).map((p) => ({
      id: p.id,
      icon: BET_ICONS[p.type] ?? '•',
      iconName: betGlyphName(p.type),
      title: p.name,
      status: p.label,
      detailLines: p.detailLines,
    }))

    const extra = []
    const wolfPillPlayers = playersInBet(players, wolfBet)
    if (!isScramble && wolfBet && wolfPillPlayers.length === 4) {
      const results = []
      for (let h = 1; h <= totalHoles; h++) {
        const pick = wolfPicks[h]
        if (!pick) continue
        const holeScores = {}
        wolfPillPlayers.forEach((p) => {
          holeScores[p.id] = scoreValue(scores[p.id]?.[h])
        })
        results.push(
          calculateWolfResult(holeScores, getWolfOrder(wolfPillPlayers, h), pick.partnerId, wolfBet.config?.unit ?? wolfBet.amount ?? 1, {
            blind: pick.blind,
          })
        )
      }
      const totals = calculateWolfTotals(results, wolfPillPlayers)
      const lead = [...wolfPillPlayers].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0))[0]
      const amt = lead ? totals[lead.id] ?? 0 : 0
      extra.push({
        id: wolfBet.id,
        icon: BET_ICONS.wolf,
        iconName: betGlyphName('wolf'),
        title: 'Wolf',
        status: amt > 0 ? `${lead.name} +$${amt}` : 'All even',
        detailLines: wolfPillPlayers.map((p) => `${p.name}: ${(totals[p.id] ?? 0) >= 0 ? '+' : ''}$${totals[p.id] ?? 0}`),
      })
    }
    const bbbPillPlayers = playersInBet(players, bbbBet)
    if (!isScramble && bbbBet && bbbPillPlayers.length > 0) {
      const flags = Object.values(bbbFlags).map((f) => ({
        bingoWinner: f?.bingo ?? null,
        bangoWinner: f?.bango ?? null,
        bongoWinner: f?.bongo ?? null,
      }))
      const { payouts } = calculateBBBPayouts(flags, bbbPillPlayers, bbbBet.config?.valuePerPoint ?? 1)
      const lead = [...bbbPillPlayers].sort((a, b) => (payouts[b.id] ?? 0) - (payouts[a.id] ?? 0))[0]
      const amt = lead ? payouts[lead.id] ?? 0 : 0
      extra.push({
        id: bbbBet.id,
        icon: BET_ICONS.bingobangobongo,
        title: 'Bingo Bango Bongo',
        status: amt > 0 ? `${lead.name} +$${amt}` : 'All even',
        detailLines: bbbPillPlayers.map((p) => `${p.name}: ${(payouts[p.id] ?? 0) >= 0 ? '+' : ''}$${payouts[p.id] ?? 0}`),
      })
    }
    return [...standard, ...extra]
  }, [
    bets, players, scores, pars, allocations, sideGameFlags, skinFlags, scoringType, teams,
    wolfBet, bbbBet, wolfPicks, bbbFlags, totalHoles, isScramble,
  ])

  // Progress dots: current hole is a wide accent pill; played holes bright.
  const dots = useMemo(() => {
    const probe = entities[0]?.id
    return Array.from({ length: totalHoles }, (_, i) => {
      const h = i + 1
      const cur = h === currentHole
      const played = probe != null && scoreValue(scores[probe]?.[h]) != null
      return {
        bg: cur ? ACCENT : played ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.28)',
        w: cur ? 22 : 7,
      }
    })
  }, [entities, scores, currentHole, totalHoles])

  // Full leaderboard model for the overlay (Net / Gross / Money + movement).
  // Only built while the overlay is open. Money sums every active bet's net per
  // player via the same engine the payout screen uses; movement compares each
  // player's current rank to their rank one hole earlier.
  const leaderModel = useMemo(() => {
    if (sheet !== 'leaderboard') return null
    const view = lbView
    const ents = isScramble ? teams : players
    if (ents.length === 0) return null
    const scopeLabel = view === 'money' ? 'MONEY' : view === 'gross' || useGrossScoring ? 'GROSS' : 'NET'
    const colLabel = view === 'money' ? 'MONEY' : view === 'gross' || useGrossScoring ? 'GROSS' : isStableford ? 'PTS' : 'NET'

    // Furthest hole anyone has a score on — the round's "through".
    let N = 0
    for (const e of ents) {
      const sc = scores[e.id] ?? {}
      for (const h in sc) if (scoreValue(sc[h]) != null && Number(h) > N) N = Number(h)
    }
    if (N === 0) return { empty: true, N: 0, scopeLabel, colLabel, rows: [], spot: null }

    const statsByEntity = (scoreSet) => {
      const m = {}
      if (isStableford) {
        buildStablefordLeaderboard(players, scoreSet, pars, allocations).forEach((e) => {
          m[e.player.id] = { gross: e.gross, net: e.points, toPar: null, thru: e.thru, points: e.points }
        })
      } else {
        buildLeaderboard(ents, scoreSet, allocations, pars, totalHoles).forEach((e) => {
          m[e.player.id] = { gross: e.gross, net: e.net, toPar: e.toPar, thru: e.thru }
        })
      }
      return m
    }

    const moneyByEntity = (scoreSet, sgf, wp, bbb, sf) => {
      const per = {}
      players.forEach((p) => { per[p.id] = 0 })
      buildBetResults({
        bets, players, scores: scoreSet, pars, strokeAllocations: allocations,
        sideGameFlags: sgf, skinFlags: sf, wolfPicks: wp, bbbFlags: bbb, scoringType, teams, pressBets,
      }).forEach((r) => { for (const pid in (r.payouts ?? {})) per[pid] = (per[pid] ?? 0) + (r.payouts[pid] ?? 0) })
      const m = {}
      ents.forEach((e) => {
        if (isScramble) {
          const t = teams.find((tt) => tt.id === e.id)
          m[e.id] = (t?.playerIds ?? []).reduce((s, pid) => s + (per[pid] ?? 0), 0)
        } else m[e.id] = per[e.id] ?? 0
      })
      return m
    }

    const sortIds = (stats, money) =>
      ents.map((e) => e.id).sort((a, b) => {
        const sa = stats[a] ?? { gross: 0, toPar: 0, points: 0 }
        const sb = stats[b] ?? { gross: 0, toPar: 0, points: 0 }
        if (view === 'gross') return (sa.gross - sb.gross) || ((sa.toPar ?? 0) - (sb.toPar ?? 0))
        if (view === 'money') return ((money[b] ?? 0) - (money[a] ?? 0)) || ((sa.toPar ?? 0) - (sb.toPar ?? 0))
        return (isStableford ? (sb.points ?? 0) - (sa.points ?? 0) : (sa.toPar ?? 0) - (sb.toPar ?? 0)) || (sa.gross - sb.gross)
      })
    const rankOf = (ids) => { const m = {}; ids.forEach((id, i) => { m[id] = i + 1 }); return m }

    const stats = statsByEntity(scores)
    const money = view === 'money' ? moneyByEntity(scores, sideGameFlags, wolfPicks, bbbFlags, skinFlags) : {}
    const order = sortIds(stats, money)
    const curRank = rankOf(order)

    let prevRank = null
    if (N > 1) {
      const ps = statsByEntity(limitScores(scores, N - 1))
      const pm = view === 'money'
        ? moneyByEntity(
            limitScores(scores, N - 1),
            { closestToPin: limitHoleKeys(sideGameFlags?.closestToPin, N - 1), longestDrive: limitHoleKeys(sideGameFlags?.longestDrive, N - 1) },
            limitHoleKeys(wolfPicks, N - 1),
            limitHoleKeys(bbbFlags, N - 1),
            limitHoleKeys(skinFlags, N - 1),
          )
        : {}
      prevRank = rankOf(sortIds(ps, pm))
    }

    const subFor = (e, s) => {
      const h = e.courseHandicap ?? e.handicapIndex
      const hp = h != null && !useGrossScoring ? ` · Hdcp ${h}` : ''
      const scoreStr = isStableford
        ? `${s.points} pts`
        : useGrossScoring
          ? `Gross ${vpl(s.toPar)}`
          : `Net ${vpl(s.toPar)}`
      if (view === 'gross') return `${scoreStr}${hp}`
      if (view === 'money') return `Gross ${s.gross} · ${scoreStr}`
      return `Gross ${s.gross}${hp}`
    }
    const bigOf = (id, s) => (view === 'gross' ? String(s.gross) : view === 'money' ? fmtMoney(money[id]) : isStableford ? String(s.points) : vpl(s.toPar))
    const bigColorOf = (id, s) => (view === 'gross' ? '#fff' : view === 'money' ? moneyColor(money[id]) : isStableford ? '#fff' : ncd(s.toPar))

    const rows = order.map((id, i) => {
      const e = ents.find((x) => x.id === id)
      const s = stats[id]
      if (!e || !s) return null
      let move = '–'
      let moveColor = 'rgba(255,255,255,.32)'
      if (prevRank) {
        const d = prevRank[id] - curRank[id]
        if (d > 0) { move = `▲${d}`; moveColor = ACCENT } else if (d < 0) { move = `▼${-d}`; moveColor = '#fb7185' }
      }
      return {
        id, name: e.name, color: e.color, isMe: id === meEntityId,
        pos: i + 1, posColor: i === 0 ? ACCENT : 'rgba(255,255,255,.7)',
        move, moveColor, thru: `thru ${s.thru}`, sub: subFor(e, s),
        big: bigOf(id, s), bigColor: bigColorOf(id, s),
      }
    }).filter(Boolean)

    const Lid = order[0]
    const L = ents.find((x) => x.id === Lid)
    const ls = stats[Lid]
    if (!L || !ls || rows.length === 0) return { empty: true, N, scopeLabel, colLabel, rows: [], spot: null }
    const secId = order[1]
    let leadBy = 'clear of the field'
    if (secId && stats[secId]) {
      const ss = stats[secId]
      if (view === 'gross') { const d = ss.gross - ls.gross; leadBy = d === 0 ? 'tied at the top' : `leads by ${d} gross` }
      else if (view === 'money') { const d = Math.round((money[Lid] ?? 0) - (money[secId] ?? 0)); leadBy = d === 0 ? 'tied at the top' : `$${d} clear` }
      else if (isStableford) { const d = ls.points - ss.points; leadBy = d === 0 ? 'tied at the top' : `leads by ${d} pts` }
      else { const d = ss.toPar - ls.toPar; leadBy = d === 0 ? 'tied at the top' : `leads by ${d}` }
    }

    return {
      N,
      scopeLabel,
      colLabel,
      rows,
      spot: {
        name: L.name, color: L.color, isMe: Lid === meEntityId,
        big: bigOf(Lid, ls), bigColor: bigColorOf(Lid, ls), sub: subFor(L, ls), leadBy,
        unit: view === 'gross' ? 'GROSS' : view === 'money' ? 'NET WON' : isStableford ? 'POINTS' : 'TO PAR',
      },
    }
  }, [sheet, lbView, isScramble, isStableford, useGrossScoring, teams, players, scores, pars, allocations, bets, pressBets, sideGameFlags, skinFlags, wolfPicks, bbbFlags, scoringType, totalHoles, meEntityId])

  // Completed rounds belong on Payouts, not an editable scorecard.
  if (round && roundStatus === 'complete') {
    return <Navigate to="/payouts" replace />
  }

  // No round set up yet — bounce back to setup.
  if (!round) {
    if (liveRoundId && liveLoading) {
      return (
        <div style={S.root}>
          <div style={S.scrim} />
          <div style={{ ...S.column, alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>
            Loading live round…
          </div>
        </div>
      )
    }
    return <Navigate to="/setup" replace />
  }

  const backdrop = getCourseImage(round)
  const courseLabel = round.course || round.tee?.name || ''
  const headerProps = {
    accent: ACCENT,
    backTo: '/',
    logo: 'wordmark',
    rightAction: 'pin',
    kicker: 'LIVE ROUND',
    title: 'Scoring',
    contextPill: courseLabel,
    pillAlign: 'right',
    titleCollapsed: headerCollapsed,
    currentPage: 'Play',
  }

  if (isScramble && teams.length === 0) {
    return (
      <div style={S.root}>
        <div style={{ ...S.backdrop, background: COURSE_FALLBACK_BG, backgroundImage: `url(${backdrop}), ${COURSE_FALLBACK_BG}` }} />
        <div style={S.scrim} />
        <div style={S.column}>
          <AppHeader {...headerProps} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
            <div style={S.panel}>
              <div style={{ fontSize: 21, fontWeight: 800, color: '#fff' }}>Teams not set up for this round.</div>
              <button onClick={() => navigate('/setup')} style={{ ...S.modalPrimary, marginTop: 18 }}>Back to Setup</button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (entities.length === 0) {
    return <Navigate to="/setup" replace />
  }

  const scoreFor = (id) => scoreValue(scores[id]?.[currentHole]) ?? par
  const parDefaultScoring = !readOnly
  const showScoreFor = (id) => {
    const stored = scoreValue(scores[id]?.[currentHole])
    if (readOnly) return stored
    return parDefaultScoring ? (stored ?? par) : stored
  }
  const recordScore = (id, hole, value) => {
    const next = clampScore(value)
    if (!id || next == null) return
    updateScore(id, clampHole(hole, totalHoles), next)
  }
  const commitParDefaults = (hole = currentHole) => {
    if (readOnly) return
    seedParForHole(hole, { entities, pars, totalHoles, updateScore })
  }
  const adjust = (id, delta) => recordScore(id, currentHole, scoreFor(id) + delta)
  const goPrev = () => {
    if (atFirstHole) return
    setCurrentHole(clampHole(currentHole - 1, totalHoles))
  }
  const goNext = () => {
    if (isLastHole) return
    commitParDefaults(currentHole)
    setCurrentHole(clampHole(currentHole + 1, totalHoles))
  }
  const finishRound = () => {
    if (readOnly) return
    commitParDefaults(currentHole)
    completeRound()
    navigate('/payouts')
  }

  const inviteUrl = inviteCode ? `${window.location.origin}/join/${inviteCode}` : null
  const copyInvite = async () => {
    if (!inviteUrl) return
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopiedInvite(true)
      setTimeout(() => setCopiedInvite(false), 2000)
    } catch {
      /* clipboard blocked */
    }
  }

  const boardTitle = isMatchplay
    ? 'Match'
    : isStableford
      ? 'Stableford'
      : isScramble
        ? 'Teams'
        : 'Leaderboard'

  const holeDetail = [
    `Par ${par}`,
    si != null ? `H ${si}` : null,
    round?.yardages?.[currentHole] ? `${round.yardages[currentHole]}y` : null,
  ].filter(Boolean).join(' · ')

  const useCompactRows = entities.length >= 3
  const useFoursomeDense = entities.length >= 4
  const hasFoursomeSidePanels =
    (isMatchplay && matchInfoList.length > 0 && !readOnly) ||
    (wolfActive && !readOnly) ||
    (bbbActive && !readOnly) ||
    (ctpBet && !readOnly) ||
    (ldBet && !readOnly) ||
    (skinsActive && !readOnly)

  // Collapse the header title row as the score list scrolls (hysteresis avoids flicker).
  const onListScroll = (e) => {
    const y = e.currentTarget.scrollTop
    setHeaderCollapsed((c) => (c ? y >= 8 : y > 26))
  }

  /* --------------------------------------------------------------- entity card */

  const entityMeta = (e) => {
    const gross = showScoreFor(e.id)
    const reduction = allocations[e.id]?.[currentHole] ?? 0
    const net = gross == null ? null : Math.max(0, gross - reduction)
    const pts = isStableford && gross != null ? calculateStablefordPoints(gross, par, reduction) : null
    const toPar = net == null ? null : net - par
    const isWolf = wolfActive && e.id === wolfId
    const subtitle = isScramble
      ? 'Best ball'
      : useGrossScoring
        ? 'Gross scoring'
        : `Hdcp ${e.courseHandicap ?? e.handicapIndex ?? 0}`
    return { gross, net, toPar, pts, isWolf, subtitle }
  }

  const compactRow = (e) => {
    const { gross, net, toPar, pts, isWolf, subtitle } = entityMeta(e)
    return (
      <PlayerScoreRow
        key={e.id}
        entity={e}
        gross={gross}
        net={net}
        toPar={toPar}
        points={pts}
        subtitle={subtitle}
        isMe={e.id === meEntityId}
        isWolf={isWolf}
        readOnly={readOnly}
        isStableford={isStableford}
        useGrossScoring={useGrossScoring}
        isScramble={isScramble}
        dense={useFoursomeDense}
        onMinus={() => adjust(e.id, -1)}
        onPlus={() => adjust(e.id, +1)}
        onScoreTap={() => setKeypadFor({ id: e.id, hole: currentHole })}
      />
    )
  }

  const card = (e) => {
    const { gross, net, toPar, pts, isWolf, subtitle } = entityMeta(e)
    const isMe = e.id === meEntityId

    return (
      <div key={e.id} style={S.cardWrap}>
        <span style={{ ...S.cardGlow, background: hexA(e.color, 0.5) }} />
        <div style={S.cardHead}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ ...S.avatar, background: e.color }}>{initial(e.name)}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={S.cardName}>{e.name}</span>
                {isMe && <span style={youBadge}>YOU</span>}
                {isWolf && <span style={{ ...S.wolfTag, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="wolf" size={12} color={ACCENT_DARK} /> Wolf</span>}
              </div>
              <div style={S.cardSub}>{subtitle}</div>
            </div>
          </div>

          {gross != null && !isScramble && (
            <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
              {isStableford ? (
                <span style={{ ...S.badge, color: ACCENT }}>{pts} pt</span>
              ) : (
                <>
                  <span style={S.badge}>{useGrossScoring ? 'Gross' : 'Net'} {net}</span>
                  <span style={{ ...S.badge, color: ncd(toPar) }}>{vpl(toPar)}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div style={S.cardScoreRow}>
          {readOnly ? (
            <span style={{ ...S.numBtn, cursor: 'default' }}>{gross == null ? '–' : gross}</span>
          ) : (
            <>
              <button onClick={() => adjust(e.id, -1)} aria-label={`${e.name} minus`} style={S.minusBtn}>−</button>
              <button onClick={() => setKeypadFor({ id: e.id, hole: currentHole })} aria-label={`${e.name} score`} style={S.numBtn}>
                {gross == null ? '–' : gross}
              </button>
              <button onClick={() => adjust(e.id, +1)} aria-label={`${e.name} plus`} style={S.plusBtn}>+</button>
            </>
          )}
        </div>
      </div>
    )
  }

  /* --------------------------------------------------------------- render */

  return (
    <div style={S.root}>
      <div style={{ ...S.backdrop, background: COURSE_FALLBACK_BG, backgroundImage: `url(${backdrop}), ${COURSE_FALLBACK_BG}` }} />
      <div style={S.scrim} />

      <div style={S.column}>
        <AppHeader {...headerProps} />

        {readOnly && (
          <div style={{ margin: '0 18px 4px', padding: '7px 12px', borderRadius: 9999, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.14)', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.78)', textAlign: 'center' }}>
            Watching — {scorerName || 'Scorer'} is scoring
          </div>
        )}

        {isLiveScorer && inviteUrl && (
          <div style={{ flex: '0 0 auto', margin: '0 18px 2px', display: 'flex', justifyContent: useCompactRows ? 'flex-end' : 'stretch' }}>
            <button
              type="button"
              onClick={copyInvite}
              style={{
                flex: useCompactRows ? '0 0 auto' : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                border: `1px solid ${hexA(ACCENT, 0.35)}`,
                borderRadius: 9999,
                padding: useCompactRows ? '6px 12px' : '6px 10px',
                background: copiedInvite ? ACCENT : 'rgba(20,28,24,.5)',
                color: copiedInvite ? ACCENT_DARK : ACCENT,
                fontSize: 11,
                fontWeight: 800,
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            >
              {copiedInvite ? 'Copied' : useCompactRows ? 'Invite' : `Invite · /join/${inviteCode}`}
            </button>
          </div>
        )}

        {/* header ------------------------------------------------------------ */}
        <div style={{ ...S.header, paddingBottom: useFoursomeDense ? 2 : useCompactRows ? 4 : 8 }}>
          {/* hole block */}
          <div style={{ display: 'flex', alignItems: 'center', gap: useFoursomeDense ? 8 : 10, marginTop: useFoursomeDense ? 2 : useCompactRows ? 4 : 8 }}>
            <button onClick={goPrev} disabled={atFirstHole} aria-label="Previous hole" style={{ ...(useFoursomeDense ? S.navCircleDense : S.navCircle), opacity: atFirstHole ? 0.4 : 1, cursor: atFirstHole ? 'not-allowed' : 'pointer' }}>‹</button>
            <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
              {useFoursomeDense ? (
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, letterSpacing: 2.5, color: 'rgba(255,255,255,.7)', fontWeight: 800 }}>HOLE</span>
                  <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: '#fff' }}>{currentHole}</span>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 11, letterSpacing: 3, color: 'rgba(255,255,255,.7)', fontWeight: 800 }}>HOLE</div>
                  <div style={useCompactRows ? S.holeNumCompact : S.holeNum}>{currentHole}</div>
                </>
              )}
              <div style={{ maxWidth: '100%', overflow: 'hidden' }}>
                <div style={{ ...S.detailLine, marginTop: useFoursomeDense ? 3 : useCompactRows ? 4 : 8, padding: useFoursomeDense ? '4px 10px' : useCompactRows ? '5px 12px' : '6px 14px', fontSize: useFoursomeDense ? 11 : useCompactRows ? 12 : 13 }}>{holeDetail}</div>
              </div>
            </div>
            <button onClick={goNext} disabled={isLastHole} aria-label="Next hole" style={{ ...(useFoursomeDense ? S.navCircleDense : S.navCircle), opacity: isLastHole ? 0.4 : 1, cursor: isLastHole ? 'not-allowed' : 'pointer' }}>›</button>
          </div>

          {/* dots */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', marginTop: useFoursomeDense ? 4 : useCompactRows ? 6 : 10 }}>
            {dots.map((d, i) => (
              <span key={i} style={{ height: 7, borderRadius: 9999, flex: '0 0 auto', background: d.bg, width: d.w }} />
            ))}
          </div>
        </div>

        {/* body: scrollable scores + pinned footer chrome -------------------- */}
        <div style={S.body}>
        {useFoursomeDense ? (
          <>
            <div style={{ flex: '0 0 auto', padding: '4px 14px 0', boxSizing: 'border-box' }}>
              {entities.map(compactRow)}
            </div>
            {hasFoursomeSidePanels && (
              <div className="golo-scroll" onScroll={onListScroll} style={S.scroll}>
                {isMatchplay && matchInfoList.length > 0 && !readOnly && matchInfoList.map((info) => (
                  <MatchPanel
                    key={`${info.side1.id}-${info.side2.id}`}
                    info={info}
                    pairLabel={players.length > 2 ? `${info.side1.name} vs ${info.side2.name}` : null}
                    hole={currentHole}
                    concededTo={canConcedeMatch ? concededHoles[currentHole] ?? null : null}
                    onConcede={
                      canConcedeMatch
                        ? (pid) => concedeHole(currentHole, pid)
                        : undefined
                    }
                  />
                ))}
                {wolfActive && !readOnly && (
                  <WolfPanel
                    players={wolfPlayers}
                    wolfId={wolfId}
                    pick={wolfPicks[currentHole]}
                    onPick={(d) => setWolfPick(currentHole, d)}
                    onClear={() => clearWolfPick(currentHole)}
                  />
                )}
                {bbbActive && !readOnly && (
                  <BBBPanel
                    players={bbbPlayers}
                    flags={bbbFlags[currentHole]}
                    onFlag={(type, pid) => flagBBB(currentHole, type, pid)}
                  />
                )}
                {ctpBet && !readOnly && (
                  <PickerPanel
                    title={`📍 Closest to pin · Hole ${currentHole}`}
                    players={ctpPlayers}
                    selectedId={sideGameFlags.closestToPin[currentHole]}
                    onSelect={(pid) => flagCTP(currentHole, pid)}
                  />
                )}
                {ldBet && !readOnly && (
                  <PickerPanel
                    title={`🚀 Longest drive · Hole ${currentHole}`}
                    players={ldPlayers}
                    selectedId={sideGameFlags.longestDrive[currentHole]}
                    onSelect={(pid) => flagLD(currentHole, pid)}
                  />
                )}
                {skinsActive && !readOnly && (
                  <SkinsPanel
                    types={manualSkinTypes}
                    players={skinPlayers}
                    flags={skinFlags[currentHole]}
                    value={baseSkinValue}
                    onToggle={(type, pid) => toggleSkinFlag(currentHole, type, pid)}
                  />
                )}
              </div>
            )}
          </>
        ) : (
        <div className="golo-scroll" onScroll={onListScroll} style={S.scroll}>
          {isMatchplay && matchInfoList.length > 0 && !readOnly && matchInfoList.map((info) => (
            <MatchPanel
              key={`${info.side1.id}-${info.side2.id}`}
              info={info}
              pairLabel={players.length > 2 ? `${info.side1.name} vs ${info.side2.name}` : null}
              hole={currentHole}
              concededTo={canConcedeMatch ? concededHoles[currentHole] ?? null : null}
              onConcede={
                canConcedeMatch
                  ? (pid) => concedeHole(currentHole, pid)
                  : undefined
              }
            />
          ))}

          {entities.map(useCompactRows ? compactRow : card)}

          {wolfActive && !readOnly && (
            <WolfPanel
              players={wolfPlayers}
              wolfId={wolfId}
              pick={wolfPicks[currentHole]}
              onPick={(d) => setWolfPick(currentHole, d)}
              onClear={() => clearWolfPick(currentHole)}
            />
          )}

          {bbbActive && !readOnly && (
            <BBBPanel
              players={bbbPlayers}
              flags={bbbFlags[currentHole]}
              onFlag={(type, pid) => flagBBB(currentHole, type, pid)}
            />
          )}

          {ctpBet && !readOnly && (
            <PickerPanel
              title={`📍 Closest to pin · Hole ${currentHole}`}
              players={ctpPlayers}
              selectedId={sideGameFlags.closestToPin[currentHole]}
              onSelect={(pid) => flagCTP(currentHole, pid)}
            />
          )}
          {ldBet && !readOnly && (
            <PickerPanel
              title={`🚀 Longest drive · Hole ${currentHole}`}
              players={ldPlayers}
              selectedId={sideGameFlags.longestDrive[currentHole]}
              onSelect={(pid) => flagLD(currentHole, pid)}
            />
          )}
          {skinsActive && !readOnly && (
            <SkinsPanel
              types={manualSkinTypes}
              players={skinPlayers}
              flags={skinFlags[currentHole]}
              value={baseSkinValue}
              onToggle={(type, pid) => toggleSkinFlag(currentHole, type, pid)}
            />
          )}
        </div>
        )}

        {/* active bets ------------------------------------------------------- */}
        {(pills.length > 0 || (overallPurseBet && !readOnly)) && (
          <div style={{ flex: '0 0 auto', padding: useFoursomeDense ? '4px 14px 0' : '8px 14px 0', boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: useFoursomeDense ? '0 2px 4px' : '0 2px 8px' }}>
              <div style={S.activeLabel}>ACTIVE BETS</div>
              {overallPurseBet && activePressCount > 0 && (
                <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.45)' }}>
                  {activePressCount}/{MAX_ACTIVE_PRESSES} presses
                </span>
              )}
            </div>
            <div className="no-scrollbar" style={S.betRow}>
              {pills.map((b) => (
                <button key={b.id} type="button" onClick={() => setSheet('bets')} style={S.betChip}>
                  <span style={S.betChipTitle}>
                    <BetGlyph bet={b} size={16} />
                    <span style={S.betChipTitleText}>{b.title}</span>
                  </span>
                  <span style={S.betChipStatus}>{b.status}</span>
                </button>
              ))}
              {overallPurseBet && !readOnly && pressEligibility.allowed && (
                <button
                  type="button"
                  onClick={() => setSheet('press')}
                  style={{
                    ...S.betChip,
                    border: `1px solid ${hexA(ACCENT, 0.55)}`,
                    background: hexA(ACCENT, 0.1),
                  }}
                >
                  <span style={{ ...S.betChipTitle, color: ACCENT }}>
                    <Icon name="wager" size={16} color={ACCENT} />
                    <span style={S.betChipTitleText}>Press</span>
                  </span>
                  <span style={{ ...S.betChipStatus, color: ACCENT }}>{pressChipLabel.replace(/^Press · /, '')}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* bottom nav -------------------------------------------------------- */}
        <div style={{ flex: '0 0 auto', padding: useFoursomeDense ? '6px 14px max(10px, env(safe-area-inset-bottom))' : '8px 14px max(14px, env(safe-area-inset-bottom))' }}>
          <div style={S.navBar}>
            <button
              type="button"
              onClick={goPrev}
              disabled={atFirstHole}
              aria-label="Previous hole"
              style={{ ...S.navSide, opacity: atFirstHole ? 0.35 : 1, cursor: atFirstHole ? 'not-allowed' : 'pointer' }}
            >
              <span aria-hidden="true" style={S.navArrow}>◀</span>
              <span>Prev</span>
            </button>
            <button type="button" onClick={() => setSheet('leaderboard')} style={S.navPrimary}>
              {boardTitle}
            </button>
            {isLastHole ? (
              <button
                type="button"
                onClick={() => setSheet('finish')}
                disabled={readOnly}
                aria-label="Finish round"
                style={{ ...S.navSide, color: ACCENT, fontWeight: 800, opacity: readOnly ? 0.35 : 1, cursor: readOnly ? 'not-allowed' : 'pointer' }}
              >
                Finish
              </button>
            ) : (
              <button
                type="button"
                onClick={goNext}
                aria-label="Next hole"
                style={S.navSide}
              >
                <span>Next</span>
                <span aria-hidden="true" style={S.navArrow}>▶</span>
              </button>
            )}
          </div>
        </div>
        </div>

        {/* ===== sheets (framed inside the phone column) ===== */}
      {sheet === 'leaderboard' && leaderModel && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 35, display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 70% at 50% 0%, #2a7d4a 0%, #14532d 45%, #0a2418 85%)' }}>
          <div style={{ ...S.backdrop, background: COURSE_FALLBACK_BG, backgroundImage: `url(${backdrop}), ${COURSE_FALLBACK_BG}` }} />
          <div style={S.scrim} />
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>

            {/* utility row + progress */}
            <div style={{ flex: '0 0 auto', padding: 'max(10px, env(safe-area-inset-top)) 16px 6px', textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <button onClick={() => setSheet(null)} aria-label="Back to scoring" style={S.iconBtn}>‹</button>
                <div style={S.coursePill}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', background: ACCENT }} />
                  <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1, color: '#fff' }}>LIVE</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{round.course}</span>
                </div>
                {!readOnly && (
                  <button onClick={() => setSheet('finish')} aria-label="Payouts" style={S.iconBtn}>↗</button>
                )}
                {readOnly && <span style={{ width: 40 }} />}
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2.6, color: 'rgba(255,255,255,.7)', fontWeight: 800 }}>THROUGH</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 52, fontWeight: 800, lineHeight: 0.96, color: '#fff' }}>{leaderModel.N}</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,.55)' }}>/ {totalHoles}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flex: '0 0 auto', paddingBottom: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>{Math.max(0, totalHoles - leaderModel.N)} to play</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>{leaderModel.N < totalHoles ? `on hole ${leaderModel.N + 1}` : 'finishing up'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 10 }}>
                {dots.map((d, i) => (<span key={i} style={{ height: 6, borderRadius: 9999, flex: 1, background: d.bg }} />))}
              </div>
            </div>

            {/* Net / Gross / Money / Card */}
            <div style={{ flex: '0 0 auto', padding: '4px 16px 8px' }}>
              <div style={{ display: 'flex', gap: 4, background: 'rgba(16,22,18,.55)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 4 }}>
                {[['net', 'Net'], ['gross', 'Gross'], ['money', 'Money'], ['card', 'Card']].map(([id, label]) => {
                  const on = lbView === id
                  // Opening the card lands on the nine you're playing.
                  const pick = () => {
                    setLbView(id)
                    if (id === 'card') setCardNine(currentHole > 9 ? 'back' : 'front')
                  }
                  return <button key={id} onClick={pick} style={{ flex: 1, minHeight: 42, borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 800, background: on ? ACCENT : 'transparent', color: on ? ACCENT_DARK : 'rgba(255,255,255,.62)', boxShadow: on ? `0 4px 12px ${hexA(ACCENT, 0.4)}` : 'none' }}>{label}</button>
                })}
              </div>

              {/* Front / Back — only a full round has a back nine to page to. */}
              {lbView === 'card' && totalHoles > 9 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  {[['front', 'Front 9'], ['back', 'Back 9']].map(([id, label]) => {
                    const on = cardNine === id
                    return (
                      <button
                        key={id}
                        onClick={() => setCardNine(id)}
                        style={{ flex: 1, minHeight: 34, borderRadius: 9999, cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: 0.6, background: on ? hexA(ACCENT, 0.16) : 'rgba(255,255,255,.06)', border: `1px solid ${on ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.14)'}`, color: on ? ACCENT : 'rgba(255,255,255,.6)' }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* scrollable body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '2px 16px 14px' }}>

              {lbView === 'card' ? (
                /* Scorecard renders even before a score lands — an empty card is
                 * still the fastest way to enter one on a hole you've passed. */
                <ScorecardGrid
                  entities={entities}
                  scores={scores}
                  pars={pars}
                  strokeIndex={round?.strokeIndex ?? {}}
                  allocations={allocations}
                  totalHoles={totalHoles}
                  nine={cardNine}
                  meEntityId={meEntityId}
                  readOnly={readOnly}
                  onCellTap={(id, hole) => setKeypadFor({ id, hole })}
                />
              ) : leaderModel.empty ? (
                <div style={{ ...S.panel, textAlign: 'center', padding: 22, marginTop: 10, marginBottom: 16 }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>No scores entered yet.</div>
                </div>
              ) : (
                <>
              {/* leader spotlight */}
              <div style={{ position: 'relative', overflow: 'hidden', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${hexA(ACCENT, 0.5)}`, borderRadius: 24, padding: 18, marginBottom: 16, boxShadow: '0 14px 34px rgba(0,0,0,.34)' }}>
                <span style={{ position: 'absolute', right: -30, top: -34, width: 150, height: 150, borderRadius: '50%', background: hexA(ACCENT, 0.45), filter: 'blur(34px)', pointerEvents: 'none' }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: ACCENT }}><Icon name="leader" size={13} color={ACCENT} /> LEADING · {leaderModel.scopeLabel}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.5)' }}>{leaderModel.spot.leadBy}</span>
                </div>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, marginTop: 13 }}>
                  <span style={{ ...S.avatar, width: 60, height: 60, fontSize: 24, background: leaderModel.spot.color, boxShadow: `0 0 0 3px ${hexA(ACCENT, 0.9)}, 0 8px 20px rgba(0,0,0,.35)` }}>{initial(leaderModel.spot.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{leaderModel.spot.name}</span>
                      {leaderModel.spot.isMe && <span style={youBadge}>YOU</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.58)', marginTop: 2 }}>{leaderModel.spot.sub}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 0.95, letterSpacing: -1, color: leaderModel.spot.bigColor }}>{leaderModel.spot.big}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>{leaderModel.spot.unit}</div>
                  </div>
                </div>
              </div>

              {/* column header */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px 8px', fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: 'rgba(255,255,255,.45)' }}>
                <span style={{ width: 26 }}>#</span>
                <span style={{ flex: 1 }}>PLAYER</span>
                <span style={{ width: 46, textAlign: 'center' }}>THRU</span>
                <span style={{ width: 62, textAlign: 'right' }}>{leaderModel.colLabel}</span>
              </div>

              {/* rows */}
              {leaderModel.rows.map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${r.isMe ? hexA(ACCENT, 0.5) : 'rgba(255,255,255,.12)'}`, borderRadius: 16, padding: '11px 13px', marginBottom: 9, boxShadow: '0 6px 18px rgba(0,0,0,.22)' }}>
                  <div style={{ width: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: r.posColor, lineHeight: 1 }}>{r.pos}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, lineHeight: 1, marginTop: 2, color: r.moveColor }}>{r.move}</span>
                  </div>
                  <span style={{ ...S.avatar, width: 40, height: 40, fontSize: 16, background: r.color, boxShadow: `0 0 0 2px ${r.pos === 1 ? hexA(ACCENT, 1) : 'rgba(255,255,255,.2)'}` }}>{initial(r.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                      {r.isMe && <span style={youBadge}>YOU</span>}
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub}</div>
                  </div>
                  <span style={{ width: 46, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.55)', flex: '0 0 auto' }}>{r.thru}</span>
                  <span style={{ width: 62, textAlign: 'right', fontSize: 24, fontWeight: 800, letterSpacing: -0.5, color: r.bigColor, flex: '0 0 auto' }}>{r.big}</span>
                </div>
              ))}
                </>
              )}

              {/* money on the line — the card wants the full height for holes */}
              {lbView !== 'card' && pills.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '18px 4px 9px' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)' }}>MONEY ON THE LINE</span>
                  </div>
                  {pills.map((b) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: '11px 13px', marginBottom: 9 }}>
                      <span style={{ width: 38, height: 38, borderRadius: 12, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.1)' }}><BetGlyph bet={b} size={20} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{b.title}</div>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT, textAlign: 'right', flex: '0 0 auto' }}>{b.status}</span>
                    </div>
                  ))}
                </>
              )}

            </div>

            {/* bottom action bar */}
            <div style={{ flex: '0 0 auto', padding: '8px 14px max(14px, env(safe-area-inset-bottom))' }}>
              <div style={S.navBar}>
                <button onClick={() => setSheet(null)} style={S.navPrimary}>Back to scoring</button>
                <button onClick={() => setSheet('finish')} style={{ ...S.navText, fontWeight: 800 }}>Payouts</button>
              </div>
            </div>

          </div>
        </div>
      )}

      {sheet === 'bets' && (
        <Sheet onClose={() => setSheet(null)} title="Active Bets">
          {pills.length === 0 && activePresses.length === 0 && (
            <div style={{ padding: '14px 18px', color: 'rgba(255,255,255,.5)', fontSize: 14 }}>No games on — just keeping score.</div>
          )}
          {pills.map((b) => (
            <div key={b.id} style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                  <BetGlyph bet={b} size={18} />
                  {b.title}
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT, textAlign: 'right' }}>{b.status}</span>
              </div>
              {b.detailLines?.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {b.detailLines.map((line, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)' }}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {activePresses.length > 0 && (
            <>
              <div style={{ padding: '12px 18px 6px', fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.45)', borderTop: pills.length ? '1px solid rgba(255,255,255,.07)' : 'none' }}>
                ACTIVE PRESSES
              </div>
              {activePresses.map((press) => {
                const downName = press.targetTeamId
                  ? teams.find((t) => t.id === press.targetTeamId)?.name
                  : players.find((p) => p.id === press.targetPlayerId)?.name
                const upName = press.opponentTeamId
                  ? teams.find((t) => t.id === press.opponentTeamId)?.name
                  : players.find((p) => p.id === press.opponentPlayerId)?.name
                const origLine =
                  press.originalBetAction === 'close'
                    ? `Original closed thru hole ${press.startHole - 1}`
                    : 'Original continued'
                return (
                  <div key={press.id} style={{ padding: '12px 18px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
                      Press x{press.multiplier} · ${press.pressStake} · from hole {press.startHole}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 4 }}>
                      {downName} vs {upName}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>{origLine}</div>
                  </div>
                )
              })}
            </>
          )}
          {overallPurseBet && !readOnly && pressEligibility.allowed && (
            <div style={{ padding: '14px 18px', borderTop: '1px solid rgba(255,255,255,.07)' }}>
              <button
                type="button"
                onClick={() => setSheet('press')}
                style={{
                  width: '100%',
                  minHeight: 48,
                  borderRadius: 14,
                  border: `1px solid ${hexA(ACCENT, 0.45)}`,
                  background: hexA(ACCENT, 0.1),
                  color: ACCENT,
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {pressChipLabel}
              </button>
            </div>
          )}
        </Sheet>
      )}

      {sheet === 'press' && overallPurseBet && pressEligibility.allowed && (
        <PressSheet
          onClose={(created) => {
            setSheet(null)
            if (created?.startHole) {
              useNotificationStore.getState().pushToast({
                kicker: 'PRESS',
                title: 'Press set',
                body: `Starts hole ${created.startHole}`,
                duration: 5000,
              })
            }
          }}
          targets={pressEligibility.targets}
          originalStake={overallPurseBet.config?.stake ?? overallPurseBet.amount ?? 0}
          currentHole={currentHole}
          players={players}
          teams={teams}
          onConfirm={(input) =>
            createPressBet({
              ...input,
              createdByPlayerId: meId,
              createdByTeamId: isScramble ? meEntityId : null,
            })
          }
        />
      )}

      {keypadFor && (
        <Keypad
          entity={entities.find((e) => e.id === keypadFor.id)}
          holeLabel={`Hole ${keypadFor.hole} · Par ${pars[keypadFor.hole] ?? 4}`}
          onPick={(n) => {
            recordScore(keypadFor.id, keypadFor.hole, n)
            setKeypadFor(null)
          }}
          onClose={() => setKeypadFor(null)}
        />
      )}

      {sheet === 'finish' && (
        <div style={S.modalWrap}>
          <div onClick={() => setSheet(null)} style={S.modalScrim} />
          <div style={S.modalCard}>
            <div style={{ fontSize: 21, fontWeight: 800, color: '#fff' }}>Finish round?</div>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', marginTop: 6, lineHeight: 1.5 }}>
              You're on hole {currentHole} of {totalHoles}. Finishing locks scores and opens the payout summary.
            </div>
            <div style={S.leaderRow}>
              <Icon name="leader" size={20} color={ACCENT} />
              <span style={{ fontSize: 15, fontWeight: 800, color: ACCENT }}>Leader: {leaderName}</span>
            </div>
            <button onClick={finishRound} style={S.modalPrimary}>View Payouts →</button>
            <button onClick={() => setSheet(null)} style={S.modalGhost}>Keep Scoring</button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- sub-components */

/** Bottom sheet shell: scrim + rounded panel + grab handle + Done. */
function Sheet({ title, onClose, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)' }} />
      <div style={S.sheet}>
        <div style={S.grab} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px 10px' }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: '#fff' }}>{title}</span>
          <button onClick={onClose} style={{ fontSize: 14, fontWeight: 800, color: ACCENT, background: 'none', border: 'none', minHeight: 44, cursor: 'pointer' }}>Done</button>
        </div>
        <div style={{ overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}

/** Score keypad bottom sheet (1–9, matching the design). */
function Keypad({ entity, holeLabel, onPick, onClose }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' }} />
      <div style={{ ...S.sheet, maxHeight: 'none', padding: '8px 16px max(20px, env(safe-area-inset-bottom))' }}>
        <div style={S.grab} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 800, color: '#fff' }}>
            <span style={{ ...S.avatar, width: 26, height: 26, fontSize: 12, boxShadow: 'none', background: entity?.color ?? '#2dd4bf' }}>{initial(entity?.name)}</span>
            {entity?.name}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>{holeLabel}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} onClick={() => onPick(n)} style={S.key}>{n}</button>
          ))}
        </div>
        <button onClick={onClose} style={S.keyCancel}>Cancel</button>
      </div>
    </div>
  )
}

/** Match Play status + per-hole concession (2-player matches only). */
function MatchPanel({ info, pairLabel, hole, concededTo, onConcede }) {
  const { side1, side2, status } = info
  const leaderName = status.leader === 'p1' ? side1.name : status.leader === 'p2' ? side2.name : null
  const complete = status.status === 'complete'
  const headline = complete
    ? status.result === 'All Square'
      ? 'All Square'
      : `${leaderName} won ${status.result}`
    : leaderName
      ? `${leaderName} ${status.result} · thru ${status.holesPlayed}`
      : `All Square · thru ${status.holesPlayed}`
  return (
    <div style={{ ...S.panel, marginBottom: 13 }}>
      {pairLabel && (
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)', marginBottom: 6 }}>
          {pairLabel.toUpperCase()}
        </div>
      )}
      <div style={{ fontSize: pairLabel ? 17 : 19, fontWeight: 800, color: '#fff' }}>{headline}</div>
      {!complete && onConcede && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.5)' }}>Concede hole {hole}:</span>
          {[side1, side2].map((s) => {
            const on = concededTo === s.id
            return (
              <button key={s.id} onClick={() => onConcede(on ? null : s.id)} aria-pressed={!!on} style={chip(on)}>
                {on ? `✓ ${s.name}` : `Give to ${s.name}`}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Per-hole Wolf decision. */
function WolfPanel({ players, wolfId, pick, onPick, onClear }) {
  const wolf = players.find((p) => p.id === wolfId)
  const others = players.filter((p) => p.id !== wolfId)
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '—'
  const decided = pick != null
  let text = ''
  if (decided) {
    if (pick.blind) text = 'Blind Lone Wolf (2×)'
    else if (pick.partnerId == null) text = 'Lone Wolf'
    else text = `Partnered with ${nameOf(pick.partnerId)}`
  }
  return (
    <div style={{ ...S.panel, marginBottom: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 10 }}><Icon name="wolf" size={18} color={ACCENT} /> {wolf?.name ?? '—'} is Wolf</div>
      {decided ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: ACCENT }}>{text}</span>
          <button onClick={onClear} style={{ ...chip(false), minHeight: 40 }}>Undo</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {others.map((p) => (
            <button key={p.id} onClick={() => onPick({ partnerId: p.id })} style={{ ...chip(false), display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.color }} />
              Partner {p.name.slice(0, 8)}
            </button>
          ))}
          <button onClick={() => onPick({ partnerId: null, lone: true })} style={chip(true)}>Lone Wolf (3×)</button>
          <button onClick={() => onPick({ partnerId: null, lone: true, blind: true })} style={chip(true)}>Blind (6×)</button>
        </div>
      )}
    </div>
  )
}

/** Per-hole Bingo Bango Bongo flag pickers. */
function BBBPanel({ players, flags, onFlag }) {
  const current = flags ?? {}
  const points = [
    { type: 'bingo', icon: '🟢', label: 'Bingo', hint: 'First on the green' },
    { type: 'bango', icon: '📍', label: 'Bango', hint: 'Closest once all on' },
    { type: 'bongo', icon: '🏁', label: 'Bongo', hint: 'First to hole out' },
  ]
  return (
    <div style={{ ...S.panel, marginBottom: 13 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Bingo Bango Bongo</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {points.map(({ type, icon, label, hint }) => (
          <div key={type}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>{icon} {label} — {hint}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {players.map((p) => {
                const on = current[type] === p.id
                return (
                  <button key={p.id} onClick={() => onFlag(type, on ? null : p.id)} aria-pressed={!!on} style={{ ...chip(on), display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.color }} />
                    {p.name.slice(0, 8)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Manual skins (greenie / sandie): multi-select, stacking toggles per hole.
 * Each toggled player adds head-to-head exposure: value × (players − 1). */
function SkinsPanel({ types, players, flags, value, onToggle }) {
  const current = flags ?? {}
  const hits = types.reduce((sum, t) => sum + (current[t.type]?.length ?? 0), 0)
  const opponents = Math.max(0, players.length - 1)
  const holeTotal = hits * value * opponents
  return (
    <div style={{ ...S.panel, marginBottom: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>🎯 Skins</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: hits > 0 ? ACCENT : 'rgba(255,255,255,.55)' }}>
          Hole skins: ${holeTotal}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {types.map(({ type, label, hint }) => {
          const on = current[type] ?? []
          return (
            <div key={type}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)', marginBottom: 6 }}>{label} — {hint} · ${value} each vs {opponents} opponent{opponents !== 1 ? 's' : ''}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {players.map((p) => {
                  const sel = on.includes(p.id)
                  return (
                    <button key={p.id} onClick={() => onToggle(type, p.id)} aria-pressed={!!sel} style={{ ...chip(sel), display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.color }} />
                      {p.name.slice(0, 8)}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Single-winner picker for CTP / Longest Drive. */
function PickerPanel({ title, players, selectedId, onSelect }) {
  return (
    <div style={{ ...S.panel, marginBottom: 13 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {players.map((p) => {
          const on = selectedId === p.id
          return (
            <button key={p.id} onClick={() => onSelect(on ? null : p.id)} aria-pressed={!!on} style={{ ...chip(on), display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: p.color }} />
              {p.name.slice(0, 10)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- shared styles */

/** Pill button style — accent when selected/primary. */
const chip = (on) => ({
  minHeight: 44,
  padding: '0 14px',
  borderRadius: 9999,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  background: on ? ACCENT : 'rgba(255,255,255,.06)',
  border: `1px solid ${on ? ACCENT : 'rgba(255,255,255,.18)'}`,
  color: on ? ACCENT_DARK : 'rgba(255,255,255,.85)',
})

const S = {
  root: {
    position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    height: '100dvh', maxHeight: '100dvh',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: '#fff',
    background: COURSE_FALLBACK_BG,
  },
  backdrop: { position: 'absolute', inset: 0, background: COURSE_FALLBACK_BG, backgroundSize: 'cover', backgroundPosition: 'center' },
  scrim: {
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'linear-gradient(180deg, rgba(6,14,9,.58) 0%, rgba(6,14,9,.28) 24%, rgba(6,16,10,.34) 58%, rgba(4,12,8,.8) 100%)',
  },
  column: { position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, width: '100%', maxWidth: 480, margin: '0 auto', minHeight: 0, maxHeight: '100%', overflow: 'hidden' },
  header: { flex: '0 0 auto', padding: '2px 16px 8px', textShadow: '0 2px 12px rgba(0,0,0,.4)' },
  body: { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  holeNum: { fontSize: 'clamp(52px, 14vw, 74px)', fontWeight: 800, lineHeight: 0.96, color: '#fff' },
  holeNumCompact: { fontSize: 'clamp(40px, 10vw, 56px)', fontWeight: 800, lineHeight: 0.96, color: '#fff' },
  headerTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  iconBtn: { width: 46, height: 46, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 19, cursor: 'pointer' },
  coursePill: { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.16)', padding: '9px 16px', borderRadius: 9999, maxWidth: 220, minWidth: 0 },
  navCircle: { width: 54, height: 54, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 24, fontWeight: 800, cursor: 'pointer' },
  navCircleDense: { width: 46, height: 46, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,.14)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 22, fontWeight: 800, cursor: 'pointer' },
  detailLine: { display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, maxWidth: '100%', background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.16)', padding: '6px 14px', borderRadius: 9999, fontSize: 13, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  scroll: { flex: '1 1 0', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 14px 8px', boxSizing: 'border-box', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' },

  cardWrap: { position: 'relative', overflow: 'hidden', background: 'rgba(20,28,24,.46)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 20, boxShadow: '0 10px 30px rgba(0,0,0,.32), inset 0 1px 0 rgba(255,255,255,.12)', padding: '11px 14px 12px', marginBottom: 10 },
  cardGlow: { position: 'absolute', left: -30, top: -10, width: 90, height: 90, borderRadius: '50%', filter: 'blur(26px)', pointerEvents: 'none' },
  cardHead: { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 },
  avatar: { width: 40, height: 40, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#fff', boxShadow: '0 0 0 2px rgba(255,255,255,.25)' },
  cardName: { fontSize: 18, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cardSub: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)' },
  wolfTag: { fontSize: 11, fontWeight: 800, color: ACCENT_DARK, background: ACCENT, padding: '2px 7px', borderRadius: 9999, flex: '0 0 auto' },
  badge: { fontSize: 12, fontWeight: 800, color: 'rgba(255,255,255,.92)', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.12)', padding: '4px 9px', borderRadius: 9999 },
  cardScoreRow: { position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 },
  minusBtn: { width: 48, height: 48, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', fontSize: 28, fontWeight: 700, cursor: 'pointer' },
  numBtn: { minWidth: 56, height: 54, border: 'none', background: 'transparent', fontSize: 44, fontWeight: 800, color: '#fff', cursor: 'pointer', lineHeight: 1, textShadow: '0 2px 16px rgba(0,0,0,.4)' },
  plusBtn: { width: 48, height: 48, borderRadius: '50%', flex: '0 0 auto', background: ACCENT, border: 'none', color: ACCENT_DARK, fontSize: 28, fontWeight: 800, cursor: 'pointer', boxShadow: `0 6px 18px ${hexA(ACCENT, 0.45)}` },

  panel: { background: 'rgba(20,28,24,.46)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 20, padding: 15, boxShadow: '0 10px 30px rgba(0,0,0,.3)' },

  activeLabel: { fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.55)', padding: '0 2px 8px' },
  betRow: { display: 'flex', gap: 9, overflowX: 'auto', paddingBottom: 2, width: '100%', boxSizing: 'border-box' },
  betChip: { display: 'flex', flexDirection: 'column', gap: 3, textAlign: 'left', flex: '0 0 auto', minWidth: 154, maxWidth: 220, boxSizing: 'border-box', background: 'rgba(255,255,255,.12)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,.16)', borderRadius: 16, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit' },
  betChipTitle: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#fff', minWidth: 0 },
  betChipTitleText: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  betChipStatus: { fontSize: 12, color: 'rgba(255,255,255,.62)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  navBar: { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16,22,18,.55)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 22, padding: 8, boxShadow: '0 10px 30px rgba(0,0,0,.35)', boxSizing: 'border-box' },
  navSide: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 52, padding: '0 12px', borderRadius: 15, background: 'transparent', border: 'none', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: 'inherit', flex: '0 0 auto' },
  navText: { minHeight: 52, padding: '0 16px', borderRadius: 15, background: 'transparent', border: 'none', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.85)', cursor: 'pointer', fontFamily: 'inherit' },
  navArrow: { fontSize: 11, lineHeight: 1 },
  navPrimary: { flex: 1, minHeight: 52, borderRadius: 15, background: ACCENT, color: ACCENT_DARK, fontSize: 15, fontWeight: 800, border: 'none', cursor: 'pointer', fontFamily: 'inherit', boxShadow: `0 6px 18px ${hexA(ACCENT, 0.45)}` },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(14,20,16,.92)', backdropFilter: 'blur(26px)', WebkitBackdropFilter: 'blur(26px)', borderTop: '1px solid rgba(255,255,255,.14)', borderRadius: '26px 26px 0 0', padding: '8px 0 18px', maxHeight: '78%', display: 'flex', flexDirection: 'column' },
  grab: { width: 42, height: 5, borderRadius: 9999, background: 'rgba(255,255,255,.22)', margin: '6px auto 12px' },

  key: { height: 62, borderRadius: 16, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.12)', fontSize: 26, fontWeight: 800, color: '#fff', cursor: 'pointer' },
  keyCancel: { marginTop: 12, width: '100%', minHeight: 50, borderRadius: 14, background: 'transparent', border: '1px solid rgba(255,255,255,.16)', fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,.8)', cursor: 'pointer' },

  modalWrap: { position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalScrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,.55)' },
  modalCard: { position: 'relative', background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(26px)', WebkitBackdropFilter: 'blur(26px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 24, padding: 24, width: '100%', maxWidth: 360, boxShadow: '0 30px 60px rgba(0,0,0,.5)' },
  leaderRow: { marginTop: 15, display: 'flex', alignItems: 'center', gap: 10, background: hexA(ACCENT, 0.12), border: `1px solid ${hexA(ACCENT, 0.3)}`, borderRadius: 15, padding: 14 },
  modalPrimary: { marginTop: 16, width: '100%', minHeight: 52, borderRadius: 15, background: ACCENT, color: ACCENT_DARK, fontSize: 16, fontWeight: 800, border: 'none', cursor: 'pointer' },
  modalGhost: { marginTop: 8, width: '100%', minHeight: 48, borderRadius: 14, background: 'transparent', border: 'none', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)', cursor: 'pointer' },
}
