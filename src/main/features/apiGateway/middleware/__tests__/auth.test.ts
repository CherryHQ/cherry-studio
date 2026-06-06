import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authorizeApiRequest } from '../auth'

// Mock preferenceService via application.get()
const { mockPreferenceGet } = vi.hoisted(() => ({
  mockPreferenceGet: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    PreferenceService: { get: mockPreferenceGet }
  })
})

/**
 * `authorizeApiRequest(xApiKey, bearer)` validates the presented credentials. The
 * extraction of `bearer` from `Authorization: Bearer …` / `?access_token` is the
 * `@elysia/bearer` plugin's job and is covered by the routes integration test.
 */
describe('authorizeApiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Missing credentials', () => {
    it('returns 401 when no credential is present', () => {
      expect(authorizeApiRequest(undefined, undefined)).toEqual({
        status: 401,
        error: 'Unauthorized: missing credentials'
      })
    })

    it('returns 401 when the x-api-key is an empty string', () => {
      expect(authorizeApiRequest('', undefined)).toEqual({ status: 401, error: 'Unauthorized: missing credentials' })
    })

    it('returns 401 when the x-api-key is whitespace-only', () => {
      expect(authorizeApiRequest('   ', undefined)).toEqual({ status: 401, error: 'Unauthorized: missing credentials' })
    })
  })

  describe('Server configuration', () => {
    it('returns 403 when API key is not configured', () => {
      mockPreferenceGet.mockReturnValue('')
      expect(authorizeApiRequest('some-key', undefined)).toEqual({ status: 403, error: 'Forbidden' })
    })

    it('returns 403 when API key is null', () => {
      mockPreferenceGet.mockReturnValue(null)
      expect(authorizeApiRequest('some-key', undefined)).toEqual({ status: 403, error: 'Forbidden' })
    })
  })

  describe('API Key authentication (priority)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('authenticates with a valid API key', () => {
      expect(authorizeApiRequest(validApiKey, undefined)).toBeUndefined()
    })

    it('returns 403 with an invalid API key', () => {
      expect(authorizeApiRequest('invalid-key', undefined)).toEqual({ status: 403, error: 'Forbidden' })
    })

    it('trims surrounding whitespace on the API key', () => {
      expect(authorizeApiRequest(`  ${validApiKey}  `, undefined)).toBeUndefined()
    })

    it('prioritizes the API key over the Bearer token when both are present', () => {
      expect(authorizeApiRequest(validApiKey, 'invalid-token')).toBeUndefined()
    })

    it('returns 403 when the API key is invalid even if the Bearer token is valid', () => {
      expect(authorizeApiRequest('invalid-key', validApiKey)).toEqual({ status: 403, error: 'Forbidden' })
    })
  })

  describe('Bearer token authentication (fallback)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('authenticates with a valid Bearer token', () => {
      expect(authorizeApiRequest(undefined, validApiKey)).toBeUndefined()
    })

    it('returns 403 with an invalid Bearer token', () => {
      expect(authorizeApiRequest(undefined, 'invalid-token')).toEqual({ status: 403, error: 'Forbidden' })
    })

    it('trims surrounding whitespace on the Bearer token', () => {
      expect(authorizeApiRequest(undefined, `  ${validApiKey}  `)).toBeUndefined()
    })
  })

  describe('Timing attack protection', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('rejects a shorter API key via timing-safe comparison', () => {
      expect(authorizeApiRequest('short', undefined)).toEqual({ status: 403, error: 'Forbidden' })
    })

    it('rejects a same-length but different API key', () => {
      expect(authorizeApiRequest('valid-api-key-124', undefined)).toEqual({ status: 403, error: 'Forbidden' })
    })

    it('rejects a same-length but different Bearer token', () => {
      expect(authorizeApiRequest(undefined, 'valid-api-key-124')).toEqual({ status: 403, error: 'Forbidden' })
    })

    it('rejects a multibyte token of equal char length without throwing', () => {
      // Same UTF-16 char count as the 17-char key but more UTF-8 bytes (each CJK
      // char is 1 code unit / 3 bytes) — comparing byte lengths must short-circuit
      // to 403 rather than letting timingSafeEqual throw on unequal buffer sizes.
      const multibyte = '中'.repeat(validApiKey.length)
      expect(multibyte.length).toBe(validApiKey.length)
      expect(Buffer.byteLength(multibyte)).not.toBe(Buffer.byteLength(validApiKey))
      expect(authorizeApiRequest(multibyte, undefined)).toEqual({ status: 403, error: 'Forbidden' })
    })
  })
})
