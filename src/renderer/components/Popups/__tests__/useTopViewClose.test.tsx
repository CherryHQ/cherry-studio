// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TOP_VIEW_CLOSE_ANIMATION_MS, useTopViewClose } from '../useTopViewClose'

const { hideMock } = vi.hoisted(() => ({
  hideMock: vi.fn()
}))

vi.mock('../../TopView', () => ({
  TopView: {
    hide: hideMock
  }
}))

describe('useTopViewClose', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('resolves only once when close is called twice', () => {
    vi.useFakeTimers()
    const afterClose = vi.fn()
    const resolve = vi.fn()
    const setOpen = vi.fn()

    const { result } = renderHook(() => useTopViewClose({ afterClose, resolve, setOpen, topViewKey: 'test-popup' }))

    act(() => {
      result.current('first')
      result.current('second')
    })

    expect(setOpen).toHaveBeenCalledTimes(1)
    expect(setOpen).toHaveBeenCalledWith(false)

    act(() => {
      vi.advanceTimersByTime(TOP_VIEW_CLOSE_ANIMATION_MS)
    })

    expect(afterClose).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('first')
    expect(hideMock).toHaveBeenCalledTimes(1)
    expect(hideMock).toHaveBeenCalledWith('test-popup')
  })

  it('flushes the pending resolve when unmounted before the close timer fires', () => {
    vi.useFakeTimers()
    const afterClose = vi.fn()
    const resolve = vi.fn()
    const setOpen = vi.fn()

    const { result, unmount } = renderHook(() =>
      useTopViewClose({ afterClose, resolve, setOpen, topViewKey: 'test-popup' })
    )

    act(() => {
      result.current('closed')
    })

    unmount()

    expect(afterClose).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('closed')
    expect(hideMock).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(TOP_VIEW_CLOSE_ANIMATION_MS)
    })

    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('runs setOpen before afterClose, resolve, and TopView.hide after the animation delay', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const afterClose = vi.fn(() => calls.push('afterClose'))
    const resolve = vi.fn(() => calls.push('resolve'))
    const setOpen = vi.fn(() => calls.push('setOpen'))
    hideMock.mockImplementation(() => calls.push('hide'))

    const { result } = renderHook(() => useTopViewClose({ afterClose, resolve, setOpen, topViewKey: 'test-popup' }))

    act(() => {
      result.current('done')
    })

    expect(calls).toEqual(['setOpen'])

    act(() => {
      vi.advanceTimersByTime(TOP_VIEW_CLOSE_ANIMATION_MS)
    })

    expect(calls).toEqual(['setOpen', 'afterClose', 'resolve', 'hide'])
  })
})
