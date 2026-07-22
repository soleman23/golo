import { hexA } from '../lib/colors'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import useProfileStore from '../store/profileStore'
import useAuthStore from '../store/authStore'
import useLiveRoundStore from '../store/liveRoundStore'
import { calculateCourseHandicap, clampHandicapIndex } from '../engines/handicap'
import { hasContact, displayName, playerKey } from '../lib/identity'
import { fetchCourses } from '../lib/db/courses'
import { searchVerifiedPlayers, fetchPlayerContact } from '../lib/db/players'
import { searchNcrdbCourses, getNcrdbTees } from '../lib/ncrdb'
import { getHoleData } from '../lib/golfCourseApi'
import {
  holeCardFromTees,
  yardageMapFromCourseTee,
  yardageMapFromTees,
} from '../lib/scorecardData'
import { courseFromNcrdb } from '../lib/courseValidation'
import { getCourseImage } from '../lib/courseImages'
import { defaultHomeCourse, matchCourseInCatalog } from '../lib/homeCourse'
import {
  GEO_STATUS,
  getDevicePosition,
  readCachedGeo,
  writeCachedGeo,
} from '../lib/geolocation'
import { reverseGeocode, forwardGeocode } from '../lib/reverseGeocode'
import {
  sortCoursesByDistance,
  dedupeNcrdbAgainstCatalog,
  courseDistanceLabel,
  enrichRegionWithCatalog,
  ncrdbHitMatchesRegion,
  sortNcrdbHitsByRegion,
  buildNearbySearchQueries,
} from '../lib/nearbyCourses'
import { normalizeSkinsLdHole, resolveLdHoleNumber } from '../engines/skins'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { serializeRoundState, ensureLiveScorerAccess, liveRoundUserMessage } from '../lib/db/liveRounds'
import { teardownLiveSync } from '../lib/liveRoundSync'
import useNotificationStore from '../store/notificationStore'
import AppHeader from '../components/shared/AppHeader'
import { Icon } from '../components/shared/GoloIcons'

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
  { id: 'pinehurst', name: 'Pinehurst No.2', loc: 'Pinehurst, NC', holes: 18, bg: '/courses/course.png', latitude: 35.1856, longitude: -79.4663 },
  { id: 'harbor', name: 'Harbor Dunes', loc: 'Pawleys Island, SC', holes: 18, bg: '/courses/sunset.png', latitude: 33.4228, longitude: -79.0956 },
  { id: 'lincoln', name: 'Lincoln Park', loc: 'San Francisco, CA', holes: 18, bg: '/courses/turf.png', latitude: 37.7849, longitude: -122.4994 },
  {
    id: 'tetherow', name: 'Tetherow', loc: 'Bend, OR', holes: 18, bg: '/courses/tetherow.jpg',
    latitude: 44.0215, longitude: -121.3165,
    pars: TETHEROW_PARS, strokeIndex: TETHEROW_SI, tees: TETHEROW_TEES,
  },
  {
    id: 'losttracks', name: 'Lost Tracks Golf Course', loc: 'Bend, OR', holes: 18, bg: '/courses/losttracks.webp',
    latitude: 44.0245, longitude: -121.2789,
    pars: LOSTTRACKS_PARS, strokeIndex: LOSTTRACKS_SI, tees: LOSTTRACKS_TEES,
  },
]

// Courses surfaced on the setup picker, in display order. The rest stay defined
// for data lookup (by id) but are hidden from the list until admin tooling
// lets us manage the catalogue.
const VISIBLE_COURSE_IDS = ['tetherow', 'losttracks', 'pinehurst']
const COURSE_PAGE_SIZE = 5

const ncrdbValue = (course, ...keys) => {
  for (const key of keys) {
    const value = course?.[key]
    if (value != null && String(value).trim()) return value
  }
  return null
}

const ncrdbCourseId = (course) => ncrdbValue(course, 'courseID', 'courseId', 'CourseID')
const ncrdbFacilityId = (course) => ncrdbValue(course, 'facilityID', 'facilityId', 'FacilityID')
const ncrdbCourseName = (course) =>
  String(ncrdbValue(course, 'fullName', 'courseName', 'clubName', 'name') ?? '').trim()
const ncrdbCourseLocation = (course) =>
  [
    ncrdbValue(course, 'city', 'clubCity', 'City'),
    ncrdbValue(course, 'stateDisplay', 'state', 'clubState', 'State'),
  ].filter(Boolean).join(', ')

const normalizedNcrdbCourse = (course) => ({
  ...course,
  fullName: ncrdbCourseName(course),
  courseID: ncrdbCourseId(course),
  facilityID: ncrdbFacilityId(course),
  city: ncrdbValue(course, 'city', 'clubCity', 'City') ?? '',
  stateDisplay: ncrdbValue(course, 'stateDisplay', 'state', 'clubState', 'State') ?? '',
})

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
    // valuePerSkin is for Standard Skins only. Bonus/manual skin types settle from
    // skinsConfig.baseSkinValue so they can be enabled independently.
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
    desc: 'Longest drive in the fairway on a par 5.', unit: 'pot',
    toggles: [],
    selects: [{ key: 'hole', label: 'Par 5 hole', options: [] }],
    toConfig: (b, who, ctx) => ({
      amount: b.stake,
      hole: ctx.par5Holes.includes(b.hole) ? b.hole : (ctx.par5Holes[0] ?? null),
    }),
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

const comma = (n) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
/** Avatar initial from a player's best label (name → handle → email). */
const initial = (p) => {
  const t = (typeof p === 'string' ? p : displayName(p)).trim()
  return t ? t.charAt(0).toUpperCase() : '?'
}
const today = () => new Date().toISOString().slice(0, 10)

/** Saved-round identities with contact — the "has an account" directory. */
function buildAccountDirectory(rounds, inRound) {
  const map = {}
  for (const r of rounds) {
    for (const p of r.players ?? []) {
      if (!hasContact(p)) continue
      const k = playerKey(p)
      if (!k || inRound.has(k) || map[k]) continue
      map[k] = { key: k, name: p.name ?? '', nickname: p.nickname ?? '', email: p.email ?? '', phone: p.phone ?? '' }
    }
  }
  return Object.values(map)
}

/** Everyone you've shared a round with (crew), newest contact info wins. */
function buildCrewRoster(rounds, inRound) {
  const map = {}
  for (const r of rounds) {
    for (const p of r.players ?? []) {
      const k = playerKey(p)
      if (!k || inRound.has(k)) continue
      if (!map[k]) {
        map[k] = {
          key: k,
          name: p.name ?? '',
          nickname: p.nickname ?? '',
          email: p.email ?? '',
          phone: p.phone ?? '',
          rounds: 0,
        }
      }
      map[k].rounds += 1
    }
  }
  return Object.values(map).sort((a, b) => b.rounds - a.rounds)
}

/**
 * Merge local history picks with server search hits; first wins per identity.
 * Server search rows carry no raw contact, so they're deduped by `u:<userId>`
 * (which `inRound` also includes for already-added account players); local
 * history rows dedupe by their real e:/p: key.
 */
function mergePlayerPickers(local, remote, inRound) {
  const map = new Map()
  for (const a of [...local, ...remote]) {
    const k = a.userId ? `u:${a.userId}` : (a.key ?? playerKey(a))
    if (!k || inRound.has(k)) continue
    if (!map.has(k)) map.set(k, a)
  }
  return [...map.values()]
}

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
// base per-skin value, a Net/Gross choice, automatic bonus skins, and manual
// Greenie/Sandie/CTP/LD flags.

const SKIN_PRESETS = [1, 2, 5, 10]

// The standard skin types, in display order. `base: true` means it adds the
// base value to the per-hole "up to" total (per the agreed rule: Standard +
// Birdie + Eagle count; Carryover is a modifier and Greenie/Sandie are separate
// side pots).
const SKIN_TYPES = [
  { key: 'standardSkin', name: 'Standard Skin', tag: 'Low score wins', desc: 'Lowest unique score on a hole wins the skin; ties carry over.', base: true },
  { key: 'carryoverSkin', name: 'Carryover Skin', tag: 'Banked skins', desc: 'A tied hole stacks the skin onto the next, growing the payout until won outright.', base: false },
  { key: 'birdieBonusSkin', name: 'Birdie Skin', tag: 'Birdie+', desc: 'Every birdie-or-better wins its own flat skin, separate from the standard low-score skin.', base: true },
  { key: 'eagleBonusSkin', name: 'Eagle Skin', tag: 'Eagle+', desc: 'Every eagle-or-better wins its own flat skin, separate from the standard low-score skin.', base: true },
  { key: 'greenie', name: 'Greenie', tag: 'Par 3s', desc: 'Par-3 CTP plus par or better. One winner; unclaimed Greenies carry to the next par 3. Cannot combine with CTP skin.', base: false },
  { key: 'sandie', name: 'Sandie', tag: 'Sand save', desc: 'Flag players who were in a bunker; each par-or-better sand save wins a flat skin.', base: false },
  { key: 'closestToPin', name: 'Closest to Pin', tag: 'Par 3s', desc: 'Nearest the flag on par 3s. Flag one winner per hole live during scoring; pays the base value head-to-head. Cannot combine with Greenie.', base: false },
  { key: 'longestDrive', name: 'Longest Drive', tag: 'Par 5', desc: 'Longest drive in the fairway on a par 5. Flag the winner live during scoring; pays the base value head-to-head.', base: false },
  { key: 'overallPurse', name: 'Overall Purse', tag: 'Match play', desc: 'Head-to-head match over the full round. Supports live presses when a side goes 2+ down.', base: false },
]

/** Fresh Skins selection (the wizard-side shape held in st.bets.skins). */
const defaultSkinsSelection = () => ({
  baseSkinValue: 1,
  overallPurseStake: 1,
  basePreset: '1', // '1' | '2' | '5' | '10' | 'custom'
  scoring: 'net', // 'net' | 'gross'
  savedAsDefault: false,
  ctpHoles: 0, // 0 = all par 3s, 1 = back 9 only
  ldHole: null, // hole number on the card (par 5 only)
  selectedSkins: {
    standardSkin: true,
    carryoverSkin: true,
    birdieBonusSkin: false,
    eagleBonusSkin: false,
    greenie: false,
    sandie: false,
    closestToPin: false,
    longestDrive: false,
    overallPurse: false,
    custom1: { enabled: false, name: '', value: 1, mode: 'dollar' }, // legacy persisted defaults only
    custom2: { enabled: false, name: '', value: 1, mode: 'dollar' },
  },
})

