import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock 外部依赖
vi.mock('turndown', () => ({
  default: vi.fn(() => ({
    turndown: vi.fn(() => '# Test content')
  }))
}))
vi.mock('@mozilla/readability', () => ({
  Readability: vi.fn(() => ({
    parse: vi.fn(() => ({
      title: 'Test Article',
      content: '<p>Test content</p>',
      textContent: 'Test content'
    }))
  }))
}))
vi.mock('@reduxjs/toolkit', () => ({
  nanoid: vi.fn(() => 'test-id')
}))

import { fetchRedirectUrl, fetchWebContent, fetchWebContents } from '../fetch'

// 设置基础 mocks
global.DOMParser = vi.fn().mockImplementation(() => ({
  parseFromString: vi.fn(() => ({}))
})) as any

global.window = {
  api: {
    searchService: {
      openUrlInSearchWindow: vi.fn()
    }
  }
} as any

// 辅助函数
const createMockResponse = (overrides = {}) =>
  ({
    ok: true,
    status: 200,
    text: vi.fn().mockResolvedValue('<html><body>Test content</body></html>'),
    ...overrides
  }) as unknown as Response

describe('fetch', () => {
  beforeEach(() => {
    // Mock fetch 和 AbortSignal
    global.fetch = vi.fn()
    global.AbortSignal = {
      timeout: vi.fn(() => ({})),
      any: vi.fn(() => ({}))
    } as any

    // 清理 mock 调用历史
    vi.clearAllMocks()
  })

  describe('fetchWebContent', () => {
    it('should fetch and return content successfully', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(createMockResponse())

      const result = await fetchWebContent('https://example.com')

      expect(result).toEqual({
        title: 'Test Article',
        url: 'https://example.com',
        content: '# Test content'
      })
      expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.any(Object))
    })

    it('should use browser mode when specified', async () => {
      vi.mocked(window.api.searchService.openUrlInSearchWindow).mockResolvedValueOnce(
        '<html><body>Browser content</body></html>'
      )

      const result = await fetchWebContent('https://example.com', 'markdown', true)

      expect(result.content).toBe('# Test content')
      expect(window.api.searchService.openUrlInSearchWindow).toHaveBeenCalled()
    })

    it('should handle errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // 无效 URL
      const invalidResult = await fetchWebContent('not-a-url')
      expect(invalidResult.content).toBe('No content found')

      // 网络错误
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))
      const networkResult = await fetchWebContent('https://example.com')
      expect(networkResult.content).toBe('No content found')

      consoleSpy.mockRestore()
    })

    it('should rethrow abort errors', async () => {
      const abortError = new DOMException('Aborted', 'AbortError')
      vi.mocked(global.fetch).mockRejectedValueOnce(abortError)

      await expect(fetchWebContent('https://example.com')).rejects.toThrow(DOMException)
    })

    it.each([
      ['markdown', '# Test content'],
      ['html', '<p>Test content</p>'],
      ['text', 'Test content']
    ])('should return %s format correctly', async (format, expectedContent) => {
      vi.mocked(global.fetch).mockResolvedValueOnce(createMockResponse())

      const result = await fetchWebContent('https://example.com', format as any)

      expect(result.content).toBe(expectedContent)
      expect(result.title).toBe('Test Article')
      expect(result.url).toBe('https://example.com')
    })

    it('should handle timeout signal in AbortSignal.any', async () => {
      const mockTimeoutSignal = new AbortController().signal
      vi.spyOn(global.AbortSignal, 'timeout').mockReturnValue(mockTimeoutSignal)

      vi.mocked(global.fetch).mockResolvedValueOnce(createMockResponse())

      await fetchWebContent('https://example.com')

      // 验证 AbortSignal.timeout 是否被调用，并传入 30000ms
      expect(global.AbortSignal.timeout).toHaveBeenCalledWith(30000)

      vi.spyOn(global.AbortSignal, 'timeout').mockRestore()
    })

    it('should combine user signal with timeout signal', async () => {
      const userController = new AbortController()
      const mockAnyCalls: any[] = []

      vi.spyOn(global.AbortSignal, 'any').mockImplementation((signals) => {
        mockAnyCalls.push(signals)
        return new AbortController().signal
      })

      vi.mocked(global.fetch).mockResolvedValueOnce(createMockResponse())

      await fetchWebContent('https://example.com', 'markdown', false, {
        signal: userController.signal
      })

      // 验证 AbortSignal.any 是否被调用，并传入两个信号
      expect(mockAnyCalls).toHaveLength(1)
      expect(mockAnyCalls[0]).toHaveLength(2)
      expect(mockAnyCalls[0]).toContain(userController.signal)

      vi.spyOn(global.AbortSignal, 'any').mockRestore()
    })
  })

  describe('fetchWebContents', () => {
    it('should fetch multiple URLs in parallel', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(createMockResponse()).mockResolvedValueOnce(createMockResponse())

      const urls = ['https://example1.com', 'https://example2.com']
      const results = await fetchWebContents(urls)

      expect(results).toHaveLength(2)
      expect(results[0].content).toBe('# Test content')
      expect(results[1].content).toBe('# Test content')
    })

    it('should handle partial failures gracefully', async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(createMockResponse())
        .mockRejectedValueOnce(new Error('Network error'))

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const results = await fetchWebContents(['https://success.com', 'https://fail.com'])

      expect(results).toHaveLength(2)
      expect(results[0].content).toBe('# Test content')
      expect(results[1].content).toBe('No content found')

      consoleSpy.mockRestore()
    })
  })

  describe('fetchRedirectUrl', () => {
    it('should return final redirect URL', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        url: 'https://redirected.com/final'
      } as any)

      const result = await fetchRedirectUrl('https://example.com')

      expect(result).toBe('https://redirected.com/final')
      expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.any(Object))
    })

    it('should return original URL on error', async () => {
      vi.mocked(global.fetch).mockRejectedValueOnce(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await fetchRedirectUrl('https://example.com')
      expect(result).toBe('https://example.com')

      consoleSpy.mockRestore()
    })
  })
})
