import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import { calculateCourseHandicap } from '../engines/handicap'
import { hasContact, displayName, playerKey } from '../lib/identity'
import { fetchCourses } from '../lib/db/courses'
import { getCourseImage } from '../lib/courseImages'
import { GoloWordmark } from '../components/shared/Logo'
import { Icon } from '../components/shared/GoloIcons'
import BackButton from '../components/shared/BackButton'

/**
 * SetupWizard — the single-screen, five-step round setup.
 *
 * Recreates the "glass-over-turf" dark design (Golo Golf - Setup.dc.html):
 * Course → Players → Format → Games → Review, electric-lime accent, full
 * per-game config, live validation, then a confirmation overlay that hands off
 * to live scoring. Inline styles are used throughout to match the prototype
 * pixel-for-pixel rather than fighting the app's light Tailwind theme.
 *
 * Wired to the real roundStore: on Start Round it creates/updates the round,
 * sets players, teams (scramble), the course card and bets, then navigates to
 * /scoring. Extends the design with the app's extras — 9/18 holes, Scramble
 * format, and the Wolf / Bingo Bango Bongo games. The round date is stamped
 * automatically when the user starts the round (no manual date picker), and the
 * course-card editor is admin-only and hidden until roles ship.
 */

/* ----------------------------------------------------------------- constants */

const ACCENT = '#d4f23a'
const ACCENT_DARK = '#13250a' // text/icon color on the lime accent
const PALETTE = ['#2dd4bf', '#60a5fa', '#fb923c', '#c084fc', '#f472b6', '#facc15']

// Editing the course card (par + stroke index) is reserved for admins, who
// don't exist yet — keep the UI built but hidden until admin roles ship.
const SHOW_COURSE_CARD_EDIT = false

// Max players per round. Capped at 4 for now; bump this when we're ready to
// support bigger groups (PALETTE carries enough colors for 6).
const MAX_PLAYERS = 4

const STEPS = ['Course', 'Players', 'Format', 'Games', 'Review']

// Global fallback tees for courses that don't carry their own.
const TEES = [
  { name: 'Championship', color: '#1f2937', yards: 7012, rating: 74.3, slope: 138, par: 72 },
  { name: 'Blue', color: '#3b82f6', yards: 6601, rating: 72.1, slope: 132, par: 72 },
  { name: 'White', color: '#e5e7eb', yards: 6189, rating: 70.0, slope: 126, par: 72 },
  { name: 'Gold', color: '#f59e0b', yards: 5742, rating: 68.2, slope: 121, par: 72 },
  { name: 'Red', color: '#ef4444', yards: 5210, rating: 69.8, slope: 119, par: 73 },
]

// Tetherow Golf Club, Bend OR — real scorecard data. Pars + Men's stroke index
// drive scoring/allocation; each tee's slope+rating+par drives the course
// handicap. Men's tees only (the Ladies-only Red tee and Sage's Ladies rating
// are omitted per the scorecard request).
const TETHEROW_PARS = {
  1: 4, 2: 5, 3: 3, 4: 4, 5: 4, 6: 4, 7: 3, 8: 4, 9: 5,
  10: 4, 11: 4, 12: 4, 13: 5, 14: 3, 15: 4, 16: 4, 17: 3, 18: 5,
}
const TETHEROW_SI = {
  1: 11, 2: 17, 3: 15, 4: 1, 5: 9, 6: 7, 7: 13, 8: 3, 9: 5,
  10: 18, 11: 6, 12: 10, 13: 8, 14: 12, 15: 2, 16: 4, 17: 14, 18: 16,
}
const TETHEROW_TEES = [
  { name: 'Kidd', color: '#6d28d9', yards: 7283, rating: 75.2, slope: 150, par: 72 },
  { name: 'Black', color: '#111827', yards: 6933, rating: 73.7, slope: 145, par: 72 },
  { name: 'Tan', color: '#c2a878', yards: 6485, rating: 71.4, slope: 139, par: 72 },
  { name: 'Sage', color: '#8a9a5b', yards: 5960, rating: 69.2, slope: 133, par: 72 },
]

// Lost Tracks Golf Course, Bend OR — real scorecard. Par/SI below are the
// Championship/Tournament/Middle card (par 72); the Forward tee plays hole 4 as
// a par 5 for a par 73, but the app scores off one shared card so the par-72
// layout is used for everyone. Hole 7 (517 yds) is the front par 5; holes 5, 8,
// 11, 16 are the par 3s; 9, 12, 18 the other par 5s. Middle uses the men's
// rating/slope (68.5/124).
const LOSTTRACKS_PARS = {
  1: 4, 2: 4, 3: 4, 4: 4, 5: 3, 6: 4, 7: 5, 8: 3, 9: 5,
  10: 4, 11: 3, 12: 5, 13: 4, 14: 4, 15: 4, 16: 3, 17: 4, 18: 5,
}
const LOSTTRACKS_SI = {
  1: 11, 2: 17, 3: 3, 4: 9, 5: 15, 6: 7, 7: 1, 8: 13, 9: 5,
  10: 8, 11: 16, 12: 10, 13: 4, 14: 6, 15: 14, 16: 18, 17: 2, 18: 12,
}
const LOSTTRACKS_TEES = [
  { name: 'Championship', color: '#111827', yards: 7003, rating: 73.1, slope: 135, par: 72 },
  { name: 'Tournament', color: '#1d4ed8', yards: 6401, rating: 70.4, slope: 126, par: 72 },
  { name: 'Middle', color: '#15803d', yards: 6073, rating: 68.5, slope: 124, par: 72 },
  { name: 'Forward', color: '#dc2626', yards: 5344, rating: 70.0, slope: 129, par: 73 },
]

const COURSES = [
  { id: 'pinehurst', name: 'Pinehurst No.2', loc: 'Pinehurst, NC', holes: 18, bg: '/courses/course.png' },
  { id: 'harbor', name: 'Harbor Dunes', loc: 'Pawleys Island, SC', holes: 18, bg: '/courses/sunset.png' },
  { id: 'lincoln', name: 'Lincoln Park', loc: 'San Francisco, CA', holes: 18, bg: '/courses/turf.png' },
  {
    id: 'tetherow', name: 'Tetherow', loc: 'Bend, OR', holes: 18, bg: '/courses/tetherow.jpg',
    pars: TETHEROW_PARS, strokeIndex: TETHEROW_SI, tees: TETHEROW_TEES,
  },
  {
    id: 'losttracks', name: 'Lost Tracks Golf Course', loc: 'Bend, OR', holes: 18, bg: '/courses/losttracks.webp',
    pars: LOSTTRACKS_PARS, strokeIndex: LOSTTRACKS_SI, tees: LOSTTRACKS_TEES,
  },
]

// Courses surfaced on the setup picker, in display order. The rest stay defined
// for data lookup (by id) but are hidden from the list until admin tooling
// lets us manage the catalogue.
const VISIBLE_COURSE_IDS = ['tetherow', 'losttracks', 'pinehurst']

// Format ids map directly to roundStore scoringType values.
const FORMATS = [
  { id: 'stroke', label: 'Stroke Play', desc: 'Count every stroke; lowest total wins the round.' },
  { id: 'matchplay', label: 'Match Play', desc: 'Win holes head-to-head, not on total strokes.' },
  { id: 'stableford', label: 'Stableford', desc: 'Earn points per hole; highest points win.' },
  { id: 'scramble', label: 'Scramble', desc: 'Play in teams — everyone hits, take the best ball.' },
]

/**
 * Game catalogue. `appType` is the roundStore bet type; `toConfig` turns the
 * wizard's lightweight bet state into the engine-ready config shape.
 */
