import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import { calculateCourseHandicap } from '../engines/handicap'
import Button from '../components/shared/Button'
import TextInput from '../components/shared/TextInput'

const MAX_PLAYERS = 8

// Palette stored as the `color` string on each player (see data model).
const COLORS = [
  { id: 'teal', hex: '#14b8a6' },
  { id: 'red', hex: '#ef4444' },
  { id: 'blue', hex: '#3b82f6' },
  { id: 'orange', hex: '#f97316' },
  { id: 'purple', hex: '#a855f7' },
  { id: 'yellow', hex: '#eab308' },
]

/** First palette color not already used by another row. */
const nextColor = (rows) => {
  const taken = new Set(rows.map((r) => r.color))
  return (COLORS.find((c) => !taken.has(c.id)) ?? COLORS[0]).id
}

// Scramble team colors (CSS colors, matching the player-color convention).
const TEAM_DEFS = [
  { id: 'teamA', key: 'A', name: 'Team A', color: 'green' },
  { id: 'teamB', key: 'B', name: 'Team B', color: 'blue' },
]

/** Balance teams: assign the next row to whichever team has fewer rows. */
const nextTeam = (rows) => {
  const a = rows.filter((r) => r.team === 'A').length
  const b = rows.filter((r) => r.team === 'B').length
  return a <= b ? 'A' : 'B'
}

/** A fresh empty row with an auto-assigned, unused color and balanced team. */
const emptyRow = (rows) => ({
  key: crypto.randomUUID(),
  name: '',
  handicapIndex: '',
  color: nextColor(rows),
  team: nextTeam(rows),
})

/** Initial rows: existing roster from the store, else two empty rows (min). */
const initialRows = (storedPlayers, storedTeams) => {
  const teamOf = (id) =>
    storedTeams.find((t) => t.playerIds?.includes(id))?.id === 'teamB' ? 'B' : 'A'
  if (storedPlayers.length > 0) {
    return storedPlayers.map((p, i) => ({
      key: p.id,
      name: p.name,
      handicapIndex: p.handicapIndex == null ? '' : String(p.handicapIndex),
      color: p.color,
      team: storedTeams.length ? teamOf(p.id) : i % 2 === 0 ? 'A' : 'B',
    }))
  }
  const first = emptyRow([])
  return [first, emptyRow([first])]
}

