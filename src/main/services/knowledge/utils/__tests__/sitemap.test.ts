import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, loggerWarnMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock,
      error: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

const { expandSitemapOwnerToCreateItems } = await import('../sitemap')

describe('expandSitemapOwnerToCreateItems', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    loggerWarnMock.mockReset()
  })

  it('creates deduplicated url child items for a sitemap owner', async () => {
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

    const items = await expandSitemapOwnerToCreateItems({
      id: 'sitemap-owner-1',
      baseId: 'kb-1',
      groupId: null,
      type: 'sitemap',
      data: {
        url: 'https://example.com/sitemap.xml',
        name: 'https://example.com/sitemap.xml'
      },
      status: 'idle',
      error: null,
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z'
    })

    expect(items).toEqual([
      {
        groupId: 'sitemap-owner-1',
        type: 'url',
        data: {
          url: 'https://example.com/page-1',
          name: 'https://example.com/page-1'
        }
      },
      {
        groupId: 'sitemap-owner-1',
        type: 'url',
        data: {
          url: 'https://example.com/page-2',
          name: 'https://example.com/page-2'
        }
      }
    ])
  })

  it('rejects unsupported sitemap protocols before fetching', async () => {
    await expect(
      expandSitemapOwnerToCreateItems({
        id: 'sitemap-owner-2',
        baseId: 'kb-1',
        groupId: null,
        type: 'sitemap',
        data: {
          url: 'file:///etc/passwd',
          name: 'file:///etc/passwd'
        },
        status: 'idle',
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      })
    ).rejects.toThrow('Invalid knowledge url: file:///etc/passwd')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs a warning when sitemap parsing yields no URLs', async () => {
    fetchMock.mockResolvedValue(new Response('<urlset></urlset>', { status: 200 }))

    await expect(
      expandSitemapOwnerToCreateItems({
        id: 'sitemap-owner-3',
        baseId: 'kb-1',
        groupId: null,
        type: 'sitemap',
        data: {
          url: 'https://example.com/empty-sitemap.xml',
          name: 'https://example.com/empty-sitemap.xml'
        },
        status: 'idle',
        error: null,
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:00:00.000Z'
      })
    ).resolves.toEqual([])

    expect(loggerWarnMock).toHaveBeenCalledWith('Sitemap expansion produced no URLs', {
      ownerId: 'sitemap-owner-3',
      sitemapUrl: 'https://example.com/empty-sitemap.xml'
    })
  })
})