const GAME_DEFS = [
  {
    key: 'skins', appType: 'skins', icon: '🎯', iconName: 'skins', title: 'Skins',
    desc: 'Low score wins each hole; ties carry over.', unit: '/ skin',
    // Skins uses its own panel (renderSkinsConfig), not the generic toggles/selects.
    toggles: [], selects: [],
    // Legacy fields keep the current engine settling standard + carryover skins.
    // valuePerSkin is 0 unless "Standard" is selected, so types the new engine
    // doesn't handle yet (greenie/birdie/…) pay nothing in the interim rather
    // than being mis-scored as standard skins. skinsConfig carries the full setup.
    toConfig: (b) => ({
      valuePerSkin: b.selectedSkins.standardSkin ? b.baseSkinValue : 0,
      carryover: !!b.selectedSkins.carryoverSkin,
      useNetScores: b.scoring === 'net',
      skinsConfig: skinsConfigOf(b),
    }),
  },
  {
    key: 'nassau', appType: 'nassau', icon: '🏆', iconName: 'nassau', title: 'Nassau',
    desc: 'Front 9, back 9 and overall match.', unit: '/ segment',
    // Auto-press is hidden for now (we'll add it back later); the `press` default
    // and toConfig stay wired so restoring it is just re-adding this toggle.
    toggles: [],
    selects: [],
    toConfig: (b) => ({ frontAmount: b.stake, backAmount: b.stake, overallAmount: b.stake, style: 'match', autoPress: !!b.press }),
  },
  {
    key: 'purse', appType: 'strokePurse', icon: '💰', iconName: 'purse', title: 'Stroke Purse',
    desc: 'Lowest net total takes the pot.', unit: 'buy-in',
    toggles: [],
    selects: [{ key: 'payout', label: 'Payout', options: ['Winner takes all', 'Top 2 split', 'Top 3 split'] }],
    toConfig: (b, who) => ({ mode: 'entry', entryFee: b.stake, totalPurse: b.stake * who.length, payTop: b.payout + 1, splitTies: true }),
  },
  {
    key: 'ctp', appType: 'ctp', icon: '📍', iconName: 'closestToPin', title: 'Closest to Pin',
    desc: 'Nearest the flag on the par 3s.', unit: 'pot',
    toggles: [],
    selects: [{ key: 'holes', label: 'Holes', options: ['All par 3s', 'Back 9 only'] }],
    toConfig: (b, who, ctx) => ({ amount: b.stake, holes: b.holes === 1 ? ctx.backNinePar3s : ctx.par3Holes }),
  },
  {
    key: 'long', appType: 'longestDrive', icon: '🚀', iconName: 'longestDrive', title: 'Longest Drive',
    desc: 'Longest drive in the fairway.', unit: 'pot',
    toggles: [],
    selects: [{ key: 'hole', label: 'Hole', options: ['Hole 8', 'Hole 13', 'Hole 18'] }],
    toConfig: (b) => ({ amount: b.stake, hole: [8, 13, 18][b.hole] ?? null }),
  },
  {
    key: 'wolf', appType: 'wolf', icon: '🐺', iconName: 'wolf', title: 'Wolf',
    desc: '4-player rotating teams.', unit: '/ unit',
    toggles: [], selects: [], requiresExactly: 4,
    toConfig: (b) => ({ unit: b.stake }),
  },
  {
    key: 'bbb', appType: 'bingobangobongo', icon: '🟢', title: 'Bingo Bango Bongo',
    desc: 'Three points per hole.', unit: '/ point',
    toggles: [], selects: [],
    toConfig: (b) => ({ valuePerPoint: b.stake }),
  },
]

/* ------------------------------------------------------------------- helpers */

