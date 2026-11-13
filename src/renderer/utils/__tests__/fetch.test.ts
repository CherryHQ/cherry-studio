import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchRedirectUrl } from '../fetch'

const fetchMock = vi.fn<typeof fetch>()

describe('fetchRedirectUrl', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('should return final redirect URL', async () => {
    const finalUrl = 'https://redirected.com/final'
    const response = new Response()
    Object.defineProperty(response, 'url', { value: finalUrl })
    fetchMock.mockResolvedValueOnce(response)

    const result = await fetchRedirectUrl('https://example.com')

    expect(result).toBe(finalUrl)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('should return original URL on error', async () => {
    const error = new Error('Network error')
    const loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => undefined)
    fetchMock.mockRejectedValueOnce(error)

    const result = await fetchRedirectUrl('https://example.com')

    expect(result).toBe('https://example.com')
    expect(loggerErrorSpy.mock.calls[0][0]).toBe('Failed to fetch redirect url')
    expect(loggerErrorSpy.mock.calls[0][1]).toBe(error)
  })
})
