import { preferenceService } from '@data/PreferenceService'
import type { NextFunction, Request, Response } from 'express'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authMiddleware } from '../auth'

// Mock the preferenceService module
vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
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

const mockPreferenceService = preferenceService as any

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
    it('should return 401 when both auth headers are missing', () => {
      ;(req.header as any).mockReturnValue('')

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: missing credentials' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 when both auth headers are empty strings', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return ''
        if (header === 'x-api-key') return ''
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: missing credentials' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Server configuration', () => {
    it('should return 403 when API key is not configured', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'some-key'
        return ''
      })

      mockPreferenceService.get.mockReturnValue('')

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 403 when API key is null', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'some-key'
        return ''
      })

      mockPreferenceService.get.mockReturnValue(null)

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('API Key authentication (priority)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceService.get.mockReturnValue(validApiKey)
    })

    it('should authenticate successfully with valid API key', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 with invalid API key', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'invalid-key'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with empty API key', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return '   '
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: empty x-api-key' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle API key with whitespace', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return `  ${validApiKey}  `
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should prioritize API key over Bearer token when both are present', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return validApiKey
        if (header === 'authorization') return 'Bearer invalid-token'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 when API key is invalid even if Bearer token is valid', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'invalid-key'
        if (header === 'authorization') return `Bearer ${validApiKey}`
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Bearer token authentication (fallback)', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceService.get.mockReturnValue(validApiKey)
    })

    it('should authenticate successfully with valid Bearer token when no API key', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return `Bearer ${validApiKey}`
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should return 403 with invalid Bearer token', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer invalid-token'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with malformed authorization header', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Basic sometoken'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 with Bearer without space', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with only trailing spaces (edge case)', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Bearer    ' // This will be trimmed to "Bearer" and fail format check
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with case insensitive prefix', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return `bearer ${validApiKey}`
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })

    it('should handle Bearer token with whitespace', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return `  Bearer   ${validApiKey}  `
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(next).toHaveBeenCalled()
      expect(statusMock).not.toHaveBeenCalled()
    })
  })

  describe('Edge cases', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceService.get.mockReturnValue(validApiKey)
    })

    it('should use timing-safe comparison for different length tokens', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return 'short'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should return 401 when neither credential format is valid', () => {
      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return 'Invalid format'
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(401)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Unauthorized: invalid authorization format' })
      expect(next).not.toHaveBeenCalled()
    })
  })

  describe('Timing attack protection', () => {
    const validApiKey = 'valid-api-key-123'

    beforeEach(() => {
      mockPreferenceService.get.mockReturnValue(validApiKey)
    })

    it('should handle similar length but different API keys securely', () => {
      const similarKey = 'valid-api-key-124' // Same length, different last char

      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'x-api-key') return similarKey
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })

    it('should handle similar length but different Bearer tokens securely', () => {
      const similarKey = 'valid-api-key-124' // Same length, different last char

      ;(req.header as any).mockImplementation((header: string) => {
        if (header === 'authorization') return `Bearer ${similarKey}`
        return ''
      })

      authMiddleware(req as Request, res as Response, next)

      expect(statusMock).toHaveBeenCalledWith(403)
      expect(jsonMock).toHaveBeenCalledWith({ error: 'Forbidden' })
      expect(next).not.toHaveBeenCalled()
    })
  })
})