function hexA(hex, a) {
  let h = (hex || ACCENT).replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

const comma = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
/** Avatar initial from a player's best label (name → handle → email). */
const initial = (p) => {
  const t = (typeof p === 'string' ? p : displayName(p)).trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}
const today = () => new Date().toISOString().slice(0, 10)

/** Default course card: par 4, stroke index = hole number (a valid permutation). */
function defaultCard(totalHoles, pars, strokeIndex) {
  const p = {}
  const si = {}
  for (let h = 1; h <= totalHoles; h++) {
    p[h] = pars?.[h] ?? 4
    si[h] = strokeIndex?.[h] ?? h
  }
  return { pars: p, strokeIndex: si }
}

/** Balance teams: assign the next player to whichever team has fewer. */
const nextTeam = (players) =>
  players.filter((p) => p.team === 'A').length <= players.filter((p) => p.team === 'B').length ? 'A' : 'B'

/* ------------------------------------------------------------------- skins */

// Skins is configured by its own rich panel (not the generic game pattern): a
// base per-skin value, a Net/Gross choice, the six standard skin types, and two
// custom slots. Engine/greenie-sandie tracking/results come later — for now this
// captures the SkinsConfig and the existing engine still settles standard +
// carryover skins off baseSkinValue.

const SKIN_PRESETS = [1, 2, 5, 10]

// The six standard skin types, in display order. `base: true` means it adds the
// base value to the per-hole "up to" total (per the agreed rule: Standard +
// Birdie + Eagle + Customs count; Carryover is a modifier and Greenie/Sandie are
// separate side pots).
const SKIN_TYPES = [
  { key: 'standardSkin', name: 'Standard Skin', tag: 'Low score wins', desc: 'Lowest unique score on a hole wins the skin; ties carry over.', base: true },
  { key: 'carryoverSkin', name: 'Carryover Skin', tag: 'Banked skins', desc: 'A tied hole stacks the skin onto the next, growing the payout until won outright.', base: false },
  { key: 'birdieBonusSkin', name: 'Birdie Bonus', tag: '+1 skin', desc: 'Winning a hole with a birdie earns an extra skin on top of the win.', base: true },
  { key: 'eagleBonusSkin', name: 'Eagle Bonus', tag: '×2 value', desc: 'An eagle is worth double; a double eagle more. Eagle beats a birdie — no tie.', base: true },
  { key: 'greenie', name: 'Greenie', tag: 'Par 3s', desc: 'Par-3 only: on in regulation, par or better. Flagged live during scoring; pays the base value per hit, head-to-head, and stacks.', base: false },
  { key: 'sandie', name: 'Sandie', tag: 'Sand save', desc: 'Up and down from a bunker for par. Flagged live during scoring; pays the base value per hit, head-to-head, and stacks.', base: false },
]

/** Fresh Skins selection (the wizard-side shape held in st.bets.skins). */
const defaultSkinsSelection = () => ({
  baseSkinValue: 1,
  basePreset: '1', // '1' | '2' | '5' | '10' | 'custom'
  scoring: 'net', // 'net' | 'gross'
  savedAsDefault: false,
  selectedSkins: {
    standardSkin: true,
    carryoverSkin: true,
    birdieBonusSkin: false,
    eagleBonusSkin: false,
    greenie: false,
    sandie: false,
    custom1: { enabled: false, name: '', value: 1, mode: 'dollar' }, // mode: 'dollar' | 'multiplier'
    custom2: { enabled: false, name: '', value: 1, mode: 'dollar' },
  },
})

/** A custom skin's resolved dollar value (flat amount, or multiplier × base). */
const resolveCustomSkin = (c, base) =>
  c.mode === 'multiplier' ? base * (Number(c.value) || 0) : (Number(c.value) || 0)

/** "Up to" dollars per hole: base for each of Standard/Birdie/Eagle + customs. */
const perHoleSkinValue = (sel, base) =>
  (sel.standardSkin ? base : 0) +
  (sel.birdieBonusSkin ? base : 0) +
  (sel.eagleBonusSkin ? base : 0) +
  (sel.custom1.enabled ? resolveCustomSkin(sel.custom1, base) : 0) +
  (sel.custom2.enabled ? resolveCustomSkin(sel.custom2, base) : 0)

/** Any skin type selected at all (used for validation). */
const anySkinSelected = (sel) =>
  sel.standardSkin || sel.carryoverSkin || sel.birdieBonusSkin || sel.eagleBonusSkin ||
  sel.greenie || sel.sandie || sel.custom1.enabled || sel.custom2.enabled

/** Wizard skins state → the persisted SkinsConfig (data schema #1). */
const skinsConfigOf = (b) => ({
  enabled: true,
  baseSkinValue: b.baseSkinValue,
  scoring: b.scoring,
  selectedSkins: {
    standardSkin: !!b.selectedSkins.standardSkin,
    carryoverSkin: !!b.selectedSkins.carryoverSkin,
    birdieBonusSkin: !!b.selectedSkins.birdieBonusSkin,
    eagleBonusSkin: !!b.selectedSkins.eagleBonusSkin,
    greenie: !!b.selectedSkins.greenie,
    sandie: !!b.selectedSkins.sandie,
    custom1: { ...b.selectedSkins.custom1 },
    custom2: { ...b.selectedSkins.custom2 },
  },
  perHoleSkinValue: perHoleSkinValue(b.selectedSkins, b.baseSkinValue),
  savedAsDefault: !!b.savedAsDefault,
})

/** Persisted SkinsConfig (or saved default) → the wizard skins selection shape. */
const skinsSelectionFrom = (c) => {
  const base = defaultSkinsSelection()
  if (!c) return base
  const s = c.selectedSkins ?? {}
  return {
    baseSkinValue: c.baseSkinValue ?? base.baseSkinValue,
    basePreset: SKIN_PRESETS.includes(c.baseSkinValue) ? String(c.baseSkinValue) : 'custom',
    scoring: c.scoring ?? base.scoring,
    savedAsDefault: !!c.savedAsDefault,
    selectedSkins: {
      standardSkin: !!s.standardSkin,
      carryoverSkin: !!s.carryoverSkin,
      birdieBonusSkin: !!s.birdieBonusSkin,
      eagleBonusSkin: !!s.eagleBonusSkin,
      greenie: !!s.greenie,
      sandie: !!s.sandie,
      custom1: { ...base.selectedSkins.custom1, ...(s.custom1 ?? {}) },
      custom2: { ...base.selectedSkins.custom2, ...(s.custom2 ?? {}) },
    },
  }
}

/** Seed wizard state from any round already in the store (edit / back-nav). */
function initState() {
  const {
    round: storedRound,
    players: rawPlayers,
    bets: rawBets,
    teams: rawTeams,
  } = useRoundStore.getState()
  const round = storedRound?.status === 'complete' ? null : storedRound
  const storedPlayers = round ? rawPlayers : []
  const storedBets = round ? rawBets : []
  const storedTeams = round ? rawTeams : []

  const holes = round?.holes ?? 18
  const courseMatch =
    COURSES.find((c) => c.id === round?.courseId) ??
    COURSES.find((c) => c.name === round?.course)

  // Players
  const teamOf = (id) =>
    storedTeams?.find((t) => t.playerIds?.includes(id))?.id === 'teamB' ? 'B' : 'A'
  let players
  if (storedPlayers?.length) {
    players = storedPlayers.map((p, i) => ({
      id: p.id,
      name: p.name ?? '',
      nickname: p.nickname ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      hdcp: p.handicapIndex ?? 12,
      guest: false,
      color: p.color?.startsWith?.('#') ? p.color : PALETTE[i % PALETTE.length],
      team: storedTeams?.length ? teamOf(p.id) : i % 2 === 0 ? 'A' : 'B',
    }))
  } else {
    // Fresh round: the only player carried over is "you" — the organizer, always
    // the first card. Everyone else is added explicitly below and must carry a
    // verified contact before the round can start.
    const me = useProfileStore.getState()
    players = [
      {
        id: crypto.randomUUID(),
        name: me.name ?? '',
        nickname: me.nickname ?? '',
        email: me.email ?? '',
        phone: me.phone ?? '',
        hdcp: me.handicapIndex ?? 12,
        guest: false,
        color: PALETTE[0],
        team: 'A',
      },
    ]
  }
  const ids = players.map((p) => p.id)

  // Bets — defaults, lightly re-seeded from any saved bet of the same type.
  const findBet = (appType) => storedBets?.find((b) => b.type === appType)
  const bet = (appType, base) => {
    const saved = findBet(appType)
    if (!saved) return { on: false, who: ids.slice(), ...base }
    return {
      on: true,
      who: saved.playerIds?.length ? saved.playerIds.filter((x) => ids.includes(x)) : ids.slice(),
      ...base,
      stake: saved.amount ?? base.stake,
      ...(base.carryover != null ? { carryover: saved.config?.carryover ?? base.carryover } : {}),
      ...(base.press != null ? { press: saved.config?.autoPress ?? base.press } : {}),
    }
  }

  // Skins has its own config panel: seed from a saved round's skinsConfig, else
  // the player's saved default, else a fresh selection.
  const savedSkins = findBet('skins')
  const skinsBet = {
    on: !!savedSkins,
    who: savedSkins?.playerIds?.length ? savedSkins.playerIds.filter((x) => ids.includes(x)) : ids.slice(),
    ...skinsSelectionFrom(savedSkins?.config?.skinsConfig ?? useProfileStore.getState().skinsDefault),
  }

  // Every game starts untoggled (the bet() helper returns on:false for a fresh
  // round) with a $1 stake. Saved bets re-seed their own amount on back-nav.
  const bets = {
    skins: skinsBet,
    nassau: bet('nassau', { stake: 1, press: false }),
    purse: bet('strokePurse', { stake: 1, payout: 0 }),
    ctp: bet('ctp', { stake: 1, holes: 0 }),
    long: bet('longestDrive', { stake: 1, hole: 2 }),
    wolf: bet('wolf', { stake: 1 }),
    bbb: bet('bingobangobongo', { stake: 1 }),
  }

  const card = defaultCard(holes, round?.pars, round?.strokeIndex)

  return {
    step: 0,
    courseId: courseMatch?.id ?? 'pinehurst',
    courseQuery: '',
    teeIdx: 1,
    holes,
    date: round?.date ?? today(),
    showCard: false,
    showAccountPicker: false,
    pars: card.pars,
    strokeIndex: card.strokeIndex,
    format: round?.scoringType ?? 'stroke',
    scoring: round?.scoring ?? 'net',
    players,
    bets,
    started: false,
  }
}

/* --------------------------------------------------------------- component */

export default function SetupWizard() {
  const navigate = useNavigate()
  const createRound = useRoundStore((s) => s.createRound)
  const updateRoundSetup = useRoundStore((s) => s.updateRoundSetup)
  const setCourseConfig = useRoundStore((s) => s.setCourseConfig)
  const setPlayers = useRoundStore((s) => s.setPlayers)
  const setTeams = useRoundStore((s) => s.setTeams)
  const setBets = useRoundStore((s) => s.setBets)
  const historyCount = useHistoryStore((s) => s.rounds.length)
  // Saved rounds double as the "account directory": the people you've finished
  // rounds with (and who left a contact) are the players you can re-add.
  const historyRounds = useHistoryStore((s) => s.rounds)

  const [st, setSt] = useState(initState)
  const patch = (p) => setSt((s) => ({ ...s, ...p }))

  // Course catalogue: starts with the bundled fallback list, then swaps in the
  // backend catalogue once it loads (when Supabase is configured). The hardcoded
  // courses remain as a fallback for any id the DB doesn't have.
  const [catalog, setCatalog] = useState(COURSES)
  const [coursesFromDb, setCoursesFromDb] = useState(false)
  useEffect(() => {
    let active = true
    fetchCourses().then((rows) => {
      if (!active || !rows || rows.length === 0) return
      const byId = new Map(COURSES.map((c) => [c.id, c]))
      for (const r of rows) byId.set(r.id, r)
      setCatalog([...byId.values()])
      setCoursesFromDb(true)
    })
    return () => { active = false }
  }, [])

  // Open every step at the top of the scroll, not wherever the previous step
  // left the shared scroll container.
  const bodyRef = useRef(null)
  useEffect(() => { bodyRef.current?.scrollTo(0, 0) }, [st.step])

  /* ---- derived ---- */
  const course = catalog.find((c) => c.id === st.courseId) ?? catalog[0]
  // Per-course tees when defined, else the global fallback set.
  const tees = course.tees ?? TEES
  const tee = tees[Math.min(st.teeIdx, tees.length - 1)]
  const isScramble = st.format === 'scramble'
  const ids = st.players.map((p) => p.id)
  const holeNumbers = Array.from({ length: st.holes }, (_, i) => i + 1)
  const par3Holes = holeNumbers.filter((h) => st.pars[h] === 3)
  const backNinePar3s = par3Holes.filter((h) => h > 9)
  const ctx = { holeNumbers, par3Holes, backNinePar3s, playerCount: st.players.length }
  const skins = st.bets.skins
  // Base amount shown in summaries — Skins reports its per-skin base value.
  const baseAmount = (d, b) => (d.key === 'skins' ? b.baseSkinValue : b.stake)

  const activeGames = GAME_DEFS.filter(
    (d) => st.bets[d.key].on && (d.requiresExactly == null || st.players.length === d.requiresExactly)
  )
  const selectedCount = (d) => st.bets[d.key].who.filter((x) => ids.includes(x)).length
  const validGameSelection = (d) => {
    const n = selectedCount(d)
    return d.requiresExactly != null ? n === d.requiresExactly : n >= 2
  }

  /* ---- player mutations ---- */
  const updatePlayer = (id, p) =>
    patch({ players: st.players.map((pl) => (pl.id === id ? { ...pl, ...p } : pl)) })
  const incHdcp = (id, d) =>
    updatePlayer(id, { hdcp: Math.max(0, Math.min(54, st.players.find((p) => p.id === id).hdcp + d)) })
  const addRoundPlayer = (fields) => {
    if (st.players.length >= MAX_PLAYERS) return
    const id = crypto.randomUUID()
    setSt((s) => {
      const used = s.players.map((p) => p.color)
      const color = PALETTE.find((c) => !used.includes(c)) ?? PALETTE[s.players.length % PALETTE.length]
      const player = { id, name: '', nickname: '', email: '', phone: '', hdcp: 12, guest: false, color, team: nextTeam(s.players), ...fields }
      const players = [...s.players, player]
      const bets = { ...s.bets }
      Object.keys(bets).forEach((k) => { bets[k] = { ...bets[k], who: [...bets[k].who, id] } })
      return { ...s, players, bets, showAccountPicker: false }
    })
  }
  const addVerifiedPlayer = () => addRoundPlayer({ guest: false })
  const addAccount = (acct) =>
    addRoundPlayer({ guest: false, name: acct.name, nickname: acct.nickname, email: acct.email, phone: acct.phone })
  const removePlayer = (id) => {
    // The organizer (first card) is always carried over and can't be removed.
    if (st.players[0]?.id === id) return
    setSt((s) => {
      const players = s.players.filter((p) => p.id !== id)
      const bets = { ...s.bets }
      Object.keys(bets).forEach((k) => { bets[k] = { ...bets[k], who: bets[k].who.filter((x) => x !== id) } })
      return { ...s, players, bets }
    })
  }

  /* ---- bet mutations ---- */
  const setBet = (key, p) => patch({ bets: { ...st.bets, [key]: { ...st.bets[key], ...p } } })
  // Stakes step up by $1 through $15, then by $5 above it. Floor $1, cap $500.
  const stepStake = (key, dir) => {
    const cur = st.bets[key].stake
    const next = dir > 0 ? (cur < 15 ? cur + 1 : cur + 5) : (cur <= 15 ? cur - 1 : cur - 5)
    setBet(key, { stake: Math.max(1, Math.min(500, next)) })
  }
  const toggleWho = (key, pid) => {
    const cur = st.bets[key].who
    setBet(key, { who: cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid] })
  }

  /* ---- skins config (its own panel, not the generic game pattern) ---- */
  const setSkinType = (k, v) => setBet('skins', { selectedSkins: { ...skins.selectedSkins, [k]: v } })
  const setCustomSkin = (slot, p) =>
    setBet('skins', { selectedSkins: { ...skins.selectedSkins, [slot]: { ...skins.selectedSkins[slot], ...p } } })
  const setSkinBasePreset = (preset) =>
    preset === 'custom'
      ? setBet('skins', { basePreset: 'custom' })
      : setBet('skins', { basePreset: String(preset), baseSkinValue: preset })
  const setSkinBaseValue = (raw) =>
    setBet('skins', { baseSkinValue: Math.max(1, Math.min(500, Math.round(Number(raw) || 0))) })

  /* ---- course selection ---- */
  // Switching course loads its real card (pars + stroke index) and resets the
  // tee; courses without their own data fall back to a generic par-4 card.
  const selectCourse = (id) => {
    if (id === st.courseId) return
    const c = catalog.find((x) => x.id === id) ?? catalog[0]
    const card =
      c.pars && c.strokeIndex
        ? { pars: { ...c.pars }, strokeIndex: { ...c.strokeIndex } }
        : defaultCard(st.holes)
    patch({ courseId: id, teeIdx: 1, pars: card.pars, strokeIndex: card.strokeIndex })
  }

  /* ---- course card ---- */
  const setPar = (hole, par) => patch({ pars: { ...st.pars, [hole]: par } })
  const setSi = (hole, raw) => {
    if (raw === '') return
    const n = Math.max(1, Math.min(st.holes, Math.round(Number(raw))))
    if (Number.isNaN(n)) return
    patch({ strokeIndex: { ...st.strokeIndex, [hole]: n } })
  }
  // Rebuild the card when the hole count changes (keeps it a valid 1..N set).
  const setHoles = (n) => {
    const card = defaultCard(n, st.pars, st.strokeIndex)
    // On a 9-hole round, "Back 9 only" CTP is invalid — force "All par 3s" (0).
    const bets = n === 9 && st.bets.ctp.holes !== 0
      ? { ...st.bets, ctp: { ...st.bets.ctp, holes: 0 } }
      : st.bets
    patch({ holes: n, pars: card.pars, strokeIndex: card.strokeIndex, bets })
  }

  /* ---- validation ---- */
  // Every player needs a name before the round can continue.
  const organizer = st.players[0]
  const isReady = (p) => p.name?.trim().length > 0
  const readyPlayers = st.players.filter((p, i) => isReady(p, i))
  const everyoneReady = st.players.every((p, i) => isReady(p, i))
  const validStep = (step) => {
    if (step === 1) {
      if (!organizer || !isReady(organizer)) return false
      if (!everyoneReady || readyPlayers.length < 2) return false
      if (isScramble) {
        const a = readyPlayers.filter((p) => p.team === 'A').length
        const b = readyPlayers.filter((p) => p.team === 'B').length
        return a >= 1 && b >= 1
      }
      return true
    }
    if (step === 3) {
      const whoOk = activeGames.every(validGameSelection)
      if (!whoOk) return false
      if (skins.on && !anySkinSelected(skins.selectedSkins)) return false
      return true
    }
    return true
  }
  const isReview = st.step === 4
  // The progress dots let you jump straight to Review, so Start must re-check the
  // players and games steps — not just the review step, which is always valid.
  const valid = isReview ? validStep(1) && validStep(3) : validStep(st.step)
  let hintText = ''
  if (!valid && st.step === 1) {
    if (!organizer || !isReady(organizer)) hintText = 'Add your name to continue.'
    else if (!everyoneReady) hintText = 'Add a name for every player.'
    else if (readyPlayers.length < 2) hintText = 'Add at least one more player.'
    else if (isScramble) hintText = 'Put a player on each team.'
  }
  if (!valid && st.step === 3) {
    const exactGame = activeGames.find((d) => d.requiresExactly != null && selectedCount(d) !== d.requiresExactly)
    hintText = skins.on && !anySkinSelected(skins.selectedSkins)
      ? 'Pick at least one skin type for Skins.'
      : exactGame
        ? `${exactGame.title} needs exactly ${exactGame.requiresExactly} players.`
        : 'Each active game needs at least 2 players.'
  }
  if (!valid && isReview) {
    hintText = !validStep(1) ? 'Add players before starting the round.' : 'Finish the games step before starting.'
  }

  /* ---- navigation / commit ---- */
  const goStep = (i) => patch({ step: Math.max(0, Math.min(4, i)) })
  const back = () => patch({ step: Math.max(0, st.step - 1) })

  const commit = () => {
    const existing = useRoundStore.getState().round
    const data = {
      courseId: course.id,
      course: course.name,
      courseBg: getCourseImage(course),
      // Date is stamped now, the moment the user starts the round — no picker.
      date: today(),
      holes: st.holes,
      scoringType: st.format,
      scoring: st.scoring,
      tee: { name: tee.name, yards: tee.yards, par: tee.par, rating: tee.rating, slope: tee.slope },
    }
    if (existing && existing.status !== 'complete') updateRoundSetup(data)
    else createRound(data)
    setCourseConfig({ pars: st.pars, strokeIndex: st.strokeIndex })

    const players = readyPlayers.map((p) => ({
      id: p.id,
      // Name is optional; fall back to handle/email/phone so every downstream
      // label (scorecard, standings, share text) has something to show.
      name: p.name.trim() || displayName(p),
      nickname: p.nickname.trim().replace(/^@+/, ''),
      email: p.email.trim().toLowerCase(),
      phone: p.phone.trim(),
      handicapIndex: p.hdcp,
      courseHandicap: calculateCourseHandicap(p.hdcp, tee.slope, tee.rating, tee.par),
      color: p.color,
      guest: false,
      loggedIn: true,
      verified: hasContact(p),
    }))
    setPlayers(players)

    if (isScramble) {
      const teams = [
        { id: 'teamA', name: 'Team A', color: 'green', playerIds: readyPlayers.filter((p) => p.team === 'A').map((p) => p.id) },
        { id: 'teamB', name: 'Team B', color: 'blue', playerIds: readyPlayers.filter((p) => p.team === 'B').map((p) => p.id) },
      ].filter((t) => t.playerIds.length > 0)
      setTeams(teams)
    } else {
      setTeams([])
    }

    const bets = activeGames.map((d) => {
      const b = st.bets[d.key]
      const who = b.who.filter((x) => ids.includes(x))
      return {
        id: crypto.randomUUID(),
        type: d.appType,
        playerIds: who,
        amount: baseAmount(d, b),
        config: d.toConfig(b, who, ctx),
      }
    })
    setBets(bets)

    // Persist (or clear) the player's saved Skins default for future rounds.
    if (skins.on) useProfileStore.getState().setSkinsDefault(skins.savedAsDefault ? skinsConfigOf(skins) : null)

    // Backfill the profile from the organizer (the first player) so a round set
    // up with an empty profile remembers "you" next time and "me" detection works
    // downstream. Only fill fields the profile doesn't already have.
    const me = readyPlayers[0]
    if (me) {
      const prof = useProfileStore.getState()
      const fill = {}
      if (!prof.name && me.name.trim()) fill.name = me.name
      if (!prof.nickname && me.nickname.trim()) fill.nickname = me.nickname
      if (!prof.email && me.email.trim()) fill.email = me.email
      if (!prof.phone && me.phone.trim()) fill.phone = me.phone
      if (Object.keys(fill).length) prof.setIdentity(fill)
    }

    const prof = useProfileStore.getState()
    const profileForMatch = {
      name: prof.name,
      nickname: prof.nickname,
      email: prof.email,
      phone: prof.phone,
    }
    const profileKey = playerKey(profileForMatch)
    const profilePlayer = players.find((p) => profileKey != null && playerKey(p) === profileKey)
    if (profilePlayer) prof.setHandicapIndex(profilePlayer.handicapIndex)
  }

  const next = () => {
    if (!valid) return
    if (st.step < 4) patch({ step: st.step + 1 })
    else { commit(); patch({ started: true }) }
  }

  /* --------------------------------------------------------------- render */

  const titles = [
    { t: 'Pick your course', s: 'Choose the track and the tees you’re playing.' },
    { t: 'Who’s playing?', s: 'Build the group and set each handicap.' },
    { t: 'How are we scoring?', s: 'Pick a format and net or gross.' },
    { t: 'Games & bets', s: 'Switch on games, set stakes and who’s in.' },
    { t: 'Review & start', s: 'Lock it in and head to the first tee.' },
  ]

  const optStyle = (sel) => ({
    bg: sel ? ACCENT : 'rgba(255,255,255,.06)',
    border: sel ? ACCENT : 'rgba(255,255,255,.14)',
    color: sel ? ACCENT_DARK : 'rgba(255,255,255,.7)',
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
        fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        color: '#fff', overflow: 'hidden',
        background: 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)',
      }}
    >
      {/* course photo backdrop + dark overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)', backgroundImage: `url(${getCourseImage(course)}), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(6,14,9,.7) 0%, rgba(6,14,9,.5) 22%, rgba(6,16,10,.6) 55%, rgba(4,12,8,.92) 100%)', pointerEvents: 'none' }} />

      {/* content column */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', height: '100%', maxWidth: 480, width: '100%', margin: '0 auto' }}>

        {/* header */}
        <div style={{ flex: '0 0 auto', padding: 'max(14px, env(safe-area-inset-top)) 18px 14px', textShadow: '0 2px 12px rgba(0,0,0,.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <BackButton />
            <GoloWordmark variant="white" fontPx={15} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT }}>
              STEP {st.step + 1} OF 5 · {STEPS[st.step].toUpperCase()}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.13)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.16)', padding: '6px 12px', borderRadius: 9999, fontSize: 12, fontWeight: 700, color: '#fff', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: ACCENT }} />
              {course.name}
            </span>
          </div>
          <div style={{ fontSize: 27, fontWeight: 800, color: '#fff', marginTop: 9, letterSpacing: '-0.5px' }}>{titles[st.step].t}</div>
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.62)', marginTop: 3, lineHeight: 1.45 }}>{titles[st.step].s}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            {STEPS.map((label, i) => (
              <button
                key={label}
                onClick={() => goStep(i)}
                aria-label={`Go to ${label}`}
                style={{ flex: 1, height: 6, borderRadius: 9999, border: 'none', padding: 0, cursor: 'pointer', background: i <= st.step ? ACCENT : 'rgba(255,255,255,.2)' }}
              />
            ))}
          </div>
        </div>

        {/* scrollable body */}
        <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 18px' }}>
          {st.step === 0 && renderCourse()}
          {st.step === 1 && renderPlayers()}
          {st.step === 2 && renderFormat()}
          {st.step === 3 && renderGames()}
          {st.step === 4 && renderReview()}
        </div>

        {/* footer */}
        <div style={{ flex: '0 0 auto', padding: '10px 16px max(14px, env(safe-area-inset-bottom))' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {st.step > 0 && (
              <button onClick={back} style={{ minHeight: 54, padding: '0 20px', borderRadius: 16, background: 'rgba(255,255,255,.1)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,.18)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Back</button>
            )}
            <button
              onClick={next}
              style={{ flex: 1, minHeight: 54, borderRadius: 16, border: 'none', fontSize: 16, fontWeight: 800, cursor: valid ? 'pointer' : 'not-allowed', background: valid ? ACCENT : 'rgba(255,255,255,.12)', color: valid ? ACCENT_DARK : 'rgba(255,255,255,.4)', boxShadow: valid ? `0 8px 22px ${hexA(ACCENT, 0.4)}` : 'none' }}
            >
              {isReview ? 'Start Round →' : 'Continue'}
            </button>
          </div>
          {!valid && (
            <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#fb7185', marginTop: 8 }}>{hintText}</div>
          )}
        </div>
      </div>

      {/* start overlay */}
      {st.started && renderOverlay()}
    </div>
  )

  /* ----------------------------------------------------------- step bodies */

  function sectionLabel(text, style) {
    return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', marginBottom: 10, ...style }}>{text}</div>
  }

  function renderCourse() {
    const q = st.courseQuery.trim().toLowerCase()
    // From the backend, show the whole catalogue; in local-only mode keep the
    // curated visible subset that used to be hardcoded.
    const visible = coursesFromDb
      ? catalog
      : VISIBLE_COURSE_IDS.map((id) => catalog.find((c) => c.id === id)).filter(Boolean)
    const matches = visible.filter((c) => !q || (c.name + ' ' + (c.loc ?? '')).toLowerCase().includes(q))
    return (
      <div>
        {sectionLabel('COURSE SEARCH')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 14, padding: '0 15px', marginBottom: 20 }}>
          <span style={{ fontSize: 19, flex: '0 0 auto', lineHeight: 1 }}>🔍</span>
          <input
            value={st.courseQuery}
            onChange={(e) => patch({ courseQuery: e.target.value })}
            placeholder="Search courses…"
            style={{ flex: 1, minHeight: 52, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', padding: 0 }}
          />
          {q.length > 0 && (
            <button onClick={() => patch({ courseQuery: '' })} style={{ width: 26, height: 26, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
        </div>

        {sectionLabel('COURSE')}
        {matches.map((c) => {
          const sel = c.id === st.courseId
          return (
            <button key={c.id} onClick={() => selectCourse(c.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${sel ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)'}`, borderRadius: 16, padding: 12, marginBottom: 10, cursor: 'pointer' }}>
              <span style={{ width: 54, height: 54, borderRadius: 12, flex: '0 0 auto', background: 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)', backgroundImage: `url(${c.bg}), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)`, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{c.name}</div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 1 }}>{c.loc} · {c.holes} holes</div>
              </div>
              <span style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${sel ? ACCENT : 'rgba(255,255,255,.3)'}`, background: sel ? ACCENT : 'transparent', color: ACCENT_DARK, fontSize: 14, fontWeight: 800 }}>{sel ? '✓' : ''}</span>
            </button>
          )
        })}
        {matches.length === 0 && (
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, padding: 14, lineHeight: 1.5 }}>
            No courses match “{st.courseQuery}”. More courses coming soon — for now pick from the list above.
          </div>
        )}

        {sectionLabel('TEES', { margin: '18px 0 10px' })}
        {tees.map((t, i) => {
          const sel = i === st.teeIdx
          return (
            <button key={t.name} onClick={() => patch({ teeIdx: i })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${sel ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)'}`, borderRadius: 14, padding: '11px 13px', marginBottom: 9, cursor: 'pointer' }}>
              <span style={{ width: 16, height: 16, borderRadius: '50%', flex: '0 0 auto', background: t.color, boxShadow: '0 0 0 2px rgba(255,255,255,.28)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{t.name} Tees</div>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>CR {t.rating} · Slope {t.slope} · Par {t.par}</div>
              </div>
              <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: sel ? ACCENT : '#fff' }}>{comma(t.yards)}</div>
                <div style={{ fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,.45)' }}>YARDS</div>
              </div>
            </button>
          )
        })}

        {/* extras: holes (round date is stamped automatically at start) */}
        {sectionLabel('ROUND', { margin: '18px 0 10px' })}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[9, 18].map((n) => {
            const sel = st.holes === n
            return (
              <button key={n} onClick={() => setHoles(n)} style={{ flex: 1, minHeight: 48, borderRadius: 12, border: `1px solid ${sel ? ACCENT : 'rgba(255,255,255,.14)'}`, cursor: 'pointer', fontSize: 15, fontWeight: 800, background: sel ? ACCENT : 'rgba(255,255,255,.06)', color: sel ? ACCENT_DARK : 'rgba(255,255,255,.7)' }}>{n} holes</button>
            )
          })}
        </div>

        {/* extras: editable course card — admin-only, hidden until roles ship */}
        {SHOW_COURSE_CARD_EDIT && (
          <>
            <button onClick={() => patch({ showCard: !st.showCard })} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderRadius: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.14)', color: 'rgba(255,255,255,.82)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: '0 14px' }}>
              <span>Course card · par &amp; stroke index</span>
              <span style={{ color: ACCENT }}>{st.showCard ? 'Hide' : 'Edit'}</span>
            </button>
            {st.showCard && (
              <div style={{ marginTop: 10, background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: '6px 12px' }}>
                {holeNumbers.map((h) => (
                  <div key={h} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: h === 1 ? 'none' : '1px solid rgba(255,255,255,.08)' }}>
                    <span style={{ width: 26, fontSize: 14, fontWeight: 800, color: '#fff' }}>{h}</span>
                    <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                      {[3, 4, 5].map((p) => {
                        const sel = st.pars[h] === p
                        return (
                          <button key={p} onClick={() => setPar(h, p)} style={{ flex: 1, minHeight: 36, borderRadius: 9, border: `1px solid ${sel ? ACCENT : 'rgba(255,255,255,.14)'}`, cursor: 'pointer', fontSize: 13, fontWeight: 800, background: sel ? ACCENT : 'transparent', color: sel ? ACCENT_DARK : 'rgba(255,255,255,.7)' }}>{p}</button>
                        )
                      })}
                    </div>
                    <input
                      type="number" inputMode="numeric" min={1} max={st.holes}
                      value={st.strokeIndex[h]}
                      onChange={(e) => setSi(h, e.target.value)}
                      aria-label={`Hole ${h} stroke index`}
                      style={{ width: 52, minHeight: 36, textAlign: 'center', borderRadius: 9, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', outline: 'none' }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  function renderPlayers() {
    // The "account directory" stand-in: identities from saved rounds that left a
    // contact, minus anyone already in this round. Newest label wins.
    const inRound = new Set(st.players.map(playerKey).filter(Boolean))
    const accountMap = {}
    for (const r of historyRounds) {
      for (const p of r.players ?? []) {
        if (!hasContact(p)) continue
        const k = playerKey(p)
        if (!k || inRound.has(k) || accountMap[k]) continue
        accountMap[k] = { key: k, name: p.name ?? '', nickname: p.nickname ?? '', email: p.email ?? '', phone: p.phone ?? '' }
      }
    }
    const accounts = Object.values(accountMap)
    const full = st.players.length >= MAX_PLAYERS

    return (
      <div>
        {sectionLabel(`PLAYERS · ${st.players.length}`)}
        {st.players.map((p, idx) => renderPlayerCard(p, idx))}

        {sectionLabel('ADD PLAYERS', { margin: '18px 0 10px' })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {/* 1 — existing account holder */}
          <button onClick={() => !full && patch({ showAccountPicker: !st.showAccountPicker })} disabled={full} style={addOption(st.showAccountPicker, full)}>
            <span style={addOptionIcon}>👤</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={addOptionTitle}>Add player</span>
              <span style={addOptionSub}>Someone who already has an account</span>
            </span>
            <span style={{ color: ACCENT, fontSize: 22, fontWeight: 800, flex: '0 0 auto' }}>{st.showAccountPicker ? '×' : '+'}</span>
          </button>
          {st.showAccountPicker && (
            <div style={{ background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: accounts.length ? 6 : 14 }}>
              {accounts.length === 0 ? (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', lineHeight: 1.5 }}>
                  No saved players yet. People you finish rounds with show up here, or add a verified player below.
                </div>
              ) : (
                accounts.map((a) => (
                  <button key={a.key} onClick={() => addAccount(a)} disabled={full} style={accountRow}>
                    <span style={{ width: 32, height: 32, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.18)' }}>{initial(a.name || a.email)}</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || a.email || a.phone}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.email || a.phone}</span>
                    </span>
                    <span style={{ color: ACCENT, fontSize: 18, fontWeight: 800, flex: '0 0 auto' }}>+</span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* 2 — verified player entered manually */}
          <button onClick={() => !full && addVerifiedPlayer()} disabled={full} style={addOption(false, full)}>
            <span style={addOptionIcon}>🙋</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={addOptionTitle}>Add verified player</span>
              <span style={addOptionSub}>Enter a name before starting</span>
            </span>
            <span style={{ color: ACCENT, fontSize: 22, fontWeight: 800, flex: '0 0 auto' }}>+</span>
          </button>
        </div>
        {full && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 8, textAlign: 'center' }}>Up to {MAX_PLAYERS} players per round.</div>}
      </div>
    )
  }

  function renderPlayerCard(p, idx) {
    const isOrganizer = idx === 0
    const kind = isOrganizer ? 'you' : 'account'
    const ready = isReady(p, idx)
    const badge = { you: { t: 'YOU', c: ACCENT }, account: { t: 'VERIFIED', c: '#60a5fa' } }[kind]
    return (
      <div key={p.id} style={{ background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${ready ? 'rgba(255,255,255,.12)' : 'rgba(251,113,133,.6)'}`, borderRadius: 18, padding: 12, marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#fff', background: p.color, boxShadow: '0 0 0 2px rgba(255,255,255,.2)' }}>{initial(p)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <input value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} placeholder={isOrganizer ? 'Your name' : 'Player name'} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 17, fontWeight: 700, fontFamily: 'inherit', padding: 0 }} />
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: badge.c, border: `1px solid ${hexA(badge.c, 0.5)}`, background: hexA(badge.c, 0.14), borderRadius: 6, padding: '2px 6px', flex: '0 0 auto' }}>{badge.t}</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>Handicap index</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: '0 0 auto' }}>
            <button onClick={() => incHdcp(p.id, -1)} style={stepBtn}>−</button>
            <span style={{ minWidth: 26, textAlign: 'center', fontSize: 17, fontWeight: 800, color: '#fff' }}>{p.hdcp}</span>
            <button onClick={() => incHdcp(p.id, 1)} style={stepBtn}>+</button>
          </div>
          {!isOrganizer && (
            <button onClick={() => removePlayer(p.id)} aria-label="Remove player" style={{ width: 30, height: 30, borderRadius: '50%', flex: '0 0 auto', background: 'transparent', border: 'none', color: 'rgba(255,255,255,.42)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
          <input value={p.nickname} onChange={(e) => updatePlayer(p.id, { nickname: e.target.value })} placeholder="@handle" autoCapitalize="none" autoCorrect="off" style={{ ...playerField, flex: 1 }} />
          <input value={p.email} onChange={(e) => updatePlayer(p.id, { email: e.target.value })} placeholder="Email (optional)" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" style={{ ...playerField, flex: 1.4 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <input value={p.phone} onChange={(e) => updatePlayer(p.id, { phone: e.target.value })} placeholder="Phone (optional)" type="tel" inputMode="tel" style={{ ...playerField, flex: 1 }} />
          {!p.name?.trim() && <span style={{ fontSize: 11, fontWeight: 700, color: '#fb7185', flex: '0 0 auto' }}>Name required</span>}
        </div>

        {isScramble && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.5)' }}>Team</span>
            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
              {['A', 'B'].map((t) => {
                const sel = p.team === t
                return (
                  <button key={t} onClick={() => updatePlayer(p.id, { team: t })} style={{ minHeight: 36, padding: '0 14px', borderRadius: 10, border: `1px solid ${sel ? ACCENT : 'rgba(255,255,255,.14)'}`, cursor: 'pointer', fontSize: 13, fontWeight: 800, background: sel ? ACCENT : 'transparent', color: sel ? ACCENT_DARK : 'rgba(255,255,255,.7)' }}>Team {t}</button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderFormat() {
    return (
      <div>
        {sectionLabel('SCORING FORMAT')}
        {FORMATS.map((f) => {
          const sel = f.id === st.format
          return (
            <button key={f.id} onClick={() => patch({ format: f.id })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${sel ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)'}`, borderRadius: 16, padding: 15, marginBottom: 10, cursor: 'pointer' }}>
              <span style={{ width: 22, height: 22, borderRadius: '50%', flex: '0 0 auto', border: `2px solid ${sel ? ACCENT : 'rgba(255,255,255,.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ width: 11, height: 11, borderRadius: '50%', background: sel ? ACCENT : 'transparent' }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{f.label}</div>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 2, lineHeight: 1.4 }}>{f.desc}</div>
              </div>
            </button>
          )
        })}

        {sectionLabel('HANDICAPPING', { margin: '20px 0 10px' })}
        <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: 5 }}>
          {[{ id: 'net', label: 'Net' }, { id: 'gross', label: 'Gross' }].map((o) => {
            const sel = o.id === st.scoring
            return (
              <button key={o.id} onClick={() => patch({ scoring: o.id })} style={{ flex: 1, padding: 13, borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, background: sel ? ACCENT : 'transparent', color: sel ? ACCENT_DARK : 'rgba(255,255,255,.6)' }}>{o.label}</button>
            )
          })}
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', marginTop: 10, lineHeight: 1.5 }}>
          {st.scoring === 'net'
            ? 'Strokes are adjusted by each player’s handicap before they count.'
            : 'Raw strokes only — no handicap strokes are applied.'}
        </div>
      </div>
    )
  }

  function renderGames() {
    const totalStake = activeGames.reduce((sum, d) => sum + baseAmount(d, st.bets[d.key]), 0)
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, background: hexA(ACCENT, 0.1), border: `1px solid ${hexA(ACCENT, 0.3)}`, borderRadius: 14, padding: '11px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{activeGames.length} {activeGames.length === 1 ? 'game on' : 'games on'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: ACCENT }}>${totalStake} in play</span>
        </div>

        {GAME_DEFS.map((d) => {
          const b = st.bets[d.key]
          const locked = d.requiresExactly != null && st.players.length !== d.requiresExactly
          const wolfLocked = d.key === 'wolf' && st.players.length !== 4
          const gameLocked = locked || wolfLocked
          const selCount = selectedCount(d)
          return (
            <div key={d.key} style={{ background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${b.on && !gameLocked ? hexA(ACCENT, 0.4) : 'rgba(255,255,255,.12)'}`, borderRadius: 20, padding: 14, marginBottom: 12, boxShadow: '0 8px 24px rgba(0,0,0,.28)', opacity: gameLocked ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 42, height: 42, borderRadius: 13, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' }}>
                  {d.iconName ? <Icon name={d.iconName} size={22} color={b.on && !gameLocked ? ACCENT : 'rgba(255,255,255,.7)'} /> : d.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{d.title}</div>
                  {wolfLocked ? (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#fb923c', marginTop: 2 }}>Needs exactly 4 players</div>
                  ) : (
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>{locked ? `Needs exactly ${d.requiresExactly} players` : d.desc}</div>
                  )}
                </div>
                <button
                  onClick={() => !gameLocked && setBet(d.key, { on: !b.on })}
                  disabled={gameLocked}
                  aria-pressed={!!b.on}
                  style={{ width: 50, height: 30, borderRadius: 9999, border: 'none', cursor: gameLocked ? 'not-allowed' : 'pointer', flex: '0 0 auto', position: 'relative', background: b.on && !gameLocked ? ACCENT : 'rgba(255,255,255,.18)' }}
                >
                  <span style={{ position: 'absolute', top: 3, left: b.on ? 23 : 3, width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.4)', transition: 'left .15s' }} />
                </button>
              </div>

              {b.on && !gameLocked && (d.key === 'skins' ? renderSkinsConfig(b, selCount) : (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', flexDirection: 'column', gap: 15 }}>
                  {/* stake */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)' }}>STAKE</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <button onClick={() => stepStake(d.key, -1)} style={bigStepBtn}>−</button>
                      <span style={{ minWidth: 96, textAlign: 'center', fontSize: 18, fontWeight: 800, color: '#fff' }}>${b.stake} <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>{d.unit}</span></span>
                      <button onClick={() => stepStake(d.key, 1)} style={{ ...bigStepBtn, background: ACCENT, border: 'none', color: ACCENT_DARK }}>+</button>
                    </div>
                  </div>

                  {/* who's in */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)' }}>WHO'S IN</span>
                      {d.requiresExactly != null && selCount !== d.requiresExactly ? (
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#fb7185' }}>Pick exactly {d.requiresExactly}</span>
                      ) : selCount < 2 && (
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#fb7185' }}>Pick at least 2</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {st.players.map((p) => {
                        const inSel = b.who.includes(p.id)
                        return (
                          <button key={p.id} onClick={() => toggleWho(d.key, p.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px 6px 6px', borderRadius: 9999, cursor: 'pointer', background: inSel ? hexA(p.color, 0.22) : 'rgba(255,255,255,.05)', border: `1px solid ${inSel ? hexA(p.color, 0.7) : 'rgba(255,255,255,.14)'}` }}>
                            <span style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', background: p.color }}>{initial(p)}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, color: inSel ? '#fff' : 'rgba(255,255,255,.5)' }}>{displayName(p) || 'New'}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* rule toggles */}
                  {d.toggles.map((t) => {
                    const on = !!b[t.key]
                    return (
                      <div key={t.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.82)' }}>{t.label}</span>
                        <button onClick={() => setBet(d.key, { [t.key]: !on })} aria-pressed={!!on} style={{ width: 46, height: 27, borderRadius: 9999, border: 'none', cursor: 'pointer', flex: '0 0 auto', position: 'relative', background: on ? ACCENT : 'rgba(255,255,255,.18)' }}>
                          <span style={{ position: 'absolute', top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.4)', transition: 'left .15s' }} />
                        </button>
                      </div>
                    )
                  })}

                  {/* selects */}
                  {d.selects.map((sel) => {
                    const ctpNineHoleSelect = d.key === 'ctp' && sel.key === 'holes' && st.holes === 9
                    const options = ctpNineHoleSelect ? ['All par 3s'] : sel.options
                    const selectedValue = ctpNineHoleSelect ? 0 : b[sel.key]
                    return (
                      <div key={sel.key}>
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)', marginBottom: 9 }}>{sel.label.toUpperCase()}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {options.map((o, i) => {
                            const s = optStyle(selectedValue === i)
                            return (
                              <button key={o} onClick={() => setBet(d.key, { [sel.key]: i })} style={{ padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>{o}</button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  // The detailed Skins setup panel (replaces the generic game config block).
  function renderSkinsConfig(b, selCount) {
    const sel = skins.selectedSkins
    const perHole = perHoleSkinValue(sel, skins.baseSkinValue)
    const nContrib = [sel.standardSkin, sel.birdieBonusSkin, sel.eagleBonusSkin, sel.custom1.enabled, sel.custom2.enabled].filter(Boolean).length
    const sidePots = [sel.greenie && 'Greenie', sel.sandie && 'Sandie'].filter(Boolean)

    const renderCustomSkin = (slot, label) => {
      const c = sel[slot]
      return (
        <div style={{ background: 'rgba(255,255,255,.04)', border: `1px solid ${c.enabled ? hexA(ACCENT, 0.35) : 'rgba(255,255,255,.12)'}`, borderRadius: 12, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: c.enabled ? '#fff' : 'rgba(255,255,255,.6)' }}>{label}</span>
            <button onClick={() => setCustomSkin(slot, { enabled: !c.enabled })} aria-pressed={!!c.enabled} style={miniToggle(c.enabled)}>
              <span style={miniKnob(c.enabled)} />
            </button>
          </div>
          {c.enabled && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input value={c.name} onChange={(e) => setCustomSkin(slot, { name: e.target.value })} placeholder="Name this skin… (e.g. Bingo)" style={{ ...playerField, minHeight: 42 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 10, padding: 4, flex: '0 0 auto' }}>
                  {[['dollar', '$'], ['multiplier', '×']].map(([m, lbl]) => {
                    const on = c.mode === m
                    return <button key={m} onClick={() => setCustomSkin(slot, { mode: m })} style={{ minWidth: 38, padding: '7px 0', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 800, background: on ? ACCENT : 'transparent', color: on ? ACCENT_DARK : 'rgba(255,255,255,.6)' }}>{lbl}</button>
                  })}
                </div>
                <input type="number" inputMode="numeric" min={0} value={c.value} onChange={(e) => setCustomSkin(slot, { value: Number(e.target.value) })} aria-label={`${label} value`} style={{ ...playerField, width: 84, minHeight: 42, textAlign: 'center' }} />
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>{c.mode === 'multiplier' ? `= $${resolveCustomSkin(c, skins.baseSkinValue)}` : 'per skin'}</span>
              </div>
            </div>
          )}
        </div>
      )
    }

    return (
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.1)', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* per-skin value */}
        <div>
          <div style={skinSectionLabel}>PER-SKIN VALUE</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SKIN_PRESETS.map((p) => (
              <button key={p} onClick={() => setSkinBasePreset(p)} style={skinChip(skins.basePreset === String(p))}>${p}</button>
            ))}
            <button onClick={() => setSkinBasePreset('custom')} style={skinChip(skins.basePreset === 'custom')}>Custom</button>
          </div>
          {skins.basePreset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>$</span>
              <input type="number" inputMode="numeric" min={1} value={skins.baseSkinValue} onChange={(e) => setSkinBaseValue(e.target.value)} aria-label="Custom per-skin value" style={{ ...playerField, width: 110, minHeight: 44, fontSize: 15 }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>per skin</span>
            </div>
          )}
        </div>

        {/* live per-hole preview */}
        <div style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT, background: hexA(ACCENT, 0.1), border: `1px solid ${hexA(ACCENT, 0.3)}`, borderRadius: 12, padding: '10px 12px', lineHeight: 1.45 }}>
          Each hole is worth up to ${perHole} in skins{nContrib > 0 ? ` · ${nContrib} skin${nContrib !== 1 ? 's' : ''}` : ''}
          {sidePots.length > 0 && <span style={{ display: 'block', fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>plus {sidePots.join(' & ')} — ${skins.baseSkinValue} each, flagged live &amp; stacking</span>}
        </div>

        {/* scoring */}
        <div>
          <div style={skinSectionLabel}>SCORING</div>
          <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 5 }}>
            {[{ id: 'net', label: 'Net' }, { id: 'gross', label: 'Gross' }].map((o) => {
              const on = skins.scoring === o.id
              return <button key={o.id} onClick={() => setBet('skins', { scoring: o.id })} style={{ flex: 1, padding: 11, borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 800, background: on ? ACCENT : 'transparent', color: on ? ACCENT_DARK : 'rgba(255,255,255,.6)' }}>{o.label}</button>
            })}
          </div>
        </div>

        {/* skin types */}
        <div>
          <div style={skinSectionLabel}>SKIN TYPES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SKIN_TYPES.map((t) => {
              const on = !!sel[t.key]
              return (
                <button key={t.key} onClick={() => setSkinType(t.key, !on)} style={skinCard(on)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{t.name}</span>
                      <span style={skinTypeTag(on)}>{t.tag}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.55)', marginTop: 2, lineHeight: 1.4 }}>{t.desc}</div>
                  </div>
                  <span style={skinCheck(on)}>{on ? '✓' : ''}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* custom skins */}
        <div>
          <div style={skinSectionLabel}>CUSTOM SKINS</div>
          {renderCustomSkin('custom1', 'Custom skin 1')}
          {renderCustomSkin('custom2', 'Custom skin 2')}
        </div>

        {/* who's in */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
            <span style={skinSectionLabel}>WHO'S IN</span>
            {selCount < 2 && <span style={{ fontSize: 11, fontWeight: 800, color: '#fb7185' }}>Pick at least 2</span>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {st.players.map((p) => {
              const inSel = b.who.includes(p.id)
              return (
                <button key={p.id} onClick={() => toggleWho('skins', p.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 13px 6px 6px', borderRadius: 9999, cursor: 'pointer', background: inSel ? hexA(p.color, 0.22) : 'rgba(255,255,255,.05)', border: `1px solid ${inSel ? hexA(p.color, 0.7) : 'rgba(255,255,255,.14)'}` }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', background: p.color }}>{initial(p)}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: inSel ? '#fff' : 'rgba(255,255,255,.5)' }}>{displayName(p) || 'New'}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* save as default */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,.82)' }}>Save as my default for future rounds</span>
          <button onClick={() => setBet('skins', { savedAsDefault: !skins.savedAsDefault })} aria-pressed={!!skins.savedAsDefault} style={miniToggle(skins.savedAsDefault)}>
            <span style={miniKnob(skins.savedAsDefault)} />
          </button>
        </div>
      </div>
    )
  }

  function renderReview() {
    const reviewLines = [
      { label: 'COURSE', value: course.name, sub: course.loc },
      { label: 'TEES', value: `${tee.name} tees`, sub: `${comma(tee.yards)} yds · Par ${tee.par}` },
      { label: 'FORMAT', value: FORMATS.find((f) => f.id === st.format).label, sub: `${st.scoring === 'net' ? 'Net' : 'Gross'} scoring` },
      { label: 'HOLES', value: `${st.holes} holes`, sub: new Date(st.date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) },
    ]
    return (
      <div>
        <div style={{ background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 20, padding: '2px 16px', marginBottom: 18 }}>
          {reviewLines.map((r, i) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,.09)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)' }}>{r.label}</span>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{r.value}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>{r.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {sectionLabel('PLAYERS')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {readyPlayers.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 9999, padding: '6px 13px 6px 6px' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff', background: p.color }}>{initial(p)}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>{displayName(p)}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>H{p.hdcp}{isScramble ? ` · ${p.team}` : ''}</span>
            </div>
          ))}
        </div>

        {sectionLabel('GAMES')}
        {activeGames.length > 0 ? (
          activeGames.map((d) => {
            const b = st.bets[d.key]
            const n = b.who.filter((x) => ids.includes(x)).length
            return (
              <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: '13px 14px', marginBottom: 10 }}>
                <span style={{ fontSize: 20, flex: '0 0 auto', display: 'flex' }}>{d.iconName ? <Icon name={d.iconName} size={20} color={ACCENT} /> : d.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>{n} players in</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 800, color: ACCENT, flex: '0 0 auto' }}>${baseAmount(d, b)} {d.unit}</span>
              </div>
            )
          })
        ) : (
          <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.5)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 16, padding: 14 }}>No games on — just keeping score.</div>
        )}

        {historyCount > 0 && (
          <button onClick={() => navigate('/history')} style={{ marginTop: 16, width: '100%', minHeight: 44, borderRadius: 12, background: 'transparent', border: 'none', color: 'rgba(255,255,255,.55)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>View past rounds ({historyCount})</button>
        )}
      </div>
    )
  }

  function renderOverlay() {
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={() => patch({ started: false })} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)' }} />
        <div style={{ position: 'relative', background: 'rgba(16,22,18,.94)', backdropFilter: 'blur(26px)', WebkitBackdropFilter: 'blur(26px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 24, padding: '26px 24px', width: '100%', maxWidth: 360, boxShadow: '0 30px 60px rgba(0,0,0,.5)', textAlign: 'center' }}>
          <div style={{ width: 66, height: 66, borderRadius: '50%', margin: '0 auto 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 800, color: ACCENT_DARK, background: ACCENT, boxShadow: `0 8px 24px ${hexA(ACCENT, 0.45)}` }}>✓</div>
          <div style={{ fontSize: 23, fontWeight: 800, color: '#fff', letterSpacing: '-0.3px' }}>You're all set</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.62)', marginTop: 8, lineHeight: 1.5 }}>{course.name} · {tee.name} tees · {readyPlayers.length} players</div>
          <button onClick={() => navigate('/scoring')} style={{ marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 54, borderRadius: 16, background: ACCENT, color: ACCENT_DARK, fontSize: 16, fontWeight: 800, border: 'none', cursor: 'pointer', boxShadow: `0 8px 22px ${hexA(ACCENT, 0.45)}` }}>Start scoring →</button>
          <button onClick={() => patch({ started: false })} style={{ marginTop: 9, width: '100%', minHeight: 48, borderRadius: 14, background: 'transparent', border: 'none', fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)', cursor: 'pointer' }}>Back to setup</button>
        </div>
      </div>
    )
  }
}

/* ------------------------------------------------------------- shared styles */

const stepBtn = {
  width: 38, height: 38, borderRadius: 10, background: 'rgba(255,255,255,.1)',
  border: '1px solid rgba(255,255,255,.16)', color: '#fff', fontSize: 20, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

const playerField = {
  minWidth: 0, minHeight: 40, borderRadius: 10, background: 'rgba(255,255,255,.06)',
  border: '1px solid rgba(255,255,255,.14)', color: '#fff', fontSize: 13.5, fontWeight: 600,
  fontFamily: 'inherit', padding: '0 11px', outline: 'none',
}

const bigStepBtn = {
  width: 40, height: 40, borderRadius: 11, background: 'rgba(255,255,255,.1)',
  border: '1px solid rgba(255,255,255,.16)', color: '#fff', fontSize: 22, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}

/* "Add players" options on the Players step */
const addOption = (active, disabled) => ({
  width: '100%', display: 'flex', alignItems: 'center', gap: 12, minHeight: 60,
  borderRadius: 16, padding: '0 14px', cursor: disabled ? 'not-allowed' : 'pointer',
  background: active ? hexA(ACCENT, 0.12) : 'rgba(255,255,255,.05)',
  border: `1px solid ${active ? hexA(ACCENT, 0.45) : 'rgba(255,255,255,.14)'}`,
  opacity: disabled ? 0.5 : 1,
})

const addOptionIcon = {
  width: 38, height: 38, borderRadius: 11, flex: '0 0 auto', display: 'flex',
  alignItems: 'center', justifyContent: 'center', fontSize: 19,
  background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)',
}
const addOptionTitle = { display: 'block', fontSize: 15, fontWeight: 800, color: '#fff', textAlign: 'left' }
const addOptionSub = { display: 'block', fontSize: 12, color: 'rgba(255,255,255,.5)', marginTop: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

const accountRow = {
  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px',
  borderRadius: 10, background: 'transparent', border: 'none', cursor: 'pointer',
}

/* Skins config panel */
const skinSectionLabel = { fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)', marginBottom: 9 }

const skinChip = (sel) => ({
  minWidth: 52, padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 800,
  background: sel ? ACCENT : 'rgba(255,255,255,.06)', border: `1px solid ${sel ? ACCENT : 'rgba(255,255,255,.14)'}`,
  color: sel ? ACCENT_DARK : 'rgba(255,255,255,.7)',
})

const skinCard = (on) => ({
  width: '100%', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer',
  background: on ? hexA(ACCENT, 0.1) : 'rgba(255,255,255,.04)',
  border: `1px solid ${on ? hexA(ACCENT, 0.45) : 'rgba(255,255,255,.12)'}`,
  borderRadius: 14, padding: '11px 13px',
})

const skinTypeTag = (on) => ({
  fontSize: 9.5, fontWeight: 800, letterSpacing: 0.6, flex: '0 0 auto', borderRadius: 6, padding: '2px 6px',
  color: on ? ACCENT : 'rgba(255,255,255,.5)',
  border: `1px solid ${on ? hexA(ACCENT, 0.5) : 'rgba(255,255,255,.2)'}`,
  background: on ? hexA(ACCENT, 0.14) : 'transparent',
})

const skinCheck = (on) => ({
  width: 24, height: 24, borderRadius: 7, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: `2px solid ${on ? ACCENT : 'rgba(255,255,255,.3)'}`, background: on ? ACCENT : 'transparent',
  color: ACCENT_DARK, fontSize: 14, fontWeight: 800,
})

const miniToggle = (on) => ({
  width: 46, height: 27, borderRadius: 9999, border: 'none', cursor: 'pointer', flex: '0 0 auto',
  position: 'relative', background: on ? ACCENT : 'rgba(255,255,255,.18)',
})
const miniKnob = (on) => ({
  position: 'absolute', top: 3, left: on ? 22 : 3, width: 21, height: 21, borderRadius: '50%',
  background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.4)', transition: 'left .15s',
})
