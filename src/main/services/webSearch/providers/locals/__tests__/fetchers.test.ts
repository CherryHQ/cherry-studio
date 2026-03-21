import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchHtmlMock } = vi.hoisted(() => ({
  fetchHtmlMock: vi.fn()
}))

vi.mock('../LocalBrowser', () => ({
  localBrowser: {
    fetchHtml: fetchHtmlMock
  }
}))

import { fetchSearchResultPageHtml } from '../fetchers'

describe('fetchSearchResultPageHtml', () => {
  beforeEach(() => {
    fetchHtmlMock.mockReset()
  })

  it('keeps local browser windows hidden by default', async () => {
    fetchHtmlMock.mockResolvedValue('<html></html>')

    await fetchSearchResultPageHtml('https://example.com/search?q=test')

    expect(fetchHtmlMock).toHaveBeenCalledWith('https://example.com/search?q=test', {
      timeoutMs: 10000,
      signal: undefined,
      showWindow: false
    })
  })
})
