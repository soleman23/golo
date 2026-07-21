export const COURSE_HOLES = Array.from({ length: 18 }, (_, i) => i + 1)

export function slugifyCourseName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const asNumber = (value) => {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const isBlank = (value) => String(value ?? '').trim().length === 0
const isValidPar = (value) => Number.isInteger(value) && value >= 3 && value <= 6
const isValidStrokeIndex = (value) => Number.isInteger(value) && value >= 1 && value <= 18
const isValidYardage = (value) => Number.isFinite(value) && value > 0 && value < 1000

export function normalizeHoleRows(rows) {
  const holes = []
  for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
    const hole = asNumber(row?.hole ?? row?.number ?? row?.holeNumber ?? index + 1)
    const par = asNumber(row?.par)
    const strokeIndex = asNumber(row?.strokeIndex ?? row?.handicap)
    const yardage = asNumber(row?.yardage ?? row?.yards)
    if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !isValidPar(par)) continue
    holes.push({
      hole,
      par,
      ...(isValidStrokeIndex(strokeIndex) ? { strokeIndex } : {}),
      ...(isValidYardage(yardage) ? { yardage } : {}),
    })
  }
  const expected = rows?.length === 9 ? 9 : 18
  return holes.length === expected && new Set(holes.map((row) => row.hole)).size === expected
    ? holes.sort((a, b) => a.hole - b.hole)
    : null
}

function completeHoleMap(values, validator) {
  const out = {}
  for (const hole of COURSE_HOLES) {
    const value = asNumber(values?.[hole] ?? values?.[String(hole)])
    if (!validator(value)) return null
    out[hole] = value
  }
  return out
}

function holeRowsToMap(rows, key, validator) {
  const values = {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const hole = asNumber(row?.hole ?? row?.number ?? row?.holeNumber)
    if (!Number.isInteger(hole) || hole < 1 || hole > 18) continue
    const value = asNumber(row?.[key])
    if (validator(value)) values[hole] = value
  }
  return completeHoleMap(values, validator)
}

function scorecardMapFromTee(tee, objectKeys, rowKey, validator) {
  for (const key of objectKeys) {
    const map = completeHoleMap(tee?.[key], validator)
    if (map) return map
  }
  return holeRowsToMap(tee?.holes, rowKey, validator)
}

export function scorecardFromNcrdbTees(tees) {
  for (const tee of Array.isArray(tees) ? tees : []) {
    const pars = scorecardMapFromTee(tee, ['pars', 'holePars', 'parByHole'], 'par', isValidPar)
    if (!pars) continue
    const strokeIndex = scorecardMapFromTee(
      tee,
      ['strokeIndex', 'stroke_index', 'handicap', 'handicapIndex'],
      'strokeIndex',
      isValidStrokeIndex
    )
    return {
      pars,
      ...(strokeIndex ? { strokeIndex } : {}),
    }
  }
  return {}
}

export function normalizeCourseForSave(course) {
  const pars = {}
  const strokeIndex = {}
  COURSE_HOLES.forEach((hole) => {
    const par = asNumber(course.pars?.[hole])
    const rank = asNumber(course.strokeIndex?.[hole])
    if (par != null) pars[hole] = par
    if (rank != null) strokeIndex[hole] = rank
  })

  const tees = (course.tees ?? []).map((tee) => {
    const holes = normalizeHoleRows(tee.holes)
    return {
      name: String(tee.name ?? '').trim(),
      color: String(tee.color ?? '').trim() || '#1f2937',
      yards: asNumber(tee.yards),
      rating: asNumber(tee.rating),
      slope: asNumber(tee.slope),
      par: asNumber(tee.par),
      ...(holes ? { holes } : {}),
    }
  })

  const ghinTeeSets = Object.fromEntries(
    Object.entries(course.ghinTeeSets ?? {})
      .map(([name, id]) => [String(name).trim(), String(id ?? '').trim()])
      .filter(([name, id]) => name && id)
  )

  return {
    id: String(course.id ?? '').trim() || slugifyCourseName(course.name),
    name: String(course.name ?? '').trim(),
    loc: String(course.loc ?? '').trim(),
    holes: 18,
    bg: String(course.bg ?? '').trim() || null,
    pars,
    strokeIndex,
    tees,
    isPublic: true,
    visibleInSetup: !!course.visibleInSetup,
    ghinFacilityId: String(course.ghinFacilityId ?? '').trim() || null,
    ghinCourseId: String(course.ghinCourseId ?? '').trim() || null,
    ghinTeeSets: Object.keys(ghinTeeSets).length ? ghinTeeSets : null,
    latitude: asNumber(course.latitude),
    longitude: asNumber(course.longitude),
  }
}

