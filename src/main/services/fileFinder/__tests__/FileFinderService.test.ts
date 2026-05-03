import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FinderSearchArgs } from '../FileFinderService'

// Module-scoped mock state so tests can tweak fff's responses without
// rebuilding the mock graph.
const state: {
  createOk: boolean
  scanOk: boolean
  searchOk: boolean
  searchValue: {
    items: Array<{ type: 'file' | 'directory'; item: any }>
    scores: Array<{ total: number }>
    totalMatched: number
    totalFiles: number
    totalDirs: number
  }
} = {
  createOk: true,
  scanOk: true,
  searchOk: true,
  searchValue: { items: [], scores: [], totalMatched: 0, totalFiles: 0, totalDirs: 0 }
}

const mixedSearch = vi.fn((_query: string, _opts?: unknown) => {
  if (!state.searchOk) return { ok: false, error: 'mock mixed search failure' }
  return { ok: true, value: state.searchValue }
})
const trackQuery = vi.fn(() => ({ ok: true, value: true }))
const waitForScan = vi.fn(async () => {
  if (!state.scanOk) return { ok: false, error: 'mock scan failure' }
  return { ok: true, value: true }
})
const destroy = vi.fn()

vi.mock('@ff-labs/fff-node', () => ({
  FileFinder: {
    create: vi.fn(() => {
      if (!state.createOk) return { ok: false, error: 'mock init failure' }
      return {
        ok: true,
        value: { waitForScan, mixedSearch, trackQuery, destroy, isDestroyed: false }
      }
    })
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

// Import target after mocks are wired.
import { search, trackSelection } from '../FileFinderService'

const fileItem = (overrides: Partial<{ relativePath: string; fileName: string; gitStatus: string }> = {}) => ({
  relativePath: 'src/index.ts',
  fileName: 'index.ts',
  gitStatus: 'clean',
  size: 0,
  modified: 0,
  accessFrecencyScore: 0,
  modificationFrecencyScore: 0,
  totalFrecencyScore: 0,
  ...overrides
})

const dirItem = (overrides: Partial<{ relativePath: string; dirName: string }> = {}) => ({
  relativePath: 'src/components',
  dirName: 'components',
  maxAccessFrecency: 0,
  ...overrides
})

beforeEach(() => {
  state.createOk = true
  state.scanOk = true
  state.searchOk = true
  state.searchValue = { items: [], scores: [], totalMatched: 0, totalFiles: 0, totalDirs: 0 }
  mixedSearch.mockClear()
  trackQuery.mockClear()
  waitForScan.mockClear()
  destroy.mockClear()
})

afterEach(() => {
  // Clear the CacheService backing store so each test starts with no
  // cached finders.
  MockMainCacheServiceUtils.resetMocks()
})

const args = (overrides: Partial<FinderSearchArgs> = {}): FinderSearchArgs => ({
  basePath: '/repo',
  query: 'idx',
  ...overrides
})

describe('FileFinderService.search', () => {
  it('maps mixedSearch results into FinderItems with type-tagged fields', async () => {
    state.searchValue = {
      items: [
        { type: 'file', item: fileItem({ gitStatus: 'modified' }) },
        { type: 'directory', item: dirItem() }
      ],
      scores: [{ total: 1200 }, { total: 800 }],
      totalMatched: 2,
      totalFiles: 1,
      totalDirs: 1
    }

    const result = await search(args())
    expect(result.totalMatched).toBe(2)
    expect(result.items).toEqual([
      {
        type: 'file',
        relativePath: 'src/index.ts',
        name: 'index.ts',
        score: 1200,
        gitStatus: 'modified'
      },
      {
        type: 'directory',
        relativePath: 'src/components',
        name: 'components',
        score: 800
      }
    ])
  })

  it('returns empty result without calling fff when basePath is absent', async () => {
    const result = await search(args({ basePath: '' }))
    expect(result.items).toEqual([])
    expect(mixedSearch).not.toHaveBeenCalled()
  })

  it('returns empty result when fff reports a search error', async () => {
    state.searchOk = false
    const result = await search(args())
    expect(result.items).toEqual([])
    expect(result.totalMatched).toBe(0)
  })

  it("falls back to a '.' query for empty input (browse mode)", async () => {
    await search(args({ query: '   ' }))
    expect(mixedSearch).toHaveBeenCalledWith('.', expect.objectContaining({ pageIndex: 0 }))
  })

  it('clamps pageSize to the [1, 500] range', async () => {
    await search(args({ pageSize: 99999 }))
    expect(mixedSearch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pageSize: 500 }))
    mixedSearch.mockClear()
    await search(args({ pageSize: 0 }))
    expect(mixedSearch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ pageSize: 1 }))
  })

  it('forwards currentFile to fff for distance-aware ranking', async () => {
    await search(args({ currentFile: 'src/main.ts' }))
    expect(mixedSearch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ currentFile: 'src/main.ts' })
    )
  })

  it('returns empty result when finder creation fails', async () => {
    state.createOk = false
    const result = await search(args())
    expect(result.items).toEqual([])
    expect(mixedSearch).not.toHaveBeenCalled()
  })
})

describe('FileFinderService.trackSelection', () => {
  it('forwards query + selectedFilePath into fff trackQuery', async () => {
    await trackSelection({
      basePath: '/repo',
      query: 'idx',
      selectedFilePath: 'src/index.ts'
    })
    expect(trackQuery).toHaveBeenCalledWith('idx', 'src/index.ts')
  })

  it('swallows fff errors so the renderer never sees a rejection', async () => {
    state.searchOk = false // unrelated, but ensure we don't blow up on misc errors
    trackQuery.mockImplementationOnce(() => ({ ok: false, error: 'oops' }))
    await expect(trackSelection({ basePath: '/repo', query: 'q', selectedFilePath: 'f' })).resolves.toBeUndefined()
  })
})
