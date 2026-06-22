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

export function getCourseImage(courseOrRound, courseName) {
  const source =
    courseOrRound && typeof courseOrRound === 'object'
      ? courseOrRound
      : { courseId: courseOrRound, course: courseName ?? courseOrRound }

  const savedImage = normalize(source.courseBg ?? source.bg ?? source.image ?? source.imageUrl)
  if (savedImage) return savedImage

  const courseId = normalize(source.courseId ?? source.id)
  if (courseId && COURSE_IMAGES_BY_ID[courseId]) return COURSE_IMAGES_BY_ID[courseId]

  const name = normalize(source.course ?? source.name)
  if (name) return COURSE_IMAGE_BY_NORMALIZED_NAME[name.toLowerCase()] ?? DEFAULT_COURSE_IMAGE

  return DEFAULT_COURSE_IMAGE
}
