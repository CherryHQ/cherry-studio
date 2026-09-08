import { describe, expect, it } from 'vitest'

import {
  calculateOverlapRatio,
  createInitialExplorerState,
  evaluateIncomingExplorerCall,
  EXPLORER_CAP_HARD_THRESHOLD,
  EXPLORER_IDENTICAL_HARD_THRESHOLD,
  mergeIntervals,
  normalizeExplorerSignature,
  normalizePath,
  recordExplorerCallState
} from '../explorerLoop'

describe('normalizePath', () => {
  it('converts Windows backslashes to forward slashes and lowercases', () => {
    expect(normalizePath('src\\Core\\Main.TS ')).toBe('src/core/main.ts')
    expect(normalizePath(undefined)).toBe('')
  })
})

describe('interval helpers', () => {
  it('merges overlapping and adjacent intervals', () => {
    const intervals: [number, number][] = [
      [1, 100],
      [200, 300]
    ]
    const res1 = mergeIntervals(intervals, [50, 150])
    expect(res1).toEqual([
      [1, 150],
      [200, 300]
    ])

    const res2 = mergeIntervals(res1, [151, 199])
    expect(res2).toEqual([[1, 300]])
  })

  it('calculates overlap ratio accurately', () => {
    const intervals: [number, number][] = [
      [1, 100],
      [200, 300]
    ]
    // Completely covered
    expect(calculateOverlapRatio(intervals, 10, 50)).toBe(1)
    // Half covered (101 out of 200 = 0.505)
    expect(calculateOverlapRatio(intervals, 51, 250)).toBe(0.505)
    // Disjoint
    expect(calculateOverlapRatio(intervals, 110, 190)).toBe(0)
  })
})

describe('normalizeExplorerSignature', () => {
  it('normalizes file_path by replacing backslashes and trimming', () => {
    expect(normalizeExplorerSignature('Read', { file_path: 'src\\main\\index.ts ' })).toBe('Read:src/main/index.ts')
  })

  it('includes offset and limit in signature for slice reads', () => {
    expect(normalizeExplorerSignature('Read', { file_path: 'src/main.ts', offset: 10, limit: 50 })).toBe(
      'Read:src/main.ts:10:50'
    )
  })

  it('normalizes Grep with pattern and path', () => {
    expect(normalizeExplorerSignature('Grep', { path: 'src/main', pattern: 'foo' })).toBe('Grep:src/main:foo')
  })

  it('sorts generic parameters deterministically', () => {
    const sig1 = normalizeExplorerSignature('Glob', { pattern: '*.ts', path: 'src' })
    const sig2 = normalizeExplorerSignature('Glob', { path: 'src', pattern: '*.ts' })
    expect(sig1).toBe(sig2)
  })
})

describe('evaluateIncomingExplorerCall & interval logic', () => {
  it('allows normal sequential pagination without false positives', () => {
    const state = createInitialExplorerState()
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 1, limit: 100 })
    const peek1 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'src/main.ts', offset: 101, limit: 100 })
    expect(peek1.isCycle).toBeFalsy()
    expect(peek1.isDuplicateChunk).toBeFalsy()
    expect(peek1.sameFileCapReached).toBeFalsy()
  })

  it('detects backward jumps / traversal cycles when reading back into covered lines', () => {
    const state = createInitialExplorerState()
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 1, limit: 200 })
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 500, limit: 200 })

    // Jump back to line 1
    const peekBack = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'src/main.ts', offset: 1, limit: 100 })
    expect(peekBack.isCycle).toBe(true)
  })

  it('detects duplicate subset chunks', () => {
    const state = createInitialExplorerState()
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 1, limit: 500 })

    const peekSubset = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'src/main.ts', offset: 50, limit: 100 })
    expect(peekSubset.isDuplicateChunk).toBe(true)
  })

  it('detects same-file read cap after 4 completed reads', () => {
    const state = createInitialExplorerState()
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 1, limit: 50 })
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 51, limit: 50 })
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 101, limit: 50 })
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 151, limit: 50 })

    const peek5 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'src/main.ts', offset: 201, limit: 50 })
    expect(peek5.sameFileCapReached).toBe(true)
  })

  it('reaches identical hard threshold at 5', () => {
    const state = createInitialExplorerState()
    for (let i = 1; i <= 4; i++) {
      recordExplorerCallState(state, 'Read', { file_path: 'same.ts' })
    }
    const peek5 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'same.ts' })
    expect(peek5.identicalRun).toBe(EXPLORER_IDENTICAL_HARD_THRESHOLD)
  })

  it('reaches consecutive exploration cap at 10 (soft) and 15 (hard)', () => {
    const state = createInitialExplorerState()
    for (let i = 1; i <= 14; i++) {
      recordExplorerCallState(state, 'Read', { file_path: `file_${i}.ts` })
    }
    const peek15 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'file_15.ts' })
    expect(peek15.consecutiveReads).toBe(EXPLORER_CAP_HARD_THRESHOLD)
  })
})
