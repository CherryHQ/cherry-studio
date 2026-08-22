import { cacheService } from '@data/CacheService'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import type { VListHandle } from 'virtua'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  computeScrollAnchor,
  readScrollSizes,
  resolveRestoreTarget,
  type ScrollPositionMemoryInputs,
  useScrollPositionMemory
} from '../useScrollPositionMemory'

describe('computeScrollAnchor', () => {
  it('returns null when the list is following', () => {
    expect(
      computeScrollAnchor({
        following: true,
        scrollOffset: 1234,
        topIndex: 4,
        getKeyAtIndex: () => 'g4',
        getOffsetAtIndex: () => 0
      })
    ).toBeNull()
  })

  it('returns null when the top-most item is out of range', () => {
    expect(
      computeScrollAnchor({
        following: false,
        scrollOffset: 100,
        topIndex: 9,
        getKeyAtIndex: () => null,
        getOffsetAtIndex: () => 0
      })
    ).toBeNull()
  })

  it('captures the top-most visible group key and the offset past its top', () => {
    expect(
      computeScrollAnchor({
        following: false,
        scrollOffset: 250,
        topIndex: 3,
        getKeyAtIndex: (index) => (index === 3 ? 'g3' : null),
        getOffsetAtIndex: (index) => (index === 3 ? 100 : 0)
      })
    ).toEqual({ key: 'g3', offset: 150 })
  })

  it('clamps a negative offset to zero', () => {
    expect(
      computeScrollAnchor({
        following: false,
        scrollOffset: 80,
        topIndex: 2,
        getKeyAtIndex: () => 'g2',
        getOffsetAtIndex: () => 120
      })
    ).toEqual({ key: 'g2', offset: 0 })
  })
})

describe('resolveRestoreTarget', () => {
  it('follows the newest message (end-aligned, bottom offset) when nothing is saved', () => {
    expect(resolveRestoreTarget(null, () => 5, 9, 24)).toEqual({ index: 9, align: 'end', offset: 24 })
    expect(resolveRestoreTarget(undefined, () => 5, 9, 24)).toEqual({ index: 9, align: 'end', offset: 24 })
  })

  it('follows the newest message when the saved message no longer exists', () => {
    expect(resolveRestoreTarget({ key: 'gone', offset: 40 }, () => -1, 9, 24)).toEqual({
      index: 9,
      align: 'end',
      offset: 24
    })
  })

  it('restores the saved anchor (start-aligned, saved offset) when the message is found', () => {
    expect(resolveRestoreTarget({ key: 'g7', offset: 40 }, (key) => (key === 'g7' ? 7 : -1), 9, 24)).toEqual({
      index: 7,
      align: 'start',
      offset: 40
    })
  })
})

describe('readScrollSizes', () => {
  // Heights are addressed by index, so any list the snapshot was not measured
  // against would assign them to the wrong messages.
  const snapshot = { sizes: [10, 20, 30] }
  const save = (over: Record<string, unknown> = {}) =>
    cacheService.set('chat.scroll_sizes.t1', { snapshot, count: 3, firstKey: 'g0', lastKey: 'g2', ...over })

  beforeEach(() => MockCacheUtils.resetMocks())

  it('restores the measured heights for the same list', () => {
    save()
    expect(readScrollSizes('t1', ['g0', 'g1', 'g2'])).toBe(snapshot)
  })

  it('drops the heights when an older page was prepended', () => {
    save()
    expect(readScrollSizes('t1', ['older', 'g0', 'g1', 'g2'])).toBeUndefined()
  })

  it('drops the heights when a boundary message was replaced at the same count', () => {
    save()
    expect(readScrollSizes('t1', ['g0', 'g1', 'edited'])).toBeUndefined()
  })

  it('restores nothing without a topic or items', () => {
    save()
    expect(readScrollSizes(undefined, ['g0', 'g1', 'g2'])).toBeUndefined()
    expect(readScrollSizes('t1', [])).toBeUndefined()
  })
})

