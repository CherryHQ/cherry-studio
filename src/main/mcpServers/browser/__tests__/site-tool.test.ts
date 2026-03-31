import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock registry
vi.mock('../sites/registry', () => ({
  getAllSites: vi.fn(),
  findSite: vi.fn(),
  searchSites: vi.fn(),
  ensureSitesAvailable: vi.fn(),
  backgroundUpdate: vi.fn()
}))

// Mock runner
vi.mock('../sites/runner', () => ({
  runSiteAdapter: vi.fn()
}))

// Mock logger
vi.mock('../types', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { backgroundUpdate, ensureSitesAvailable, findSite, getAllSites, searchSites } from '../sites/registry'
import { runSiteAdapter } from '../sites/runner'
import { handleSite } from '../tools/site'

// ── Helpers ──────────────────────────────────────────────────────

function makeController() {
  return {} as any
}

function makeSiteMeta(overrides: Record<string, unknown> = {}) {
  return {
    name: 'twitter/search',
    description: 'Search Twitter',
    domain: 'x.com',
    args: { query: { required: true, description: 'Search query' } },
    filePath: '/tmp/twitter/search.js',
    source: 'community',
    ...overrides
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('handleSite', () => {
  const controller = makeController()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ensureSitesAvailable).mockResolvedValue('Community adapters already available.')
  })

  // ── backgroundUpdate is called on every action ──

  it('calls backgroundUpdate on every action', async () => {
    vi.mocked(getAllSites).mockReturnValue([])
    await handleSite(controller, { action: 'list' })
    expect(backgroundUpdate).toHaveBeenCalled()
  })

  it('calls backgroundUpdate for search action', async () => {
    vi.mocked(searchSites).mockReturnValue([])
    await handleSite(controller, { action: 'search', query: 'test' })
    expect(backgroundUpdate).toHaveBeenCalled()
  })

  it('calls backgroundUpdate for info action', async () => {
    vi.mocked(findSite).mockReturnValue(makeSiteMeta() as any)
    await handleSite(controller, { action: 'info', name: 'twitter/search' })
    expect(backgroundUpdate).toHaveBeenCalled()
  })

  it('calls backgroundUpdate for run action', async () => {
    vi.mocked(findSite).mockReturnValue(makeSiteMeta() as any)
    vi.mocked(runSiteAdapter).mockResolvedValue({ success: true, data: {} })
    await handleSite(controller, { action: 'run', name: 'twitter/search', args: { query: 'test' } })
    expect(backgroundUpdate).toHaveBeenCalled()
  })

  // ── action: list ──

  describe('action: list', () => {
    it('returns grouped platforms', async () => {
      vi.mocked(getAllSites).mockReturnValue([
        makeSiteMeta({ name: 'twitter/search' }) as any,
        makeSiteMeta({ name: 'twitter/timeline', description: 'Timeline' }) as any,
        makeSiteMeta({ name: 'github/trending', domain: 'github.com', description: 'Trending repos' }) as any
      ])

      const result = await handleSite(controller, { action: 'list' })
      expect(result.isError).toBe(false)

      const body = JSON.parse(result.content[0].text)
      expect(body.total).toBe(3)
      expect(body.platforms.twitter).toHaveLength(2)
      expect(body.platforms.github).toHaveLength(1)
    })

    it('calls ensureSitesAvailable before listing', async () => {
      vi.mocked(getAllSites).mockReturnValue([])
      await handleSite(controller, { action: 'list' })
      expect(ensureSitesAvailable).toHaveBeenCalled()
    })

    it('returns empty list when no adapters', async () => {
      vi.mocked(getAllSites).mockReturnValue([])
      const result = await handleSite(controller, { action: 'list' })
      const body = JSON.parse(result.content[0].text)
      expect(body.total).toBe(0)
      expect(body.platforms).toEqual({})
    })
  })

  // ── action: search ──

  describe('action: search', () => {
    it('returns matching adapters', async () => {
      vi.mocked(searchSites).mockReturnValue([makeSiteMeta() as any])
      const result = await handleSite(controller, { action: 'search', query: 'twitter' })
      expect(result.isError).toBe(false)

      const body = JSON.parse(result.content[0].text)
      expect(body).toHaveLength(1)
      expect(body[0].name).toBe('twitter/search')
    })

    it('returns empty array when no results', async () => {
      vi.mocked(searchSites).mockReturnValue([])
      const result = await handleSite(controller, { action: 'search', query: 'nonexistent' })
      expect(result.isError).toBe(false)

      const body = JSON.parse(result.content[0].text)
      expect(body).toHaveLength(0)
    })

    it('returns error when query is missing', async () => {
      const result = await handleSite(controller, { action: 'search' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('query')
    })
  })

  // ── action: info ──

  describe('action: info', () => {
    it('returns adapter metadata', async () => {
      const site = makeSiteMeta({
        capabilities: ['read'],
        readOnly: true,
        example: 'site run twitter/search --query test'
      })
      vi.mocked(findSite).mockReturnValue(site as any)

      const result = await handleSite(controller, { action: 'info', name: 'twitter/search' })
      expect(result.isError).toBe(false)

      const body = JSON.parse(result.content[0].text)
      expect(body.name).toBe('twitter/search')
      expect(body.domain).toBe('x.com')
      expect(body.args.query.required).toBe(true)
      expect(body.capabilities).toEqual(['read'])
      expect(body.readOnly).toBe(true)
      expect(body.example).toBe('site run twitter/search --query test')
      expect(body.source).toBe('community')
    })

    it('returns error when adapter not found', async () => {
      vi.mocked(findSite).mockReturnValue(undefined)
      const result = await handleSite(controller, { action: 'info', name: 'nonexistent/adapter' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not found')
    })

    it('returns error when name is missing', async () => {
      const result = await handleSite(controller, { action: 'info' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('name')
    })
  })

  // ── action: run ──

  describe('action: run', () => {
    it('calls runner and returns result', async () => {
      const site = makeSiteMeta()
      vi.mocked(findSite).mockReturnValue(site as any)
      vi.mocked(runSiteAdapter).mockResolvedValue({ success: true, data: { items: [1, 2, 3] } })

      const result = await handleSite(controller, { action: 'run', name: 'twitter/search', args: { query: 'test' } })
      expect(result.isError).toBe(false)

      const body = JSON.parse(result.content[0].text)
      expect(body.success).toBe(true)
      expect(body.data.items).toEqual([1, 2, 3])

      expect(runSiteAdapter).toHaveBeenCalledWith(
        controller,
        site,
        { query: 'test' },
        {
          timeout: undefined,
          privateMode: undefined,
          showWindow: undefined
        }
      )
    })

    it('passes options to runner', async () => {
      vi.mocked(findSite).mockReturnValue(makeSiteMeta() as any)
      vi.mocked(runSiteAdapter).mockResolvedValue({ success: true, data: {} })

      await handleSite(controller, {
        action: 'run',
        name: 'twitter/search',
        args: { query: 'test' },
        timeout: 60000,
        privateMode: true,
        showWindow: true
      })

      expect(runSiteAdapter).toHaveBeenCalledWith(
        controller,
        expect.anything(),
        { query: 'test' },
        { timeout: 60000, privateMode: true, showWindow: true }
      )
    })

    it('returns error when name is missing', async () => {
      const result = await handleSite(controller, { action: 'run' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('name')
    })

    it('returns error when adapter not found', async () => {
      vi.mocked(findSite).mockReturnValue(undefined)
      const result = await handleSite(controller, { action: 'run', name: 'nonexistent/adapter' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not found')
    })

    it('uses empty args when none provided', async () => {
      vi.mocked(findSite).mockReturnValue(makeSiteMeta() as any)
      vi.mocked(runSiteAdapter).mockResolvedValue({ success: true, data: {} })

      await handleSite(controller, { action: 'run', name: 'twitter/search' })
      expect(runSiteAdapter).toHaveBeenCalledWith(controller, expect.anything(), {}, expect.anything())
    })
  })

  // ── error handling ──

  describe('error handling', () => {
    it('returns error for invalid action', async () => {
      const result = await handleSite(controller, { action: 'invalid' })
      expect(result.isError).toBe(true)
    })

    it('returns error for invalid args schema', async () => {
      const result = await handleSite(controller, { action: 'run', args: 'not-an-object' })
      expect(result.isError).toBe(true)
    })
  })
})
