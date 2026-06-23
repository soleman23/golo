import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import Button from '../components/shared/Button'
import BetCard from '../components/betting/BetCard'
import BetConfigModal from '../components/betting/BetConfigModal'

/**
 * Static metadata + default config for each supported game. Config shapes are
 * engine-ready (see nassau.js / skins.js); Stroke Purse, CTP and Longest Drive
 * persist config for a future engine. `holeNumbers`/`par3Holes` resolve their
 * hole-pickers at render time from the round's par data.
 */
const BET_DEFS = [
  {
    type: 'nassau',
    icon: '🏆',
    name: 'Nassau',
    description: 'Front 9, Back 9 & Overall',
    defaults: { frontAmount: 5, backAmount: 5, overallAmount: 5, style: 'match', autoPress: false },
  },
  {
    type: 'skins',
    icon: '🎯',
    name: 'Skins',
    description: 'Win holes outright for cash',
    defaults: { valuePerSkin: 2, carryover: true, useNetScores: true },
  },
  {
    type: 'strokePurse',
    icon: '💰',
    name: 'Stroke Purse',
    description: 'Lowest net score wins the pot',
    defaults: { mode: 'entry', entryFee: 10, totalPurse: 40, payTop: 1, splitTies: true },
  },
  {
    type: 'ctp',
    icon: '📍',
    name: 'Closest to Pin',
    description: 'Par 3s only',
    defaults: { amount: 5, holes: [] }, // holes seeded from par data on enable
  },
  {
    type: 'longestDrive',
    icon: '🚀',
    name: 'Longest Drive',
    description: 'Single hole challenge',
    defaults: { amount: 5, hole: null },
  },
  {
    type: 'wolf',
    icon: '🐺',
    name: 'Wolf',
    description: '4-player rotating teams',
    defaults: { unit: 1 },
    requiresExactly: 4, // only valid with exactly 4 players
  },
  {
    type: 'bingobangobongo',
    icon: '🟢',
    name: 'Bingo Bango Bongo',
    description: '3 points per hole',
    defaults: { valuePerPoint: 1 },
  },
]

const DEF_BY_TYPE = Object.fromEntries(BET_DEFS.map((d) => [d.type, d]))

/** Headline "$N" amount used in the summary line for a given bet. */
function headlineAmount(type, config) {
  switch (type) {
    case 'nassau':
      return config.frontAmount
    case 'skins':
      return config.valuePerSkin
    case 'strokePurse':
      return config.mode === 'entry' ? config.entryFee : config.totalPurse
    case 'wolf':
      return config.unit
    case 'bingobangobongo':
      return config.valuePerPoint
    default:
      return config.amount
  }
}

/**
 * Worst-case amount a single player can lose on a bet — summed across active
 * bets for the "max exposure" line. Auto-press is unbounded so it's excluded.
 */
function maxExposure(type, config, ctx) {
  switch (type) {
    case 'nassau':
      return config.frontAmount + config.backAmount + config.overallAmount
    case 'skins':
      // Could lose every skin in the round.
      return config.valuePerSkin * ctx.holeNumbers.length
    case 'strokePurse':
      return config.mode === 'entry'
        ? config.entryFee
        : Math.round(config.totalPurse / Math.max(1, ctx.playerCount))
    case 'ctp':
      return config.amount * config.holes.length
    case 'longestDrive':
      return config.hole == null ? 0 : config.amount
    case 'wolf':
      // Worst case: lose a blind Lone Wolf (2 units) on every hole.
      return config.unit * 2 * ctx.holeNumbers.length
    case 'bingobangobongo':
      // Worst case: forfeit your equal share of all 3 points every hole.
      return config.valuePerPoint * 3 * ctx.holeNumbers.length
    default:
      return 0
  }
}

/** Build the persisted bet record (matches the Bets data model). */
function toBet(type, config, playerIds) {
  return {
    id: crypto.randomUUID(),
    type,
    playerIds,
    amount: headlineAmount(type, config),
    config,
  }
}

