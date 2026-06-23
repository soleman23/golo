/**
 * Resolve a player's home course label and match it to the setup catalogue.
 * Home club = profile override, else most-played course from saved history.
 */

export function resolveHomeCourseLabel({ homeClub, rounds = [] } = {}) {
  if (homeClub?.trim()) return homeClub.trim()
  const freq = {}
  for (const r of rounds) {
    if (r.course) freq[r.course] = (freq[r.course] ?? 0) + 1
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Match a home-club label to a catalogue entry by id or name. */
export function matchCourseInCatalog(courses, label) {
  if (!label?.trim() || !courses?.length) return null
  const q = label.trim().toLowerCase()
  const byId = courses.find((c) => c.id.toLowerCase() === q)
  if (byId) return byId
  const byName = courses.find((c) => c.name.toLowerCase() === q)
  if (byName) return byName
  return courses.find((c) => {
    const n = c.name.toLowerCase()
    return n.includes(q) || q.includes(n)
  }) ?? null
}

export function defaultHomeCourse(courses, { homeClub, rounds } = {}) {
  const label = resolveHomeCourseLabel({ homeClub, rounds })
  return matchCourseInCatalog(courses, label)
}

/** Pin the home course to the top while preserving relative order of the rest. */
export function sortCoursesHomeFirst(courses, opts) {
  const home = defaultHomeCourse(courses, opts)
  if (!home) return courses
  const i = courses.findIndex((c) => c.id === home.id)
  if (i <= 0) return courses
  return [courses[i], ...courses.slice(0, i), ...courses.slice(i + 1)]
}
