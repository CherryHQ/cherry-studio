import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCloseBeforeAction } from '../useCloseBeforeAction'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useCloseBeforeAction', () => {
  it('closes synchronously and runs the action on the next frame after unmount', () => {
    let frameCallback: FrameRequestCallback | undefined
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback
      return 1
    })
    const onOpenChange = vi.fn()
    const action = vi.fn()
    const { result, unmount } = renderHook(() => useCloseBeforeAction(onOpenChange))

    act(() => result.current(action))

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(action).not.toHaveBeenCalled()

    unmount()
    frameCallback?.(0)

    expect(action).toHaveBeenCalledOnce()
  })

  it('keeps independently selected actions scheduled', () => {
    const frameCallbacks: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallbacks.push(callback)
      return frameCallbacks.length
    })
    const firstAction = vi.fn()
    const secondAction = vi.fn()
    const { result } = renderHook(() => useCloseBeforeAction(vi.fn()))

    act(() => {
      result.current(firstAction)
      result.current(secondAction)
    })

    frameCallbacks[0]?.(0)
    frameCallbacks[1]?.(0)
    expect(firstAction).toHaveBeenCalledOnce()
    expect(secondAction).toHaveBeenCalledOnce()
  })
})
