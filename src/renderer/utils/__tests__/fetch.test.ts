import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchRedirectUrl } from '../fetch'

describe('fetch', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    vi.clearAllMocks()
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
