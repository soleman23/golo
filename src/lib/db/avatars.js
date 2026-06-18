import { supabase, isSupabaseConfigured } from '../supabaseClient'

/**
 * Profile avatars stored in the public `avatars` Storage bucket.
 *
 * Images are resized + center-cropped to a small square JPEG in the browser
 * before upload, so rows stay tiny and we never ship a 5MB phone photo. Files
 * live under a per-user folder ("<uid>/<timestamp>.jpg") which the Storage RLS
 * policies require (see supabase/migrations/0003_avatars.sql).
 */

const BUCKET = 'avatars'
const SIZE = 256 // output square edge, px
const QUALITY = 0.85

/** Read a File into an HTMLImageElement. */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(url)
      reject(e)
    }
    img.src = url
  })
}

/** Resize + center-crop to a SIZE x SIZE JPEG blob. */
async function toSquareJpeg(file) {
  const img = await loadImage(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY)
  )
  if (!blob) throw new Error('Could not process this image.')
  return blob
}

/** Pull the storage object path ("<uid>/<file>") out of a public URL. */
function pathFromPublicUrl(url) {
  if (!url) return null
  const marker = `/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length).split('?')[0]
}

/**
 * Resize `file`, upload it for `userId`, and return the public URL.
 * Best-effort deletes the previous avatar (passed as `prevUrl`) to avoid orphans.
 */
export async function uploadAvatar(userId, file, prevUrl = null) {
  if (!isSupabaseConfigured) return { url: null, error: new Error('Backend not configured.') }
  if (!userId) return { url: null, error: new Error('You must be signed in.') }
  if (!file?.type?.startsWith('image/')) return { url: null, error: new Error('Please choose an image file.') }

  let blob
  try {
    blob = await toSquareJpeg(file)
  } catch (e) {
    return { url: null, error: e instanceof Error ? e : new Error('Could not read that image.') }
  }

  const path = `${userId}/${Date.now()}.jpg`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
  if (error) {
    console.error('[db] uploadAvatar', error)
    return { url: null, error }
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)

  // Clean up the previous file (ignore failures — orphans are harmless).
  const prevPath = pathFromPublicUrl(prevUrl)
  if (prevPath && prevPath !== path) {
    supabase.storage.from(BUCKET).remove([prevPath]).catch(() => {})
  }

  return { url: data.publicUrl, error: null }
}

/** Delete the avatar object behind `url` (best effort). */
export async function removeAvatar(url) {
  if (!isSupabaseConfigured) return { error: null }
  const path = pathFromPublicUrl(url)
  if (!path) return { error: null }
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.error('[db] removeAvatar', error)
  return { error }
}
