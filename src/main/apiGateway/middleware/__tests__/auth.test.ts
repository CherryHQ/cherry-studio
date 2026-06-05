import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authGuard } from '../auth'

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

// Mock the logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn()
    }))
  }
}))

/**
 * Drive the Elysia auth guard with a header map and capture the result.
 * Returns the status set on `set.status` and the body the guard returned
 * (undefined when the request is allowed through).
 */
async function runGuard(headers: Record<string, string | undefined>): Promise<{
  status?: number | string
  body: { error: string } | undefined
  allowed: boolean
}> {
  const set: { status?: number | string } = {}
  const body = await authGuard({ headers, set })
  return { status: set.status, body, allowed: body === undefined }
}

describe('authGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Missing credentials', () => {
    it('should return 401 when both auth headers are missing', async () => {
      const { status, body } = await runGuard({})

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: missing credentials' })
    })

    it('should return 401 when both auth headers are empty strings', async () => {
      const { status, body } = await runGuard({ authorization: '', 'x-api-key': '' })

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: missing credentials' })
    })
  })

  describe('Server configuration', () => {
    it('should return 403 when API key is not configured', async () => {
      mockPreferenceGet.mockReturnValue('')

      const { status, body } = await runGuard({ 'x-api-key': 'some-key' })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })

    it('should return 403 when API key is null', async () => {
      mockPreferenceGet.mockReturnValue(null)

      const { status, body } = await runGuard({ 'x-api-key': 'some-key' })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('API Key authentication (priority)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('should authenticate successfully with valid API key', async () => {
      const { status, allowed } = await runGuard({ 'x-api-key': validApiKey })

      expect(allowed).toBe(true)
      expect(status).toBeUndefined()
    })

    it('should return 403 with invalid API key', async () => {
      const { status, body } = await runGuard({ 'x-api-key': 'invalid-key' })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })

    it('should return 401 with empty API key', async () => {
      const { status, body } = await runGuard({ 'x-api-key': '   ' })

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: empty x-api-key' })
    })

    it('should handle API key with whitespace', async () => {
      const { status, allowed } = await runGuard({ 'x-api-key': `  ${validApiKey}  ` })

      expect(allowed).toBe(true)
      expect(status).toBeUndefined()
    })

    it('should prioritize API key over Bearer token when both are present', async () => {
      const { status, allowed } = await runGuard({
        'x-api-key': validApiKey,
        authorization: 'Bearer invalid-token'
      })

      expect(allowed).toBe(true)
      expect(status).toBeUndefined()
    })

    it('should return 403 when API key is invalid even if Bearer token is valid', async () => {
      const { status, body } = await runGuard({
        'x-api-key': 'invalid-key',
        authorization: `Bearer ${validApiKey}`
      })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('Bearer token authentication (fallback)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('should authenticate successfully with valid Bearer token when no API key', async () => {
      const { status, allowed } = await runGuard({ authorization: `Bearer ${validApiKey}` })

      expect(allowed).toBe(true)
      expect(status).toBeUndefined()
    })

    it('should return 403 with invalid Bearer token', async () => {
      const { status, body } = await runGuard({ authorization: 'Bearer invalid-token' })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })

    it('should return 401 with malformed authorization header', async () => {
      const { status, body } = await runGuard({ authorization: 'Basic sometoken' })

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: invalid authorization format' })
    })

    it('should return 401 with Bearer without space', async () => {
      const { status, body } = await runGuard({ authorization: 'Bearer' })

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: invalid authorization format' })
    })

    it('should handle Bearer token with only trailing spaces (edge case)', async () => {
      // This will be trimmed to "Bearer" and fail format check
      const { status, body } = await runGuard({ authorization: 'Bearer    ' })

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: invalid authorization format' })
    })

    it('should handle Bearer token with case insensitive prefix', async () => {
      const { status, allowed } = await runGuard({ authorization: `bearer ${validApiKey}` })

      expect(allowed).toBe(true)
      expect(status).toBeUndefined()
    })

    it('should handle Bearer token with whitespace', async () => {
      const { status, allowed } = await runGuard({ authorization: `  Bearer   ${validApiKey}  ` })

      expect(allowed).toBe(true)
      expect(status).toBeUndefined()
    })
  })

  describe('Edge cases', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('should use timing-safe comparison for different length tokens', async () => {
      const { status, body } = await runGuard({ 'x-api-key': 'short' })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })

    it('should return 401 when neither credential format is valid', async () => {
      const { status, body } = await runGuard({ authorization: 'Invalid format' })

      expect(status).toBe(401)
      expect(body).toEqual({ error: 'Unauthorized: invalid authorization format' })
    })
  })

  describe('Timing attack protection', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceGet.mockReturnValue(validApiKey)
    })

    it('should handle similar length but different API keys securely', async () => {
      const similarKey = 'valid-api-key-124' // Same length, different last char

      const { status, body } = await runGuard({ 'x-api-key': similarKey })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })

    it('should handle similar length but different Bearer tokens securely', async () => {
      const similarKey = 'valid-api-key-124' // Same length, different last char

      const { status, body } = await runGuard({ authorization: `Bearer ${similarKey}` })

      expect(status).toBe(403)
      expect(body).toEqual({ error: 'Forbidden' })
    })
  })
})
