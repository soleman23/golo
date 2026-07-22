export const DEFAULT_COURSE_IMAGE = '/courses/course.png'

export const COURSE_IMAGES_BY_ID = {
  pinehurst: '/courses/course.png',
  harbor: '/courses/sunset.png',
  lincoln: '/courses/turf.png',
  tetherow: '/courses/tetherow.jpg',
  losttracks: '/courses/losttracks.webp',
}

export const COURSE_IMAGES_BY_NAME = {
  'Pinehurst No.2': COURSE_IMAGES_BY_ID.pinehurst,
  'Harbor Dunes': COURSE_IMAGES_BY_ID.harbor,
  'Lincoln Park': COURSE_IMAGES_BY_ID.lincoln,
  Tetherow: COURSE_IMAGES_BY_ID.tetherow,
  'Lost Tracks Golf Course': COURSE_IMAGES_BY_ID.losttracks,
}

const normalize = (value) => (typeof value === 'string' ? value.trim() : '')

const COURSE_IMAGE_BY_NORMALIZED_NAME = Object.fromEntries(
  Object.entries(COURSE_IMAGES_BY_NAME).map(([name, image]) => [name.toLowerCase(), image])
)

/** A stored image string is only usable if it looks like a real URL/path. */
const isUsableImagePath = (value) =>
  value.startsWith('/') || value.startsWith('http') || value.startsWith('data:')

export function getCourseImage(courseOrRound, courseName) {
  const source =
    courseOrRound && typeof courseOrRound === 'object'
      ? courseOrRound
      : { courseId: courseOrRound, course: courseName ?? courseOrRound }

  // Resolve from the canonical catalogue first — it's the stable source of truth
  // and always points at assets that ship with the app. A round can carry a
  // stale/garbage `courseBg` (an old build asset URL, a renamed path, even the
  // string "undefined"), so a stored value is only a fallback for courses the
  // catalogue doesn't know about.
  const courseId = normalize(source.courseId ?? source.id)
  if (courseId && COURSE_IMAGES_BY_ID[courseId]) return COURSE_IMAGES_BY_ID[courseId]

  const name = normalize(source.course ?? source.name)
  if (name && COURSE_IMAGE_BY_NORMALIZED_NAME[name.toLowerCase()]) {
    return COURSE_IMAGE_BY_NORMALIZED_NAME[name.toLowerCase()]
  }

  // A fetched/curated photo (courses.image_url, camelCase imageUrl on merged
  // catalogue rows) beats the legacy static `bg` asset — it's a real photo of
  // that course rather than shared shipped art.
  const savedImage = normalize(
    source.image_url ?? source.imageUrl ?? source.courseBg ?? source.bg ?? source.image
  )
  if (savedImage && isUsableImagePath(savedImage)) return savedImage

  return DEFAULT_COURSE_IMAGE
}
