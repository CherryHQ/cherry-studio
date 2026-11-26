import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import type { VListHandle } from 'virtua'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@data/CacheService'

import {
  computeScrollAnchor,
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

  it('returns null when resting at the real bottom even in reading mode', () => {
    expect(
      computeScrollAnchor({
        following: false,
        atBottom: true,
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
  }
  let following: boolean
  let enterFollowingAfterRestore: ReturnType<typeof vi.fn<() => void>>
  let enterReadingForRestore: ReturnType<typeof vi.fn<() => void>>
  let settleReadingRestore: ReturnType<typeof vi.fn<() => void>>
  let keysByIndex: Record<number, string>

  const buildInputs = (overrides: Partial<ScrollPositionMemoryInputs> = {}): ScrollPositionMemoryInputs => ({
    topicId: 't1',
    itemCount: 3,
    bottomPadding: 24,
    scrollerRef: { current: scroller as unknown as HTMLElement },
    vlistHandleRef: { current: handle as unknown as VListHandle },
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
    handle = { findItemIndex: vi.fn(), getItemOffset: vi.fn(), scrollToIndex: vi.fn() }
    following = false
    enterFollowingAfterRestore = vi.fn<() => void>()
    enterReadingForRestore = vi.fn<() => void>()
    settleReadingRestore = vi.fn<() => void>()
    keysByIndex = { 0: 'g0', 1: 'g1', 2: 'g2' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps explicit navigation when it takes ownership before the initial restore frame', () => {
    let ownsInitialRestore = true
    renderHook(() => useScrollPositionMemory(buildInputs({ shouldRestore: () => ownsInitialRestore })))
    scroller.scrollTop = 250
    ownsInitialRestore = false
    flushRaf()
    expect(scroller.scrollTop).toBe(250)
    expect(handle.scrollToIndex).not.toHaveBeenCalled()
    expect(enterFollowingAfterRestore).not.toHaveBeenCalled()
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

  it('falls back to scrollTop when no virtua handle is available', () => {
    renderHook(() => useScrollPositionMemory(buildInputs({ vlistHandleRef: { current: null } })))
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

    nowSpy.mockReturnValue(1000)
    act(() => result.current.save()) // first throttled save → writes
    nowSpy.mockReturnValue(1100) // 100ms later, inside the 200ms window
    act(() => result.current.save()) // throttled out
    expect(cacheService.set).toHaveBeenCalledTimes(1)

    act(() => result.current.save(true)) // immediate save bypasses the throttle
    expect(cacheService.set).toHaveBeenCalledTimes(2)

    nowSpy.mockRestore()
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

  it('saves null when resting at the real bottom in reading mode and reopens at the latest turn', () => {
    const { result, unmount } = renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()
    enterFollowingAfterRestore.mockClear()

    // Simulate jumping to the last turn in reading mode (following=false),
    // where scrollTop rests at realBottom while an earlier turn is at topIndex.
    following = false
    scroller.scrollTop = 599
    handle.findItemIndex.mockReturnValue(1)
    handle.getItemOffset.mockReturnValue(400)
    act(() => result.current.save(true))

    expect(cacheService.set).toHaveBeenCalledWith('chat.scroll_anchor.t1', null)

    // Reopening the topic restores to the end in following mode rather than
    // restoring an earlier top-of-viewport turn anchor.
    unmount()
    renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, { align: 'end', offset: 24 })
    expect(enterFollowingAfterRestore).toHaveBeenCalledTimes(1)
    expect(enterReadingForRestore).not.toHaveBeenCalled()
  })

  it('respects getBottomInset when deciding whether reading mode rests at the real bottom', () => {
    // Freeze spacer adds 120px below the real bottom (effective bottom = 1000 - 120 - 400 = 480).
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs({ getBottomInset: () => 120 })))
    flushRaf()

    following = false
    scroller.scrollTop = 480
    handle.findItemIndex.mockReturnValue(1)
    handle.getItemOffset.mockReturnValue(350)
    act(() => result.current.save(true))

    expect(cacheService.set).toHaveBeenCalledWith('chat.scroll_anchor.t1', null)
  })

  it('saves null in reading mode when content fits inside a measured viewport (realBottom === 0)', () => {
    const { result } = renderHook(() => useScrollPositionMemory(buildInputs()))
    flushRaf()

    following = false
    scroller.scrollHeight = 300
    scroller.clientHeight = 400
    scroller.scrollTop = 0
    handle.findItemIndex.mockReturnValue(0)
    handle.getItemOffset.mockReturnValue(0)
    act(() => result.current.save(true))

    expect(cacheService.set).toHaveBeenCalledWith('chat.scroll_anchor.t1', null)
  })
})
