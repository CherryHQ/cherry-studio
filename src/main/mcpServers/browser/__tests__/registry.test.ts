import { homedir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock node:fs before importing the module under test
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn()
  }
})

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() }))
}))

// Mock the logger
vi.mock('../types', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'

import {
  backgroundUpdate,
  ensureSitesAvailable,
  findSite,
  getAllSites,
  invalidateCache,
  parseSiteMeta,
  scanSites,
  searchSites
} from '../sites/registry'

const BB_DIR = join(homedir(), '.bb-browser')
const LOCAL_SITES_DIR = join(BB_DIR, 'sites')
const COMMUNITY_SITES_DIR = join(BB_DIR, 'bb-sites')

describe('parseSiteMeta', () => {
  it('parses @meta JSON block', () => {
    const content = `/* @meta
{
  "name": "twitter/search",
  "description": "Search tweets",
  "domain": "x.com",
  "args": { "query": { "required": true, "description": "Search query" } },
  "example": "site twitter/search --query cats"
}
*/
async function(args) { return []; }`

    const result = parseSiteMeta(content, join(COMMUNITY_SITES_DIR, 'twitter/search.js'), 'community')

    expect(result).not.toBeNull()
    expect(result!.name).toBe('twitter/search')
    expect(result!.description).toBe('Search tweets')
    expect(result!.domain).toBe('x.com')
    expect(result!.args).toEqual({ query: { required: true, description: 'Search query' } })
    expect(result!.example).toBe('site twitter/search --query cats')
    expect(result!.source).toBe('community')
  })

  it('uses default name from file path when @meta has no name', () => {
    const content = `/* @meta
{ "description": "Popular videos", "domain": "bilibili.com" }
*/
async function(args) { return []; }`

    const result = parseSiteMeta(content, join(COMMUNITY_SITES_DIR, 'bilibili/popular.js'), 'community')

    expect(result).not.toBeNull()
    expect(result!.name).toBe('bilibili/popular')
  })

  it('parses @tag fallback format', () => {
    const content = `// @name hackernews/top
// @description Top stories from Hacker News
// @domain news.ycombinator.com
// @args count
// @example site hackernews/top 10
async function(args) { return []; }`

    const result = parseSiteMeta(content, join(COMMUNITY_SITES_DIR, 'hackernews/top.js'), 'community')

    expect(result).not.toBeNull()
    expect(result!.name).toBe('hackernews/top')
    expect(result!.description).toBe('Top stories from Hacker News')
    expect(result!.domain).toBe('news.ycombinator.com')
    expect(result!.args).toEqual({ count: { required: true } })
    expect(result!.example).toBe('site hackernews/top 10')
  })

  it('handles malformed @meta JSON by falling back to @tag parsing', () => {
    const content = `/* @meta
{ this is not valid JSON }
*/
// @description Fallback desc
// @domain example.com
async function(args) { return []; }`

    const result = parseSiteMeta(content, join(COMMUNITY_SITES_DIR, 'test/broken.js'), 'community')

    expect(result).not.toBeNull()
    expect(result!.name).toBe('test/broken')
    expect(result!.description).toBe('Fallback desc')
    expect(result!.domain).toBe('example.com')
  })

  it('handles content with no @meta and no @tag', () => {
    const content = `async function(args) { return []; }`

    const result = parseSiteMeta(content, join(LOCAL_SITES_DIR, 'custom/tool.js'), 'local')

    expect(result).not.toBeNull()
    expect(result!.name).toBe('custom/tool')
    expect(result!.description).toBe('')
    expect(result!.domain).toBe('')
    expect(result!.args).toEqual({})
    expect(result!.source).toBe('local')
  })

  it('parses multiple @args from comma-separated values', () => {
    const content = `// @args query, count, sort`

    const result = parseSiteMeta(content, join(COMMUNITY_SITES_DIR, 'test/multi.js'), 'community')

    expect(result).not.toBeNull()
    expect(result!.args).toEqual({
      query: { required: true },
      count: { required: true },
      sort: { required: true }
    })
  })
})

describe('scanSites', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    invalidateCache()
  })

  it('returns empty array when directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const result = scanSites('/nonexistent', 'community')
    expect(result).toEqual([])
  })

  it('scans directory recursively for .js files', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockImplementation(((dirPath: string) => {
      const dir = String(dirPath)
      if (dir === COMMUNITY_SITES_DIR) {
        return [
          { name: 'twitter', isDirectory: () => true, isFile: () => false },
          { name: '.git', isDirectory: () => true, isFile: () => false }
        ]
      }
      if (dir.endsWith('twitter')) {
        return [{ name: 'search.js', isDirectory: () => false, isFile: () => true }]
      }
      return []
    }) as unknown as typeof readdirSync)

    vi.mocked(readFileSync).mockReturnValue(`/* @meta
{ "description": "Search tweets", "domain": "x.com" }
*/
async function(args) { return []; }`)

    const result = scanSites(COMMUNITY_SITES_DIR, 'community')

    expect(result).toHaveLength(1)
    expect(result[0].description).toBe('Search tweets')
    // Skips .git directory
  })
})

