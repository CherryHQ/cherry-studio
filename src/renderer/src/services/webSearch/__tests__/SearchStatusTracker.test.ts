import type { WebSearchStatus } from '@renderer/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SearchStatusTracker } from '../SearchStatusTracker'

// Mock cacheService
const mockCacheGet = vi.fn()
const mockCacheSet = vi.fn()
vi.mock('@data/CacheService', () => ({
  cacheService: {
    get: (...args: any[]) => mockCacheGet(...args),
    set: (...args: any[]) => mockCacheSet(...args)
  }
}))

describe('SearchStatusTracker', () => {
  let tracker: SearchStatusTracker

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    tracker = new SearchStatusTracker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setStatus', () => {
    it('should set status for a new request', async () => {
      mockCacheGet.mockReturnValue(null)

      const status: WebSearchStatus = { phase: 'default' }

      const promise = tracker.setStatus('request-1', status)
      await vi.runAllTimersAsync()
      await promise

      expect(mockCacheGet).toHaveBeenCalledWith('chat.websearch.active_searches')
      expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', { 'request-1': status })
    })

    it('should update status for existing request', async () => {
      mockCacheGet.mockReturnValue({ 'request-1': { phase: 'default' } })

      const newStatus: WebSearchStatus = { phase: 'rag' }

      const promise = tracker.setStatus('request-1', newStatus)
      await vi.runAllTimersAsync()
      await promise

      expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', { 'request-1': newStatus })
    })

    it('should preserve other request statuses when updating', async () => {
      mockCacheGet.mockReturnValue({
        'request-1': { phase: 'default' },
        'request-2': { phase: 'rag' }
      })

      const newStatus: WebSearchStatus = { phase: 'cutoff' }

      const promise = tracker.setStatus('request-1', newStatus)
      await vi.runAllTimersAsync()
      await promise

      expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', {
        'request-1': newStatus,
        'request-2': { phase: 'rag' }
      })
    })

    it('should delay execution when delayMs is provided', async () => {
      mockCacheGet.mockReturnValue({})

      const status: WebSearchStatus = { phase: 'default' }

      const promise = tracker.setStatus('request-1', status, 1000)

      // Advance timers partially
      await vi.advanceTimersByTimeAsync(500)

      // Promise should not be resolved yet
      let resolved = false
      promise.then(() => {
        resolved = true
      })

      expect(resolved).toBe(false)

      // Advance remaining time
      await vi.advanceTimersByTimeAsync(500)
      await promise

      expect(resolved).toBe(true)
    })

    it('should not delay when delayMs is not provided', async () => {
      mockCacheGet.mockReturnValue({})

      const status: WebSearchStatus = { phase: 'default' }

      // This should resolve immediately without needing to advance timers
      await tracker.setStatus('request-1', status)

      expect(mockCacheSet).toHaveBeenCalled()
    })

    it('should handle various WebSearchStatus phases', async () => {
      mockCacheGet.mockReturnValue({})

      const testCases: WebSearchStatus[] = [
        { phase: 'default' },
        { phase: 'fetch_complete', countAfter: 5 },
        { phase: 'rag' },
        { phase: 'rag_complete', countBefore: 10, countAfter: 5 },
        { phase: 'rag_failed' },
        { phase: 'cutoff' }
      ]

      for (const status of testCases) {
        vi.clearAllMocks()
        mockCacheGet.mockReturnValue({})

        const promise = tracker.setStatus('request-1', status)
        await vi.runAllTimersAsync()
        await promise

        expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', { 'request-1': status })
      }
    })

    it('should not throw when cache get fails', async () => {
      mockCacheGet.mockImplementation(() => {
        throw new Error('Cache error')
      })

      const status: WebSearchStatus = { phase: 'default' }

      // Should not throw
      await expect(tracker.setStatus('request-1', status)).resolves.not.toThrow()
    })

    it('should not throw when cache set fails', async () => {
      mockCacheGet.mockReturnValue({})
      mockCacheSet.mockImplementation(() => {
        throw new Error('Cache error')
      })

      const status: WebSearchStatus = { phase: 'default' }

      // Should not throw
      await expect(tracker.setStatus('request-1', status)).resolves.not.toThrow()
    })
  })

  describe('clearStatus', () => {
    it('should remove status for a request', () => {
      mockCacheGet.mockReturnValue({
        'request-1': { phase: 'default' },
        'request-2': { phase: 'rag' }
      })

      tracker.clearStatus('request-1')

      expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', {
        'request-2': { phase: 'rag' }
      })
    })

    it('should handle clearing non-existent request', () => {
      mockCacheGet.mockReturnValue({ 'request-1': { phase: 'default' } })

      // Should not throw
      expect(() => tracker.clearStatus('non-existent')).not.toThrow()

      expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', {
        'request-1': { phase: 'default' }
      })
    })

    it('should handle empty active searches', () => {
      mockCacheGet.mockReturnValue(null)

      // Should not throw
      expect(() => tracker.clearStatus('request-1')).not.toThrow()

      expect(mockCacheSet).toHaveBeenCalledWith('chat.websearch.active_searches', {})
    })

    it('should not throw when cache get fails', () => {
      mockCacheGet.mockImplementation(() => {
        throw new Error('Cache error')
      })

      // Should not throw
      expect(() => tracker.clearStatus('request-1')).not.toThrow()
    })

    it('should not throw when cache set fails', () => {
      mockCacheGet.mockReturnValue({ 'request-1': { phase: 'default' } })
      mockCacheSet.mockImplementation(() => {
        throw new Error('Cache error')
      })

      // Should not throw
      expect(() => tracker.clearStatus('request-1')).not.toThrow()
    })
  })
})
