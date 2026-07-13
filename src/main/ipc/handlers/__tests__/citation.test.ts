import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchPreview } = vi.hoisted(() => ({
  fetchPreview: vi.fn()
}))
vi.mock('@main/services/CitationPreviewService', () => ({ citationPreviewService: { fetchPreview } }))

import { citationHandlers } from '../citation'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('citationHandlers', () => {
  it('forwards the URL unchanged and returns only the preview content', async () => {
    fetchPreview.mockResolvedValue('Short preview')

    const result = await citationHandlers['citation.fetch_preview']({ url: 'https://example.com/article' }, ctx)

    expect(fetchPreview).toHaveBeenCalledWith('https://example.com/article')
    expect(result).toEqual({ content: 'Short preview' })
    expect(Object.keys(result)).toEqual(['content'])
  })

  it('returns empty content when the service resolves empty', async () => {
    fetchPreview.mockResolvedValue('')

    await expect(
      citationHandlers['citation.fetch_preview']({ url: 'https://example.com/empty' }, ctx)
    ).resolves.toEqual({ content: '' })
  })

  it('returns empty content when the service rejects', async () => {
    fetchPreview.mockRejectedValue(new Error('network unavailable'))

    await expect(
      citationHandlers['citation.fetch_preview']({ url: 'https://example.com/unavailable' }, ctx)
    ).resolves.toEqual({ content: '' })
  })
})
