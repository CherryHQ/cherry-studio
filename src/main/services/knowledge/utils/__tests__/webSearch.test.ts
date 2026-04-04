import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const readabilityParseMock = vi.hoisted(() => vi.fn())
const turndownMock = vi.hoisted(() => vi.fn())

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

vi.mock('@mozilla/readability', () => ({
  Readability: class {
    parse = readabilityParseMock
  }
}))

vi.mock('turndown', () => ({
  default: class {
    turndown = turndownMock
  }
}))

const { fetchKnowledgeSitemapUrls, fetchKnowledgeWebPage } = await import('../webSearch')

describe('fetchKnowledgeWebPage', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    readabilityParseMock.mockReset()
    turndownMock.mockReset()
  })

  it('fetches a page and returns markdown content', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        '<html><head><title>Example Page</title></head><body><article>Hello knowledge</article></body></html>',
        {
          status: 200,
          headers: {
            'content-type': 'text/html'
          }
        }
      )
    )
    readabilityParseMock.mockReturnValue({
      title: 'Example Page',
      content: '<article><h1>Example Page</h1><p>Hello knowledge</p></article>'
    })
    turndownMock.mockReturnValue('# Example Page\n\nHello knowledge')

    await expect(fetchKnowledgeWebPage('https://example.com')).resolves.toEqual({
      url: 'https://example.com',
      title: 'Example Page',
      markdown: '# Example Page\n\nHello knowledge'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('throws on non-ok upstream responses', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }))

    await expect(fetchKnowledgeWebPage('https://example.com')).rejects.toThrow(
      'Failed to fetch knowledge web page https://example.com: HTTP 500'
    )
  })

  it('resolves page urls from nested sitemap indexes', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === 'https://example.com/sitemap.xml') {
        return new Response(
          [
            '<sitemapindex>',
            '  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>',
            '</sitemapindex>'
          ].join(''),
          { status: 200 }
        )
      }

      if (url === 'https://example.com/sitemap-pages.xml') {
        return new Response(
          [
            '<urlset>',
            '  <url><loc>https://example.com/page-1</loc></url>',
            '  <url><loc>https://example.com/page-2</loc></url>',
            '</urlset>'
          ].join(''),
          { status: 200 }
        )
      }

      return new Response('', { status: 404 })
    })

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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.com/sitemap-pages.xml',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })
})
