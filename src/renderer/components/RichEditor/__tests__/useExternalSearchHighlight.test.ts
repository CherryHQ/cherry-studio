import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useExternalSearchHighlight } from '../useExternalSearchHighlight'

const RESCAN_DELAY_MS = 300

const highlightExternal = vi.fn()
const contentSearchRef = { current: { highlightExternal } as unknown as ContentSearchRef }

interface Props {
  keyword: string
  content: string
}

const renderHighlight = (initialProps: Props) =>
  renderHook(
    ({ keyword, content }: Props) => useExternalSearchHighlight({ contentSearchRef, enabled: true, keyword, content }),
    {
      initialProps
    }
  )

const runTimers = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })

describe('useExternalSearchHighlight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    highlightExternal.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies a new keyword immediately', () => {
    renderHighlight({ keyword: 'foo', content: 'a' })

    runTimers(0)

    expect(highlightExternal).toHaveBeenCalledExactlyOnceWith('foo')
  })

  it('debounces the re-scan an edit triggers, instead of running it per keystroke', () => {
    const { rerender } = renderHighlight({ keyword: 'foo', content: 'a' })
    runTimers(0)
    highlightExternal.mockClear()

    rerender({ keyword: 'foo', content: 'ab' })
    rerender({ keyword: 'foo', content: 'abc' })
    runTimers(RESCAN_DELAY_MS - 1)
    expect(highlightExternal).not.toHaveBeenCalled()

    runTimers(1)
    expect(highlightExternal).toHaveBeenCalledExactlyOnceWith('foo')
  })

  it('retracts the highlight even when a rerender cancels the pending timer', () => {
    // Regression: the keyword used to be recorded as applied when the timer was
    // scheduled, so an edit arriving inside that window left the effect believing the
    // retraction had happened - and the previous keyword stayed highlighted for good.
    const { rerender } = renderHighlight({ keyword: 'foo', content: 'a' })
    runTimers(0)
    highlightExternal.mockClear()

    rerender({ keyword: '', content: 'a' })
    rerender({ keyword: '', content: 'ab' })
    runTimers(RESCAN_DELAY_MS)

    expect(highlightExternal).toHaveBeenCalledWith('')
  })

  it('leaves the highlight alone while no external keyword has been applied', () => {
    // The find bar owns the highlight the rest of the time; an empty apply per keystroke
    // would wipe the results of a Cmd+F search as the user types.
    const { rerender } = renderHighlight({ keyword: '', content: 'a' })
    rerender({ keyword: '', content: 'ab' })
    runTimers(RESCAN_DELAY_MS)

    expect(highlightExternal).not.toHaveBeenCalled()
  })
})
