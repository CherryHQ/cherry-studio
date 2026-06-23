import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useIpcOn } from '../useIpcOn'

const onMock = vi.fn()
const unsubscribe = vi.fn()
let captured: ((payload: unknown) => void) | undefined

// Exercises the hook's runtime plumbing with a throwaway event name, casting past
// the typed signature rather than coupling to a real event.
const useEvent = useIpcOn as unknown as (event: string, handler: (p: unknown) => void) => void

beforeEach(() => {
  onMock.mockReset()
  unsubscribe.mockReset()
  captured = undefined
  onMock.mockImplementation((_event: string, cb: (p: unknown) => void) => {
    captured = cb
    return unsubscribe
  })
  ;(window as unknown as { api: unknown }).api = { ipcApi: { request: vi.fn(), on: onMock } }
})

describe('useIpcOn', () => {
  it('subscribes to the event on mount', () => {
    renderHook(() => useEvent('demo.evt', vi.fn()))
    expect(onMock).toHaveBeenCalledWith('demo.evt', expect.any(Function))
  })

  it('invokes the handler when a matching event payload arrives', () => {
    const handler = vi.fn()
    renderHook(() => useEvent('demo.evt', handler))
    captured?.({ width: 5 })
    expect(handler).toHaveBeenCalledWith({ width: 5 })
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useEvent('demo.evt', vi.fn()))
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('uses the latest handler without re-subscribing when the handler identity changes', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ h }) => useEvent('demo.evt', h), { initialProps: { h: first } })

    rerender({ h: second })
    captured?.('payload')

    expect(onMock).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith('payload')
    expect(first).not.toHaveBeenCalled()
  })

  it('tears down the old subscription and re-subscribes when the event name changes', () => {
    const { rerender } = renderHook(({ e }) => useEvent(e, vi.fn()), { initialProps: { e: 'demo.evt' } })
    expect(onMock).toHaveBeenCalledTimes(1)
    expect(onMock).toHaveBeenLastCalledWith('demo.evt', expect.any(Function))

    rerender({ e: 'demo.other' })

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(onMock).toHaveBeenCalledTimes(2)
    expect(onMock).toHaveBeenLastCalledWith('demo.other', expect.any(Function))
  })
})