/** "Up to" dollars per hole: base for each of Standard/Birdie/Eagle. */
const perHoleSkinValue = (sel, base) =>
  (sel.standardSkin ? base : 0) +
  (sel.birdieBonusSkin ? base : 0) +
  (sel.eagleBonusSkin ? base : 0)

/** Any payable skin type selected (carryover alone is not valid — it's a modifier). */
const anySkinSelected = (sel) =>
  sel.standardSkin || sel.birdieBonusSkin || sel.eagleBonusSkin ||
  sel.greenie || sel.sandie || sel.closestToPin || sel.longestDrive || sel.overallPurse

/** Wizard skins state → the persisted SkinsConfig (data schema #1). */
const skinsConfigOf = (b) => ({
  enabled: true,
  baseSkinValue: b.baseSkinValue,
  overallPurseStake: b.overallPurseStake ?? b.baseSkinValue,
  scoring: b.scoring,
  ctpHoles: b.ctpHoles ?? 0,
  ldHole: b.ldHole ?? null,
  selectedSkins: {
    standardSkin: !!b.selectedSkins.standardSkin,
    carryoverSkin: !!b.selectedSkins.carryoverSkin,
    birdieBonusSkin: !!b.selectedSkins.birdieBonusSkin,
    eagleBonusSkin: !!b.selectedSkins.eagleBonusSkin,
    greenie: !!b.selectedSkins.greenie,
    sandie: !!b.selectedSkins.sandie,
    closestToPin: !!b.selectedSkins.closestToPin,
    longestDrive: !!b.selectedSkins.longestDrive,
    overallPurse: !!b.selectedSkins.overallPurse,
    custom1: { ...b.selectedSkins.custom1 },
    custom2: { ...b.selectedSkins.custom2 },
  },
  perHoleSkinValue: perHoleSkinValue(b.selectedSkins, b.baseSkinValue),
  savedAsDefault: !!b.savedAsDefault,
})

/** Re-resolve longest-drive holes against the current course card when each bet is active. */
const betsWithNormalizedLdHole = (bets, pars) => ({
  ...bets,
  skins: {
    ...bets.skins,
    ldHole: bets.skins.selectedSkins?.longestDrive
      ? normalizeSkinsLdHole(bets.skins.ldHole, pars)
      : bets.skins.ldHole,
  },
  long: bets.long?.on
    ? { ...bets.long, hole: normalizeSkinsLdHole(bets.long.hole, pars) }
    : bets.long,
})

/** Persisted SkinsConfig (or saved default) → the wizard skins selection shape. */
const skinsSelectionFrom = (c) => {
  const base = defaultSkinsSelection()
  if (!c) return base
  const s = c.selectedSkins ?? {}
  const greenie = !!s.greenie
  const closestToPin = !!s.closestToPin && !greenie
  return {
    baseSkinValue: c.baseSkinValue ?? base.baseSkinValue,
    overallPurseStake: c.overallPurseStake ?? c.baseSkinValue ?? base.overallPurseStake,
    basePreset: SKIN_PRESETS.includes(c.baseSkinValue) ? String(c.baseSkinValue) : 'custom',
    scoring: c.scoring ?? base.scoring,
    savedAsDefault: !!c.savedAsDefault,
    ctpHoles: c.ctpHoles ?? base.ctpHoles,
    ldHole: c.ldHole ?? base.ldHole,
    selectedSkins: {
      standardSkin: !!s.standardSkin,
      carryoverSkin: !!s.carryoverSkin,
      birdieBonusSkin: !!s.birdieBonusSkin,
      eagleBonusSkin: !!s.eagleBonusSkin,
      greenie,
      sandie: !!s.sandie,
      closestToPin,
      longestDrive: !!s.longestDrive,
      overallPurse: !!s.overallPurse,
      custom1: { ...base.selectedSkins.custom1, ...(s.custom1 ?? {}) },
      custom2: { ...base.selectedSkins.custom2, ...(s.custom2 ?? {}) },
    },
  }
}

