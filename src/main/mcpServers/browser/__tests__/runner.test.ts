import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock node:fs
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn()
  }
})

// Mock the logger
vi.mock('../types', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { readFileSync } from 'node:fs'

import { domainMatches, runSiteAdapter } from '../sites/runner'
import type { SiteMeta } from '../types'

// ── Helpers ──────────────────────────────────────────────────────

function makeSite(overrides: Partial<SiteMeta> = {}): SiteMeta {
  return {
    name: 'test/adapter',
    description: 'Test adapter',
    domain: 'example.com',
    args: {},
    filePath: '/tmp/test/adapter.js',
    source: 'community',
    ...overrides
  }
}

function makeController(overrides: Record<string, unknown> = {}) {
  return {
    listTabs: vi.fn().mockResolvedValue([]),
    open: vi.fn().mockResolvedValue({ currentUrl: 'https://example.com', title: 'Example', tabId: 'tab-1' }),
    execute: vi.fn().mockResolvedValue(null),
    ...overrides
  } as any
}

const ADAPTER_JS = `/* @meta
{ "name": "test/adapter", "description": "Test", "domain": "example.com" }
*/
async function(args) { return { items: [] }; }`

const ADAPTER_JS_BODY = 'async function(args) { return { items: [] }; }'

// ── Tests ────────────────────────────────────────────────────────

describe('domainMatches', () => {
  it('matches exact domain', () => {
    expect(domainMatches('https://x.com/home', 'x.com')).toBe(true)
  })

  it('matches subdomain', () => {
    expect(domainMatches('https://api.twitter.com/v2', 'twitter.com')).toBe(true)
  })

  it('does not match partial domain name', () => {
    expect(domainMatches('https://nottwitter.com', 'twitter.com')).toBe(false)
  })

  it('returns false for invalid URL', () => {
    expect(domainMatches('not-a-url', 'example.com')).toBe(false)
  })

  it('matches www subdomain', () => {
    expect(domainMatches('https://www.bilibili.com/hot', 'bilibili.com')).toBe(true)
  })
})

describe('runSiteAdapter', () => {
  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue(ADAPTER_JS)
  })

  describe('required args validation', () => {
    it('returns error when required args are missing', async () => {
      const site = makeSite({
        args: {
          query: { required: true, description: 'Search query' },
          count: { required: false, description: 'Result count' }
        }
      })
      const controller = makeController()

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('Missing required args')
      expect(result.error).toContain('query')
      expect(result.hint).toContain('query (required)')
      expect(result.hint).toContain('Search query')
    })

    it('passes when all required args are provided', async () => {
      const site = makeSite({
        args: {
          query: { required: true, description: 'Search query' }
        }
      })
      const controller = makeController({
        execute: vi.fn().mockResolvedValue({ items: ['a'] })
      })

      const result = await runSiteAdapter(controller, site, { query: 'cats' })

      expect(result.success).toBe(true)
    })

    it('includes example in hint when available', async () => {
      const site = makeSite({
        args: { query: { required: true } },
        example: 'site test/adapter --query cats'
      })
      const controller = makeController()

      const result = await runSiteAdapter(controller, site, {})

      expect(result.hint).toContain('Example: site test/adapter --query cats')
    })
  })

  describe('IIFE wrapping', () => {
    it('produces correct script from adapter body and args', async () => {
      const site = makeSite()
      const controller = makeController()

      await runSiteAdapter(controller, site, { count: '10' })

      expect(controller.execute).toHaveBeenCalledWith(`(${ADAPTER_JS_BODY})({"count":"10"})`, 30_000, false, 'tab-1')
    })

    it('strips @meta block before wrapping', async () => {
      const site = makeSite()
      const controller = makeController()

      await runSiteAdapter(controller, site, {})

      const script = controller.execute.mock.calls[0][0] as string
      expect(script).not.toContain('@meta')
      expect(script).toContain('async function')
    })
  })

  describe('domain tab resolution', () => {
    it('reuses existing tab matching domain', async () => {
      const site = makeSite({ domain: 'x.com' })
      const controller = makeController({
        listTabs: vi.fn().mockResolvedValue([{ tabId: 'existing-tab', url: 'https://x.com/home', title: 'X' }]),
        execute: vi.fn().mockResolvedValue({ tweets: [] })
      })

      await runSiteAdapter(controller, site, {})

      expect(controller.open).not.toHaveBeenCalled()
      expect(controller.execute).toHaveBeenCalledWith(expect.any(String), 30_000, false, 'existing-tab')
    })

    it('opens new tab when no matching domain tab exists', async () => {
      const site = makeSite({ domain: 'bilibili.com' })
      const controller = makeController({
        listTabs: vi.fn().mockResolvedValue([]),
        open: vi.fn().mockResolvedValue({ tabId: 'new-tab' }),
        execute: vi.fn().mockResolvedValue(null)
      })

      await runSiteAdapter(controller, site, {})

      expect(controller.open).toHaveBeenCalledWith('https://bilibili.com', 30_000, false, true, false)
      expect(controller.execute).toHaveBeenCalledWith(expect.any(String), 30_000, false, 'new-tab')
    })

    it('returns error when no domain and no active tab', async () => {
      const site = makeSite({ domain: '' })
      const controller = makeController({
        listTabs: vi.fn().mockResolvedValue([])
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('No page open')
    })

    it('uses active tab when no domain but tabs exist', async () => {
      const site = makeSite({ domain: '' })
      const controller = makeController({
        listTabs: vi.fn().mockResolvedValue([{ tabId: 'active-tab', url: 'https://something.com', title: 'Page' }]),
        execute: vi.fn().mockResolvedValue('result data')
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(true)
      // tabId should be undefined (uses active tab)
      expect(controller.execute).toHaveBeenCalledWith(expect.any(String), 30_000, false, undefined)
    })
  })

  describe('result parsing', () => {
    it('passes through object result as data', async () => {
      const site = makeSite()
      const controller = makeController({
        execute: vi.fn().mockResolvedValue({ items: [1, 2, 3] })
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ items: [1, 2, 3] })
    })

    it('parses JSON string result', async () => {
      const site = makeSite()
      const controller = makeController({
        execute: vi.fn().mockResolvedValue('{"count":42}')
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ count: 42 })
    })

    it('passes through non-JSON string as data', async () => {
      const site = makeSite()
      const controller = makeController({
        execute: vi.fn().mockResolvedValue('Hello world')
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(true)
      expect(result.data).toBe('Hello world')
    })

    it('handles null result', async () => {
      const site = makeSite()
      const controller = makeController({
        execute: vi.fn().mockResolvedValue(null)
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(true)
      expect(result.data).toBeNull()
    })
  })

  describe('auth error detection', () => {
    const authPatterns = [
      '401',
      '403 Forbidden',
      'Not logged in',
      'Login required',
      'unauthorized',
      'Please sign in to continue',
      'auth token expired'
    ]

    for (const pattern of authPatterns) {
      it(`detects auth error: "${pattern}"`, async () => {
        const site = makeSite({ domain: 'x.com' })
        const controller = makeController({
          listTabs: vi.fn().mockResolvedValue([{ tabId: 't1', url: 'https://x.com', title: 'X' }]),
          execute: vi.fn().mockResolvedValue({ error: pattern })
        })

        const result = await runSiteAdapter(controller, site, {})

        expect(result.success).toBe(false)
        expect(result.error).toBe(pattern)
        expect(result.hint).toContain('Please log in to https://x.com')
      })
    }

    const nonAuthPatterns = ['author not found', 'authentication successful', 'normal content with no errors']

    for (const pattern of nonAuthPatterns) {
      it(`does NOT false-positive on: "${pattern}"`, async () => {
        const site = makeSite()
        const controller = makeController({
          execute: vi.fn().mockResolvedValue({ items: [pattern] })
        })

        const result = await runSiteAdapter(controller, site, {})

        expect(result.success).toBe(true)
      })
    }

    it('detects error object without auth and returns without login hint', async () => {
      const site = makeSite()
      const controller = makeController({
        execute: vi.fn().mockResolvedValue({ error: 'Rate limit exceeded' })
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rate limit exceeded')
      expect(result.hint).toBeUndefined()
    })
  })

  describe('execution errors', () => {
    it('returns error when controller.execute throws', async () => {
      const site = makeSite()
      const controller = makeController({
        execute: vi.fn().mockRejectedValue(new Error('Execution timed out'))
      })

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(false)
      expect(result.error).toBe('Execution timed out')
    })

    it('returns error when adapter file cannot be read', async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })

      const site = makeSite()
      const controller = makeController()

      const result = await runSiteAdapter(controller, site, {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to read adapter file')
    })
  })

  describe('options', () => {
    it('passes custom timeout and privateMode', async () => {
      const site = makeSite()
      const controller = makeController({
        listTabs: vi.fn().mockResolvedValue([]),
        open: vi.fn().mockResolvedValue({ tabId: 'tab-p' }),
        execute: vi.fn().mockResolvedValue(null)
      })

      await runSiteAdapter(controller, site, {}, { timeout: 60_000, privateMode: true })

      expect(controller.listTabs).toHaveBeenCalledWith(true)
      expect(controller.open).toHaveBeenCalledWith('https://example.com', 60_000, true, true, false)
      expect(controller.execute).toHaveBeenCalledWith(expect.any(String), 60_000, true, 'tab-p')
    })

    it('passes showWindow to controller.open', async () => {
      const site = makeSite()
      const controller = makeController({
        listTabs: vi.fn().mockResolvedValue([]),
        open: vi.fn().mockResolvedValue({ tabId: 'tab-v' }),
        execute: vi.fn().mockResolvedValue(null)
      })

      await runSiteAdapter(controller, site, {}, { showWindow: true })

      expect(controller.open).toHaveBeenCalledWith('https://example.com', 30_000, false, true, true)
    })
  })
})
