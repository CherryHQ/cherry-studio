import { describe, expect, it, vi } from 'vitest'

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

const { expandSitemapToCreateItems } = await import('../sitemap')

describe('expandSitemapToCreateItems', () => {
  it('creates a sitemap owner and deduplicated url child items', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        [
          '<urlset>',
          '  <url><loc>https://example.com/page-1</loc></url>',
          '  <url><loc>https://example.com/page-2</loc></url>',
          '  <url><loc>https://example.com/page-1</loc></url>',
          '</urlset>'
        ].join(''),
        { status: 200 }
      )
    )

    const items = await expandSitemapToCreateItems('https://example.com/sitemap.xml')

    expect(items[0]).toMatchObject({
      ref: 'root',
      type: 'sitemap',
      data: {
        url: 'https://example.com/sitemap.xml',
        name: 'https://example.com/sitemap.xml'
      }
    })
    expect(items.slice(1)).toEqual([
      {
        groupRef: 'root',
        type: 'url',
        data: {
          url: 'https://example.com/page-1',
          name: 'https://example.com/page-1'
        }
      },
      {
        groupRef: 'root',
        type: 'url',
        data: {
          url: 'https://example.com/page-2',
          name: 'https://example.com/page-2'
        }
      }
    ])
  })
})
