import type { Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { config } from '../../config'
import { authMiddleware } from '../auth'

// Mock the config module
vi.mock('../../config', () => ({
  config: {
    get: vi.fn()
  }
}))

// Mock the logger
vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn()
    }))
  }
}))

const mockConfig = config as any

describe('authMiddleware', () => {
  const headerMock = vi.fn<(name: string) => string | undefined>()
  const jsonMock = vi.fn()
  const statusMock = vi.fn<(code: number) => { json: typeof jsonMock }>().mockReturnValue({ json: jsonMock })
  let next: ReturnType<typeof vi.fn<(err?: unknown) => void>>

  const req = { header: headerMock } as unknown as Request
  const res = { status: statusMock } as unknown as Response

  beforeEach(() => {
    next = vi.fn<(err?: unknown) => void>()

    vi.clearAllMocks()
  })

  describe('Missing credentials', () => {
    it('should return 401 when both auth headers are missing', async () => {
      headerMock.mockReturnValue('')

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: missing credentials' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 when both auth headers are empty strings', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return ''
        if (header === 'x-api-key') return ''
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: missing credentials' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Server configuration', () => {
    it('should return 403 when API key is not configured', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'some-key'
        return ''
      })

      mockConfig.get.mockResolvedValue({ apiKey: '' })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 403 when API key is null', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'some-key'
        return ''
      })

      mockConfig.get.mockResolvedValue({ apiKey: null })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('API Key authentication (priority)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockConfig.get.mockResolvedValue({ apiKey: validApiKey })
    })

    it('should authenticate successfully with valid API key', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 with invalid API key', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'invalid-key'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with empty API key', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return '   '
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: empty x-api-key' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle API key with whitespace', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return `  ${validApiKey}  `
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should prioritize API key over Bearer token when both are present', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        if (header === 'authorization') return 'Bearer invalid-token'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 when API key is invalid even if Bearer token is valid', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'invalid-key'
        if (header === 'authorization') return `Bearer ${validApiKey}`
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Bearer token authentication (fallback)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockConfig.get.mockResolvedValue({ apiKey: validApiKey })
    })

    it('should authenticate successfully with valid Bearer token when no API key', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return `Bearer ${validApiKey}`
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 with invalid Bearer token', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer invalid-token'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with malformed authorization header', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return 'Basic sometoken'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with Bearer without space', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with only trailing spaces (edge case)', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer    ' // This will be trimmed to "Bearer" and fail format check
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with case insensitive prefix', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return `bearer ${validApiKey}`
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with whitespace', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return `  Bearer   ${validApiKey}  `
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockConfig.get.mockResolvedValue({ apiKey: validApiKey })
    })

    it('should handle config.get() rejection', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        return ''
      })

      mockConfig.get.mockRejectedValue(new Error('Config error'))

      await expect(authMiddleware(req as Request, res as Response, next)).rejects.toThrow('Config error')
    })

    it('should use timing-safe comparison for different length tokens', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'short'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 when neither credential format is valid', async () => {
      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return 'Invalid format'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Timing attack protection', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockConfig.get.mockResolvedValue({ apiKey: validApiKey })
    })

    it('should handle similar length but different API keys securely', async () => {
      const similarKey = 'valid-api-key-124' // Same length, different last char

      headerMock.mockImplementation((header: string) => {
        if (header === 'x-api-key') return similarKey
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle similar length but different Bearer tokens securely', async () => {
      const similarKey = 'valid-api-key-124' // Same length, different last char

      headerMock.mockImplementation((header: string) => {
        if (header === 'authorization') return `Bearer ${similarKey}`
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })
  })
})
