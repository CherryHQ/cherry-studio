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

// In multi-pattern + regex/fuzzy modes the tool fans out and calls
// `grep(p, ...)` once per pattern. The mock returns different items per
// pattern based on a per-pattern map so tests can drive both branches.
let perPatternItems: Record<string, typeof finderState.items> | null = null

const grep = vi.fn((query: string) => {
  if (!finderState.searchOk) return { ok: false, error: 'mock grep failure' }
  const items = perPatternItems?.[query] ?? finderState.items
  return {
    ok: true,
    value: {
      items,
      totalFilesSearched: finderState.totalFilesSearched,
      totalMatched: items.length,
      totalFiles: 100,
      filteredFileCount: finderState.totalFilesSearched,
      nextCursor: null
    }
  }
})
const multiGrep = vi.fn((opts: { patterns: string[] }) => {
  if (!finderState.searchOk) return { ok: false, error: 'mock multiGrep failure' }
  // Default: pretend fff dedups internally and returns the union from
  // the test's per-pattern map (or the global `items` when no map set).
  const dedup = new Map<string, (typeof finderState.items)[number]>()
  for (const p of opts.patterns) {
    const items = perPatternItems?.[p] ?? finderState.items
    for (const it of items) {
      const key = `${it.relativePath}:${it.lineNumber}`
      if (!dedup.has(key)) dedup.set(key, it)
    }
  }
  return {
    ok: true,
    value: {
      items: Array.from(dedup.values()),
      totalFilesSearched: finderState.totalFilesSearched,
      totalMatched: dedup.size,
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
      return { ok: true, value: { waitForScan, grep, multiGrep, destroy, isDestroyed: false } }
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
  pattern: string | string[]
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
        matchedPattern?: string
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
  perPatternItems = null
  grep.mockClear()
  multiGrep.mockClear()
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

  /**
   * Single-string pattern stays on the original `grep(query, options)`
   * path and does NOT touch `multiGrep` — pins that the array branch
   * doesn't accidentally swallow scalar inputs.
   */
  it('routes single string pattern through finder.grep, not multiGrep', async () => {
    finderState.items = [{ relativePath: 'src/a.ts', lineNumber: 1, lineContent: 'hit' }]
    const out = await callExecute({ basePath: '/tmp/grep-single', pattern: 'hit' })
    expect(out.kind).toBe('matches')
    expect(grep).toHaveBeenCalledTimes(1)
    expect(multiGrep).not.toHaveBeenCalled()
  })

  /**
   * Array pattern + plain (default) mode → native `multiGrep` (one
   * walk, fff-side dedup). Per-match `matchedPattern` is intentionally
   * undefined because fff doesn't surface attribution.
   */
  it('routes array pattern + plain mode through finder.multiGrep without pattern attribution', async () => {
    perPatternItems = {
      foo: [{ relativePath: 'src/a.ts', lineNumber: 5, lineContent: 'foo here' }],
      bar: [{ relativePath: 'src/b.ts', lineNumber: 9, lineContent: 'bar here' }]
    }
    finderState.totalFilesSearched = 20
    const out = await callExecute({ basePath: '/tmp/grep-multi-plain', pattern: ['foo', 'bar'] })
    expect(grep).not.toHaveBeenCalled()
    expect(multiGrep).toHaveBeenCalledTimes(1)
    expect(multiGrep).toHaveBeenCalledWith(expect.objectContaining({ patterns: ['foo', 'bar'] }))
    expect(out.kind).toBe('matches')
    if (out.kind === 'matches') {
      expect(out.items.map((it) => it.relativePath).sort()).toEqual(['src/a.ts', 'src/b.ts'])
      // No attribution from native multiGrep.
      expect(out.items.every((it) => it.matchedPattern === undefined)).toBe(true)
    }
  })

  /**
   * Array pattern + non-plain mode (regex / fuzzy) → manual fan-out
   * because fff has no native multi for those modes. Each match is
   * attributed to the pattern that hit, dedup on path:line, sorted by
   * (path, line) so the order is stable across pattern arrangements.
   */
  it('fans out array pattern in regex mode with per-match attribution and dedup', async () => {
    perPatternItems = {
      'foo\\d+': [
        { relativePath: 'src/a.ts', lineNumber: 1, lineContent: 'foo1' },
        { relativePath: 'src/a.ts', lineNumber: 2, lineContent: 'foo2' }
      ],
      'bar\\d+': [
        // Same line as foo's hit on line 2 — must dedup, attribute to first match.
        { relativePath: 'src/a.ts', lineNumber: 2, lineContent: 'foo2 bar2' },
        { relativePath: 'src/c.ts', lineNumber: 7, lineContent: 'bar7' }
      ]
    }
    finderState.totalFilesSearched = 30
    const out = await callExecute({
      basePath: '/tmp/grep-multi-regex',
      pattern: ['foo\\d+', 'bar\\d+'],
      mode: 'regex'
    })
    expect(multiGrep).not.toHaveBeenCalled()
    expect(grep).toHaveBeenCalledTimes(2)
    expect(out.kind).toBe('matches')
    if (out.kind === 'matches') {
      // 3 unique (path, line) keys: a.ts:1, a.ts:2, c.ts:7
      expect(out.items).toHaveLength(3)
      expect(out.items[0]).toMatchObject({ relativePath: 'src/a.ts', lineNumber: 1, matchedPattern: 'foo\\d+' })
      // a.ts:2 was hit by both; first wins.
      expect(out.items[1]).toMatchObject({ relativePath: 'src/a.ts', lineNumber: 2, matchedPattern: 'foo\\d+' })
      expect(out.items[2]).toMatchObject({ relativePath: 'src/c.ts', lineNumber: 7, matchedPattern: 'bar\\d+' })
    }
  })
})