describe('getAllSites', () => {
  beforeEach(() => {
    invalidateCache()
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(statSync).mockReturnValue({ mtimeMs: 0 } as ReturnType<typeof statSync>)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    invalidateCache()
  })

  it('local adapter overrides community adapter with same name', () => {
    vi.mocked(existsSync).mockReturnValue(true)

    let callCount = 0
    vi.mocked(statSync).mockImplementation(() => {
      callCount++
      return { mtimeMs: callCount } as ReturnType<typeof statSync>
    })

    vi.mocked(readdirSync).mockImplementation(((dirPath: string) => {
      const dir = String(dirPath)
      if (dir === COMMUNITY_SITES_DIR || dir === LOCAL_SITES_DIR) {
        return [{ name: 'twitter', isDirectory: () => true, isFile: () => false }]
      }
      if (dir.includes('twitter')) {
        return [{ name: 'search.js', isDirectory: () => false, isFile: () => true }]
      }
      return []
    }) as unknown as typeof readdirSync)

    vi.mocked(readFileSync).mockImplementation(((filePath: string) => {
      const path = String(filePath)
      if (path.includes('bb-sites')) {
        return `/* @meta
{ "description": "Community version", "domain": "x.com" }
*/`
      }
      return `/* @meta
{ "description": "Local version", "domain": "x.com" }
*/`
    }) as typeof readFileSync)

    const sites = getAllSites()

    expect(sites).toHaveLength(1)
    expect(sites[0].description).toBe('Local version')
    expect(sites[0].source).toBe('local')
  })

  it('returns cached results when mtimes have not changed', () => {
    vi.mocked(statSync).mockReturnValue({ mtimeMs: 100 } as ReturnType<typeof statSync>)
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>)

    const first = getAllSites()
    const second = getAllSites()

    expect(first).toBe(second) // Same reference = cached
    // readdirSync should only be called for the first scan (2 dirs)
    // Second call returns cached result
  })
})

describe('findSite', () => {
  beforeEach(() => {
    invalidateCache()
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now() } as ReturnType<typeof statSync>)
    vi.mocked(readdirSync).mockImplementation(((dirPath: string) => {
      const dir = String(dirPath)
      if (dir === COMMUNITY_SITES_DIR) {
        return [{ name: 'hackernews', isDirectory: () => true, isFile: () => false }]
      }
      if (dir.includes('hackernews')) {
        return [{ name: 'top.js', isDirectory: () => false, isFile: () => true }]
      }
      return []
    }) as unknown as typeof readdirSync)
    vi.mocked(readFileSync).mockReturnValue(`/* @meta
{ "name": "hackernews/top", "description": "Top HN stories", "domain": "news.ycombinator.com" }
*/`)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    invalidateCache()
  })

  it('finds adapter by exact name', () => {
    const site = findSite('hackernews/top')
    expect(site).toBeDefined()
    expect(site!.name).toBe('hackernews/top')
  })

  it('returns undefined for non-existent adapter', () => {
    const site = findSite('nonexistent/tool')
    expect(site).toBeUndefined()
  })
})