/** Course card for wizard state — saved round card, course-specific card, or generic. */
function cardForCourse(course, holes, roundPars, roundStrokeIndex) {
  if (roundPars || roundStrokeIndex) return defaultCard(holes, roundPars, roundStrokeIndex)
  if (course?.pars || course?.strokeIndex) {
    return defaultCard(holes, course.pars, course.strokeIndex)
  }
  return defaultCard(holes)
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

  const profile = useProfileStore.getState()
  const historyRounds = useHistoryStore.getState().rounds
  const homeCourse = defaultHomeCourse(COURSES, {
    homeClub: profile.homeClub,
    rounds: historyRounds,
  })
  const initialCourse = courseMatch ?? homeCourse ?? COURSES.find((c) => c.id === 'pinehurst') ?? COURSES[0]
  const card = courseMatch
    ? defaultCard(holes, round?.pars, round?.strokeIndex)
    : cardForCourse(initialCourse, holes)

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
      guest: !!p.guest,
      color: p.color?.startsWith?.('#') ? p.color : PALETTE[i % PALETTE.length],
      team: storedTeams?.length ? teamOf(p.id) : i % 2 === 0 ? 'A' : 'B',
    }))
  } else {
    // Fresh round: the only player carried over is "you" — the organizer, always
    // the first card. Everyone else is added explicitly below and must carry a
    // verified contact before the round can start.
    const me = profile
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
  const skinsFromSaved = skinsSelectionFrom(savedSkins?.config?.skinsConfig ?? profile.skinsDefault)
  const skinsBet = {
    on: !!savedSkins,
    who: savedSkins?.playerIds?.length ? savedSkins.playerIds.filter((x) => ids.includes(x)) : ids.slice(),
    ...skinsFromSaved,
    ldHole: skinsFromSaved.selectedSkins?.longestDrive
      ? normalizeSkinsLdHole(skinsFromSaved.ldHole, card.pars)
      : skinsFromSaved.ldHole,
  }

  // Every game starts untoggled (the bet() helper returns on:false for a fresh
  // round) with a $1 stake. Saved bets re-seed their own amount on back-nav.
  const bets = {
    skins: skinsBet,
    nassau: bet('nassau', { stake: 1, press: false }),
    purse: bet('strokePurse', { stake: 1, payout: 0 }),
    ctp: bet('ctp', { stake: 1, holes: 0 }),
    long: bet('longestDrive', { stake: 1, hole: null }),
    wolf: bet('wolf', { stake: 1 }),
    bbb: bet('bingobangobongo', { stake: 1 }),
  }

  return {
    step: 0,
    courseId: initialCourse.id,
    courseQuery: '',
    teeIdx: 1,
    holes,
    date: round?.date ?? today(),
    showCard: false,
    showAccountPicker: false,
    showCrewPicker: false,
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
  const remintRoundId = useRoundStore((s) => s.remintRoundId)
  const updateRoundSetup = useRoundStore((s) => s.updateRoundSetup)
  const setCourseConfig = useRoundStore((s) => s.setCourseConfig)
  const setPlayers = useRoundStore((s) => s.setPlayers)
  const setTeams = useRoundStore((s) => s.setTeams)
  const setBets = useRoundStore((s) => s.setBets)
  const historyCount = useHistoryStore((s) => s.rounds.length)
  // Saved rounds double as the "account directory": the people you've finished
  // rounds with (and who left a contact) are the players you can re-add.
  const historyRounds = useHistoryStore((s) => s.rounds)
  const profileHomeClub = useProfileStore((s) => s.homeClub)
  const authEnabled = useAuthStore((s) => s.enabled)
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const liveRoundsEnabled = isSupabaseConfigured && authEnabled && !!userId

  const [st, setSt] = useState(initState)
  const patch = (p) => setSt((s) => ({ ...s, ...p }))
  const userPickedCourse = useRef(false)

  // Course catalogue: starts with the bundled fallback list, then swaps in the
  // backend's visible setup catalogue once it loads (when Supabase is configured).
  // Local-only mode keeps the curated hardcoded subset below.
  const [catalog, setCatalog] = useState(COURSES)
  const [coursesFromDb, setCoursesFromDb] = useState(false)
  const [ncrdbResults, setNcrdbResults] = useState([])
  const [ncrdbResultsQuery, setNcrdbResultsQuery] = useState('')
  const [ncrdbLoading, setNcrdbLoading] = useState(false)
  const [ncrdbError, setNcrdbError] = useState('')
  const [ncrdbSelectingId, setNcrdbSelectingId] = useState(null)
  const [courseListExpanded, setCourseListExpanded] = useState(false)
  const [courseCollapsed, setCourseCollapsed] = useState(false)
  // Compatibility scorecard lookup for catalogue courses. NCRDB imports arrive
  // already enriched by the same shared resolver, so they never land here.
  const [scorecardLookup, setScorecardLookup] = useState({
    courseId: null,
    status: 'idle', // idle | loading | matched | unavailable
    teesData: null,
    enrichment: null,
  })
  // The course whose card the user hand-edited; its provenance is theirs, not
  // the provider's, so nothing may overwrite it afterwards.
  const [manualCardCourseId, setManualCardCourseId] = useState(null)
  // One lookup per course, and one card application per course/tee/hole-count —
  // both survive Strict Mode's double effect run without cancelling the request.
  const scorecardRequestRef = useRef(null)
  const scorecardGenRef = useRef(0)
  const appliedCardKeyRef = useRef(null)
  const [accountSearch, setAccountSearch] = useState('')
  const [accountSearchResults, setAccountSearchResults] = useState([])
  const [accountSearchLoading, setAccountSearchLoading] = useState(false)
  const [geoStatus, setGeoStatus] = useState(GEO_STATUS.IDLE)
  const [geoRegion, setGeoRegion] = useState(null)
  const [nearbyNcrdb, setNearbyNcrdb] = useState([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const nearbyFetchGen = useRef(0)
  const nearbyFetchedKey = useRef('')
  const nearbyRetryCount = useRef(0)
  const nearbyTimerRef = useRef(null)
  const courseIdRef = useRef(st.courseId)
  const courseQueryRef = useRef(st.courseQuery)
  const catalogRef = useRef(catalog)
  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])
  useEffect(() => {
    courseIdRef.current = st.courseId
  }, [st.courseId])
  useEffect(() => {
    courseQueryRef.current = st.courseQuery
  }, [st.courseQuery])

  const fetchNearbyNcrdb = useCallback(async (region, { force = false } = {}) => {
    async function runAttempt(targetRegion, forced) {
      if (!isSupabaseConfigured || courseQueryRef.current.trim()) return null
      const enriched = enrichRegionWithCatalog(targetRegion, catalogRef.current, COURSES)
      const city = String(enriched?.city ?? '').trim()
      const state = String(enriched?.stateCode ?? enriched?.state ?? '').trim()
      if (!city && !state && enriched?.lat == null) return null

      const key = `${city}|${state}|${catalogRef.current.length}`
      if (!forced && nearbyFetchedKey.current === key) return null

      const gen = ++nearbyFetchGen.current
      setNearbyLoading(true)

      const hits = []
      const seen = new Set()
      const addHits = (rows) => {
        for (const row of rows ?? []) {
          const id = String(row?.courseID ?? row?.courseId ?? '').trim()
          if (!id || seen.has(id)) continue
          seen.add(id)
          hits.push(row)
        }
      }

      const queries = buildNearbySearchQueries(enriched, catalogRef.current)
      const results = await Promise.all(
        queries.map((params) => searchNcrdbCourses(params).then(({ data, error }) => (error ? [] : data?.courses ?? []))),
      )
      // Superseded: leave nearbyLoading alone so the newer request still owns it.
      if (gen !== nearbyFetchGen.current) return null
      if (courseQueryRef.current.trim()) {
        setNearbyLoading(false)
        return null
      }
      for (const rows of results) addHits(rows)

      const regionalHits = sortNcrdbHitsByRegion(
        city || state ? hits.filter((hit) => ncrdbHitMatchesRegion(hit, enriched)) : hits,
        enriched,
      ).slice(0, 15)

      // First empty response is often a cold edge-function miss — auto-retry once.
      if (regionalHits.length === 0 && nearbyRetryCount.current < 1) {
        nearbyRetryCount.current += 1
        setNearbyLoading(false)
        return runAttempt(enriched, true)
      }

      setNearbyNcrdb(regionalHits)
      setNearbyLoading(false)
      // Only lock when we got results — empty must not block later auto/catalog retries.
      if (regionalHits.length > 0) nearbyFetchedKey.current = key
      return { key, count: regionalHits.length }
    }

    return runAttempt(region, force)
  }, [])

  const scheduleNearbyFetch = useCallback((region, opts = {}) => {
    if (nearbyTimerRef.current) clearTimeout(nearbyTimerRef.current)
    nearbyTimerRef.current = setTimeout(() => {
      fetchNearbyNcrdb(region, opts)
    }, 400)
  }, [fetchNearbyNcrdb])

  useEffect(() => {
    let cancelled = false

    async function resolveRegionFromCoords(lat, lng) {
      const { data, error } = await reverseGeocode(lat, lng)
      if (cancelled) return null
      if (error || !data?.city) {
        // Coords-only fallback: distance sort still works without reverse-geocode edge fn.
        return { lat, lng, city: '', state: '', stateCode: '' }
      }
      return {
        lat,
        lng,
        city: data.city,
        state: data.state,
        stateCode: data.stateCode || data.state,
      }
    }

    async function applyRegion(region) {
      const hasCoords = region?.lat != null && region?.lng != null
      const hasRegion = !!(region?.city || region?.stateCode || region?.state)
      if (cancelled || (!hasCoords && !hasRegion)) return
      const enriched = enrichRegionWithCatalog(region, catalogRef.current, COURSES)
      setGeoRegion(enriched)
      setGeoStatus(GEO_STATUS.READY)
      if (enriched.lat != null && enriched.lng != null) writeCachedGeo(enriched)
      if ((enriched.city || enriched.stateCode || enriched.state) && isSupabaseConfigured) {
        nearbyRetryCount.current = 0
        scheduleNearbyFetch(enriched)
      }
    }

    async function loadNearbyGeo() {
      setGeoStatus(GEO_STATUS.LOADING)

      const cached = readCachedGeo()
      if (cached?.lat != null && cached?.lng != null) {
        if (cached?.city && (cached?.stateCode || cached?.state)) {
          await applyRegion(cached)
          return
        }
        const region = await resolveRegionFromCoords(cached.lat, cached.lng)
        if (region) {
          await applyRegion(region)
          return
        }
      }

      try {
        const pos = await getDevicePosition()
        if (cancelled) return
        const region = await resolveRegionFromCoords(pos.lat, pos.lng)
        if (!region) return
        await applyRegion(region)
      } catch (err) {
        if (cancelled) return
        setGeoRegion(null)
        if (err?.code === 1) setGeoStatus(GEO_STATUS.DENIED)
        else setGeoStatus(GEO_STATUS.UNAVAILABLE)
      }
    }

    loadNearbyGeo()
    return () => {
      cancelled = true
      if (nearbyTimerRef.current) clearTimeout(nearbyTimerRef.current)
    }
  }, [scheduleNearbyFetch])
  useEffect(() => {
    let active = true
    fetchCourses().then((rows) => {
      if (!active || !rows || rows.length === 0) return
      const fallbackById = new Map(COURSES.map((c) => [c.id, c]))
      const next = rows.map((r) => ({ ...(fallbackById.get(r.id) ?? {}), ...r }))
      const selectedId = courseIdRef.current
      // If the current selection was filtered out of the visible catalogue,
      // keep it in the in-memory list so scoring does not silently switch.
      if (selectedId && !next.some((c) => c.id === selectedId)) {
        const preserved =
          fallbackById.get(selectedId) ??
          COURSES.find((c) => c.id === selectedId)
        if (preserved) next.push({ ...preserved })
      }
      setCatalog(next)
      setCoursesFromDb(true)
    })
    return () => { active = false }
  }, [])

  // Debounce nearby fetch when geo + catalogue settle (coalesces Strict Mode / catalog races).
  useEffect(() => {
    const hasRegion = geoRegion?.lat != null || geoRegion?.city || geoRegion?.stateCode || geoRegion?.state
    if (geoStatus !== GEO_STATUS.READY || !hasRegion) return undefined
    const enriched = enrichRegionWithCatalog(geoRegion, catalog, COURSES)
    if (!(enriched.city || enriched.stateCode || enriched.state) || !isSupabaseConfigured) return undefined
    if (!geoRegion.city || geoRegion.city !== enriched.city) {
      setGeoRegion(enriched)
      if (enriched.lat != null && enriched.lng != null) writeCachedGeo(enriched)
    }
    scheduleNearbyFetch(enriched)
    return undefined
  }, [catalog, coursesFromDb, geoStatus, geoRegion, scheduleNearbyFetch])

  useEffect(() => {
    const q = st.courseQuery.trim()
    if (!isSupabaseConfigured || q.length < 3) {
      setNcrdbResults([])
      setNcrdbResultsQuery('')
      setNcrdbLoading(false)
      setNcrdbError('')
      return undefined
    }

    let cancelled = false
    setNcrdbResults([])
    setNcrdbResultsQuery('')
    setNcrdbLoading(true)
    setNcrdbError('')
    const timer = setTimeout(async () => {
      const { data, error } = await searchNcrdbCourses({ clubName: q, clubCountry: 'USA' })
      if (cancelled) return
      setNcrdbResults(data?.courses ?? [])
      setNcrdbResultsQuery(q.toLowerCase())
      setNcrdbError(error?.message ?? '')
      setNcrdbLoading(false)
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [st.courseQuery])

  // Verified-player search for the "Add player" picker (signed-in + Supabase only).
  useEffect(() => {
    if (!st.showAccountPicker || !liveRoundsEnabled) {
      setAccountSearchResults([])
      setAccountSearchLoading(false)
      return undefined
    }
    const q = accountSearch.trim()
    if (q.length < 2) {
      setAccountSearchResults([])
      setAccountSearchLoading(false)
      return undefined
    }
    let cancelled = false
    setAccountSearchLoading(true)
    const timer = setTimeout(() => {
      searchVerifiedPlayers(q).then((rows) => {
        if (cancelled) return
        setAccountSearchResults(rows)
        setAccountSearchLoading(false)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [st.showAccountPicker, accountSearch, liveRoundsEnabled])

  // When the DB catalogue loads, default to home course if it wasn't in the bundled list.
  useEffect(() => {
    if (!coursesFromDb || userPickedCourse.current) return
    const { round } = useRoundStore.getState()
    if (round && round.status !== 'complete') return

    const profile = useProfileStore.getState()
    const historyRounds = useHistoryStore.getState().rounds
    const homeCourse = defaultHomeCourse(catalog, {
      homeClub: profile.homeClub,
      rounds: historyRounds,
    })
    if (!homeCourse) return

    setSt((s) => {
      if (s.courseId === homeCourse.id) return s
      const card = cardForCourse(homeCourse, s.holes)
      return {
        ...s,
        courseId: homeCourse.id,
        teeIdx: 1,
        pars: card.pars,
        strokeIndex: card.strokeIndex,
        bets: betsWithNormalizedLdHole(s.bets, card.pars),
      }
    })
  }, [coursesFromDb, catalog])

  // Open every step at the top of the scroll, not wherever the previous step
  // left the shared scroll container.
  const bodyRef = useRef(null)
  useEffect(() => { bodyRef.current?.scrollTo(0, 0) }, [st.step])

  /* ---- derived ---- */
  const course =
    catalog.find((c) => c.id === st.courseId) ??
    COURSES.find((c) => c.id === st.courseId) ??
    catalog[0]
  // Per-course tees when defined, else the global fallback set.
  const tees = course.tees ?? TEES
  const tee = tees[Math.min(st.teeIdx, tees.length - 1)]
  const courseHasTeeHoles = course?.tees?.some((item) => Array.isArray(item?.holes))
  // A real card: bundled scorecard data, or per-tee holes the resolver validated.
  const courseHasVerifiedPars = !!course?.pars || courseHasTeeHoles
  // NCRDB imports carry the resolver's verdict on the course itself.
  const explicitScorecardStatus = course?.scorecardStatus
  const lookupForCourse = scorecardLookup.courseId === course?.id ? scorecardLookup : null
  const cardIsManual = manualCardCourseId != null && manualCardCourseId === course?.id
  // Only courses without a card of their own wait on the lookup — for the rest it
  // just adds yardage, so a provider miss there must not downgrade the card.
  const scorecardStatus = cardIsManual
    ? 'manual'
    : explicitScorecardStatus
      ?? (courseHasVerifiedPars ? 'matched' : lookupForCourse?.status ?? 'loading')
  const scorecardLoading = scorecardStatus === 'loading'
  const scorecardUnavailable = scorecardStatus === 'unavailable'
  const scorecardCached = !!(course?.scorecardCached ?? lookupForCourse?.enrichment?.cached)

  // Catalogue courses that did not enter through NCRDB use the compatibility
  // wrapper. NCRDB imports already awaited the same shared resolver server-side.
  const courseLookupKey = course?.id ?? ''
  const courseLookupName = course?.name ?? ''
  const courseLookupLoc = course?.loc ?? ''
  useEffect(() => {
    if (!courseLookupKey || !courseLookupName) return
    if (courseHasTeeHoles || explicitScorecardStatus) return
    // Strict Mode runs this twice. The ref keeps the first request alive instead
    // of cancelling it and then skipping the retry.
    if (scorecardRequestRef.current === courseLookupKey) return
    scorecardRequestRef.current = courseLookupKey

    const gen = ++scorecardGenRef.current
    setScorecardLookup({ courseId: courseLookupKey, status: 'loading', teesData: null, enrichment: null })
    getHoleData({ id: courseLookupKey, name: courseLookupName, loc: courseLookupLoc }).then(
      ({ teesData, enrichment }) => {
        if (gen !== scorecardGenRef.current) return
        setScorecardLookup({
          courseId: courseLookupKey,
          status: enrichment?.matched && teesData ? 'matched' : 'unavailable',
          teesData,
          enrichment: enrichment ?? { matched: false, reason: 'no_matching_course' },
        })
      },
    )
  }, [courseLookupKey, courseLookupName, courseLookupLoc, courseHasTeeHoles, explicitScorecardStatus])

  const lookupStatus = lookupForCourse?.status
  const lookupTeesData = lookupForCourse?.teesData
  const teeName = tee?.name
  const teeYards = tee?.yards

  // Seed the card from the selected tee once the lookup lands. Bundled and NCRDB
  // cards already hold real pars, so only synthetic par-4 cards get filled.
  useEffect(() => {
    if (lookupStatus !== 'matched' || !lookupTeesData) return
    if (cardIsManual || courseHasVerifiedPars) return
    const applyKey = `${courseLookupKey}|${teeName ?? ''}|${st.holes}`
    if (appliedCardKeyRef.current === applyKey) return

    const holes = Array.from({ length: st.holes }, (_, index) => index + 1)
    const card = holeCardFromTees(lookupTeesData, teeName, 'male', teeYards)
    if (!card || !holes.every((hole) => card.pars[hole] != null)) return
    appliedCardKeyRef.current = applyKey

    setSt((state) => {
      if (state.courseId !== courseLookupKey) return state
      const siValues = holes.map((hole) => card.strokeIndex[hole])
      const validSi =
        siValues.every((value) => value >= 1 && value <= st.holes) &&
        new Set(siValues).size === st.holes
      const pars = { ...state.pars, ...card.pars }
      return {
        ...state,
        pars,
        strokeIndex: validSi ? { ...state.strokeIndex, ...card.strokeIndex } : state.strokeIndex,
        bets: betsWithNormalizedLdHole(state.bets, pars),
      }
    })
  }, [
    lookupStatus,
    lookupTeesData,
    cardIsManual,
    courseHasVerifiedPars,
    courseLookupKey,
    teeName,
    teeYards,
    st.holes,
  ])

  // A definitive miss on a course with no card of its own leaves the manual
  // editor as the only honest option — open it rather than pass off par 4s.
  useEffect(() => {
    if (!scorecardUnavailable || courseHasVerifiedPars) return
    setSt((state) => (state.showCard ? state : { ...state, showCard: true }))
  }, [scorecardUnavailable, courseHasVerifiedPars, courseLookupKey])

  // Per-hole yardage for the tee actually being played: validated NCRDB tee holes
  // first, then the compatibility lookup's payload.
  const selectedTeeYardages =
    yardageMapFromCourseTee(tee) ??
    (lookupStatus === 'matched' ? yardageMapFromTees(lookupTeesData, teeName, 'male', teeYards) : null)

  // Where this course's card came from, said plainly. The card drives handicap
  // strokes and every game, so a guessed one has to look different from a real one.
  const scorecardNote = (() => {
    if (scorecardStatus === 'loading') {
      return { label: 'CHECKING CARD', tone: 'rgba(255,255,255,.62)', detail: 'Loading a verified scorecard for this course.' }
    }
    if (scorecardStatus === 'manual') {
      return { label: 'MANUAL CARD', tone: '#facc15', detail: 'You edited this card — the round will use it exactly as entered.' }
    }
    if (scorecardStatus === 'unavailable') {
      return {
        label: 'UNVERIFIED CARD',
        tone: '#fb7185',
        detail: 'No scorecard matched this course. Check par and stroke index below before you start.',
      }
    }
    const source = course?.scorecardSource === 'golfcourseapi' || lookupStatus === 'matched'
      ? 'GolfCourseAPI'
      : 'the built-in scorecard'
    const yardage = selectedTeeYardages ? ` Yardage shown for the ${teeName} tees.` : ''
    return {
      label: 'VERIFIED CARD',
      tone: ACCENT,
      detail: `Par and stroke index from ${source}${scorecardCached ? ' (cached)' : ''}.${yardage}`,
    }
  })()

  const isScramble = st.format === 'scramble'
  const ids = st.players.map((p) => p.id)
  const holeNumbers = Array.from({ length: st.holes }, (_, i) => i + 1)
  const par3Holes = holeNumbers.filter((h) => st.pars[h] === 3)
  const backNinePar3s = par3Holes.filter((h) => h > 9)
  const par5Holes = holeNumbers.filter((h) => st.pars[h] === 5)
  const ctx = { holeNumbers, par3Holes, backNinePar3s, par5Holes, playerCount: st.players.length }
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
  // Bounds match the Handicap Index editors on You and Onboarding, so stepping a
  // seeded plus handicap doesn't silently snap it to scratch. The engines already
  // floor negatives when allocating strokes.
  const incHdcp = (id, d) =>
    updatePlayer(id, {
      hdcp: clampHandicapIndex(st.players.find((p) => p.id === id).hdcp + d),
    })
  const addRoundPlayer = (fields) => {
    if (st.players.length >= MAX_PLAYERS) return
    const id = crypto.randomUUID()
    setSt((s) => {
      const used = s.players.map((p) => p.color)
      const color = PALETTE.find((c) => !used.includes(c)) ?? PALETTE[s.players.length % PALETTE.length]
      const player = {
        id, userId: null, name: '', nickname: '', email: '', phone: '', hdcp: 12,
        guest: false, inviteGuest: false, color, team: nextTeam(s.players), ...fields,
      }
      const players = [...s.players, player]
      const bets = { ...s.bets }
      Object.keys(bets).forEach((k) => { bets[k] = { ...bets[k], who: [...bets[k].who, id] } })
      return { ...s, players, bets, showAccountPicker: false, showCrewPicker: false }
    })
  }
  const addInviteGuest = () => addRoundPlayer({ guest: false, inviteGuest: true })
  const addGuest = () => addRoundPlayer({ guest: true, inviteGuest: false })
  const addAccount = async (acct) => {
    // Search hits carry no raw contact — reveal it for just this one player at
    // the moment we add them, so the round player gets a real e:/p: identity.
    let { name, nickname, handicapIndex } = acct
    let email = ''
    let phone = ''
    const contact = acct.userId ? await fetchPlayerContact(acct.userId) : null
    if (contact) {
      email = contact.email || ''
      phone = contact.phone || ''
      name = contact.name || name
      nickname = contact.nickname || nickname
      if (contact.handicapIndex != null) handicapIndex = contact.handicapIndex
    }
    // Don't add someone already in the round (e.g. added earlier from your crew
    // and then found again via search).
    const key = playerKey({ name, nickname, email, phone })
    if (key && st.players.some((p) => playerKey(p) === key)) {
      patch({ showAccountPicker: false })
      return
    }
    addRoundPlayer({
      guest: false,
      inviteGuest: false,
      userId: acct.userId ?? null,
      name,
      nickname,
      email,
      phone,
      hdcp: handicapIndex != null ? Number(handicapIndex) : 12,
    })
  }
  const addCrewMember = (member) =>
    addRoundPlayer({
      guest: false,
      inviteGuest: false,
      name: member.name,
      nickname: member.nickname,
      email: member.email,
      phone: member.phone,
    })
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
  const setSkinType = (k, v) => {
    const nextSel = { ...skins.selectedSkins, [k]: v }
    if (k === 'carryoverSkin' && v) nextSel.standardSkin = true
    if (k === 'standardSkin' && !v) nextSel.carryoverSkin = false
    if (k === 'greenie' && v) nextSel.closestToPin = false
    if (k === 'closestToPin' && v) nextSel.greenie = false
    const next = { selectedSkins: nextSel }
    if (k === 'overallPurse' && v) {
      next.overallPurseStake = skins.overallPurseStake || skins.baseSkinValue
    }
    if (k === 'longestDrive' && v && par5Holes.length) {
      next.ldHole = normalizeSkinsLdHole(skins.ldHole, st.pars)
    }
    setBet('skins', next)
  }
  const setSkinBasePreset = (preset) =>
    preset === 'custom'
      ? setBet('skins', { basePreset: 'custom' })
      : setBet('skins', { basePreset: String(preset), baseSkinValue: preset })
  const setSkinBaseValue = (raw) =>
    setBet('skins', { baseSkinValue: Math.max(1, Math.min(500, Math.round(Number(raw) || 0))) })
  const stepOverallPurseStake = (dir) => {
    const cur = skins.overallPurseStake ?? skins.baseSkinValue
    const next = dir > 0 ? (cur < 15 ? cur + 1 : cur + 5) : (cur <= 15 ? cur - 1 : cur - 5)
    setBet('skins', { overallPurseStake: Math.max(1, Math.min(500, next)) })
  }

  /* ---- course selection ---- */
  const collapseCourseBrowser = () => {
    setCourseCollapsed(true)
    requestAnimationFrame(() => {
      bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  // Switching course loads its real card (pars + stroke index) and resets the
  // tee; courses without their own data fall back to a generic par-4 card.
  const selectCourse = (id) => {
    userPickedCourse.current = true
    if (id === st.courseId) {
      collapseCourseBrowser()
      return
    }
    const c =
      catalog.find((x) => x.id === id) ??
      COURSES.find((x) => x.id === id)
    if (!c) return
    const card = c.pars || c.strokeIndex
      ? defaultCard(st.holes, c.pars, c.strokeIndex)
      : defaultCard(st.holes)
    patch({
      courseId: id,
      teeIdx: 1,
      pars: card.pars,
      strokeIndex: card.strokeIndex,
      bets: betsWithNormalizedLdHole(st.bets, card.pars),
    })
    collapseCourseBrowser()
  }

  const selectNcrdbCourse = async (hit) => {
    const rawCourseId = ncrdbCourseId(hit)
    const courseId = rawCourseId != null ? String(rawCourseId) : ''
    if (!courseId || ncrdbSelectingId) return

    setNcrdbSelectingId(courseId)
    setNcrdbError('')
    const normalized = normalizedNcrdbCourse(hit)
    const { data, error } = await getNcrdbTees(Number(courseId), {
      name: normalized.fullName,
      facility: ncrdbValue(hit, 'facilityName', 'clubName', 'FacilityName') ?? '',
      course: ncrdbValue(hit, 'courseName', 'CourseName') ?? '',
      city: normalized.city,
      state: normalized.stateDisplay,
    })
    setNcrdbSelectingId(null)
    if (error) {
      setNcrdbError(error.message)
      return
    }

    const imported = courseFromNcrdb(normalized, data?.tees ?? [])
    if (!imported.tees.length) {
      setNcrdbError("No rated men's tees were found for that course.")
      return
    }
    let latitude = null
    let longitude = null
    if (imported.loc) {
      const { data: coords } = await forwardGeocode(imported.loc)
      if (coords?.lat != null && coords?.lng != null) {
        latitude = coords.lat
        longitude = coords.lng
      }
    }
    if (latitude == null && geoRegion?.lat != null && geoRegion?.lng != null) {
      latitude = geoRegion.lat
      longitude = geoRegion.lng
    }
    const importedCourse = {
      ...imported,
      id: `ncrdb-${courseId}`,
      holes: 18,
      bg: getCourseImage({ id: `ncrdb-${courseId}`, name: imported.name }),
      scorecardStatus: data?.enrichment?.matched ? 'matched' : 'unavailable',
      scorecardSource: data?.enrichment?.matched ? 'golfcourseapi' : 'fallback',
      scorecardReason: data?.enrichment?.reason ?? null,
      scorecardCached: !!data?.enrichment?.cached,
      ...(latitude != null && longitude != null ? { latitude, longitude } : {}),
    }
    userPickedCourse.current = true
    setCatalog((items) => {
      const exists = items.some((item) => item.id === importedCourse.id)
      return exists
        ? items.map((item) => (item.id === importedCourse.id ? { ...item, ...importedCourse } : item))
        : [importedCourse, ...items]
    })
    setSt((s) => {
      const card = importedCourse.pars || importedCourse.strokeIndex
        ? defaultCard(s.holes, importedCourse.pars, importedCourse.strokeIndex)
        : defaultCard(s.holes)
      return {
        ...s,
        courseId: importedCourse.id,
        teeIdx: 0,
        pars: card.pars,
        strokeIndex: card.strokeIndex,
        showCard: !data?.enrichment?.matched,
        bets: betsWithNormalizedLdHole(s.bets, card.pars),
      }
    })
    collapseCourseBrowser()
  }

  /* ---- course card ---- */
  const setPar = (hole, par) => {
    const pars = { ...st.pars, [hole]: par }
    patch({ pars, bets: betsWithNormalizedLdHole(st.bets, pars) })
    setManualCardCourseId(course.id)
  }
  const setSi = (hole, raw) => {
    if (raw === '') return
    const n = Math.max(1, Math.min(st.holes, Math.round(Number(raw))))
    if (Number.isNaN(n)) return
    patch({ strokeIndex: { ...st.strokeIndex, [hole]: n } })
    setManualCardCourseId(course.id)
  }
  // Rebuild the card when the hole count changes (keeps it a valid 1..N set).
  const setHoles = (n) => {
    const card = defaultCard(n, st.pars, st.strokeIndex)
    let bets = st.bets
    if (n === 9 && (st.bets.ctp.holes !== 0 || st.bets.skins.ctpHoles !== 0)) {
      bets = { ...bets, ctp: { ...bets.ctp, holes: 0 }, skins: { ...bets.skins, ctpHoles: 0 } }
    }
    bets = betsWithNormalizedLdHole(bets, card.pars)
    patch({ holes: n, pars: card.pars, strokeIndex: card.strokeIndex, bets })
  }

  /* ---- validation ---- */
  // Every player needs a name. For live rounds, only invite-guests must also
  // carry contact — that's how they receive a join link.
  const organizer = st.players[0]
  const isReady = (p) => {
    if (!p.name?.trim()) return false
    if (p.guest) return true
    // Invite-guests are the only players who must carry contact: they get a join
    // link by email or phone. You (the signed-in organizer) and verified players
    // are identified by their own account, so a name alone is enough.
    if (liveRoundsEnabled && p.inviteGuest && !hasContact(p)) return false
    return true
  }
  const readyPlayers = st.players.filter((p) => isReady(p))
  const everyoneReady = st.players.every((p) => isReady(p))
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
  const valid = (isReview ? validStep(1) && validStep(3) : validStep(st.step))
    && !(isReview && scorecardLoading)
  let hintText = ''
  if (!valid && st.step === 1) {
    if (!organizer || !organizer.name?.trim()) hintText = 'Add your name to continue.'
    else if (liveRoundsEnabled && st.players.some((p) => p.name?.trim() && p.inviteGuest && !hasContact(p))) {
      hintText = 'Add email or phone for invited players so they can join live.'
    }
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
    hintText = scorecardLoading
      ? 'Loading a verified course card before you start.'
      : !validStep(1)
        ? 'Add players before starting the round.'
        : 'Finish the games step before starting.'
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
    // Always pass yardages, empty included, so switching to a course we have no
    // hole data for clears the previous round's yardage instead of keeping it.
    setCourseConfig({
      pars: st.pars,
      strokeIndex: st.strokeIndex,
      yardages: selectedTeeYardages ?? {},
    })

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
      guest: !!p.guest,
      // Non-guests (incl. invite-guests) count as "logged in" — they're verified by
      // contact for the season ledger, not by an actual auth session.
      loggedIn: !p.guest,
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
    if (skins.on && skins.selectedSkins?.overallPurse) {
      const who = skins.who.filter((x) => ids.includes(x))
      const stake = skins.overallPurseStake ?? skins.baseSkinValue
      bets.push({
        id: crypto.randomUUID(),
        type: 'overallPurse',
        playerIds: who,
        amount: stake,
        config: { stake, style: 'match' },
      })
    }
    setBets(bets)
    useRoundStore.setState({ pressBets: [] })

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

  const next = async () => {
    if (!valid) return
    if (st.step < 4) patch({ step: st.step + 1 })
    else {
      commit()
      if (liveRoundsEnabled) {
        const rs = useRoundStore.getState()
        const roundId = rs.round?.roundId
        if (roundId) {
          const prevLive = useLiveRoundStore.getState()
          const stale = prevLive.liveRoundId && prevLive.liveRoundId !== roundId
          if (stale) {
            teardownLiveSync()
            useLiveRoundStore.getState().clearSession()
          }
          const ensured = await ensureLiveScorerAccess({
            roundId,
            state: serializeRoundState(rs),
            roster: rs.players,
            courseName: course.name,
          })
          if (!ensured.ok && ensured.needsNewRoundId) {
            remintRoundId()
            teardownLiveSync()
            useLiveRoundStore.getState().clearSession()
            const fresh = useRoundStore.getState()
            const retryRoundId = fresh.round?.roundId
            if (retryRoundId) {
              const retried = await ensureLiveScorerAccess({
                roundId: retryRoundId,
                state: serializeRoundState(fresh),
                roster: fresh.players,
                courseName: course.name,
              })
              if (retried.ok && retried.inviteCode) {
                const me = readyPlayers[0]
                useLiveRoundStore.getState().setSession({
                  liveRoundId: retryRoundId,
                  inviteCode: retried.inviteCode,
                  role: 'scorer',
                  scorerName: me?.name?.trim() || displayName(me) || 'Scorer',
                })
                patch({ started: true })
                return
              }
            }
          }
          if (!ensured.ok) {
            teardownLiveSync()
            useLiveRoundStore.getState().clearSession()
            useNotificationStore.getState().pushToast({
              kicker: 'LIVE ROUND',
              title: 'Could not start live sync',
              body: liveRoundUserMessage(ensured.reason),
              duration: 10000,
            })
          } else if (ensured.inviteCode) {
            const me = readyPlayers[0]
            useLiveRoundStore.getState().setSession({
              liveRoundId: roundId,
              inviteCode: ensured.inviteCode,
              role: 'scorer',
              scorerName: me?.name?.trim() || displayName(me) || 'Scorer',
            })
          } else {
            useNotificationStore.getState().pushToast({
              kicker: 'LIVE ROUND',
              title: 'Live sync unavailable',
              body: 'Round saved locally. Finish the database migration to enable invite links.',
              duration: 8000,
            })
            teardownLiveSync()
            useLiveRoundStore.getState().clearSession()
          }
        }
      } else {
        teardownLiveSync()
        useLiveRoundStore.getState().clearSession()
      }
      patch({ started: true })
    }
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

        <AppHeader
          accent={ACCENT}
          backTo="/"
          logo="wordmark"
          rightAction="pin"
          kicker={`STEP ${st.step + 1} OF 5 · ${STEPS[st.step].toUpperCase()}`}
          title={titles[st.step].t}
          contextPill={course.name}
        />
        <div style={{ flex: '0 0 auto', padding: '0 18px 14px' }}>
          <div style={{ display: 'flex', gap: 6 }}>
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
        <div ref={bodyRef} className="golo-scroll" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 16px 18px' }}>
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

  function sectionLabel(text, style = {}) {
    const { margin, ...rest } = style
    return <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.5)', ...(margin != null ? { margin } : { marginBottom: 10 }), ...rest }}>{text}</div>
  }

  function courseRowSubtitle(course, showDistance = true) {
    const distance = showDistance
      ? courseDistanceLabel(course, geoRegion?.lat, geoRegion?.lng)
      : null
    const parts = [course.loc, `${course.holes} holes`]
    if (distance) parts.splice(1, 0, distance)
    return parts.filter(Boolean).join(' · ')
  }

  function orderCoursesByHistory(courses) {
    const stats = new Map()
    historyRounds.forEach((round, index) => {
      const matched =
        courses.find((candidate) => candidate.id === round?.courseId) ??
        matchCourseInCatalog(courses, round?.course)
      if (!matched) return

      const parsedDate = Date.parse(round?.date ?? round?.completedAt ?? '')
      const recency = Number.isFinite(parsedDate) ? parsedDate : historyRounds.length - index
      const current = stats.get(matched.id) ?? { count: 0, recency: -Infinity }
      stats.set(matched.id, {
        count: current.count + 1,
        recency: Math.max(current.recency, recency),
      })
    })

    return [...courses].sort((a, b) => {
      const aStats = stats.get(a.id)
      const bStats = stats.get(b.id)
      if (!!aStats !== !!bStats) return aStats ? -1 : 1
      if (!aStats || !bStats) return 0
      if (aStats.count !== bStats.count) return bStats.count - aStats.count
      return bStats.recency - aStats.recency
    })
  }

  function renderCatalogCourseCard(item, { cardKey, collapsed = false, showDistance = true } = {}) {
    if (!item) return null
    const selected = item.id === st.courseId
    const commonStyle = {
      width: '100%',
      boxSizing: 'border-box',
      display: 'flex',
      alignItems: 'center',
      gap: collapsed ? 14 : 12,
      textAlign: 'left',
      background: 'rgba(20,28,24,.5)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: `1px solid ${selected ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)'}`,
      borderRadius: collapsed ? 20 : 16,
      padding: collapsed ? 14 : 12,
      marginBottom: 10,
      position: 'relative',
    }
    const content = (
      <>
        <span style={{ width: collapsed ? 68 : 54, height: collapsed ? 68 : 54, borderRadius: collapsed ? 15 : 12, flex: '0 0 auto', background: 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)', backgroundImage: `url(${item.bg}), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)`, backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' }} />
        <div style={{ flex: 1, minWidth: 0, paddingRight: collapsed ? 52 : 0 }}>
          <div style={{ fontSize: collapsed ? 18 : 16, fontWeight: 800, color: '#fff' }}>{item.name}</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>{courseRowSubtitle(item, showDistance)}</div>
        </div>
      </>
    )

    if (collapsed) {
      return (
        <div key={cardKey} data-course-kind="catalog" data-course-id={item.id} style={commonStyle}>
          {content}
          <button
            type="button"
            aria-label="Choose a different course"
            onClick={(event) => {
              event.stopPropagation()
              setCourseCollapsed(false)
              setCourseListExpanded(false)
              if (st.courseQuery) patch({ courseQuery: '' })
              requestAnimationFrame(() => {
                bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
              })
            }}
            style={{ position: 'absolute', top: 10, right: 10, width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,.2)', background: 'rgba(8,15,11,.7)', color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      )
    }

    return (
      <button
        key={cardKey}
        type="button"
        data-course-kind="catalog"
        data-course-id={item.id}
        aria-pressed={selected}
        onClick={() => selectCourse(item.id)}
        style={{ ...commonStyle, cursor: 'pointer' }}
      >
        {content}
        <span style={{ width: 24, height: 24, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${selected ? ACCENT : 'rgba(255,255,255,.3)'}`, background: selected ? ACCENT : 'transparent', color: ACCENT_DARK, fontSize: 14, fontWeight: 800 }}>{selected ? '✓' : ''}</span>
      </button>
    )
  }

  function renderNcrdbCourseCard(hit) {
    const id = String(ncrdbCourseId(hit))
    const picking = ncrdbSelectingId === id
    return (
      <button
        type="button"
        key={`ncrdb-${id}`}
        data-course-kind="ncrdb"
        data-course-id={id}
        disabled={!!ncrdbSelectingId}
        onClick={() => selectNcrdbCourse(hit)}
        style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, padding: 12, marginBottom: 10, cursor: ncrdbSelectingId ? 'wait' : 'pointer', opacity: ncrdbSelectingId && !picking ? 0.55 : 1 }}
      >
        <span style={{ width: 54, height: 54, borderRadius: 12, flex: '0 0 auto', background: 'linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)', backgroundImage: 'url(/courses/course.png), linear-gradient(135deg, #14532d 0%, #166534 40%, #0a2418 100%)', backgroundSize: 'cover', backgroundPosition: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.15)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{ncrdbCourseName(hit)}</div>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', marginTop: 1 }}>{ncrdbCourseLocation(hit) || 'USGA NCRDB'} · 18 holes</div>
        </div>
        <span style={{ minWidth: 72, height: 26, borderRadius: 999, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${hexA(ACCENT, 0.35)}`, background: hexA(ACCENT, 0.12), color: ACCENT, fontSize: 11, fontWeight: 900, letterSpacing: 0.8 }}>{picking ? 'LOADING' : 'ADD'}</span>
      </button>
    )
  }

  function renderCourse() {
    const q = st.courseQuery.trim().toLowerCase()
    const hasNearbyRegion = geoRegion?.lat != null || geoRegion?.city || geoRegion?.stateCode || geoRegion?.state
    const showNearby = !q && geoStatus === GEO_STATUS.READY && hasNearbyRegion
    // From the backend, `catalog` is already filtered to visible setup courses;
    // in local-only mode keep the curated visible subset that used to be hardcoded.
    const visible = coursesFromDb
      ? catalog
      : VISIBLE_COURSE_IDS.map((id) => catalog.find((c) => c.id === id)).filter(Boolean)
    const homeCourse = q
      ? null
      : defaultHomeCourse(visible, { homeClub: profileHomeClub, rounds: historyRounds })
    let catalogMatches = visible.filter((candidate) => {
      if (homeCourse && candidate.id === homeCourse.id) return false
      return !q || `${candidate.name} ${candidate.loc ?? ''}`.toLowerCase().includes(q)
    })
    if (!q) {
      catalogMatches = showNearby && geoRegion?.lat != null && geoRegion?.lng != null
        ? sortCoursesByDistance(catalogMatches, geoRegion.lat, geoRegion.lng)
        : orderCoursesByHistory(catalogMatches)
    }
    const showNcrdbSearch = isSupabaseConfigured && q.length >= 3
    const remoteMatches = showNcrdbSearch && !ncrdbLoading && ncrdbResultsQuery === q
      ? dedupeNcrdbAgainstCatalog(visible, ncrdbResults, {
          getId: ncrdbCourseId,
          getName: ncrdbCourseName,
          getLoc: ncrdbCourseLocation,
        })
      : []
    const nearbyMatches = showNearby
      ? dedupeNcrdbAgainstCatalog(visible, nearbyNcrdb, {
          getId: ncrdbCourseId,
          getName: ncrdbCourseName,
          getLoc: ncrdbCourseLocation,
        })
      : []
    const mergedItems = [
      ...catalogMatches.map((item) => ({ kind: 'catalog', item })),
      ...(q ? remoteMatches : nearbyMatches).map((item) => ({ kind: 'ncrdb', item })),
    ]
    const shownItems = courseListExpanded
      ? mergedItems
      : mergedItems.slice(0, COURSE_PAGE_SIZE)
    const nearbyLabel = [geoRegion?.city, geoRegion?.stateCode || geoRegion?.state].filter(Boolean).join(', ')
    return (
      <div>
        {courseCollapsed ? (
          <>
            {sectionLabel('SELECTED COURSE')}
            {renderCatalogCourseCard(course, { collapsed: true, showDistance: geoStatus === GEO_STATUS.READY })}
            {sectionLabel('TEES', { margin: '18px 0 10px' })}
            {tees.map((t, i) => {
              const selected = i === st.teeIdx
              return (
                <button key={t.name} type="button" onClick={() => patch({ teeIdx: i })} style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${selected ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)'}`, borderRadius: 14, padding: '11px 13px', marginBottom: 9, cursor: 'pointer' }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', flex: '0 0 auto', background: t.color, boxShadow: '0 0 0 2px rgba(255,255,255,.28)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{t.name} Tees</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.5)', marginTop: 1 }}>CR {t.rating} · Slope {t.slope} · Par {t.par}</div>
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: selected ? ACCENT : '#fff' }}>{comma(t.yards)}</div>
                    <div style={{ fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,.45)' }}>YARDS</div>
                  </div>
                </button>
              )
            })}
          </>
        ) : (
          <>
            {sectionLabel('COURSE SEARCH')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 14, padding: '0 15px', marginBottom: 20 }}>
              <span aria-hidden="true" style={{ fontSize: 19, flex: '0 0 auto', lineHeight: 1 }}>🔍</span>
              <input
                aria-label="Search courses"
                value={st.courseQuery}
                onChange={(event) => {
                  setCourseListExpanded(false)
                  patch({ courseQuery: event.target.value })
                }}
                placeholder="Search courses…"
                style={{ flex: 1, minHeight: 52, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', padding: 0 }}
              />
              {q.length > 0 && (
                <button type="button" aria-label="Clear course search" onClick={() => {
                  setCourseListExpanded(false)
                  patch({ courseQuery: '' })
                }} style={{ width: 26, height: 26, borderRadius: '50%', flex: '0 0 auto', background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', lineHeight: 1 }}>×</button>
              )}
            </div>

            {(geoStatus === GEO_STATUS.LOADING || nearbyLoading) && !q && (
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT, marginBottom: 12 }}>Finding courses near you…</div>
            )}
            {(geoStatus === GEO_STATUS.DENIED || geoStatus === GEO_STATUS.UNAVAILABLE) && !q && (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.4)', marginBottom: 12 }}>Enable location to see nearby courses.</div>
            )}

            {homeCourse && (
              <>
                {sectionLabel('HOME COURSE')}
                <div data-home-course>
                  {renderCatalogCourseCard(homeCourse, { showDistance: showNearby })}
                </div>
              </>
            )}

            {q
              ? sectionLabel('SEARCH RESULTS', { margin: homeCourse ? '16px 0 10px' : undefined })
              : showNearby
                ? <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: ACCENT, margin: homeCourse ? '16px 0 10px' : '0 0 10px' }}>NEAR YOU{nearbyLabel ? ` · ${nearbyLabel}` : ' · sorted by distance'}</div>
                : sectionLabel('YOUR COURSES', { margin: homeCourse ? '16px 0 10px' : undefined })}

            <div data-course-list>
              {shownItems.map(({ kind, item }) => (
                kind === 'catalog'
                  ? renderCatalogCourseCard(item, { cardKey: `catalog-${item.id}`, showDistance: showNearby || !!q })
                  : renderNcrdbCourseCard(item)
              ))}
            </div>

            {(showNcrdbSearch ? ncrdbLoading : nearbyLoading) && (
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.62)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, padding: 14, lineHeight: 1.5, marginBottom: 10 }}>
                {showNcrdbSearch ? 'Searching courses…' : 'Loading nearby courses from USGA…'}
              </div>
            )}

            {mergedItems.length > COURSE_PAGE_SIZE && (
              <button
                type="button"
                data-course-pagination
                onClick={() => setCourseListExpanded((expanded) => !expanded)}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 2, marginBottom: 10, minHeight: 48, borderRadius: 14, border: `1px solid ${hexA(ACCENT, 0.35)}`, background: hexA(ACCENT, 0.1), color: ACCENT, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {courseListExpanded ? 'Show less' : 'Load more'}
              </button>
            )}

            {showNearby && !nearbyLoading && nearbyMatches.length === 0 && isSupabaseConfigured && (
              <button
                type="button"
                onClick={() => {
                  nearbyFetchedKey.current = ''
                  nearbyRetryCount.current = 0
                  fetchNearbyNcrdb(geoRegion, { force: true })
                }}
                style={{ width: '100%', boxSizing: 'border-box', marginTop: 4, marginBottom: 10, minHeight: 48, borderRadius: 14, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: 'rgba(255,255,255,.72)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Retry nearby courses
              </button>
            )}

            {!ncrdbLoading && ncrdbError && (
              <div style={{ fontSize: 13.5, color: '#fecdd3', background: 'rgba(127,29,29,.3)', border: '1px solid rgba(251,113,133,.35)', borderRadius: 14, padding: 14, lineHeight: 1.5, marginBottom: 10 }}>
                {ncrdbError}
              </div>
            )}

            {mergedItems.length === 0 && !ncrdbLoading && !nearbyLoading && !ncrdbError && (
              <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.55)', background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 14, padding: 14, lineHeight: 1.5 }}>
                {q ? `No courses match “${st.courseQuery}”.` : 'No courses are available yet.'}
              </div>
            )}
          </>
        )}

        {/* where the par/stroke-index card came from */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${hexA(scorecardNote.tone.startsWith('#') ? scorecardNote.tone : '#ffffff', 0.3)}`, borderRadius: 14, padding: '12px 13px', marginTop: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto', marginTop: 5, background: scorecardNote.tone }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: scorecardNote.tone }}>{scorecardNote.label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(255,255,255,.62)', marginTop: 3, lineHeight: 1.45 }}>{scorecardNote.detail}</div>
          </div>
        </div>

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

        {/* extras: editable course card. Admin-only in the normal case, but always
            available when no verified card was found — otherwise the round would
            quietly run on synthetic par 4s. */}
        {(SHOW_COURSE_CARD_EDIT || scorecardUnavailable || cardIsManual) && (
          <>
            <button onClick={() => patch({ showCard: !st.showCard })} style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, borderRadius: 12, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.14)', color: 'rgba(255,255,255,.82)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', padding: '0 14px' }}>
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
    const inRound = new Set(st.players.map(playerKey).filter(Boolean))
    // Also track account userIds in the round so masked search hits (which have
    // no contact to derive an e:/p: key from) drop out once they've been added.
    st.players.forEach((p) => { if (p.userId) inRound.add(`u:${p.userId}`) })
    const accounts = buildAccountDirectory(historyRounds, inRound)
    const crew = buildCrewRoster(historyRounds, inRound)
    const full = st.players.length >= MAX_PLAYERS
    const accountQuery = accountSearch.trim()
    const accountDisplayList = accountQuery.length >= 2
      ? mergePlayerPickers(accounts, accountSearchResults, inRound)
      : accounts

    const renderPickerList = (items, emptyText, onPick, subFor) => (
      <div style={{ background: 'rgba(20,28,24,.5)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, padding: items.length ? 6 : 14 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,.55)', lineHeight: 1.5 }}>{emptyText}</div>
        ) : (
          items.map((a) => (
            <button key={a.key} onClick={() => onPick(a)} disabled={full} style={accountRow}>
              <span style={{ width: 32, height: 32, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', background: 'rgba(255,255,255,.18)' }}>{initial(a.name || a.email || a.emailMasked)}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || a.email || a.phone || a.emailMasked || a.phoneMasked}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subFor(a)}</span>
              </span>
              <span style={{ color: ACCENT, fontSize: 18, fontWeight: 800, flex: '0 0 auto' }}>+</span>
            </button>
          ))
        )}
      </div>
    )

    return (
      <div>
        {sectionLabel(`PLAYERS · ${st.players.length}`)}
        {st.players.map((p, idx) => renderPlayerCard(p, idx))}

        {sectionLabel('ADD PLAYERS', { margin: '18px 0 10px' })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {/* 1 — existing account holder */}
          <button
            onClick={() => {
              if (full) return
              const opening = !st.showAccountPicker
              if (!opening) {
                setAccountSearch('')
                setAccountSearchResults([])
              }
              patch({ showAccountPicker: opening, showCrewPicker: false })
            }}
            disabled={full}
            style={addOption(st.showAccountPicker, full)}
          >
            <span style={addOptionIcon}>👤</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={addOptionTitle}>Add player</span>
              <span style={addOptionSub}>
                {liveRoundsEnabled
                  ? 'Search verified GoLo players by name, handle, or email'
                  : 'Someone who already has an account'}
              </span>
            </span>
            <span style={{ color: ACCENT, fontSize: 22, fontWeight: 800, flex: '0 0 auto' }}>{st.showAccountPicker ? '×' : '+'}</span>
          </button>
          {st.showAccountPicker && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {liveRoundsEnabled && (
                <input
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Search players…"
                  aria-label="Search verified players"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  style={{ ...playerField, width: '100%', marginTop: 0 }}
                />
              )}
              {accountSearchLoading && (
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)', padding: '0 4px' }}>
                  Searching…
                </div>
              )}
              {renderPickerList(
                accountDisplayList,
                liveRoundsEnabled
                  ? accountQuery.length >= 2
                    ? accountSearchLoading
                      ? 'Searching…'
                      : `No verified players match "${accountQuery}".`
                    : accounts.length === 0
                      ? 'Search by name, handle, or email to find verified players. People you\'ve played with before will also show up here.'
                      : 'Type 2+ characters to search all verified players, or pick someone below.'
                  : 'No saved players yet. Finish a round with someone who has an email or phone and they will show up here.',
                addAccount,
                (a) => {
                  const contact = a.emailMasked || a.phoneMasked || a.email || a.phone || ''
                  const hdcp = a.handicapIndex != null ? ` · Hdcp ${Number(a.handicapIndex).toFixed(1)}` : ''
                  return `${contact}${hdcp}`.trim() || displayName(a)
                },
              )}
            </div>
          )}

          {/* 2 — crew roster */}
          <button onClick={() => !full && patch({ showCrewPicker: !st.showCrewPicker, showAccountPicker: false })} disabled={full} style={addOption(st.showCrewPicker, full)}>
            <span style={addOptionIcon}>👥</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={addOptionTitle}>Add someone from your crew</span>
              <span style={addOptionSub}>People you've played rounds with</span>
            </span>
            <span style={{ color: ACCENT, fontSize: 22, fontWeight: 800, flex: '0 0 auto' }}>{st.showCrewPicker ? '×' : '+'}</span>
          </button>
          {st.showCrewPicker && renderPickerList(
            crew,
            'Your crew fills in as you finish rounds together.',
            addCrewMember,
            (a) => `${a.rounds} ${a.rounds === 1 ? 'round' : 'rounds'} together${a.email || a.phone ? ` · ${a.email || a.phone}` : ''}`,
          )}

          {/* 3 — invite for live join link */}
          <button onClick={() => !full && addInviteGuest()} disabled={full} style={addOption(false, full)}>
            <span style={addOptionIcon}>📨</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={addOptionTitle}>Invite guest</span>
              <span style={addOptionSub}>Name + email or phone — they'll get a join link</span>
            </span>
            <span style={{ color: ACCENT, fontSize: 22, fontWeight: 800, flex: '0 0 auto' }}>+</span>
          </button>

          {/* 4 — local guest, name only */}
          <button onClick={() => !full && addGuest()} disabled={full} style={addOption(false, full)}>
            <span style={addOptionIcon}>⛳</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={addOptionTitle}>Add guest</span>
              <span style={addOptionSub}>Name only — no account or contact needed</span>
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
    // Verified players (the VERIFIED badge — directory adds + crew) get a slim
    // read-only card: avatar, name, @handle and an editable handicap. No
    // email/phone fields — their contact lives on their own account.
    const isVerified = !isOrganizer && !p.guest && !p.inviteGuest
    // Slim read-only card (you + verified players): name, @handle and the badge
    // on a second line, an editable handicap, and no email/phone. Guests and
    // invite-guests keep the full editable card.
    const isSlim = isOrganizer || isVerified
    const handle = p.nickname?.trim() ? `@${p.nickname.trim().replace(/^@+/, '')}` : ''
    const ready = isReady(p)
    const badge = isOrganizer
      ? { t: 'YOU', c: ACCENT }
      : p.guest
        ? { t: 'GUEST', c: '#fb923c' }
        : p.inviteGuest
          ? { t: 'INVITE', c: ACCENT }
          : { t: 'VERIFIED', c: '#60a5fa' }
    const pill = { fontSize: 9.5, fontWeight: 800, letterSpacing: 1, color: badge.c, border: `1px solid ${hexA(badge.c, 0.5)}`, background: hexA(badge.c, 0.14), borderRadius: 6, padding: '2px 6px', flex: '0 0 auto' }
    return (
      <div key={p.id} style={{ background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${ready ? 'rgba(255,255,255,.12)' : 'rgba(251,113,133,.6)'}`, borderRadius: 18, padding: 12, marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: '50%', flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#fff', background: p.color, boxShadow: '0 0 0 2px rgba(255,255,255,.2)' }}>{initial(p)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isSlim ? (
              <>
                <div style={{ color: '#fff', fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name?.trim() || displayName(p)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, minWidth: 0 }}>
                  {handle && <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{handle}</span>}
                  {handle && <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 12, flex: '0 0 auto' }}>·</span>}
                  <span style={pill}>{badge.t}</span>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <input value={p.name} onChange={(e) => updatePlayer(p.id, { name: e.target.value })} placeholder={isOrganizer ? 'Your name' : 'Player name'} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#fff', fontSize: 17, fontWeight: 700, fontFamily: 'inherit', padding: 0 }} />
                  <span style={pill}>{badge.t}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)', marginTop: 2 }}>Handicap index</div>
              </>
            )}
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

        {p.guest ? (
          <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.5)', marginTop: 10, lineHeight: 1.45 }}>
            Guest — scores and settles up in this round only. No email or phone needed.
          </div>
        ) : isSlim ? null : (
          <>
            {p.inviteGuest && liveRoundsEnabled && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 10, lineHeight: 1.45 }}>
                Add email or phone so they can claim this spot from your live invite link.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 11 }}>
              <input value={p.nickname} onChange={(e) => updatePlayer(p.id, { nickname: e.target.value })} placeholder="@handle" autoCapitalize="none" autoCorrect="off" style={{ ...playerField, flex: 1 }} />
              <input value={p.email} onChange={(e) => updatePlayer(p.id, { email: e.target.value })} placeholder={p.inviteGuest && liveRoundsEnabled ? 'Email' : 'Email (optional)'} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" style={{ ...playerField, flex: 1.4 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input value={p.phone} onChange={(e) => updatePlayer(p.id, { phone: e.target.value })} placeholder={p.inviteGuest && liveRoundsEnabled ? 'Phone' : 'Phone (optional)'} type="tel" inputMode="tel" style={{ ...playerField, flex: 1 }} />
              {!p.name?.trim() && <span style={{ fontSize: 11, fontWeight: 700, color: '#fb7185', flex: '0 0 auto' }}>Name required</span>}
              {p.name?.trim() && p.inviteGuest && liveRoundsEnabled && !hasContact(p) && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#fb7185', flex: '0 0 auto' }}>Contact required</span>
              )}
            </div>
          </>
        )}
        {p.guest && !p.name?.trim() && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#fb7185', marginTop: 8 }}>Name required</div>
        )}

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
            <button key={f.id} onClick={() => patch({ format: f.id })} style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 13, textAlign: 'left', background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: `1px solid ${sel ? hexA(ACCENT, 0.55) : 'rgba(255,255,255,.12)'}`, borderRadius: 16, padding: 15, marginBottom: 10, cursor: 'pointer' }}>
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
                    const ldPar5Select = d.key === 'long' && sel.key === 'hole'
                    const selectedLongHole = ldPar5Select ? resolveLdHoleNumber(b.hole, st.pars) : null
                    const options = ldPar5Select
                      ? par5Holes.map((h) => `Hole ${h} (par 5)`)
                      : ctpNineHoleSelect
                        ? ['All par 3s']
                        : sel.options
                    const selectedValue = ldPar5Select
                      ? selectedLongHole
                      : ctpNineHoleSelect
                        ? 0
                        : b[sel.key]
                    return (
                      <div key={sel.key}>
                        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)', marginBottom: 9 }}>{sel.label.toUpperCase()}</div>
                        {ldPar5Select && par5Holes.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', lineHeight: 1.45 }}>
                            No par 5s on the card — set at least one hole to par 5 in course setup.
                          </div>
                        ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {(ldPar5Select ? par5Holes : options).map((item, i) => {
                            const hole = ldPar5Select ? item : null
                            const label = ldPar5Select ? `Hole ${hole} (par 5)` : item
                            const s = optStyle(ldPar5Select ? selectedValue === hole : selectedValue === i)
                            return (
                              <button
                                key={label}
                                onClick={() => setBet(d.key, { [sel.key]: ldPar5Select ? hole : i })}
                                style={{ padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                        )}
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
    const nContrib = [sel.standardSkin, sel.birdieBonusSkin, sel.eagleBonusSkin].filter(Boolean).length
    const sidePots = [sel.greenie && 'Greenie', sel.sandie && 'Sandie', sel.closestToPin && 'CTP', sel.longestDrive && 'Long Drive'].filter(Boolean)
    const sidePotStacking = [sel.greenie && 'Greenie', sel.sandie && 'Sandie'].filter(Boolean)
    const sidePotSingle = [sel.closestToPin && 'CTP', sel.longestDrive && 'Long Drive'].filter(Boolean)
    const selectedLdHole = resolveLdHoleNumber(skins.ldHole, st.pars)

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
          {sidePots.length > 0 && (
            <span style={{ display: 'block', fontWeight: 600, color: 'rgba(255,255,255,.55)', marginTop: 2 }}>
              {sidePotStacking.length > 0 && <>plus {sidePotStacking.join(' & ')} — ${skins.baseSkinValue} each, flagged live &amp; stacking</>}
              {sidePotStacking.length > 0 && sidePotSingle.length > 0 && ' · '}
              {sidePotSingle.length > 0 && <>{sidePotSingle.join(' & ')} — ${skins.baseSkinValue} each, flagged live per hole</>}
            </span>
          )}
        </div>

        {(sel.closestToPin || sel.longestDrive) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {sel.closestToPin && (
              <div>
                <div style={skinSectionLabel}>CTP HOLES</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(st.holes === 9 ? ['All par 3s'] : ['All par 3s', 'Back 9 only']).map((o, i) => {
                    const s = optStyle((skins.ctpHoles ?? 0) === i)
                    return (
                      <button key={o} onClick={() => setBet('skins', { ctpHoles: i })} style={{ padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>{o}</button>
                    )
                  })}
                </div>
              </div>
            )}
            {sel.longestDrive && (
              <div>
                <div style={skinSectionLabel}>LONGEST DRIVE · PAR 5</div>
                {par5Holes.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.55)', lineHeight: 1.45 }}>
                    No par 5s on the card — set at least one hole to par 5 in course setup.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {par5Holes.map((h) => {
                      const s = optStyle(selectedLdHole === h)
                      return (
                        <button key={h} onClick={() => setBet('skins', { ldHole: h })} style={{ padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: s.bg, border: `1px solid ${s.border}`, color: s.color }}>Hole {h}</button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
              const carryoverLocked = t.key === 'carryoverSkin' && !sel.standardSkin
              const greenieBlocked = t.key === 'closestToPin' && sel.greenie
              const ctpBlocked = t.key === 'greenie' && sel.closestToPin
              const blocked = carryoverLocked || greenieBlocked || ctpBlocked
              return (
                <button
                  key={t.key}
                  onClick={() => !blocked && setSkinType(t.key, !on)}
                  disabled={blocked}
                  style={{ ...skinCard(on), opacity: blocked ? 0.45 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
                >
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

        {sel.overallPurse && (
          <div>
            <div style={skinSectionLabel}>OVERALL PURSE STAKE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" onClick={() => stepOverallPurseStake(-1)} aria-label="Decrease Overall Purse stake" style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>−</button>
              <span style={{ fontSize: 22, fontWeight: 800, color: ACCENT, minWidth: 72, textAlign: 'center' }}>${skins.overallPurseStake ?? skins.baseSkinValue}</span>
              <button type="button" onClick={() => stepOverallPurseStake(1)} aria-label="Increase Overall Purse stake" style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 20, fontWeight: 800, cursor: 'pointer' }}>+</button>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)' }}>per match</span>
            </div>
          </div>
        )}

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
      {
        label: 'CARD',
        value: scorecardNote.label.replace(' CARD', '').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
        sub: selectedTeeYardages ? 'Par, stroke index & yardage' : 'Par & stroke index',
        tone: scorecardNote.tone,
      },
    ]
    return (
      <div>
        <div style={{ background: 'rgba(20,28,24,.5)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 20, padding: '2px 16px', marginBottom: 18 }}>
          {reviewLines.map((r, i) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '14px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,.09)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: 'rgba(255,255,255,.5)' }}>{r.label}</span>
              <div style={{ textAlign: 'right', minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: r.tone ?? '#fff' }}>{r.value}</div>
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
