import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the native fff binding so tests stay platform-independent.
const finderState: {
  createOk: boolean
  scanOk: boolean
  searchOk: boolean
  items: Array<{ relativePath: string; fileName: string; totalFrecencyScore: number }>
} = {
  createOk: true,
  scanOk: true,
  searchOk: true,
  items: []
}

const fileSearch = vi.fn(() => {
  if (!finderState.searchOk) return { ok: false, error: 'mock search failure' }
  return { ok: true, value: { items: finderState.items } }
})
const waitForScan = vi.fn(async () => {
  if (!finderState.scanOk) return { ok: false, error: 'mock scan failure' }
  return { ok: true, value: true }
})
const destroy = vi.fn()

vi.mock('@ff-labs/fff-node', () => ({
  FileFinder: {
    create: vi.fn(() => {
      if (!finderState.createOk) return { ok: false, error: 'mock init failure' }
      return {
        ok: true,
        value: { waitForScan, fileSearch, destroy, isDestroyed: false }
      }
    })
  }
}))

import { destroyAllFinders } from '../finderPool'
import { createFindPathToolEntry, FS_FIND_TOOL_NAME } from '../findPath'

const entry = createFindPathToolEntry()

interface FindPathInput {
  basePath: string
  query: string
  limit?: number
}
type FindPathOutput =
  | {
      kind: 'matches'
      items: Array<{ relativePath: string; fileName: string; score?: number }>
      truncated: boolean
    }
  | { kind: 'error'; code: string; message: string }

function callExecute(args: FindPathInput): Promise<FindPathOutput> {
  const execute = entry.tool.execute as (args: FindPathInput, opts: ToolExecutionOptions) => Promise<FindPathOutput>
  return execute(args, {
    toolCallId: 'tc-1',
    messages: [],
    experimental_context: { requestId: 'req-1' }
  } as ToolExecutionOptions)
}

beforeEach(() => {
  finderState.createOk = true
  finderState.scanOk = true
  finderState.searchOk = true
  finderState.items = []
  fileSearch.mockClear()
  waitForScan.mockClear()
})

afterEach(async () => {
  await destroyAllFinders()
})

describe('fs__find entry', () => {
  it('registers under fs namespace as Read capability', () => {
    expect(entry.name).toBe(FS_FIND_TOOL_NAME)
    expect(entry.namespace).toBe('fs')
    expect(entry.capability).toBe('read')
  })
})

describe('fs__find execute', () => {
  it('rejects relative basePath', async () => {
    const out = await callExecute({ basePath: 'rel/path', query: 'foo' })
    expect(out).toEqual({ kind: 'error', code: 'relative-path', message: expect.any(String) })
  })

  it('returns init-failed when FileFinder.create fails', async () => {
    finderState.createOk = false
    const out = await callExecute({ basePath: '/tmp/proj-init-fail', query: 'foo' })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.code).toBe('init-failed')
  })

  it('returns search-failed when fileSearch returns not ok', async () => {
    finderState.searchOk = false
    const out = await callExecute({ basePath: '/tmp/proj-search-fail', query: 'foo' })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.code).toBe('search-failed')
  })

  it('maps successful search items', async () => {
    finderState.items = [
      { relativePath: 'src/index.ts', fileName: 'index.ts', totalFrecencyScore: 9 },
      { relativePath: 'src/util.ts', fileName: 'util.ts', totalFrecencyScore: 4 }
    ]
    const out = await callExecute({ basePath: '/tmp/proj-success', query: 'index' })
    expect(out.kind).toBe('matches')
    if (out.kind === 'matches') {
      expect(out.items).toEqual([
        { relativePath: 'src/index.ts', fileName: 'index.ts', score: 9 },
        { relativePath: 'src/util.ts', fileName: 'util.ts', score: 4 }
      ])
      expect(out.truncated).toBe(false)
    }
  })

  it('marks result truncated when items.length === limit', async () => {
    finderState.items = Array.from({ length: 3 }, (_, i) => ({
      relativePath: `f${i}.ts`,
      fileName: `f${i}.ts`,
      totalFrecencyScore: i
    }))
    const out = await callExecute({ basePath: '/tmp/proj-truncated', query: 'x', limit: 3 })
    expect(out.kind).toBe('matches')
    if (out.kind === 'matches') expect(out.truncated).toBe(true)
  })

  it('caches finder per basePath — second call reuses', async () => {
    finderState.items = []
    await callExecute({ basePath: '/tmp/proj-cache', query: 'a' })
    await callExecute({ basePath: '/tmp/proj-cache', query: 'b' })
    expect(fileSearch).toHaveBeenCalledTimes(2)
    expect(waitForScan).toHaveBeenCalledTimes(1) // create+scan only once
  })
})
