import { useNavigate } from 'react-router-dom'

const BASE_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 36,
  padding: '0 12px 0 10px',
  borderRadius: 9999,
  border: '1px solid rgba(255,255,255,.18)',
  background: 'rgba(255,255,255,.13)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 800,
  cursor: 'pointer',
  textShadow: 'none',
}

const ARROW_STYLE = {
  fontSize: 18,
  lineHeight: 1,
  marginTop: -1,
}

export default function BackButton({ label = 'Back', style, onClick }) {
  const navigate = useNavigate()

  const handleClick = () => {
    if (onClick) onClick()
    else navigate(-1)
  }

  return (
    <button type="button" onClick={handleClick} aria-label="Go back" style={{ ...BASE_STYLE, ...style }}>
      <span aria-hidden="true" style={ARROW_STYLE}>‹</span>
      <span>{label}</span>
    </button>
  )
}
