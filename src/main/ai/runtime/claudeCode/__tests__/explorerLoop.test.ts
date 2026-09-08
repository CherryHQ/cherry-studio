import { describe, expect, it } from 'vitest'

import {
  createInitialExplorerState,
  evaluateIncomingExplorerCall,
  EXPLORER_CAP_HARD_THRESHOLD,
  EXPLORER_IDENTICAL_HARD_THRESHOLD,
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

describe('evaluateIncomingExplorerCall & cap logic', () => {
  it('allows normal sequential pagination without false positives', () => {
    const state = createInitialExplorerState()
    recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: 1, limit: 100 })
    const peek1 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'src/main.ts', offset: 101, limit: 100 })
    expect(peek1.sameFileCapReached).toBeFalsy()
  })

  it('detects same-file read cap after 10 completed reads', () => {
    const state = createInitialExplorerState()
    for (let i = 0; i < 10; i++) {
      recordExplorerCallState(state, 'Read', { file_path: 'src/main.ts', offset: i * 50 + 1, limit: 50 })
    }

    const peek11 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'src/main.ts', offset: 501, limit: 50 })
    expect(peek11.sameFileCapReached).toBe(true)
  })

  it('reaches identical hard threshold at 5', () => {
    const state = createInitialExplorerState()
    for (let i = 1; i <= 4; i++) {
      recordExplorerCallState(state, 'Read', { file_path: 'same.ts' })
    }
    const peek5 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'same.ts' })
    expect(peek5.identicalRun).toBe(EXPLORER_IDENTICAL_HARD_THRESHOLD)
  })

  it('reaches consecutive exploration cap at 10 (soft) and 30 (hard)', () => {
    const state = createInitialExplorerState()
    for (let i = 1; i <= 29; i++) {
      recordExplorerCallState(state, 'Read', { file_path: `file_${i}.ts` })
    }
    const peek30 = evaluateIncomingExplorerCall(state, 'Read', { file_path: 'file_30.ts' })
    expect(peek30.consecutiveReads).toBe(EXPLORER_CAP_HARD_THRESHOLD)
  })
})
