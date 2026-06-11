import { afterEach, describe, expect, it, vi } from 'vitest'

const searchKeywords = vi.fn()
const fetchUrls = vi.fn()

vi.mock('@main/core/application', () => ({
  application: { get: vi.fn(() => ({ searchKeywords, fetchUrls })) }
}))

const { searchWeb, fetchWeb, isWebLookupError } = await import('../webLookup')

describe('webLookup cancellation', () => {
  afterEach(() => vi.clearAllMocks())

  it('rethrows an AbortError instead of swallowing it into { error }', async () => {
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    searchKeywords.mockRejectedValueOnce(abort)
    await expect(searchWeb('q')).rejects.toBe(abort)
  })

  it('rethrows when the signal is already aborted, even for a non-AbortError rejection', async () => {
    const controller = new AbortController()
    controller.abort()
    searchKeywords.mockRejectedValueOnce(new Error('boom'))
    await expect(searchWeb('q', controller.signal)).rejects.toThrow('boom')
  })

  it('still returns { error } for a normal (non-cancellation) failure', async () => {
    searchKeywords.mockRejectedValueOnce(new Error('network down'))
    const result = await searchWeb('q')
    expect(isWebLookupError(result)).toBe(true)
  })

  it('fetchWeb also rethrows cancellation rather than returning { error }', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    fetchUrls.mockRejectedValueOnce(abort)
    await expect(fetchWeb(['https://example.com'])).rejects.toBe(abort)

    fetchUrls.mockRejectedValueOnce(new Error('dns failure'))
    expect(isWebLookupError(await fetchWeb(['https://example.com']))).toBe(true)
  })
})
