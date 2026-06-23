import { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import useRoundStore from '../store/roundStore'
import { validateStrokeIndex } from '../engines/handicap'
import Button from '../components/shared/Button'

const PAR_OPTIONS = [3, 4, 5]

/**
 * Build the editable hole list, seeded from any par/stroke-index already on the
 * round (so back/forward keeps edits) and falling back to sensible, *valid*
 * defaults: par 4 and stroke index = hole number (a valid 1..N permutation).
 */
function initialHoles(totalHoles, pars, strokeIndex) {
  return Array.from({ length: totalHoles }, (_, i) => {
    const hole = i + 1
    return {
      hole,
      par: pars?.[hole] ?? 4,
      si: strokeIndex?.[hole] ?? hole,
    }
  })
}

export default function CourseSetupPage() {
  const navigate = useNavigate()
  const round = useRoundStore((s) => s.round)
  const setCourseConfig = useRoundStore((s) => s.setCourseConfig)
  const totalHoles = round?.holes ?? 18

  const [holes, setHoles] = useState(() =>
    initialHoles(totalHoles, round?.pars, round?.strokeIndex)
  )

  const setPar = (hole, par) =>
    setHoles((hs) => hs.map((h) => (h.hole === hole ? { ...h, par } : h)))

  const setSi = (hole, raw) => {
    if (raw === '') return setHoles((hs) => hs.map((h) => (h.hole === hole ? { ...h, si: '' } : h)))
    const n = Math.max(1, Math.min(totalHoles, Math.round(Number(raw))))
    if (Number.isNaN(n)) return
    setHoles((hs) => hs.map((h) => (h.hole === hole ? { ...h, si: n } : h)))
  }

  // Par totals (front / back / total) for a quick sanity check.
  const totals = useMemo(() => {
    const front = holes.filter((h) => h.hole <= 9).reduce((s, h) => s + h.par, 0)
    const back = holes.filter((h) => h.hole > 9).reduce((s, h) => s + h.par, 0)
    return { front, back, total: front + back }
  }, [holes])

  // Validate the stroke index (1..N, unique). Non-blocking — defaults are valid,
  // but a manual edit can create a duplicate/gap we want to warn about.
  const strokeIndexMap = useMemo(() => {
    const map = {}
    holes.forEach((h) => {
      if (h.si !== '') map[h.hole] = h.si
    })
    return map
  }, [holes])
  const validation = useMemo(
    () => validateStrokeIndex(strokeIndexMap, totalHoles),
    [strokeIndexMap, totalHoles]
  )

  const handleContinue = () => {
    const pars = {}
    const strokeIndex = {}
    holes.forEach((h) => {
      pars[h.hole] = h.par
      // Fall back to hole number if a stroke index was left blank.
      strokeIndex[h.hole] = h.si === '' ? h.hole : h.si
    })
    setCourseConfig({ pars, strokeIndex })
    navigate('/setup/players')
  }

  // No round in progress — bounce back to the start of setup.
  if (!round) return <Navigate to="/setup" replace />

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex-1 px-5 pt-8 pb-32">
        <h1 className="text-2xl font-bold text-gray-900">Course Card</h1>
        <p className="mt-1 text-sm text-gray-500">
          Set par and stroke index for each hole. Defaults work if you’re not sure.
        </p>

        {/* Par totals */}
        <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
          <span>
            Out <span className="font-semibold text-gray-900">{totals.front}</span>
          </span>
          {totalHoles > 9 && (
            <span>
              In <span className="font-semibold text-gray-900">{totals.back}</span>
            </span>
          )}
          <span className="ml-auto">
            Total <span className="font-semibold text-gray-900">{totals.total}</span>
          </span>
        </div>

        {/* Column labels */}
        <div className="mt-5 flex items-center gap-3 px-1 text-xs font-medium uppercase tracking-wide text-gray-400">
          <span className="w-12">Hole</span>
          <span className="flex-1">Par</span>
          <span className="w-20 text-right">Stroke Idx</span>
        </div>

        {/* Hole rows */}
        <div className="mt-2 divide-y divide-gray-100">
          {holes.map((h) => (
            <div key={h.hole} className="flex items-center gap-3 py-2.5">
              <span className="w-12 text-lg font-bold text-gray-900 tabular-nums">
                {h.hole}
              </span>

              {/* Par selector */}
              <div className="flex flex-1 gap-2">
                {PAR_OPTIONS.map((p) => {
                  const selected = h.par === p
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPar(h.hole, p)}
                      aria-pressed={selected}
                      aria-label={`Hole ${h.hole} par ${p}`}
                      className={`flex-1 min-h-[44px] rounded-xl text-base font-semibold border transition-colors ${
                        selected
                          ? 'bg-green-700 text-white border-green-700'
                          : 'bg-white text-gray-700 border-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>

              {/* Stroke index */}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={totalHoles}
                value={h.si}
                onChange={(e) => setSi(h.hole, e.target.value)}
                aria-label={`Hole ${h.hole} stroke index`}
                className="w-20 min-h-[44px] px-3 text-center text-lg text-gray-900 bg-white rounded-xl border border-gray-200 outline-none focus:border-green-600 tabular-nums"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Fixed continue bar */}
      <div className="fixed bottom-0 inset-x-0 px-5 py-4 bg-white border-t border-gray-100">
        {!validation.valid && (
          <p className="mb-2 text-xs text-center text-amber-600">
            Stroke index should use each number 1–{totalHoles} once. You can still continue.
          </p>
        )}
        <Button onClick={handleContinue}>Continue →</Button>
      </div>
    </div>
  )
}
