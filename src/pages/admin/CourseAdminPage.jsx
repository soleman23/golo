import { useEffect, useMemo, useState } from 'react'
import { adminListCourses, adminSetCourseVisibility, adminUpsertCourse } from '../../lib/db/admin'
import { getCourseImage } from '../../lib/courseImages'
import {
  COURSE_HOLES,
  isCourseReadyForSetup,
  normalizeCourseForSave,
  slugifyCourseName,
  validateCourseForSetup,
} from '../../lib/courseValidation'
import useAdminDesk from './useAdminDesk'

const ACCENT = '#d4f23a'
const DARK_TEXT = '#13250a'

const emptyScorecard = () => Object.fromEntries(COURSE_HOLES.map((h) => [h, '']))

const blankCourse = () => ({
  id: '',
  name: '',
  loc: '',
  holes: 18,
  bg: '',
  latitude: '',
  longitude: '',
  pars: emptyScorecard(),
  strokeIndex: emptyScorecard(),
  tees: [],
  visibleInSetup: false,
  ghinFacilityId: '',
  ghinCourseId: '',
  ghinTeeSets: {},
})

const blankTee = () => ({
  name: '',
  color: '#1f2937',
  yards: '',
  rating: '',
  slope: '',
  par: '',
})

const toDraft = (course) => ({
  ...blankCourse(),
  ...course,
  loc: course.loc ?? '',
  bg: course.bg ?? '',
  latitude: course.latitude ?? '',
  longitude: course.longitude ?? '',
  pars: Object.fromEntries(COURSE_HOLES.map((h) => [h, course.pars?.[h] ?? ''])),
  strokeIndex: Object.fromEntries(COURSE_HOLES.map((h) => [h, course.strokeIndex?.[h] ?? ''])),
  tees: (course.tees ?? []).map((tee) => ({
    name: tee.name ?? '',
    color: tee.color ?? '#1f2937',
    yards: tee.yards ?? '',
    rating: tee.rating ?? '',
    slope: tee.slope ?? '',
    par: tee.par ?? '',
  })),
  ghinFacilityId: course.ghinFacilityId ?? '',
  ghinCourseId: course.ghinCourseId ?? '',
  ghinTeeSets: course.ghinTeeSets ?? {},
})

const friendlyError = (error) => {
  const message = error?.message ?? ''
  if (message.includes('course_not_ready_for_setup')) return 'This course needs a complete scorecard and tee set before it can be shown in setup.'
  if (message.includes('not authorized')) return 'You are not authorized to manage courses.'
  return message || 'Something went wrong.'
}

function Stat({ label, value }) {
  return (
    <div style={S.stat}>
      <div style={S.statValue}>{value}</div>
      <div style={S.statLabel}>{label}</div>
    </div>
  )
}

