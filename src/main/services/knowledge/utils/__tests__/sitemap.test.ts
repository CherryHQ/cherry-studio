import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, loggerErrorMock, loggerWarnMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerWarnMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: loggerWarnMock,
      error: loggerErrorMock
    })
  }
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

const { expandSitemapOwnerToCreateItems } = await import('../sitemap')

function createSitemapOwner(id = 'sitemap-owner-1', url = 'https://example.com/sitemap.xml') {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'sitemap' as const,
    data: {
      source: url,
      url
    },
    status: 'idle' as const,
    phase: null,
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createSignal() {
  return new AbortController().signal
}

describe('expandSitemapOwnerToCreateItems', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    loggerErrorMock.mockReset()
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

    const items = await expandSitemapOwnerToCreateItems(createSitemapOwner(), createSignal())

    expect(items).toEqual([
      {
        groupId: 'sitemap-owner-1',
        type: 'url',
        data: {
          source: 'https://example.com/page-1',
          url: 'https://example.com/page-1'
        }
      },
      {
        groupId: 'sitemap-owner-1',
        type: 'url',
        data: {
          source: 'https://example.com/page-2',
          url: 'https://example.com/page-2'
        }
      }
    ])
  })

  it('rejects unsupported sitemap protocols before fetching', async () => {
    await expect(
      expandSitemapOwnerToCreateItems(createSitemapOwner('sitemap-owner-2', 'file:///etc/passwd'), createSignal())
    ).rejects.toThrow('Invalid knowledge url: file:///etc/passwd')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs a warning when sitemap parsing yields no URLs', async () => {
    fetchMock.mockResolvedValue(new Response('<urlset></urlset>', { status: 200 }))

    await expect(
      expandSitemapOwnerToCreateItems(
        createSitemapOwner('sitemap-owner-3', 'https://example.com/empty-sitemap.xml'),
        createSignal()
      )
    ).resolves.toEqual([])

    expect(loggerWarnMock).toHaveBeenCalledWith('Sitemap expansion produced no URLs', {
      ownerId: 'sitemap-owner-3',
      sitemapUrl: 'https://example.com/empty-sitemap.xml'
    })
  })

  it('uses an internal fetch timeout signal', async () => {
    fetchMock.mockResolvedValue(new Response('<urlset></urlset>', { status: 200 }))

    await expandSitemapOwnerToCreateItems(createSitemapOwner('sitemap-owner-4'), createSignal())

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/sitemap.xml', {
      signal: expect.any(AbortSignal)
    })
  })

  it('rejects before fetching when the runtime signal is already aborted', async () => {
    const controller = new AbortController()
    const abortError = new Error('interrupted')
    controller.abort(abortError)

    await expect(expandSitemapOwnerToCreateItems(createSitemapOwner(), controller.signal)).rejects.toBe(abortError)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts the fetch signal when the runtime signal aborts', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation(
      async () =>
        new Promise(() => {
          // Keep fetch pending so the test can inspect the supplied signal.
        })
    )

    void expandSitemapOwnerToCreateItems(createSitemapOwner(), controller.signal).catch(() => undefined)

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const fetchSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal
    expect(fetchSignal.aborted).toBe(false)

    controller.abort(new Error('interrupted'))

    expect(fetchSignal.aborted).toBe(true)
  })
})
