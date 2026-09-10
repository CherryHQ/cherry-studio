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
  it('converts Windows backslashes to forward slashes and lowercases by default on win32', () => {
    expect(normalizePath('src\\Core\\Main.TS ', true)).toBe('src/core/main.ts')
    expect(normalizePath(undefined)).toBe('')
  })

  it('preserves casing when caseInsensitive is false (e.g. Linux filesystem)', () => {
    expect(normalizePath('src\\Core\\Main.TS ', false)).toBe('src/Core/Main.TS')
  })

  it('normalizes path aliases, redundant segments, and trailing slashes', () => {
    expect(normalizePath('./src/main.ts', true)).toBe('src/main.ts')
    expect(normalizePath('src//main.ts', true)).toBe('src/main.ts')
    expect(normalizePath('src/sub/../main.ts', true)).toBe('src/main.ts')
    expect(normalizePath('src/main.ts/', true)).toBe('src/main.ts')
  })
})

describe('normalizeExplorerSignature', () => {
  it('normalizes file_path by replacing backslashes and trimming', () => {
    expect(normalizeExplorerSignature('Read', { file_path: 'src\\main\\index.ts ' })).toBe(
      'Read:{"file_path":"src/main/index.ts"}'
    )
  })

  it('includes offset and limit in signature for slice reads', () => {
    expect(normalizeExplorerSignature('Read', { file_path: 'src/main.ts', offset: 10, limit: 50 })).toBe(
      'Read:{"file_path":"src/main.ts","limit":50,"offset":10}'
    )
  })

  it('normalizes Grep with pattern and path, and preserves behavior-affecting flags', () => {
    const sigWithoutFlag = normalizeExplorerSignature('Grep', { path: 'src/main', pattern: 'foo' })
    const sigWithFlag = normalizeExplorerSignature('Grep', { path: 'src/main', pattern: 'foo', '-i': true })
    expect(sigWithoutFlag).toBe('Grep:{"path":"src/main","pattern":"foo"}')
    expect(sigWithFlag).toBe('Grep:{"-i":true,"path":"src/main","pattern":"foo"}')
    expect(sigWithoutFlag).not.toBe(sigWithFlag)
  })

  it('preserves meaningful whitespace in non-path string arguments', () => {
    const sigLeading = normalizeExplorerSignature('Grep', { path: 'src/main', pattern: ' foo' })
    const sigTrimmed = normalizeExplorerSignature('Grep', { path: 'src/main', pattern: 'foo' })
    expect(sigLeading).toBe('Grep:{"path":"src/main","pattern":" foo"}')
    expect(sigTrimmed).toBe('Grep:{"path":"src/main","pattern":"foo"}')
    expect(sigLeading).not.toBe(sigTrimmed)
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

  it('tracks path aliases under the same file record for cap enforcement', () => {
    const state = createInitialExplorerState()
    for (let i = 0; i < 5; i++) {
      recordExplorerCallState(state, 'Read', { file_path: './src/main.ts', offset: i * 50 + 1, limit: 50 })
    }
    for (let i = 5; i < 10; i++) {
      recordExplorerCallState(state, 'Read', { file_path: 'src//main.ts', offset: i * 50 + 1, limit: 50 })
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
