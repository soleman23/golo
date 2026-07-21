/**
 * Turn Supabase / Auth API errors into short copy safe to show on AuthPage.
 * Some failures (broken SMTP, empty API bodies) surface as message "{}" or blank.
 */
export function authErrorMessage(err, fallback = 'Something went wrong. Try again.') {
  if (!err) return fallback

  const raw =
    typeof err === 'string'
      ? err
      : typeof err.message === 'string'
        ? err.message
        : ''

  const msg = raw.trim()
  if (!msg || msg === '{}' || msg === '[object Object]') {
    return fallback
  }

  const lower = msg.toLowerCase()
  if (lower.includes('not authorized') || (lower.includes('email address') && lower.includes('authorized'))) {
    return 'That email cannot receive auth mail yet. Use a team email, or set up custom SMTP in Supabase.'
  }
  if (lower.includes('rate limit') || lower.includes('email rate')) {
    return 'Too many emails sent. Wait a bit, or turn Confirm email off for crew testing.'
  }
  if (lower.includes('already registered') || lower.includes('already been registered') || lower.includes('user already')) {
    return 'An account with that email already exists. Sign in instead.'
  }
  if (lower.includes('password')) {
    return msg
  }

  return msg
}
