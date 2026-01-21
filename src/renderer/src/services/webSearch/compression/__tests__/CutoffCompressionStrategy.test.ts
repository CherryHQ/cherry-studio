import type { WebSearchProviderResult } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CutoffCompressionStrategy } from '../CutoffCompressionStrategy'

// Mock tokenx
const mockSliceByTokens = vi.fn((content: string, _start: number, limit: number) => {
  // Simple mock: just slice by character (1 token = 1 char for testing)
  return content.slice(0, limit)
})

vi.mock('tokenx', () => ({
  sliceByTokens: (content: string, start: number, limit: number) => mockSliceByTokens(content, start, limit)
}))

// Mock window.toast
const mockToastWarning = vi.fn()
vi.stubGlobal('window', {
  toast: {
    warning: mockToastWarning
  }
})

// Mock i18n
vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

// Mock preferenceService
const mockPreferenceGet = vi.fn()
vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: (key: string) => mockPreferenceGet(key)
  }
}))

// Helper to create mock results
const createMockResult = (overrides: Partial<WebSearchProviderResult> = {}): WebSearchProviderResult => ({
  title: 'Test Title',
  content: 'Test content for compression testing',
  url: 'https://example.com',
  ...overrides
})

describe('CutoffCompressionStrategy', () => {
  let strategy: CutoffCompressionStrategy

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferenceGet.mockReset()
    strategy = new CutoffCompressionStrategy()
  })

  describe('name property', () => {
    it('should have name "cutoff"', () => {
      expect(strategy.name).toBe('cutoff')
    })
  })

  describe('compress', () => {
    const context = { questions: ['test question'], requestId: 'test-request-id' }

    describe('empty results', () => {
      it('should return empty array when results is empty', async () => {
        const result = await strategy.compress([], context)
        expect(result).toEqual([])
      })
    })

    describe('missing cutoff_limit', () => {
      it('should return original results and show warning when cutoff_limit is not set', async () => {
        mockPreferenceGet.mockResolvedValueOnce(null) // cutoff_limit
        mockPreferenceGet.mockResolvedValueOnce('char') // cutoff_unit

        const results = [createMockResult()]
        const compressed = await strategy.compress(results, context)

        expect(compressed).toEqual(results)
        expect(mockToastWarning).toHaveBeenCalledWith({
          timeout: 5000,
          title: 'settings.tool.websearch.compression.error.cutoff_limit_not_set'
        })
      })

      it('should return original results when cutoff_limit is 0', async () => {
        mockPreferenceGet.mockResolvedValueOnce(0) // cutoff_limit
        mockPreferenceGet.mockResolvedValueOnce('char') // cutoff_unit

        const results = [createMockResult()]
        const compressed = await strategy.compress(results, context)

        expect(compressed).toEqual(results)
        expect(mockToastWarning).toHaveBeenCalled()
      })
    })

    describe('character-based compression', () => {
      beforeEach(() => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.compression.cutoff_limit') return Promise.resolve(20)
          if (key === 'chat.websearch.compression.cutoff_unit') return Promise.resolve('char')
          return Promise.resolve(null)
        })
      })

      it('should truncate content exceeding limit and add ellipsis', async () => {
        const results = [createMockResult({ content: 'This is a very long content that should be truncated' })]

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].content).toBe('This is a very long ...')
        expect(compressed[0].content.length).toBe(23) // 20 chars + '...'
      })

      it('should not truncate content within limit', async () => {
        const results = [createMockResult({ content: 'Short content' })]

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].content).toBe('Short content')
      })

      it('should preserve other result properties', async () => {
        const results = [
          createMockResult({
            title: 'My Title',
            url: 'https://test.com',
            content: 'This is a very long content that should be truncated'
          })
        ]

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].title).toBe('My Title')
        expect(compressed[0].url).toBe('https://test.com')
      })
    })

    describe('token-based compression', () => {
      beforeEach(() => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.compression.cutoff_limit') return Promise.resolve(10)
          if (key === 'chat.websearch.compression.cutoff_unit') return Promise.resolve('token')
          return Promise.resolve(null)
        })
      })

      it('should use sliceByTokens for token-based truncation', async () => {
        const results = [createMockResult({ content: 'This is content for token slicing' })]

        await strategy.compress(results, context)

        expect(mockSliceByTokens).toHaveBeenCalledWith('This is content for token slicing', 0, 10)
      })

      it('should add ellipsis when token slicing truncates content', async () => {
        mockSliceByTokens.mockReturnValueOnce('This is co') // Shorter than original

        const results = [createMockResult({ content: 'This is content for token slicing' })]

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].content).toBe('This is co...')
      })

      it('should not add ellipsis when content is not truncated', async () => {
        const shortContent = 'Short'
        mockSliceByTokens.mockReturnValueOnce(shortContent)

        const results = [createMockResult({ content: shortContent })]

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].content).toBe(shortContent)
      })
    })

    describe('multiple results', () => {
      it('should distribute limit evenly across results', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.compression.cutoff_limit') return Promise.resolve(30)
          if (key === 'chat.websearch.compression.cutoff_unit') return Promise.resolve('char')
          return Promise.resolve(null)
        })

        const results = [
          createMockResult({ content: 'First result with long content that exceeds the limit' }),
          createMockResult({ content: 'Second result with long content that exceeds the limit' }),
          createMockResult({ content: 'Third result with long content that exceeds the limit' })
        ]

        const compressed = await strategy.compress(results, context)

        // perResultLimit = 30 / 3 = 10
        expect(compressed[0].content).toBe('First resu...')
        expect(compressed[1].content).toBe('Second res...')
        expect(compressed[2].content).toBe('Third resu...')
      })

      it('should ensure minimum per-result limit of 1', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.compression.cutoff_limit') return Promise.resolve(2)
          if (key === 'chat.websearch.compression.cutoff_unit') return Promise.resolve('char')
          return Promise.resolve(null)
        })

        const results = [
          createMockResult({ content: 'ABCDEFGHIJ' }),
          createMockResult({ content: 'KLMNOPQRST' }),
          createMockResult({ content: 'UVWXYZ1234' })
        ]

        const compressed = await strategy.compress(results, context)

        // perResultLimit = Math.max(1, floor(2/3)) = Math.max(1, 0) = 1
        // But since Math.floor(2/3) = 0, Math.max(1, 0) = 1
        expect(compressed[0].content.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('edge cases', () => {
      it('should handle content exactly matching limit', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.compression.cutoff_limit') return Promise.resolve(10)
          if (key === 'chat.websearch.compression.cutoff_unit') return Promise.resolve('char')
          return Promise.resolve(null)
        })

        const results = [createMockResult({ content: '1234567890' })] // exactly 10 chars

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].content).toBe('1234567890') // no ellipsis
      })

      it('should handle empty content', async () => {
        mockPreferenceGet.mockImplementation((key: string) => {
          if (key === 'chat.websearch.compression.cutoff_limit') return Promise.resolve(10)
          if (key === 'chat.websearch.compression.cutoff_unit') return Promise.resolve('char')
          return Promise.resolve(null)
        })

        const results = [createMockResult({ content: '' })]

        const compressed = await strategy.compress(results, context)

        expect(compressed[0].content).toBe('')
      })
    })
  })
})
