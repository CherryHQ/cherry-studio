import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  cancelPreviews: vi.fn(),
  fetchPreview: vi.fn()
}))
const applicationGet = vi.hoisted(() => vi.fn(() => service))

vi.mock('@application', () => ({ application: { get: applicationGet } }))

import { citationHandlers } from '../citation'

const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('citationHandlers', () => {
  it('forwards URL, requestId, and trusted senderId and returns only preview content', async () => {
    service.fetchPreview.mockResolvedValue('Short preview')

    const result = await citationHandlers['citation.fetch_preview'](
      { url: 'https://example.com/article', requestId: 'panel-1' },
      ctx
    )

    expect(applicationGet).toHaveBeenCalledWith('CitationPreviewService')
    expect(service.fetchPreview).toHaveBeenCalledWith('https://example.com/article', {
      requestId: 'panel-1',
      senderId: 'w1'
    })
    expect(result).toEqual({ content: 'Short preview' })
    expect(Object.keys(result)).toEqual(['content'])
  })

  it('returns empty content when the service rejects', async () => {
    service.fetchPreview.mockRejectedValue(new Error('network unavailable'))

    await expect(
      citationHandlers['citation.fetch_preview']({ url: 'https://example.com/unavailable', requestId: 'panel-1' }, ctx)
    ).resolves.toEqual({ content: '' })
  })

  it('cancels only previews owned by the caller window and requestId', async () => {
    await citationHandlers['citation.cancel_previews']({ requestId: 'panel-1' }, ctx)

    expect(service.cancelPreviews).toHaveBeenCalledWith({ requestId: 'panel-1', senderId: 'w1' })
  })
})
