// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HighlightResult } from '@renderer/types/codeHighlight'

import { useCodeHighlight } from '../useCodeHighlight'

const mocks = vi.hoisted(() => ({ highlightRange: vi.fn(), cleanupTokenizers: vi.fn(), theme: 'one-light' }))
vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    activeCodeTheme: mocks.theme,
    highlightRange: mocks.highlightRange,
    cleanupTokenizers: mocks.cleanupTokenizers
  })
}))
const resultFor = (content: string, start = 0): HighlightResult => ({ start, lines: [[{ content, offset: 0 }]] })
function deferred() {
  let resolve!: (result: HighlightResult) => void
  const promise = new Promise<HighlightResult>((done) => {
    resolve = done
  })
  return { resolve, promise }
}

describe('useCodeHighlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.theme = 'one-light'
  })

  it('returns a scrolled range without requiring tokens for preceding lines', async () => {
    mocks.highlightRange.mockResolvedValue(resultFor('last', 9999))
    const { result } = renderHook(() => useCodeHighlight({ value: 'first\nlast', language: 'text', callerId: 'range' }))
    await act(() => result.current.highlightLines(9999, 10000))
    expect(result.current.tokens).toEqual(resultFor('last', 9999))
  })

  it('discards an in-flight response after highlighting is disabled', async () => {
    const request = deferred()
    mocks.highlightRange.mockReturnValue(request.promise)
    const { result } = renderHook(() => useCodeHighlight({ value: 'old', language: 'text', callerId: 'reset' }))
    let pending!: Promise<void>
    act(() => {
      pending = result.current.highlightLines(0, 1)
    })
    act(() => result.current.resetHighlight())
    await act(async () => {
      request.resolve(resultFor('old'))
      await pending
    })
    expect(result.current.tokens).toBeNull()
  })

  it('coalesces pending revisions and uses the new theme resolver after an in-flight request', async () => {
    const first = deferred()
    mocks.highlightRange.mockReturnValue(first.promise)
    const { result, rerender } = renderHook(
      ({ value }) => useCodeHighlight({ value, language: 'text', callerId: 'stream' }),
      { initialProps: { value: 'old' } }
    )
    let pending!: Promise<void>
    act(() => {
      pending = result.current.highlightLines(0, 1)
    })
    rerender({ value: 'intermediate' })
    act(() => {
      void result.current.highlightLines(0, 1)
    })
    mocks.theme = 'nord'
    mocks.highlightRange = vi.fn(async () => resultFor('latest dark'))
    rerender({ value: 'latest' })
    act(() => {
      void result.current.highlightLines(0, 1)
    })
    await act(async () => {
      first.resolve(resultFor('old'))
      await pending
    })
    expect(result.current.tokens).toEqual(resultFor('latest dark'))
    rerender({ value: 'replaced' })
    expect(result.current.tokens).toBeNull()
  })
})
