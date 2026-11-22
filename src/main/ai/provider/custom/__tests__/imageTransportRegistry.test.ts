import { describe, expect, it } from 'vitest'

import { hasImageTransport, resolveImageTransport } from '../imageTransportRegistry'

describe('image transport resolution', () => {
  it.each(['__proto__', 'constructor', 'toString'])(
    'leaves unregistered provider %s without a transport',
    (providerId) => {
      expect(hasImageTransport(providerId, 'model')).toBe(false)
      expect(resolveImageTransport(providerId, 'model', {})).toBeNull()
    }
  )
})
