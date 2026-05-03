import type { ToolExecutionOptions } from '@ai-sdk/provider-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const finderState: {
  createOk: boolean
  scanOk: boolean
  searchOk: boolean
  items: Array<{
    relativePath: string
    lineNumber: number
    lineContent: string
    contextBefore?: string[]
    contextAfter?: string[]
  }>
  totalFilesSearched: number
} = {
  createOk: true,
  scanOk: true,
  searchOk: true,
  items: [],
  totalFilesSearched: 0
}

const grep = vi.fn(() => {
  if (!finderState.searchOk) return { ok: false, error: 'mock grep failure' }
  return {
    ok: true,
    value: {
      items: finderState.items,
      totalFilesSearched: finderState.totalFilesSearched,
      totalMatched: finderState.items.length,
      totalFiles: 100,
      filteredFileCount: finderState.totalFilesSearched,
      nextCursor: null
    }
  }
})
const waitForScan = vi.fn(async () => ({ ok: true, value: true }))
const destroy = vi.fn()

vi.mock('@ff-labs/fff-node', () => ({
  FileFinder: {
    create: vi.fn(() => {
      if (!finderState.createOk) return { ok: false, error: 'mock init failure' }
      return { ok: true, value: { waitForScan, grep, destroy, isDestroyed: false } }
    })
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'

import { createFindGrepToolEntry, FS_GREP_TOOL_NAME } from '../findGrep'

const entry = createFindGrepToolEntry()

interface FindGrepInput {
  basePath: string
  pattern: string
  mode?: 'plain' | 'fuzzy' | 'regex'
  beforeContext?: number
  afterContext?: number
  limit?: number
}
type FindGrepOutput =
  | {
      kind: 'matches'
      items: Array<{
        relativePath: string
        lineNumber: number
        lineContent: string
        contextBefore?: string[]
        contextAfter?: string[]
      }>
      filesSearched: number
      truncated: boolean
    }
  | { kind: 'error'; code: string; message: string }

function callExecute(args: FindGrepInput): Promise<FindGrepOutput> {
  const execute = entry.tool.execute as (args: FindGrepInput, opts: ToolExecutionOptions) => Promise<FindGrepOutput>
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
  finderState.totalFilesSearched = 0
  grep.mockClear()
})

afterEach(() => {
  MockMainCacheServiceUtils.resetMocks()
})

describe('fs__grep entry', () => {
  it('registers under fs namespace as Read capability', () => {
    expect(entry.name).toBe(FS_GREP_TOOL_NAME)
    expect(entry.namespace).toBe('fs')
    expect(entry.capability).toBe('read')
  })
})

describe('fs__grep execute', () => {
  it('rejects relative basePath', async () => {
    const out = await callExecute({ basePath: 'rel', pattern: 'foo' })
    expect(out).toEqual({ kind: 'error', code: 'relative-path', message: expect.any(String) })
  })

  it('returns search-failed when grep returns not ok', async () => {
    finderState.searchOk = false
    const out = await callExecute({ basePath: '/tmp/grep-fail', pattern: 'foo' })
    expect(out.kind).toBe('error')
    if (out.kind === 'error') expect(out.code).toBe('search-failed')
  })

  it('forwards options to grep call (mode, smartCase, context)', async () => {
    finderState.items = []
    finderState.totalFilesSearched = 5
    await callExecute({
      basePath: '/tmp/grep-opts',
      pattern: 'TODO',
      mode: 'regex',
      beforeContext: 2,
      afterContext: 3
    })
    expect(grep).toHaveBeenCalledWith(
      'TODO',
      expect.objectContaining({ mode: 'regex', beforeContext: 2, afterContext: 3 })
    )
  })

  it('returns matches with line + content + filesSearched', async () => {
    finderState.items = [
      {
        relativePath: 'src/a.ts',
        lineNumber: 10,
        lineContent: '  // TODO: refactor',
        contextBefore: ['  function foo() {'],
        contextAfter: ['    return null;', '  }']
      }
    ]
    finderState.totalFilesSearched = 12
    const out = await callExecute({ basePath: '/tmp/grep-match', pattern: 'TODO' })
    expect(out.kind).toBe('matches')
    if (out.kind === 'matches') {
      expect(out.filesSearched).toBe(12)
      expect(out.items).toHaveLength(1)
      expect(out.items[0]).toEqual({
        relativePath: 'src/a.ts',
        lineNumber: 10,
        lineContent: '  // TODO: refactor',
        contextBefore: ['  function foo() {'],
        contextAfter: ['    return null;', '  }']
      })
      expect(out.truncated).toBe(false)
    }
  })

  it('truncates items when more than limit', async () => {
    finderState.items = Array.from({ length: 10 }, (_, i) => ({
      relativePath: `src/f${i}.ts`,
      lineNumber: i + 1,
      lineContent: `match ${i}`
    }))
    finderState.totalFilesSearched = 10
    const out = await callExecute({ basePath: '/tmp/grep-trunc', pattern: 'match', limit: 3 })
    expect(out.kind).toBe('matches')
    if (out.kind === 'matches') {
      expect(out.items).toHaveLength(3)
      expect(out.truncated).toBe(true)
    }
  })

  it('omits empty context arrays from output', async () => {
    finderState.items = [
      {
        relativePath: 'src/x.ts',
        lineNumber: 1,
        lineContent: 'hit',
        contextBefore: [],
        contextAfter: []
      }
    ]
    const out = await callExecute({ basePath: '/tmp/grep-no-ctx', pattern: 'hit' })
    if (out.kind === 'matches') {
      expect(out.items[0].contextBefore).toBeUndefined()
      expect(out.items[0].contextAfter).toBeUndefined()
    }
  })
})
