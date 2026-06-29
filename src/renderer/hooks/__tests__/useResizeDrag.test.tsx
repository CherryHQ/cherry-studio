import { act, renderHook } from '@testing-library/react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useResizeDrag } from '../useResizeDrag'

function startDrag(startResizing: (event: ReactMouseEvent) => void) {
  const preventDefault = vi.fn()

  act(() => {
    startResizing({ preventDefault } as unknown as ReactMouseEvent)
  })

  expect(preventDefault).toHaveBeenCalledTimes(1)
}

describe('useResizeDrag', () => {
  afterEach(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false
    })
    vi.restoreAllMocks()
  })

  it('cleans up on mouse up and ignores later mouse movement', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)
    expect(result.current.isResizing).toBe(true)
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120 }))
    })

    expect(onMove).toHaveBeenCalledTimes(1)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(result.current.isResizing).toBe(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 }))
    })

    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('restores the previous document resize styles on window blur', () => {
    const onMove = vi.fn()
    document.body.style.cursor = 'grab'
    document.body.style.userSelect = 'text'
    const { result } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })

    expect(result.current.isResizing).toBe(false)
    expect(document.body.style.cursor).toBe('grab')
    expect(document.body.style.userSelect).toBe('text')

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 }))
    })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('cleans up when the document becomes hidden', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.isResizing).toBe(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('cleans up when the pointer leaves the document', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseleave'))
    })

    expect(result.current.isResizing).toBe(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('cleans up on unmount', () => {
    const onMove = vi.fn()
    const { result, unmount } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)

    act(() => {
      unmount()
    })

    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 140 }))
    })

    expect(onMove).not.toHaveBeenCalled()
  })

  it('ends the drag when onMove invokes the provided stop callback', () => {
    const onMove = vi.fn((_moveEvent: MouseEvent, stop: () => void) => stop())
    const { result } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)
    expect(result.current.isResizing).toBe(true)

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120 }))
    })

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(result.current.isResizing).toBe(false)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }))
    })

    expect(onMove).toHaveBeenCalledTimes(1)
  })

  it('cleans up the previous drag when a new drag starts', () => {
    const onMove = vi.fn()
    const { result } = renderHook(() => useResizeDrag({ onMove }))

    startDrag(result.current.startResizing)
    startDrag(result.current.startResizing)

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120 }))
    })

    // Only the second drag's listener remains; the first was torn down.
    expect(onMove).toHaveBeenCalledTimes(1)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(result.current.isResizing).toBe(false)

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }))
    })

    // A single mouseup fully ended the active drag — no leftover listener from drag #1.
    expect(onMove).toHaveBeenCalledTimes(1)
  })
})