export default function CourseAdminPage() {
  const { refreshKey } = useAdminDesk()
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(() => blankCourse())
  const [selectedId, setSelectedId] = useState('new')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function boot() {
      setLoading(true)
      const res = await adminListCourses()
      if (!active) return
      setCourses(res.courses)
      setLoading(false)
      if (res.error) setError(friendlyError(res.error))
    }
    boot()
    return () => {
      active = false
    }
  }, [refreshKey])

  const validationErrors = useMemo(() => validateCourseForSetup(draft), [draft])
  const ready = validationErrors.length === 0
  const idPreview = draft.id || slugifyCourseName(draft.name) || 'generated-after-name'
  const visibleCount = courses.filter((course) => course.visibleInSetup).length
  const readyCount = courses.filter((course) => isCourseReadyForSetup(course)).length
  const filteredCourses = courses.filter((course) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return `${course.name} ${course.loc} ${course.id}`.toLowerCase().includes(needle)
  })

  const refreshCourses = async () => {
    setLoading(true)
    const res = await adminListCourses()
    setLoading(false)
    if (res.error) {
      setError(friendlyError(res.error))
      return
    }
    setCourses(res.courses)
  }

  const replaceCourse = (course) => {
    setCourses((items) => {
      const exists = items.some((item) => item.id === course.id)
      const next = exists ? items.map((item) => (item.id === course.id ? course : item)) : [course, ...items]
      return next.sort((a, b) => Number(b.visibleInSetup) - Number(a.visibleInSetup) || a.name.localeCompare(b.name))
    })
  }

  const selectCourse = (course) => {
    setSelectedId(course.id)
    setDraft(toDraft(course))
    setNotice('')
    setError('')
  }

  const startNew = () => {
    setSelectedId('new')
    setDraft(blankCourse())
    setNotice('')
    setError('')
  }

  const patchDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }))
  }

  const setHole = (hole, key, value) => {
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], [hole]: value },
    }))
  }

  const setTee = (index, key, value) => {
    setDraft((current) => ({
      ...current,
      tees: current.tees.map((tee, i) => (i === index ? { ...tee, [key]: value } : tee)),
    }))
  }

  const addTee = () => {
    setDraft((current) => ({ ...current, tees: [...current.tees, blankTee()] }))
  }

  const removeTee = (index) => {
    setDraft((current) => ({ ...current, tees: current.tees.filter((_, i) => i !== index) }))
  }

  const setGhinTee = (teeName, value) => {
    setDraft((current) => ({
      ...current,
      ghinTeeSets: { ...current.ghinTeeSets, [teeName]: value },
    }))
  }

  const save = async (publish) => {
    setNotice('')
    setError('')
    if (publish && !ready) {
      setError('Fix the course setup issues before showing this course in setup.')
      return
    }
    // Publish forces visible; otherwise preserve current visibility so edits
    // to a live course do not silently unpublish it. Use Hide/Show to toggle.
    const visibleInSetup = publish ? true : !!draft.visibleInSetup
    setSaving(publish ? 'publish' : 'save')
    const payload = { ...normalizeCourseForSave(draft), visibleInSetup }
    const res = await adminUpsertCourse(payload)
    setSaving(null)
    if (res.error) {
      setError(friendlyError(res.error))
      return
    }
    replaceCourse(res.course)
    setDraft(toDraft(res.course))
    setSelectedId(res.course.id)
    setNotice(
      publish
        ? 'Course saved and shown in setup.'
        : visibleInSetup
          ? 'Course saved.'
          : 'Hidden draft saved.',
    )
  }

  const toggleVisibility = async (course) => {
    setNotice('')
    setError('')
    const nextVisible = !course.visibleInSetup
    if (nextVisible && !isCourseReadyForSetup(course)) {
      setError(`${course.name} needs a complete scorecard and tee set before it can be shown in setup.`)
      return
    }
    setSaving(`visibility:${course.id}`)
    const res = await adminSetCourseVisibility(course.id, nextVisible)
    setSaving(null)
    if (res.error) {
      setError(friendlyError(res.error))
      return
    }
    replaceCourse(res.course)
    if (selectedId === course.id) setDraft(toDraft(res.course))
    setNotice(nextVisible ? 'Course is now visible in setup.' : 'Course is hidden from setup.')
  }

  return (
    <div style={S.embed}>
        <div style={S.sectionHeadRow}>
          <div>
            <div style={S.kicker}>COURSES</div>
            <h1 style={S.title}>Catalogue</h1>
          </div>
          <button type="button" onClick={refreshCourses} disabled={loading} style={S.ghostButton}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        <section style={S.stats}>
          <Stat label="Courses" value={courses.length} />
          <Stat label="Visible in setup" value={visibleCount} />
          <Stat label="Ready to publish" value={readyCount} />
        </section>

        {(notice || error) && (
          <div style={{ ...S.banner, ...(error ? S.bannerError : null) }}>
            {error || notice}
          </div>
        )}

        <div style={S.workspace}>
          <section style={S.listPane}>
            <div style={S.listTop}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search courses"
                style={S.search}
              />
              <button type="button" onClick={startNew} style={S.primaryButton}>New course</button>
            </div>

            <div style={S.table}>
              <div style={{ ...S.row, ...S.headingRow }}>
                <span>Name</span>
                <span>Status</span>
                <span>Tees</span>
                <span>GHIN</span>
                <span />
              </div>
              {filteredCourses.map((course) => {
                const setupReady = isCourseReadyForSetup(course)
                const selected = selectedId === course.id
                return (
                  <div
                    role="button"
                    tabIndex={0}
                    key={course.id}
                    onClick={() => selectCourse(course)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        selectCourse(course)
                      }
                    }}
                    style={{ ...S.row, ...S.courseRow, ...(selected ? S.selectedRow : null) }}
                  >
                    <span style={S.courseNameCell}>
                      <span style={{ ...S.thumb, backgroundImage: `url(${getCourseImage(course)})` }} />
                      <span>
                        <span style={S.courseName}>{course.name}</span>
                        <span style={S.courseLoc}>{course.loc || course.id}</span>
                      </span>
                    </span>
                    <span style={course.visibleInSetup ? S.statusOn : S.statusOff}>
                      {course.visibleInSetup ? 'Visible' : setupReady ? 'Ready' : 'Draft'}
                    </span>
                    <span style={S.muted}>{course.tees?.length ?? 0}</span>
                    <span style={course.ghinCourseId ? S.statusOn : S.statusOff}>
                      {course.ghinCourseId ? 'Mapped' : 'None'}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleVisibility(course)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleVisibility(course)
                        }
                      }}
                      style={{
                        ...S.smallAction,
                        opacity: saving === `visibility:${course.id}` ? 0.6 : 1,
                      }}
                    >
                      {course.visibleInSetup ? 'Hide' : 'Show'}
                    </span>
                  </div>
                )
              })}
              {!loading && filteredCourses.length === 0 && (
                <div style={S.empty}>No courses match that search.</div>
              )}
            </div>
          </section>

          <section style={S.editorPane}>
            <div style={S.editorHero}>
              <div style={{ ...S.editorImage, backgroundImage: `url(${getCourseImage(draft)})` }} />
              <div>
                <div style={S.kicker}>{selectedId === 'new' ? 'NEW COURSE' : 'EDIT COURSE'}</div>
                <h2 style={S.editorTitle}>{draft.name || 'Untitled course'}</h2>
                <p style={S.editorMeta}>{ready ? 'Ready to show in setup' : `${validationErrors.length} setup issue${validationErrors.length === 1 ? '' : 's'}`}</p>
              </div>
            </div>

            <div style={S.formGrid}>
              <label style={S.label}>
                Course name
                <input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} style={S.input} />
              </label>
              <label style={S.label}>
                Location
                <input value={draft.loc} onChange={(e) => patchDraft({ loc: e.target.value })} placeholder="City, ST" style={S.input} />
              </label>
              <label style={S.label}>
                Latitude
                <input
                  type="number"
                  step="any"
                  value={draft.latitude ?? ''}
                  onChange={(e) => patchDraft({ latitude: e.target.value })}
                  placeholder="44.0215"
                  style={S.input}
                />
              </label>
              <label style={S.label}>
                Longitude
                <input
                  type="number"
                  step="any"
                  value={draft.longitude ?? ''}
                  onChange={(e) => patchDraft({ longitude: e.target.value })}
                  placeholder="-121.3165"
                  style={S.input}
                />
              </label>
              <label style={S.label}>
                Course id
                <input value={idPreview} readOnly style={{ ...S.input, opacity: 0.72 }} />
              </label>
              <label style={S.label}>
                Image URL or path
                <input value={draft.bg ?? ''} onChange={(e) => patchDraft({ bg: e.target.value })} placeholder="/courses/course.png" style={S.input} />
              </label>
            </div>

            <section style={S.formSection}>
              <div style={S.sectionHead}>
                <div>
                  <div style={S.sectionTitle}>Scorecard</div>
                  <div style={S.sectionSub}>Par and stroke index for holes 1 to 18.</div>
                </div>
              </div>
              <div style={S.scoreGrid}>
                {COURSE_HOLES.map((hole) => (
                  <div key={hole} style={S.holeBox}>
                    <div style={S.holeNumber}>Hole {hole}</div>
                    <label style={S.miniLabel}>
                      Par
                      <input
                        type="number"
                        min="3"
                        max="6"
                        value={draft.pars?.[hole] ?? ''}
                        onChange={(e) => setHole(hole, 'pars', e.target.value)}
                        style={S.miniInput}
                      />
                    </label>
                    <label style={S.miniLabel}>
                      SI
                      <input
                        type="number"
                        min="1"
                        max="18"
                        value={draft.strokeIndex?.[hole] ?? ''}
                        onChange={(e) => setHole(hole, 'strokeIndex', e.target.value)}
                        style={S.miniInput}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </section>

            <section style={S.formSection}>
              <div style={S.sectionHead}>
                <div>
                  <div style={S.sectionTitle}>Tees</div>
                  <div style={S.sectionSub}>Each tee needs yards, rating, slope, and par.</div>
                </div>
                <button type="button" onClick={addTee} style={S.ghostButton}>Add tee</button>
              </div>

              {draft.tees.map((tee, index) => (
                <div key={index} style={S.teeRow}>
                  <input value={tee.name} onChange={(e) => setTee(index, 'name', e.target.value)} placeholder="Name" style={S.input} />
                  <input value={tee.color} onChange={(e) => setTee(index, 'color', e.target.value)} placeholder="#1f2937" style={S.input} />
                  <input type="number" value={tee.yards} onChange={(e) => setTee(index, 'yards', e.target.value)} placeholder="Yards" style={S.input} />
                  <input type="number" value={tee.rating} onChange={(e) => setTee(index, 'rating', e.target.value)} placeholder="Rating" style={S.input} />
                  <input type="number" value={tee.slope} onChange={(e) => setTee(index, 'slope', e.target.value)} placeholder="Slope" style={S.input} />
                  <input type="number" value={tee.par} onChange={(e) => setTee(index, 'par', e.target.value)} placeholder="Par" style={S.input} />
                  <button type="button" onClick={() => removeTee(index)} style={S.removeButton}>Remove</button>
                </div>
              ))}
              {draft.tees.length === 0 && <div style={S.empty}>No tees yet.</div>}
            </section>

            <section style={S.formSection}>
              <div style={S.sectionTitle}>GHIN mapping</div>
              <div style={S.formGrid}>
                <label style={S.label}>
                  Facility ID
                  <input value={draft.ghinFacilityId ?? ''} onChange={(e) => patchDraft({ ghinFacilityId: e.target.value })} style={S.input} />
                </label>
                <label style={S.label}>
                  Course ID
                  <input value={draft.ghinCourseId ?? ''} onChange={(e) => patchDraft({ ghinCourseId: e.target.value })} style={S.input} />
                </label>
              </div>
              <div style={S.ghinGrid}>
                {draft.tees.filter((tee) => tee.name?.trim()).map((tee) => (
                  <label key={tee.name} style={S.label}>
                    {tee.name} tee set ID
                    <input value={draft.ghinTeeSets?.[tee.name] ?? ''} onChange={(e) => setGhinTee(tee.name, e.target.value)} style={S.input} />
                  </label>
                ))}
              </div>
            </section>

            {!ready && (
              <div style={S.validationBox}>
                {validationErrors.slice(0, 6).map((item) => <div key={item}>{item}</div>)}
                {validationErrors.length > 6 && <div>{validationErrors.length - 6} more issues.</div>}
              </div>
            )}

            <div style={S.footerActions}>
              <button type="button" onClick={() => save(false)} disabled={!!saving} style={S.ghostButton}>
                {saving === 'save' ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={() => save(true)} disabled={!!saving || !ready} style={{ ...S.primaryButton, opacity: !ready || saving ? 0.58 : 1 }}>
                {saving === 'publish' ? 'Saving...' : 'Save and show in setup'}
              </button>
            </div>
          </section>
        </div>
    </div>
  )
}

const baseInput = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  border: '1px solid rgba(255,255,255,.16)',
  borderRadius: 8,
  background: 'rgba(255,255,255,.08)',
  color: '#fff',
  font: 'inherit',
  fontSize: 14,
  fontWeight: 700,
  outline: 'none',
}

const S = {
  embed: {
    color: '#fff',
    fontFamily: "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    paddingBottom: 8,
  },
  sectionHeadRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 14,
  },
  shell: {
    position: 'relative',
    width: 'min(1180px, calc(100vw - 32px))',
    margin: '0 auto',
    padding: '28px 0 42px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 18,
  },
  kicker: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: 1.6,
  },
  title: {
    margin: '4px 0 0',
    fontSize: 'clamp(24px, 3.5vw, 36px)',
    lineHeight: 1,
    letterSpacing: 0,
    fontWeight: 800,
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
    marginBottom: 14,
  },
  stat: {
    border: '1px solid rgba(255,255,255,.15)',
    borderRadius: 14,
    padding: 14,
    background: 'rgba(20,28,24,.58)',
    backdropFilter: 'blur(18px)',
  },
  statValue: { fontSize: 26, fontWeight: 900, lineHeight: 1 },
  statLabel: { marginTop: 5, fontSize: 12, color: 'rgba(255,255,255,.62)', fontWeight: 750 },
  banner: {
    border: '1px solid rgba(212,242,58,.34)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    color: '#f8ffd2',
    background: 'rgba(77,95,18,.34)',
    fontSize: 14,
    fontWeight: 750,
  },
  bannerError: {
    borderColor: 'rgba(251,113,133,.45)',
    background: 'rgba(127,29,29,.38)',
    color: '#fecdd3',
  },
  workspace: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 430px), 1fr))',
    gap: 14,
    alignItems: 'start',
  },
  listPane: {
    border: '1px solid rgba(255,255,255,.15)',
    borderRadius: 16,
    background: 'rgba(20,28,24,.62)',
    backdropFilter: 'blur(20px)',
    padding: 12,
    overflowX: 'auto',
  },
  editorPane: {
    border: '1px solid rgba(255,255,255,.15)',
    borderRadius: 16,
    background: 'rgba(20,28,24,.72)',
    backdropFilter: 'blur(22px)',
    padding: 16,
  },
  listTop: {
    display: 'flex',
    gap: 10,
    marginBottom: 12,
  },
  search: {
    ...baseInput,
    minHeight: 42,
    padding: '0 12px',
  },
  table: {
    display: 'grid',
    gap: 7,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1.5fr) 86px 48px 64px 58px',
    gap: 10,
    alignItems: 'center',
  },
  headingRow: {
    padding: '0 10px 5px',
    color: 'rgba(255,255,255,.5)',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  courseRow: {
    width: '100%',
    minHeight: 66,
    padding: 8,
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8,
    background: 'rgba(255,255,255,.055)',
    color: '#fff',
    textAlign: 'left',
    font: 'inherit',
    cursor: 'pointer',
  },
  selectedRow: {
    borderColor: 'rgba(212,242,58,.62)',
    background: 'rgba(212,242,58,.12)',
  },
  courseNameCell: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  thumb: {
    width: 44,
    height: 44,
    flex: '0 0 auto',
    borderRadius: 8,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.18)',
  },
  courseName: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 850,
  },
  courseLoc: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'rgba(255,255,255,.56)',
    fontSize: 12,
    marginTop: 2,
  },
  statusOn: {
    color: ACCENT,
    fontSize: 12,
    fontWeight: 850,
  },
  statusOff: {
    color: 'rgba(255,255,255,.58)',
    fontSize: 12,
    fontWeight: 800,
  },
  muted: {
    color: 'rgba(255,255,255,.66)',
    fontSize: 13,
    fontWeight: 750,
  },
  smallAction: {
    display: 'inline-flex',
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    background: 'rgba(255,255,255,.1)',
    color: '#fff',
    fontSize: 12,
    fontWeight: 850,
    cursor: 'pointer',
  },
  empty: {
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8,
    padding: 13,
    color: 'rgba(255,255,255,.58)',
    fontSize: 13,
    fontWeight: 700,
  },
  editorHero: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  editorImage: {
    width: 82,
    height: 82,
    flex: '0 0 auto',
    borderRadius: 8,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.2)',
  },
  editorTitle: {
    margin: '4px 0 0',
    fontSize: 26,
    lineHeight: 1.08,
    letterSpacing: 0,
  },
  editorMeta: {
    margin: '6px 0 0',
    color: 'rgba(255,255,255,.62)',
    fontSize: 13,
    fontWeight: 700,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10,
  },
  label: {
    display: 'grid',
    gap: 6,
    color: 'rgba(255,255,255,.62)',
    fontSize: 12,
    fontWeight: 850,
  },
  input: {
    ...baseInput,
    minHeight: 40,
    padding: '0 10px',
  },
  formSection: {
    marginTop: 18,
    paddingTop: 16,
    borderTop: '1px solid rgba(255,255,255,.1)',
  },
  sectionHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 11,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 900,
  },
  sectionSub: {
    marginTop: 3,
    color: 'rgba(255,255,255,.54)',
    fontSize: 12,
    fontWeight: 650,
  },
  scoreGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
    gap: 8,
  },
  holeBox: {
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 8,
    background: 'rgba(255,255,255,.055)',
    padding: 9,
  },
  holeNumber: {
    fontSize: 12,
    fontWeight: 900,
    marginBottom: 7,
  },
  miniLabel: {
    display: 'grid',
    gridTemplateColumns: '28px 1fr',
    alignItems: 'center',
    gap: 6,
    color: 'rgba(255,255,255,.56)',
    fontSize: 11,
    fontWeight: 850,
    marginTop: 5,
  },
  miniInput: {
    ...baseInput,
    minHeight: 30,
    padding: '0 7px',
  },
  teeRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))',
    gap: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  ghinGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 10,
    marginTop: 12,
  },
  validationBox: {
    marginTop: 16,
    border: '1px solid rgba(251,113,133,.35)',
    borderRadius: 8,
    padding: 12,
    color: '#fecdd3',
    background: 'rgba(127,29,29,.24)',
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.55,
  },
  footerActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    minHeight: 42,
    border: 'none',
    borderRadius: 8,
    padding: '0 14px',
    background: ACCENT,
    color: DARK_TEXT,
    font: 'inherit',
    fontSize: 13,
    fontWeight: 900,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  ghostButton: {
    minHeight: 40,
    border: '1px solid rgba(255,255,255,.18)',
    borderRadius: 8,
    padding: '0 13px',
    background: 'rgba(255,255,255,.08)',
    color: '#fff',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 850,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  removeButton: {
    minHeight: 40,
    border: '1px solid rgba(251,113,133,.28)',
    borderRadius: 8,
    padding: '0 11px',
    background: 'rgba(127,29,29,.24)',
    color: '#fecdd3',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 850,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}
