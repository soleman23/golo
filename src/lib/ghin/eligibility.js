/**
 * GHIN eligibility helpers — pure functions for UI and tests.
 * Posting rules: individual stroke play, 9/18 holes, complete gross card,
 * GHIN-connected user, mapped course/tee, not already posted.
 */

/**
 * @param {Record<string, number|string>} scores - Hole → gross for one player.
 * @param {number} holes - 9 or 18.
 * @returns {number|null} Gross total, or null if any hole is missing.
 */
export function grossTotal(scores = {}, holes = 18) {
  let total = 0
  for (let h = 1; h <= holes; h++) {
    const s = scores[h] ?? scores[String(h)]
    if (s == null || s === '' || !Number.isFinite(Number(s))) return null
    total += Number(s)
  }
  return total
}

/**
 * @typedef {Object} GhinCourseMapping
 * @property {string|null} [ghinFacilityId]
 * @property {string|null} [ghinCourseId]
 * @property {Record<string, string>|null} [ghinTeeSets] - Local tee name → GHIN tee-set id.
 */

/**
 * @param {Object} opts
 * @param {Object|null} [opts.round]
 * @param {Array} [opts.teams]
 * @param {Record<string, Record<string, number>>} [opts.scores]
 * @param {string|null} [opts.playerId]
 * @param {GhinCourseMapping|null} [opts.courseGhin]
 * @param {boolean} [opts.ghinConnected]
 * @param {string|null} [opts.ghinPostedAt]
 * @returns {{ ok: boolean, reasons: string[], gross: number|null }}
 */
export function canPostToGhin({
  round = null,
  teams = [],
  scores = {},
  playerId = null,
  courseGhin = null,
  ghinConnected = false,
  ghinPostedAt = null,
} = {}) {
  const reasons = []

  if (!ghinConnected) reasons.push('Connect GHIN in your locker')
  if (ghinPostedAt) reasons.push('Already posted to GHIN')
  if ((round?.scoringType ?? 'stroke') !== 'stroke') {
    reasons.push('Stroke play rounds only')
  }
  if (teams?.length > 0) reasons.push('Individual rounds only')

  const holes = round?.holes ?? 18
  if (holes !== 9 && holes !== 18) reasons.push('9 or 18 holes only')

  let gross = null
  if (playerId) {
    gross = grossTotal(scores[playerId] ?? {}, holes)
    if (gross == null) reasons.push('Complete all hole scores first')
  } else {
    reasons.push('Sign in to post your score')
  }

  if (!courseGhin?.ghinCourseId) reasons.push('Course is not GHIN-mapped yet')

  const teeName = round?.tee?.name
  if (teeName && courseGhin?.ghinTeeSets && !courseGhin.ghinTeeSets[teeName]) {
    reasons.push(`Tee "${teeName}" is not GHIN-mapped yet`)
  }

  return { ok: reasons.length === 0, reasons, gross }
}

/** Whether the user has linked GHIN (connected timestamp present). */
export function isGhinConnected(profile = {}) {
  return Boolean(profile.ghinConnectedAt)
}