export default function BettingSetupPage() {
  const navigate = useNavigate()
  const round = useRoundStore((s) => s.round)
  const players = useRoundStore((s) => s.players)
  const setBets = useRoundStore((s) => s.setBets)

  // Hole + par context for the pickers and exposure math.
  const ctx = useMemo(() => {
    const totalHoles = round?.holes ?? 18
    const holeNumbers = Array.from({ length: totalHoles }, (_, i) => i + 1)
    const pars = round?.pars ?? {}
    const par3Holes = holeNumbers.filter((h) => pars[h] === 3)
    return { holeNumbers, par3Holes, playerCount: players.length }
  }, [round, players.length])

  // Lazy-init from any bets already saved (so back/forward keeps choices).
  const [enabled, setEnabled] = useState(() => {
    const saved = useRoundStore.getState().bets
    return Object.fromEntries(
      BET_DEFS.map((d) => [d.type, saved.some((b) => b.type === d.type)])
    )
  })
  const [configs, setConfigs] = useState(() => {
    const saved = useRoundStore.getState().bets
    return Object.fromEntries(
      BET_DEFS.map((d) => {
        const existing = saved.find((b) => b.type === d.type)
        return [d.type, existing ? existing.config : d.defaults]
      })
    )
  })
  const [openType, setOpenType] = useState(null)

  const toggle = (type) =>
    setEnabled((e) => {
      const next = !e[type]
      // Seed CTP holes from par-3 data the first time it's switched on.
      if (next && type === 'ctp') {
        setConfigs((c) =>
          c.ctp.holes.length === 0
            ? { ...c, ctp: { ...c.ctp, holes: ctx.par3Holes } }
            : c
        )
      }
      return { ...e, [type]: next }
    })

  const saveConfig = (type, draft) =>
    setConfigs((c) => ({ ...c, [type]: draft }))

  const activeTypes = BET_DEFS.filter(
    (d) =>
      enabled[d.type] &&
      (d.requiresExactly == null || players.length === d.requiresExactly)
  ).map((d) => d.type)

  const playerIds = players.map((p) => p.id)
  const totalExposure = activeTypes.reduce(
    (sum, type) => sum + maxExposure(type, configs[type], ctx),
    0
  )
  const summary =
    activeTypes.length === 0
      ? null
      : activeTypes
          .map((type) => `${DEF_BY_TYPE[type].name} $${headlineAmount(type, configs[type])}`)
          .join(', ')

  const startRound = () => {
    setBets(activeTypes.map((type) => toBet(type, configs[type], playerIds)))
    navigate('/scoring')
  }

  /** Per-card config summary shown under the name when enabled. */
  const cardSummary = (type) => {
    const c = configs[type]
    switch (type) {
      case 'nassau':
        return `$${c.frontAmount}/$${c.backAmount}/$${c.overallAmount} · ${
          (c.style ?? 'match') === 'stroke' ? 'stroke' : 'match'
        }${c.style !== 'stroke' && c.autoPress ? ' · auto-press' : ''}`
      case 'skins':
        return `$${c.valuePerSkin}/skin${c.carryover ? ' · carryover' : ''}`
      case 'strokePurse':
        return c.mode === 'entry'
          ? `$${c.entryFee} entry · pays top ${c.payTop}`
          : `$${c.totalPurse} pot · pays top ${c.payTop}`
      case 'ctp':
        return `$${c.amount} · ${c.holes.length} hole${c.holes.length === 1 ? '' : 's'}`
      case 'longestDrive':
        return c.hole == null ? `$${c.amount} · pick a hole` : `$${c.amount} · hole ${c.hole}`
      case 'wolf':
        return `$${c.unit}/unit · 4 players`
      case 'bingobangobongo':
        return `$${c.valuePerPoint}/point`
      default:
        return ''
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex-1 px-5 pt-8 pb-40">
        <h1 className="text-2xl font-bold text-gray-900">Choose Betting Games</h1>
        <p className="mt-1 text-sm text-gray-500">
          Optional — tap to configure each game
        </p>

        <div className="mt-6 space-y-3">
          {BET_DEFS.map((d) => {
            const disabled =
              d.requiresExactly != null && players.length !== d.requiresExactly
            return (
              <BetCard
                key={d.type}
                icon={d.icon}
                name={d.name}
                description={d.description}
                enabled={enabled[d.type]}
                summary={cardSummary(d.type)}
                disabled={disabled}
                disabledNote={
                  disabled ? `Needs exactly ${d.requiresExactly} players` : undefined
                }
                onToggle={() => toggle(d.type)}
                onConfigure={() => setOpenType(d.type)}
              />
            )
          })}
        </div>

        <button
          type="button"
          onClick={startRound}
          className="mt-6 min-h-[44px] text-sm font-semibold text-gray-500 active:text-gray-700"
        >
          Skip Betting
        </button>
      </div>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 inset-x-0 px-5 py-4 bg-white border-t border-gray-100">
        {summary && (
          <p className="mb-2 text-xs text-center text-gray-500">
            Active: {summary} —{' '}
            <span className="font-semibold text-gray-700">
              ${totalExposure} max exposure per player
            </span>
          </p>
        )}
        <Button onClick={startRound}>Start Round →</Button>
      </div>

      {openType && (
        <BetConfigModal
          type={openType}
          title={DEF_BY_TYPE[openType].name}
          config={configs[openType]}
          context={ctx}
          onSave={(draft) => saveConfig(openType, draft)}
          onClose={() => setOpenType(null)}
        />
      )}
    </div>
  )
}
