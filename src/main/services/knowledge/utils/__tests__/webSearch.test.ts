import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

const { fetchKnowledgeSitemapUrls, fetchKnowledgeWebPage } = await import('../webSearch')

describe('fetchKnowledgeWebPage', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches a page and returns markdown content', async () => {
    fetchMock.mockResolvedValue(new Response('# Example Page\n\nHello knowledge', { status: 200 }))

    await expect(fetchKnowledgeWebPage('https://example.com')).resolves.toBe('# Example Page\n\nHello knowledge')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: {
          'X-Retain-Images': 'none',
          'X-Return-Format': 'markdown'
        }
      })
    )
  })

  it('throws on non-ok upstream responses', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    await expect(fetchKnowledgeWebPage('https://example.com')).rejects.toThrow(
      'Failed to fetch knowledge web page https://example.com: HTTP 500'
    )
  })

  it('resolves page urls from a single-layer urlset sitemap', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        [
          '<urlset>',
          '  <url><loc>https://example.com/page-1</loc></url>',
          '  <url><loc>https://example.com/page-2</loc></url>',
          '</urlset>'
        ].join(''),
        { status: 200 }
      )
    )

    await expect(fetchKnowledgeSitemapUrls('https://example.com/sitemap.xml')).resolves.toEqual([
      'https://example.com/page-1',
      'https://example.com/page-2'
    ])

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/sitemap.xml',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('returns empty array for sitemap indexes instead of recursing', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        [
          '<sitemapindex>',
          '  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>',
          '</sitemapindex>'
        ].join(''),
        { status: 200 }
      )
    )

    await expect(fetchKnowledgeSitemapUrls('https://example.com/sitemap.xml')).resolves.toEqual([])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
