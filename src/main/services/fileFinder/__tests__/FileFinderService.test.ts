import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinderSearchArgs } from '../FileFinderService'

// Module-scoped mock state. Each test tweaks `state.fileResult` /
// `state.dirResult` and asserts behavior — no need to rebuild the mock
// graph per case.
const state: {
  createOk: boolean
  searchOk: boolean
  fileResult: {
    items: Array<{ relativePath: string; fileName: string; gitStatus?: string }>
    scores: Array<{ total: number }>
    totalMatched: number
    totalFiles: number
  }
  dirResult: {
    items: Array<{ relativePath: string; dirName: string }>
    scores: Array<{ total: number }>
    totalMatched: number
    totalDirs: number
  }
} = {
  createOk: true,
  searchOk: true,
  fileResult: { items: [], scores: [], totalMatched: 0, totalFiles: 0 },
  dirResult: { items: [], scores: [], totalMatched: 0, totalDirs: 0 }
}

const fileSearch = vi.fn((_query: string, _opts?: unknown) => {
  if (!state.searchOk) return { ok: false, error: 'mock file search failure' }
  return { ok: true, value: state.fileResult }
})
const directorySearch = vi.fn((_query: string, _opts?: unknown) => {
  if (!state.searchOk) return { ok: false, error: 'mock dir search failure' }
  return { ok: true, value: state.dirResult }
})
const trackQuery = vi.fn((): { ok: true; value: boolean } | { ok: false; error: string } => ({
  ok: true,
  value: true
}))
const waitForScan = vi.fn(async () => ({ ok: true, value: true }))
const destroy = vi.fn()