describe('useScrollPositionMemory', () => {
  let rafQueue: Array<() => void>

  const flushRaf = () => {
    let guard = 0
    // Restore schedules a frame which itself schedules a settle frame.
    while (rafQueue.length && guard++ < 20) {
      const batch = rafQueue
      rafQueue = []
      act(() => batch.forEach((fn) => fn()))
    }
  }

  let scroller: { scrollTop: number; scrollHeight: number; clientHeight: number }
  let handle: {
    findItemIndex: ReturnType<typeof vi.fn>
    getItemOffset: ReturnType<typeof vi.fn>
    scrollToIndex: ReturnType<typeof vi.fn>
    cache: object
  }
  let following: boolean
  let enterFollowingAfterRestore: ReturnType<typeof vi.fn>
  let enterReadingForRestore: ReturnType<typeof vi.fn>
  let settleReadingRestore: ReturnType<typeof vi.fn>
  let keysByIndex: Record<number, string>

  const buildInputs = (overrides: Partial<ScrollPositionMemoryInputs> = {}): ScrollPositionMemoryInputs => ({
    topicId: 't1',
    itemCount: 3,
    bottomPadding: 24,
    scrollerRef: { current: scroller as unknown as HTMLElement } as RefObject<HTMLElement | null>,
    vlistHandleRef: { current: handle as unknown as VListHandle } as RefObject<VListHandle | null>,
    getDataKeyAtIndex: (index) => keysByIndex[index] ?? null,
    findDataIndexByKey: (key) => {
      const found = Object.entries(keysByIndex).find(([, k]) => k === key)
      return found ? Number(found[0]) : -1
    },
    shouldRestore: () => true,
    isFollowing: () => following,
    enterFollowingAfterRestore,
    enterReadingForRestore,
    settleReadingRestore,
    isAnimating: () => false,
    ...overrides
  })

  beforeEach(() => {
    rafQueue = []
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0))
      return ++id
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    MockCacheUtils.resetMocks()

    scroller = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 }
    handle = { findItemIndex: vi.fn(), getItemOffset: vi.fn(), scrollToIndex: vi.fn(), cache: {} }
    following = false
    enterFollowingAfterRestore = vi.fn()
    enterReadingForRestore = vi.fn()
    settleReadingRestore = vi.fn()
    keysByIndex = { 0: 'g0', 1: 'g1', 2: 'g2' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores a saved anchor via scrollToIndex on mount', () => {
    cacheService.set('chat.scroll_anchor.t1', { key: 'g2', offset: 80 })

    renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, { align: 'start', offset: 80 })
    expect(enterReadingForRestore).toHaveBeenCalledTimes(1)
    expect(settleReadingRestore).toHaveBeenCalledTimes(1)
    expect(enterFollowingAfterRestore).not.toHaveBeenCalled()
  })

  it('follows the newest message via scrollToIndex(end) when nothing is saved', () => {
    renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    // last index (itemCount - 1), end-aligned, offset by the bottom padding.
    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, { align: 'end', offset: 24 })
    expect(enterFollowingAfterRestore).toHaveBeenCalledTimes(1)
    expect(scroller.scrollTop).toBe(0) // not touched directly while the handle exists
  })

  it('falls back to scrollTop when no virtua handle is available', () => {
    renderHook(() =>
      useScrollPositionMemory(buildInputs({ vlistHandleRef: { current: null } as RefObject<VListHandle | null> }))
    )
    flushRaf()

    expect(scroller.scrollTop).toBe(600) // scrollHeight - clientHeight
    expect(enterFollowingAfterRestore).toHaveBeenCalledTimes(1)
  })

  it('waits for items before restoring', () => {
    const { rerender } = renderHook((props: ScrollPositionMemoryInputs) => useScrollPositionMemory(props), {
      initialProps: buildInputs({ itemCount: 0 })
    })
    flushRaf()
    expect(enterFollowingAfterRestore).not.toHaveBeenCalled()

    rerender(buildInputs({ itemCount: 3 }))
    flushRaf()
    expect(enterFollowingAfterRestore).toHaveBeenCalledTimes(1)
  })

  it('suppresses saves until the initial restore has settled', () => {
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs()))

    // Before the restore frames run, saving is suppressed so a transient
    // mount-time scroll can't clobber the value we are about to restore.
    act(() => result.current.save())
    expect(cacheService.set).not.toHaveBeenCalled()

    flushRaf()

    scroller.scrollTop = 250
    handle.findItemIndex.mockReturnValue(2)
    handle.getItemOffset.mockReturnValue(100)
    act(() => result.current.save())

    expect(cacheService.set).toHaveBeenCalledWith('chat.scroll_anchor.t1', { key: 'g2', offset: 150 })
  })

  it('throttles in-flight saves but lets an immediate (scroll-end) save through', () => {
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    scroller.scrollTop = 250
    handle.findItemIndex.mockReturnValue(2)
    handle.getItemOffset.mockReturnValue(100)
    const nowSpy = vi.spyOn(Date, 'now')
    const anchorWrites = () =>
      vi.mocked(cacheService.set).mock.calls.filter(([key]) => key === 'chat.scroll_anchor.t1').length

    nowSpy.mockReturnValue(1000)
    act(() => result.current.save()) // first throttled save → writes
    nowSpy.mockReturnValue(1100) // 100ms later, inside the 200ms window
    act(() => result.current.save()) // throttled out
    expect(anchorWrites()).toBe(1)

    act(() => result.current.save(true)) // immediate save bypasses the throttle
    expect(anchorWrites()).toBe(2)

    nowSpy.mockRestore()
  })

  it('snapshots measured heights only at rest, tagged with the list it was measured against', () => {
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    handle.findItemIndex.mockReturnValue(2)
    handle.getItemOffset.mockReturnValue(100)
    handle.cache = { sizes: [1, 2, 3] }

    act(() => result.current.save())
    expect(cacheService.set).not.toHaveBeenCalledWith('chat.scroll_sizes.t1', expect.anything())

    act(() => result.current.save(true))
    expect(cacheService.set).toHaveBeenCalledWith('chat.scroll_sizes.t1', {
      snapshot: handle.cache,
      count: 3,
      firstKey: 'g0',
      lastKey: 'g2'
    })
  })

  it('saves null when the list is following', () => {
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    following = true
    act(() => result.current.save())

    expect(cacheService.set).toHaveBeenCalledWith('chat.scroll_anchor.t1', null)
  })

  it('does not save when no topic id is provided', () => {
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs({ topicId: undefined })))
    flushRaf()

    act(() => result.current.save())
    expect(cacheService.set).not.toHaveBeenCalled()
  })
})
