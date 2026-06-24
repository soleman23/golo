import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildStrokeAllocations } from '../engines/handicap'

const useRoundStore = create(
  persist(
    (set, get) => ({
      round: null,
      players: [],
      scores: {},
      bets: [],
      sideGameFlags: {
        closestToPin: {},
        longestDrive: {},
      },
      // Scramble: teams the round is played in. Empty for individual formats.
      teams: [],
      // Wolf: per-hole decision { partnerId: id|null, lone: bool, blind: bool }.
      wolfPicks: {},
      // Bingo Bango Bongo: per-hole winners { bingo, bango, bongo } (id or null).
      bbbFlags: {},
      // Manual skins (greenie/sandie): per-hole achievers that stack, so each is
      // an array of playerIds. Shape: { [hole]: { greenie: [], sandie: [] } }.
      skinFlags: {},
      // Match Play: holes given to a side without finishing { [hole]: playerId }.
      concededHoles: {},
      currentHole: 1,
      status: 'setup',

      createRound: (roundData) =>
        set({
          round: {
            roundId: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            status: 'setup',
            currentHole: 1,
            pars: {},
            strokeIndex: {},
            ...roundData,
          },
          players: [],
          scores: {},
          bets: [],
          sideGameFlags: { closestToPin: {}, longestDrive: {} },
          teams: [],
          wolfPicks: {},
          bbbFlags: {},
          skinFlags: {},
          concededHoles: {},
          currentHole: 1,
          status: 'setup',
        }),

      // Patch an existing round's setup metadata (course, date, holes,
      // scoringType) without wiping players, scores, bets, or the course card —
      // used when the user navigates *back* to the first setup screen to edit.
      // The course card is rebuilt for the current hole count when they pass
      // back through the course-setup step, so a holes change self-heals there.
      updateRoundSetup: (roundData) =>
        set((state) => {
          if (!state.round) return {}
          return { round: { ...state.round, ...roundData } }
        }),

      addPlayer: (player) =>
        set((state) => ({
          players: [...state.players, player],
          scores: {
            ...state.scores,
            [player.id]: {},
          },
        })),

      // Replace the full roster (used by the player setup screen on Continue so
      // navigating back and forth doesn't append duplicates). Seeds an empty
      // score map for each player, preserving any scores already entered.
      setPlayers: (players) =>
        set((state) => ({
          players,
          scores: players.reduce(
            (acc, p) => ({ ...acc, [p.id]: state.scores[p.id] ?? {} }),
            {}
          ),
        })),

      // Set a single hole's par and/or stroke-index rank during setup.
      setHoleConfig: (hole, { par, strokeIndex } = {}) =>
        set((state) => {
          if (!state.round) return {}
          return {
            round: {
              ...state.round,
              pars:
                par == null
                  ? state.round.pars
                  : { ...state.round.pars, [hole]: par },
              strokeIndex:
                strokeIndex == null
                  ? state.round.strokeIndex
                  : { ...state.round.strokeIndex, [hole]: strokeIndex },
            },
          }
        }),

      // Bulk-set the whole course card at once (e.g. from a setup grid).
      setCourseConfig: ({ pars, strokeIndex } = {}) =>
        set((state) => {
          if (!state.round) return {}
          return {
            round: {
              ...state.round,
              pars: pars ?? state.round.pars,
              strokeIndex: strokeIndex ?? state.round.strokeIndex,
            },
          }
        }),

      // Derived: per-player handicap strokes by hole, using the captured stroke index.
      // Feeds buildLeaderboard / calculateNassau / calculateSkins directly.
      getStrokeAllocations: () => {
        const { players, round } = get()
        const totalHoles = round?.holes ?? 18
        return buildStrokeAllocations(players, totalHoles, round?.strokeIndex ?? null)
      },

      updateScore: (playerId, hole, strokes) =>
        set((state) => ({
          scores: {
            ...state.scores,
            [playerId]: {
              ...state.scores[playerId],
              [hole]: strokes,
            },
          },
        })),

      // Move to a specific hole (kept mirrored on the round for persistence).
      setCurrentHole: (hole) =>
        set((state) => ({
          currentHole: hole,
          round: state.round
            ? { ...state.round, currentHole: hole }
            : state.round,
        })),

      // Flip the round into scoring mode the first time the scoring screen opens.
      startScoring: () =>
        set((state) =>
          state.status === 'in_progress'
            ? {}
            : {
                status: 'in_progress',
                round: state.round
                  ? { ...state.round, status: 'in_progress' }
                  : state.round,
              }
        ),

      addBet: (bet) =>
        set((state) => ({
          bets: [...state.bets, bet],
        })),

      // Replace the full bet list (used by the betting setup screen on Start
      // Round so navigating back and forth doesn't append duplicates).
      setBets: (bets) => set({ bets }),

      flagCTP: (hole, playerId) =>
        set((state) => ({
          sideGameFlags: {
            ...state.sideGameFlags,
            closestToPin: {
              ...state.sideGameFlags.closestToPin,
              [hole]: playerId,
            },
          },
        })),

      flagLD: (hole, playerId) =>
        set((state) => ({
          sideGameFlags: {
            ...state.sideGameFlags,
            longestDrive: {
              ...state.sideGameFlags.longestDrive,
              [hole]: playerId,
            },
          },
        })),

      completeRound: () =>
        set((state) => ({
          status: 'complete',
          round: state.round ? { ...state.round, status: 'complete' } : null,
        })),

      // Wipe the live round back to a clean slate (used by "New Round"). History
      // lives in its own store, so this never touches saved rounds.
      resetRound: () =>
        set({
          round: null,
          players: [],
          scores: {},
          bets: [],
          sideGameFlags: { closestToPin: {}, longestDrive: {} },
          teams: [],
          wolfPicks: {},
          bbbFlags: {},
          skinFlags: {},
          concededHoles: {},
          currentHole: 1,
          status: 'setup',
        }),

      // Scramble: replace the team list. Seeds an empty score map per team
      // (scores are keyed by teamId in scramble), preserving any existing scores.
      setTeams: (teams) =>
        set((state) => ({
          teams,
          scores: teams.reduce(
            (acc, t) => ({ ...acc, [t.id]: state.scores[t.id] ?? {} }),
            {}
          ),
        })),

      // Wolf: record this hole's decision. Pass partnerId null for Lone Wolf;
      // blind = forced/early Lone Wolf (double value).
      setWolfPick: (hole, { partnerId = null, lone = false, blind = false } = {}) =>
        set((state) => ({
          wolfPicks: {
            ...state.wolfPicks,
            [hole]: { partnerId, lone: lone || partnerId == null, blind },
          },
        })),

      // Wolf: clear this hole's decision (Undo).
      clearWolfPick: (hole) =>
        set((state) => {
          const next = { ...state.wolfPicks }
          delete next[hole]
          return { wolfPicks: next }
        }),

      // Bingo Bango Bongo: flag a winner for one of the three points on a hole.
      // type is 'bingo' | 'bango' | 'bongo'.
      flagBBB: (hole, type, playerId) =>
        set((state) => ({
          bbbFlags: {
            ...state.bbbFlags,
            [hole]: { ...state.bbbFlags[hole], [type]: playerId },
          },
        })),

      // Manual skins: Greenie is a single CTP-style winner, Sandie can stack for
      // multiple players. Shape stays arrays for persistence compatibility.
      toggleSkinFlag: (hole, type, playerId) =>
        set((state) => {
          const holeFlags = state.skinFlags[hole] ?? {}
          const current = holeFlags[type] ?? []
          const next = type === 'greenie'
            ? (current.includes(playerId) ? [] : [playerId])
            : current.includes(playerId)
              ? current.filter((id) => id !== playerId)
              : [...current, playerId]
          return {
            skinFlags: {
              ...state.skinFlags,
              [hole]: { ...holeFlags, [type]: next },
            },
          }
        }),

      // Match Play: concede a hole to a player (they win it without finishing).
      // Pass null to clear the concession.
      concedeHole: (hole, playerId) =>
        set((state) => {
          const next = { ...state.concededHoles }
          if (playerId == null) delete next[hole]
          else next[hole] = playerId
          return { concededHoles: next }
        }),

      /** Replace local state from a live_rounds.state payload (viewers / reconnect). */
      hydrateFromLiveState: (liveState) => {
        if (!liveState) return
        set({
          round: liveState.round ?? null,
          players: liveState.players ?? [],
          scores: liveState.scores ?? {},
          bets: liveState.bets ?? [],
          teams: liveState.teams ?? [],
          sideGameFlags: liveState.sideGameFlags ?? { closestToPin: {}, longestDrive: {} },
          wolfPicks: liveState.wolfPicks ?? {},
          bbbFlags: liveState.bbbFlags ?? {},
          skinFlags: liveState.skinFlags ?? {},
          concededHoles: liveState.concededHoles ?? {},
          currentHole: liveState.currentHole ?? 1,
          status: liveState.status ?? 'in_progress',
        })
      },
    }),
    { name: 'golf-round-state' }
  )
)

export default useRoundStore
