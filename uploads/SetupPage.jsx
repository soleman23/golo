import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import useHistoryStore from '../store/historyStore'
import Button from '../components/shared/Button'
import TextInput from '../components/shared/TextInput'

const SCORING_TYPES = [
  { id: 'stroke', label: 'Stroke Play', enabled: true },
  { id: 'stableford', label: 'Stableford', enabled: true },
  { id: 'matchplay', label: 'Match Play', enabled: true },
  { id: 'scramble', label: 'Scramble', enabled: true },
]

const today = () => new Date().toISOString().slice(0, 10)

export default function SetupPage() {
  const navigate = useNavigate()
  const createRound = useRoundStore((s) => s.createRound)
  const updateRoundSetup = useRoundStore((s) => s.updateRoundSetup)
  const existingRound = useRoundStore((s) => s.round)
  const historyCount = useHistoryStore((s) => s.rounds.length)

  const [course, setCourse] = useState(existingRound?.course ?? '')
  const [date, setDate] = useState(existingRound?.date ?? today())
  const [holes, setHoles] = useState(existingRound?.holes ?? 18)
  const [scoringType, setScoringType] = useState(
    existingRound?.scoringType ?? 'stroke'
  )

  const handleContinue = () => {
    const data = { course: course.trim(), date, holes, scoringType }
    // Editing an existing round preserves players/scores/bets/course card;
    // a fresh start creates a clean round.
    if (existingRound) {
      updateRoundSetup(data)
    } else {
      createRound(data)
    }
    navigate('/setup/course')
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex-1 px-5 pt-8 pb-28 space-y-7">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">New Round</h1>
          {historyCount > 0 && (
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="min-h-[44px] px-2 text-sm font-semibold text-green-700 active:text-green-800"
            >
              History ({historyCount})
            </button>
          )}
        </div>

        {/* Course name */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-600">
            Course Name
          </label>
          <TextInput
            value={course}
            onChange={(e) => setCourse(e.target.value)}
            placeholder="e.g. Pebble Beach"
            autoFocus
            ariaLabel="Course name"
          />
        </div>

        {/* Date */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-600">Date</label>
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            ariaLabel="Round date"
          />
        </div>

        {/* Holes toggle */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-600">Holes</label>
          <div className="grid grid-cols-2 gap-3">
            {[9, 18].map((n) => {
              const selected = holes === n
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHoles(n)}
                  className={`min-h-[48px] h-12 rounded-xl text-lg font-semibold border transition-colors ${
                    selected
                      ? 'bg-green-700 text-white border-green-700'
                      : 'bg-white text-gray-700 border-gray-200'
                  }`}
                >
                  {n} holes
                </button>
              )
            })}
          </div>
        </div>

        {/* Scoring type */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-600">
            Scoring
          </label>
          <div className="grid grid-cols-2 gap-3">
            {SCORING_TYPES.map((type) => {
              const selected = scoringType === type.id
              return (
                <button
                  key={type.id}
                  type="button"
                  disabled={!type.enabled}
                  onClick={() => type.enabled && setScoringType(type.id)}
                  className={`min-h-[48px] h-12 rounded-xl text-base font-semibold border transition-colors ${
                    selected
                      ? 'bg-green-700 text-white border-green-700'
                      : type.enabled
                        ? 'bg-white text-gray-700 border-gray-200'
                        : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                  }`}
                >
                  {type.label}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-gray-400">
            Scramble plays in teams; Wolf & Bingo Bango Bongo are set up as bets.
          </p>
        </div>
      </div>

      {/* Fixed continue bar */}
      <div className="fixed bottom-0 inset-x-0 px-5 py-4 bg-white border-t border-gray-100">
        <Button onClick={handleContinue}>Continue →</Button>
      </div>
    </div>
  )
}
