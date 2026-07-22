import { assertEquals } from 'jsr:@std/assert@1'
import { unsplashAttributionUrl, unsplashImageUrl } from './coursePhotos.ts'

Deno.test('unsplashImageUrl sizes a raw URL and preserves its tracking id', () => {
  const result = new URL(unsplashImageUrl({ raw: 'https://images.unsplash.com/photo-1?ixid=abc' }))
  assertEquals(result.searchParams.get('ixid'), 'abc')
  assertEquals(result.searchParams.get('w'), '1600')
  assertEquals(result.searchParams.get('fit'), 'crop')
  assertEquals(result.searchParams.get('q'), '80')
})

Deno.test('unsplashImageUrl leaves an already-sized regular URL intact', () => {
  assertEquals(
    unsplashImageUrl({ regular: 'https://images.unsplash.com/photo-1?ixid=abc&w=1080' }),
    'https://images.unsplash.com/photo-1?ixid=abc&w=1080',
  )
})

Deno.test('unsplashAttributionUrl adds referral parameters', () => {
  const result = new URL(unsplashAttributionUrl('https://unsplash.com/@golfer?existing=1'))
  assertEquals(result.searchParams.get('existing'), '1')
  assertEquals(result.searchParams.get('utm_source'), 'golo_golf')
  assertEquals(result.searchParams.get('utm_medium'), 'referral')
})

Deno.test('Unsplash URL helpers reject malformed and insecure URLs', () => {
  assertEquals(unsplashImageUrl({ raw: 'http://images.unsplash.com/photo-1' }), '')
  assertEquals(unsplashAttributionUrl('not a url'), '')
})
