import { getCoursePhotoCredit } from '../../lib/courseImages'

export default function CoursePhotoCredit({ course, style }) {
  const credit = getCoursePhotoCredit(course)
  if (!credit) return null

  return (
    <a
      href={credit.attributionUrl}
      target="_blank"
      rel="noreferrer"
      style={{
        position: 'absolute',
        right: 12,
        bottom: 82,
        zIndex: 4,
        maxWidth: 'calc(100% - 24px)',
        padding: '5px 9px',
        borderRadius: 9999,
        background: 'rgba(5,12,8,.72)',
        border: '1px solid rgba(255,255,255,.18)',
        color: 'rgba(255,255,255,.82)',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1.25,
        textAlign: 'right',
        textDecoration: 'none',
        whiteSpace: 'normal',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        ...style,
      }}
    >
      {credit.attribution}
    </a>
  )
}
