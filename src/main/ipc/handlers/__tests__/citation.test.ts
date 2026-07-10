import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchCitationPreview } = vi.hoisted(() => ({
  fetchCitationPreview: vi.fn()
}))
vi.mock('@main/utils/citationPreview', () => ({ fetchCitationPreview }))

import { citationHandlers } from '../citation'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('citationHandlers', () => {
  it('forwards the URL unchanged and returns only the preview content', async () => {
    fetchCitationPreview.mockResolvedValue('Short preview')

    const result = await citationHandlers['citation.fetch_preview']({ url: 'https://example.com/article' }, ctx)

    expect(fetchCitationPreview).toHaveBeenCalledWith('https://example.com/article')
    expect(result).toEqual({ content: 'Short preview' })
    expect(Object.keys(result)).toEqual(['content'])
  })

  it('returns empty content when the utility resolves empty', async () => {
    fetchCitationPreview.mockResolvedValue('')

    await expect(
      citationHandlers['citation.fetch_preview']({ url: 'https://example.com/empty' }, ctx)
    ).resolves.toEqual({ content: '' })
  })

  it('returns empty content when the utility rejects', async () => {
    fetchCitationPreview.mockRejectedValue(new Error('network unavailable'))

    await expect(
      citationHandlers['citation.fetch_preview']({ url: 'https://example.com/unavailable' }, ctx)
    ).resolves.toEqual({ content: '' })
  })
})
