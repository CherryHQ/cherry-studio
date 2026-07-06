// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import type { ThemedToken } from 'shiki/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCodeHighlight } from '../useCodeHighlight'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const mocks = vi.hoisted(() => ({
  highlightStreamingCode: vi.fn(),
  cleanupTokenizers: vi.fn()
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({
    activeShikiTheme: 'github-light',
    highlightStreamingCode: mocks.highlightStreamingCode,
    cleanupTokenizers: mocks.cleanupTokenizers
  })
}))

const sampleToken = (content: string): ThemedToken => ({
  content,
  offset: 0,
  color: 'inherit'
})

describe('useCodeHighlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('populates tokenLines from a highlight result', async () => {
    mocks.highlightStreamingCode.mockResolvedValue({ lines: [[sampleToken('const a = 1')]], recall: 0 })

    const { result } = renderHook(() =>
      useCodeHighlight({ rawLines: ['const a = 1'], language: 'typescript', callerId: 'c1' })
    )

    await act(async () => {
      await result.current.highlightLines()
    })

    expect(result.current.tokenLines).toHaveLength(1)
  })

  it('drops a stale async highlight result that returns after resetHighlight()', async () => {
    const deferred = createDeferred<{ lines: ThemedToken[][]; recall: number }>()
    mocks.highlightStreamingCode.mockReturnValue(deferred.promise)

    const { result } = renderHook(() =>
      useCodeHighlight({ rawLines: ['const a = 1'], language: 'typescript', callerId: 'c1' })
    )

    // Fire a highlight request that is still in-flight (awaiting)
    let pending!: Promise<void>
    act(() => {
      pending = result.current.highlightLines()
    })

    // Reset while the request is in-flight — this must invalidate the pending result
    act(() => {
      result.current.resetHighlight()
    })

    // Now the old request resolves; its write-back must be discarded
    await act(async () => {
      deferred.resolve({ lines: [[sampleToken('const a = 1')]], recall: 0 })
      await pending
    })

    expect(result.current.tokenLines).toEqual([])
  })
})