vi.mock('@ff-labs/fff-node', () => ({
  FileFinder: {
    create: vi.fn(() => {
      if (!state.createOk) return { ok: false, error: 'mock init failure' }
      return {
        ok: true,
        value: { waitForScan, fileSearch, directorySearch, trackQuery, destroy, isDestroyed: false }
      }
    })
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { search, trackSelection } from '../FileFinderService'

beforeEach(() => {
  state.createOk = true
  state.searchOk = true
  state.fileResult = { items: [], scores: [], totalMatched: 0, totalFiles: 0 }
  state.dirResult = { items: [], scores: [], totalMatched: 0, totalDirs: 0 }
  fileSearch.mockClear()
  directorySearch.mockClear()
  trackQuery.mockClear()
  waitForScan.mockClear()
  destroy.mockClear()
})

afterEach(() => {
  MockMainCacheServiceUtils.resetMocks()
})

const args = (overrides: Partial<FinderSearchArgs> = {}): FinderSearchArgs => ({
  basePath: '/repo',
  query: 'anthropic',
  ...overrides
})

describe('FileFinderService.search', () => {
  /**
   * The schema-mapping contract: each fff item produces one FinderItem
   * with type tag, name, score, and gitStatus (files only). Directories
   * come first so a path-shaped query lands its directory at the top.
   */
  it('puts directories first, maps files + dirs into typed FinderItems', async () => {
    state.dirResult = {
      items: [{ relativePath: 'packages/anthropic', dirName: 'anthropic' }],
      scores: [{ total: 800 }],
      totalMatched: 1,
      totalDirs: 1
    }
    state.fileResult = {
      items: [{ relativePath: 'src/index.ts', fileName: 'index.ts', gitStatus: 'modified' }],
      scores: [{ total: 1200 }],
      totalMatched: 1,
      totalFiles: 1
    }

    const result = await search(args())
    expect(result.items).toEqual([
      { type: 'directory', relativePath: 'packages/anthropic', name: 'anthropic', score: 800 },
      { type: 'file', relativePath: 'src/index.ts', name: 'index.ts', score: 1200, gitStatus: 'modified' }
    ])
    expect(result.totalDirs).toBe(1)
    expect(result.totalFiles).toBe(1)
    expect(result.totalMatched).toBe(2)
  })

  /**
   * The dir-slot guarantee — the actual bug fix. fff's mixedSearch
   * scoring lets file matches crowd out a relevant directory. We split
   * the page so directories get a reserved share (≥5 of 50). If anyone
   * "simplifies" back to mixedSearch this test fails immediately.
   */
  it('reserves a separate page slot for directories so they never get crowded out', async () => {
    await search(args({ pageSize: 50 }))
    expect(directorySearch).toHaveBeenCalledTimes(1)
    expect(fileSearch).toHaveBeenCalledTimes(1)
    const dirOpts = directorySearch.mock.calls[0][1] as { pageSize: number }
    const fileOpts = fileSearch.mock.calls[0][1] as { pageSize: number }
    expect(dirOpts.pageSize).toBeGreaterThanOrEqual(5)
    expect(dirOpts.pageSize + fileOpts.pageSize).toBe(50)
  })

  /**
   * The browse-mode contract: empty / whitespace query collapses to
   * `.`, so the panel can show top-frecency entries instead of empty
   * state when the user just clicks the button without typing.
   */
  it("falls back to '.' query for empty input (browse mode)", async () => {
    await search(args({ query: '   ' }))
    expect(fileSearch).toHaveBeenCalledWith('.', expect.any(Object))
    expect(directorySearch).toHaveBeenCalledWith('.', expect.any(Object))
  })

  /**
   * The path-aware split: `packages/anthropic` queries fff with just
   * the trailing term (`anthropic`) and filters to the `packages/`
   * prefix. Without this, fff fuzzy-scores `packages/anthropic` as one
   * blob and lets paths like `examples/.../anthropic-mcp` outrank the
   * real `packages/anthropic` directory.
   */
  it('searches fff with the trailing term and filters by directory prefix', async () => {
    state.dirResult = {
      items: [
        { relativePath: 'packages/anthropic', dirName: 'anthropic' },
        { relativePath: 'examples/agent/anthropic', dirName: 'anthropic' }
      ],
      scores: [{ total: 700 }, { total: 900 }],
      totalMatched: 2,
      totalDirs: 50
    }

    const result = await search(args({ query: 'packages/anthropic' }))

    // fff was called with just the trailing term, not the full path.
    expect(directorySearch).toHaveBeenCalledWith('anthropic', expect.any(Object))
    expect(fileSearch).toHaveBeenCalledWith('anthropic', expect.any(Object))

    // The off-prefix `examples/agent/anthropic` is filtered out, even
    // though fff scored it higher. `packages/anthropic` survives.
    expect(result.items.map((i) => i.relativePath)).toEqual(['packages/anthropic'])
  })

  /**
   * Edge cases against fix-by-example. fff's `relativePath` never has
   * a leading slash, and fff's matcher is smart-case — the renderer-
   * side filter has to mirror both or it disagrees with what fff just
   * matched and silently drops valid hits.
   */
  /**
   * Path-segment match (not strict startsWith). `@anthropic/src` should
   * find `packages/anthropic/src` — `anthropic/` appears mid-path, not
   * at position 0. Strict `startsWith` would silently drop it. This is
   * what VS Code / Cursor / similar pickers do.
   */
  it('matches the prefix as a path segment, not just at position 0', async () => {
    state.dirResult = {
      items: [{ relativePath: 'packages/anthropic/src', dirName: 'src' }],
      scores: [{ total: 600 }],
      totalMatched: 1,
      totalDirs: 1
    }
    const result = await search(args({ query: 'anthropic/src' }))
    expect(result.items.map((i) => i.relativePath)).toContain('packages/anthropic/src')
  })

  it('strips a leading slash from the prefix (fff relativePaths have none)', async () => {
    state.dirResult = {
      items: [{ relativePath: 'packages/anthropic', dirName: 'anthropic' }],
      scores: [{ total: 700 }],
      totalMatched: 1,
      totalDirs: 1
    }
    const result = await search(args({ query: '/packages/anthropic' }))
    expect(result.items.map((i) => i.relativePath)).toContain('packages/anthropic')
  })

  /**
   * Trailing-slash browse — `@packages/anthropic/` means "show me what's
   * inside packages/anthropic/". Querying fff with `.` returns top-
   * frecency results from anywhere, all of which fail the prefix filter
   * → empty list. We feed fff the prefix itself so its `src/` path-
   * constraint syntax does the right thing.
   */
  it('feeds fff the prefix (not `.`) when the user types a trailing slash to browse', async () => {
    state.dirResult = {
      items: [{ relativePath: 'packages/anthropic/src', dirName: 'src' }],
      scores: [{ total: 500 }],
      totalMatched: 1,
      totalDirs: 1
    }
    const result = await search(args({ query: 'packages/anthropic/' }))
    expect(directorySearch).toHaveBeenCalledWith('packages/anthropic/', expect.any(Object))
    expect(fileSearch).toHaveBeenCalledWith('packages/anthropic/', expect.any(Object))
    expect(result.items.map((i) => i.relativePath)).toContain('packages/anthropic/src')
  })

  it('matches case-insensitively when the prefix is all lowercase (smart-case)', async () => {
    // Real path is mixed-case; user typed it all lowercase. fff's
    // smart-case would still match the term — the filter must not
    // disagree by being strict-case.
    state.dirResult = {
      items: [{ relativePath: 'Packages/Anthropic', dirName: 'Anthropic' }],
      scores: [{ total: 700 }],
      totalMatched: 1,
      totalDirs: 1
    }
    const result = await search(args({ query: 'packages/anthropic' }))
    expect(result.items.map((i) => i.relativePath)).toContain('Packages/Anthropic')
  })
})

describe('FileFinderService.trackSelection', () => {
  /**
   * trackSelection is fire-and-forget — the renderer never awaits it.
   * If we ever let an fff error escape, the renderer would see an
   * unhandled rejection in the IPC layer.
   */
  it('swallows fff errors so the renderer never sees a rejection', async () => {
    trackQuery.mockImplementationOnce(() => ({ ok: false, error: 'oops' }))
    await expect(trackSelection({ basePath: '/repo', query: 'q', selectedFilePath: 'f' })).resolves.toBeUndefined()
  })
})