describe('searchSites', () => {
  beforeEach(() => {
    invalidateCache()
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now() } as ReturnType<typeof statSync>)
    vi.mocked(readdirSync).mockImplementation(((dirPath: string) => {
      const dir = String(dirPath)
      if (dir === COMMUNITY_SITES_DIR) {
        return [
          { name: 'twitter', isDirectory: () => true, isFile: () => false },
          { name: 'reddit', isDirectory: () => true, isFile: () => false }
        ]
      }
      if (dir.includes('twitter')) {
        return [{ name: 'search.js', isDirectory: () => false, isFile: () => true }]
      }
      if (dir.includes('reddit')) {
        return [{ name: 'thread.js', isDirectory: () => false, isFile: () => true }]
      }
      return []
    }) as unknown as typeof readdirSync)

    vi.mocked(readFileSync).mockImplementation(((filePath: string) => {
      const path = String(filePath)
      if (path.includes('twitter')) {
        return `/* @meta
{ "name": "twitter/search", "description": "Search tweets", "domain": "x.com" }
*/`
      }
      return `/* @meta
{ "name": "reddit/thread", "description": "Read Reddit thread", "domain": "www.reddit.com" }
*/`
    }) as typeof readFileSync)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    invalidateCache()
  })

  it('searches by name', () => {
    const results = searchSites('twitter')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('twitter/search')
  })

  it('searches by description', () => {
    const results = searchSites('tweets')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('twitter/search')
  })

  it('searches by domain', () => {
    const results = searchSites('reddit.com')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('reddit/thread')
  })

  it('is case-insensitive', () => {
    const results = searchSites('TWITTER')
    expect(results).toHaveLength(1)
  })

  it('returns empty array for no matches', () => {
    const results = searchSites('nonexistent')
    expect(results).toHaveLength(0)
  })
})

describe('ensureSitesAvailable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    invalidateCache()
  })

  it('returns immediately if .git dir already exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const result = await ensureSitesAvailable()
    expect(result).toBe('Community adapters already available.')
  })

  it('clones repo when bb-sites dir does not exist', async () => {
    vi.mocked(existsSync).mockImplementation(((p: string) => {
      const path = String(p)
      if (path.endsWith('.git')) return false
      return false
    }) as typeof existsSync)

    vi.mocked(readdirSync).mockReturnValue([] as unknown as ReturnType<typeof readdirSync>)

    vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      ;(callback as (err: null, stdout: string, stderr: string) => void)(null, '', '')
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)

    const result = await ensureSitesAvailable()
    expect(result).toMatch(/Cloned \d+ community adapters/)
  })

  it('returns error message when git clone fails', async () => {
    vi.mocked(existsSync).mockReturnValue(false)

    vi.mocked(execFile).mockImplementation(((_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      ;(callback as (err: Error, stdout: string, stderr: string) => void)(
        new Error('git not found'),
        '',
        'git not found'
      )
      return {} as ReturnType<typeof execFile>
    }) as typeof execFile)

    const result = await ensureSitesAvailable()
    expect(result).toContain('Failed to clone')
    expect(result).toContain('manually clone')
  })
})

describe('backgroundUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    invalidateCache()
  })

  it('does nothing when .git dir does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    backgroundUpdate()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('does nothing when last update was recent', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(String(Date.now()))
    backgroundUpdate()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('spawns git pull when last update was >24h ago', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(String(Date.now() - 25 * 60 * 60 * 1000))

    backgroundUpdate()

    expect(spawn).toHaveBeenCalledWith('git', ['pull', '--ff-only'], expect.objectContaining({ detached: true }))
    expect(writeFileSync).toHaveBeenCalled()
  })

  it('spawns git pull when .last-update file does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })

    backgroundUpdate()

    expect(spawn).toHaveBeenCalledWith('git', ['pull', '--ff-only'], expect.objectContaining({ detached: true }))
  })
})
