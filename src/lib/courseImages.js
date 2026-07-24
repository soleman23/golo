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

const asSource = (courseOrRound, courseName) =>
  courseOrRound && typeof courseOrRound === 'object'
    ? courseOrRound
    : { courseId: courseOrRound, course: courseName ?? courseOrRound }

/**
 * The bundled asset for a course, or null. Single definition of the lookup so
 * `getCourseImage` and `hasBundledImage` cannot disagree about which courses
 * ship with their own art.
 */
function bundledImageFor(courseOrRound, courseName) {
  const source = asSource(courseOrRound, courseName)
  const courseId = normalize(source.courseId ?? source.id)
  if (courseId && COURSE_IMAGES_BY_ID[courseId]) return COURSE_IMAGES_BY_ID[courseId]

  const name = normalize(source.course ?? source.name)
  return (name && COURSE_IMAGE_BY_NORMALIZED_NAME[name.toLowerCase()]) || null
}

/**
 * True when a bundled asset will win over any stored photo for this course.
 * The admin desk uses this to warn that an upload won't be the image on screen,
 * and Scoring uses it to skip a pointless photo lookup.
 */
export function hasBundledImage(course) {
  return bundledImageFor(course) !== null
}

/** Visible credit metadata for the image that actually wins precedence. */
export function getCoursePhotoCredit(courseOrRound) {
  const source = asSource(courseOrRound)
  if (bundledImageFor(source)) return null

  const image = normalize(source.image_url ?? source.imageUrl ?? source.courseBg)
  const attribution = normalize(source.image_attribution ?? source.imageAttribution ?? source.courseImageAttribution)
  const attributionUrl = normalize(
    source.image_attribution_url ?? source.attributionUrl ?? source.courseImageAttributionUrl
  )
  if (!image || !attribution || !attributionUrl.startsWith('https://')) return null
  return { attribution, attributionUrl }
}

export function getCourseImage(courseOrRound, courseName) {
  const source = asSource(courseOrRound, courseName)

  // Resolve from the canonical catalogue first — it's the stable source of truth
  // and always points at assets that ship with the app. A round can carry a
  // stale/garbage `courseBg` (an old build asset URL, a renamed path, even the
  // string "undefined"), so a stored value is only a fallback for courses the
  // catalogue doesn't know about.
  //
  // Note this also means a hardcoded course outranks an admin's curated upload.
  // That's deliberate — these five are hand-picked and ship with the bundle — but
  // if you ever want an upload to win for one of them, delete its entry above.
  const bundled = bundledImageFor(source)
  if (bundled) return bundled

  // A curated upload beats an auto-fetched photo, which in turn beats whatever
  // was frozen onto the round at commit time — that snapshot predates any photo
  // fetched later, so it's the weakest signal of the three.
  const fetched = normalize(source.image_url ?? source.imageUrl)
  if (fetched && isUsableImagePath(fetched)) return fetched

  const savedImage = normalize(source.courseBg ?? source.bg ?? source.image)
  if (savedImage && isUsableImagePath(savedImage)) return savedImage

  return DEFAULT_COURSE_IMAGE
}
