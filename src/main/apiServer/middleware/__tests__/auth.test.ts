import type { NextFunction, Request, Response } from 'express'
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
  let req: Partial<Request>
  let res: Partial<Response>
  let next: NextFunction
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    jsonMock = vi.fn()
    statusMock = vi.fn(() => ({ json: jsonMock }))

    req = {
      header: vi.fn()
    }
    res = {
      status: statusMock
    }
    next = vi.fn()

    vi.clearAllMocks()
  })

  describe('Missing credentials', () => {
    it('should return 401 when both auth headers are missing', async () => {
      ;(req.header as any).mockReturnValue('')

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: missing credentials' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 when both auth headers are empty strings', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
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
      ;(req.header as any).mockImplementation((header: string) => {
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
      ;(req.header as any).mockImplementation((header: string) => {
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
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 with invalid API key', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'invalid-key'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with empty API key', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return '   '
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: empty x-api-key' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle API key with whitespace', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return `  ${validApiKey}  `
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should prioritize API key over Bearer token when both are present', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        if (header === 'authorization') return 'Bearer invalid-token'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 when API key is invalid even if Bearer token is valid', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
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
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return `Bearer ${validApiKey}`
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 with invalid Bearer token', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer invalid-token'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with malformed authorization header', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Basic sometoken'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with Bearer without space', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with only trailing spaces (edge case)', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer    ' // This will be trimmed to "Bearer" and fail format check
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with case insensitive prefix', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return `bearer ${validApiKey}`
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with whitespace', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
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
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        return ''
      })

      mockConfig.get.mockRejectedValue(new Error('Config error'))

      await expect(authMiddleware(req as Request, res as Response, next)).rejects.toThrow('Config error')
    })

    it('should use timing-safe comparison for different length tokens', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'short'
        return ''
      })

      await authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 when neither credential format is valid', async () => {
      ;(req.header as any).mockImplementation((header: string) => {
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

      ;(req.header as any).mockImplementation((header: string) => {
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

      ;(req.header as any).mockImplementation((header: string) => {
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
