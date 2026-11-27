import { describe, expect, it } from 'vitest'

import { parseAppRouteUrl } from '../appRouteUrl'

describe('parseAppRouteUrl', () => {
  it('parses app-relative urls', () => {
    const parsed = parseAppRouteUrl('/app/chat?topicId=x')
    expect(parsed?.pathname).toBe('/app/chat')
    expect(parsed?.searchParams.get('topicId')).toBe('x')
  })

  it.each(['https://example.com/app/chat?tabSession=abc', '//example.com/app/chat', 'app://other/app/chat'])(
    'rejects non-app url %s',
    (url) => {
      expect(parseAppRouteUrl(url)).toBeNull()
    }
  )
})