export function validateCourseForSetup(course) {
  const errors = []
  const normalized = normalizeCourseForSave(course)

  if (isBlank(normalized.name)) errors.push('Name is required.')
  if (isBlank(normalized.loc)) errors.push('Location is required.')
  if (normalized.holes !== 18) errors.push('Course setup supports 18-hole records.')

  const ranks = new Set()
  COURSE_HOLES.forEach((hole) => {
    const par = asNumber(normalized.pars?.[hole])
    if (!Number.isInteger(par) || par < 3 || par > 6) {
      errors.push(`Hole ${hole} needs a par from 3 to 6.`)
    }

    const rank = asNumber(normalized.strokeIndex?.[hole])
    if (!Number.isInteger(rank) || rank < 1 || rank > 18) {
      errors.push(`Hole ${hole} needs a stroke index from 1 to 18.`)
    } else if (ranks.has(rank)) {
      errors.push(`Stroke index ${rank} is duplicated.`)
    } else {
      ranks.add(rank)
    }
  })

  if (ranks.size !== 18) errors.push('Stroke index must use every rank from 1 to 18 once.')

  if (!Array.isArray(normalized.tees) || normalized.tees.length < 1) {
    errors.push('Add at least one tee.')
  }

  normalized.tees.forEach((tee, idx) => {
    const label = tee.name || `Tee ${idx + 1}`
    if (isBlank(tee.name)) errors.push(`Tee ${idx + 1} needs a name.`)
    if (!Number.isFinite(tee.yards) || tee.yards <= 0) errors.push(`${label} needs yards.`)
    if (!Number.isFinite(tee.rating) || tee.rating <= 0) errors.push(`${label} needs a rating.`)
    if (!Number.isInteger(tee.slope) || tee.slope < 55 || tee.slope > 155) {
      errors.push(`${label} needs a slope from 55 to 155.`)
    }
    if (!Number.isInteger(tee.par) || tee.par < 3) errors.push(`${label} needs a par.`)
  })

  return [...new Set(errors)]
}

export function isCourseReadyForSetup(course) {
  return validateCourseForSetup(course).length === 0
}

export function courseFromNcrdb(ncrdbCourse, tees, genderFilter = 'M') {
  const city = String(ncrdbCourse?.city ?? '').trim()
  const state = String(ncrdbCourse?.stateDisplay ?? '').trim()
  const filteredTees = (Array.isArray(tees) ? tees : []).filter((tee) => !genderFilter || tee?.gender === genderFilter)
  const scorecard = scorecardFromNcrdbTees(filteredTees)
  // NCRDB/GHIN id namespace equivalence is assumed here; verify before first real GHIN score post when _shared/ghin.ts credential stubs are finalized.
  const ghinTeeSets = Object.fromEntries(
    filteredTees
      .map((tee) => [String(tee?.name ?? '').trim(), tee?.teeId != null ? String(tee.teeId) : ''])
      .filter(([name, teeId]) => name && teeId)
  )

  return {
    name: String(ncrdbCourse?.fullName ?? '').trim(),
    loc: [city, state].filter(Boolean).join(', '),
    ghinFacilityId: ncrdbCourse?.facilityID != null ? String(ncrdbCourse.facilityID) : '',
    ghinCourseId: ncrdbCourse?.courseID != null ? String(ncrdbCourse.courseID) : '',
    ghinTeeSets,
    ...scorecard,
    tees: filteredTees.map((tee) => {
      const holes = normalizeHoleRows(tee.holes)
      return {
        name: tee.name,
        rating: tee.courseRating,
        slope: tee.slope,
        par: tee.par,
        yards: tee.yards,
        ...(holes ? { holes } : {}),
      }
    }),
  }
}