export default function PlayerSetupPage() {
  const navigate = useNavigate()
  const setPlayers = useRoundStore((s) => s.setPlayers)
  const setTeams = useRoundStore((s) => s.setTeams)
  const scoringType = useRoundStore((s) => s.round?.scoringType)
  const isScramble = scoringType === 'scramble'

  // Read the roster once on mount via a lazy initializer (no effect needed).
  const [rows, setRows] = useState(() =>
    initialRows(useRoundStore.getState().players, useRoundStore.getState().teams)
  )

  const updateRow = (key, patch) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const removeRow = (key) => setRows((rs) => rs.filter((r) => r.key !== key))

  const addRow = () =>
    setRows((rs) => (rs.length >= MAX_PLAYERS ? rs : [...rs, emptyRow(rs)]))

  const handleHandicap = (key, raw) => {
    if (raw === '') return updateRow(key, { handicapIndex: '' })
    const n = Math.max(0, Math.min(54, Number(raw)))
    if (Number.isNaN(n)) return
    updateRow(key, { handicapIndex: String(n) })
  }

  const namedRows = rows.filter((r) => r.name.trim())
  const namedCount = namedRows.length
  const teamCounts = {
    A: namedRows.filter((r) => r.team === 'A').length,
    B: namedRows.filter((r) => r.team === 'B').length,
  }
  // Scramble needs at least one player on each team.
  const teamsOk = !isScramble || (teamCounts.A >= 1 && teamCounts.B >= 1)
  const canContinue = namedCount >= 2 && teamsOk

  const handleContinue = () => {
    if (!canContinue) return
    const players = namedRows.map((r) => {
      const handicapIndex = r.handicapIndex === '' ? 0 : Number(r.handicapIndex)
      return {
        id: r.key,
        name: r.name.trim(),
        handicapIndex,
        // No tee/slope data is captured yet, so default to the neutral slope
        // (113), which makes course handicap = rounded handicap index.
        courseHandicap: calculateCourseHandicap(handicapIndex),
        color: r.color,
      }
    })
    setPlayers(players)

    if (isScramble) {
      const teams = TEAM_DEFS.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        playerIds: namedRows.filter((r) => r.team === t.key).map((r) => r.key),
      })).filter((t) => t.playerIds.length > 0)
      setTeams(teams)
    } else {
      setTeams([])
    }

    navigate('/setup/betting')
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex-1 px-5 pt-8 pb-28">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Add Players</h1>
          <span className="px-3 py-1 text-sm font-semibold text-green-800 bg-green-100 rounded-full">
            {rows.length} {rows.length === 1 ? 'player' : 'players'}
          </span>
        </div>

        {/* Player rows */}
        <div className="space-y-4">
          {rows.map((row) => {
            const takenByOthers = new Set(
              rows.filter((r) => r.key !== row.key).map((r) => r.color)
            )
            return (
              <div
                key={row.key}
                className="p-4 rounded-xl border border-gray-200 space-y-3"
              >
                <div className="flex items-center gap-3">
                  <TextInput
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    placeholder="Player name"
                    ariaLabel="Player name"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(row.key)}
                    aria-label="Remove player"
                    className="flex items-center justify-center min-w-[48px] min-h-[48px] text-2xl text-gray-400 active:text-red-500"
                  >
                    ×
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {/* Handicap */}
                  <div className="w-24">
                    <TextInput
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={54}
                      value={row.handicapIndex}
                      onChange={(e) => handleHandicap(row.key, e.target.value)}
                      placeholder="--"
                      ariaLabel="Handicap index"
                    />
                  </div>
                  <span className="text-sm text-gray-400">handicap</span>

                  {/* Color picker */}
                  <div className="flex items-center gap-2 ml-auto">
                    {!isScramble && COLORS.map((c) => {
                      const selected = row.color === c.id
                      const disabled = !selected && takenByOthers.has(c.id)
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => updateRow(row.key, { color: c.id })}
                          aria-label={`Color ${c.id}`}
                          aria-pressed={selected}
                          className={`w-7 h-7 rounded-full transition-transform ${
                            selected
                              ? 'ring-2 ring-offset-2 ring-gray-900 scale-110'
                              : ''
                          } ${disabled ? 'opacity-20' : ''}`}
                          style={{ backgroundColor: c.hex }}
                        />
                      )
                    })}
                  </div>
                </div>

                {/* Scramble team assignment */}
                {isScramble && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-400">Team</span>
                    <div className="flex gap-2 ml-auto">
                      {TEAM_DEFS.map((t) => {
                        const selected = row.team === t.key
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => updateRow(row.key, { team: t.key })}
                            aria-pressed={selected}
                            className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold border transition-colors ${
                              selected
                                ? 'text-white border-transparent'
                                : 'bg-white text-gray-700 border-gray-200'
                            }`}
                            style={selected ? { backgroundColor: t.color } : undefined}
                          >
                            {t.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Add player */}
        {rows.length < MAX_PLAYERS && (
          <button
            type="button"
            onClick={addRow}
            className="mt-4 min-h-[48px] text-lg font-semibold text-green-700 active:text-green-800"
          >
            + Add Player
          </button>
        )}
      </div>

      {/* Fixed continue bar */}
      <div className="fixed bottom-0 inset-x-0 px-5 py-4 bg-white border-t border-gray-100">
        {!canContinue && (
          <p className="mb-2 text-xs text-center text-gray-400">
            {namedCount < 2
              ? 'Add at least 2 players to continue'
              : 'Each team needs at least one player'}
          </p>
        )}
        <Button onClick={handleContinue} disabled={!canContinue}>
          Continue →
        </Button>
      </div>
    </div>
  )
}
