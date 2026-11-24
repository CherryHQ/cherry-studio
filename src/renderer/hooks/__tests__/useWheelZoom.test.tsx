import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

import { useWheelZoom } from '../useWheelZoom'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

function pendingFactor() {
  let resolve!: (factor: number) => void
  let reject!: (error: Error) => void
  const promise = new Promise<number>((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function wheel(deltaY: number, options: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY, ...options })
  act(() => {
    document.body.dispatchEvent(event)
  })
  return event
}

beforeEach(async () => {
  await i18n.changeLanguage('en-US')
  vi.useFakeTimers()
  vi.mocked(ipcApi.request)
    .mockReset()
    .mockReturnValue(new Promise(() => {}))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useWheelZoom', () => {
  it('waits for the returned factor before showing the percentage and sends signed steps', async () => {
    const response = pendingFactor()
    vi.mocked(ipcApi.request).mockReturnValueOnce(response.promise)
    renderHook(useWheelZoom)

    expect(wheel(-40).defaultPrevented).toBe(true)
    expect(ipcApi.request).toHaveBeenCalledExactlyOnceWith('app.adjust_zoom', { delta: 0.1 })
    expect(toast.info).not.toHaveBeenCalled()
    await act(async () => response.resolve(1.7))
    expect(toast.info).toHaveBeenCalledExactlyOnceWith({
      key: 'app-wheel-zoom',
      title: 'Page Zoom',
      description: '170%',
      timeout: 1500
    })

    wheel(40)
    expect(ipcApi.request).toHaveBeenCalledTimes(2)
    expect(ipcApi.request).toHaveBeenLastCalledWith('app.adjust_zoom', { delta: -0.1 })
  })

  it('accumulates partial events 119 ms apart and cancels scrolling synchronously', () => {
    renderHook(useWheelZoom)
    expect(wheel(-20).defaultPrevented).toBe(true)
    expect(ipcApi.request).not.toHaveBeenCalled()
    vi.advanceTimersByTime(119)
    wheel(-20)
    expect(ipcApi.request).toHaveBeenCalledExactlyOnceWith('app.adjust_zoom', { delta: 0.1 })
  })

  it('discards partial input after 120 ms idle', () => {
    renderHook(useWheelZoom)
    wheel(-20)
    vi.advanceTimersByTime(120)
    wheel(-20)
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('discards the old direction before accumulating a reversal', () => {
    renderHook(useWheelZoom)
    wheel(-30)
    wheel(20)
    expect(ipcApi.request).not.toHaveBeenCalled()
    wheel(20)
    expect(ipcApi.request).toHaveBeenCalledExactlyOnceWith('app.adjust_zoom', { delta: -0.1 })
  })

  it('takes one step per event and discards overshoot', () => {
    renderHook(useWheelZoom)
    wheel(-100)
    wheel(-20)
    expect(ipcApi.request).toHaveBeenCalledExactlyOnceWith('app.adjust_zoom', { delta: 0.1 })
  })

  it('normalizes non-pixel input to a single step', () => {
    renderHook(useWheelZoom)
    wheel(-3, { deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(ipcApi.request).toHaveBeenCalledExactlyOnceWith('app.adjust_zoom', { delta: 0.1 })
  })

  it('ignores plain, horizontal-only, and Meta-only wheel input', () => {
    renderHook(useWheelZoom)
    expect(wheel(-100, { ctrlKey: false }).defaultPrevented).toBe(false)
    expect(wheel(0, { deltaX: -100 }).defaultPrevented).toBe(false)
    expect(wheel(-100, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(false)
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('respects cancellation by a descendant', () => {
    renderHook(useWheelZoom)
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -40, cancelable: true, bubbles: true })
    event.preventDefault()
    act(() => {
      document.body.dispatchEvent(event)
    })
    expect(ipcApi.request).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('cancels eligible wheel synchronously before IPC even at a returned bound', async () => {
    vi.mocked(ipcApi.request).mockImplementation(() => {
      expect(event.defaultPrevented).toBe(true)
      return Promise.resolve(2)
    })
    renderHook(useWheelZoom)
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -40, cancelable: true })
    await act(async () => {
      window.dispatchEvent(event)
    })
    expect(toast.info).toHaveBeenCalledWith(expect.objectContaining({ description: '200%' }))
    wheel(-40)
    expect(ipcApi.request).toHaveBeenCalledTimes(2)
  })

  it('logs a rejected request in the hook context without feedback', async () => {
    const context = vi.spyOn(loggerService, 'withContext')
    const errorLog = vi.spyOn(loggerService, 'error').mockImplementation(() => {})
    const response = pendingFactor()
    const failure = new Error('IPC unavailable')
    vi.mocked(ipcApi.request).mockReturnValueOnce(response.promise)
    renderHook(useWheelZoom)
    wheel(-40)
    await act(async () => response.reject(failure))
    expect(context).toHaveBeenCalledWith('useWheelZoom')
    expect(errorLog).toHaveBeenCalledWith('Failed to adjust interface zoom', failure)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('does not replace newer feedback with an older response', async () => {
    const older = pendingFactor()
    const newer = pendingFactor()
    vi.mocked(ipcApi.request).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    renderHook(useWheelZoom)
    wheel(-40)
    wheel(40)
    await act(async () => newer.resolve(1))
    await act(async () => older.resolve(1.1))
    expect(toast.info).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ description: '100%' }))
  })

  it('removes the listener and suppresses feedback after unmount', async () => {
    const response = pendingFactor()
    vi.mocked(ipcApi.request).mockReturnValueOnce(response.promise)
    const view = renderHook(useWheelZoom)
    wheel(-40)
    view.unmount()
    expect(wheel(-40).defaultPrevented).toBe(false)
    await act(async () => response.resolve(1.1))
    expect(ipcApi.request).toHaveBeenCalledTimes(1)
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('starts remounts with fresh accumulation and rejects obsolete feedback', async () => {
    const obsolete = pendingFactor()
    const fresh = pendingFactor()
    vi.mocked(ipcApi.request).mockReturnValueOnce(obsolete.promise).mockReturnValueOnce(fresh.promise)
    const view = renderHook(useWheelZoom)
    wheel(-40)
    wheel(-20)
    view.unmount()
    renderHook(useWheelZoom)
    wheel(-20)
    expect(ipcApi.request).toHaveBeenCalledTimes(1)
    wheel(-40)
    expect(ipcApi.request).toHaveBeenCalledTimes(2)
    await act(async () => fresh.resolve(1.2))
    await act(async () => obsolete.resolve(1.1))
    expect(toast.info).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ description: '120%' }))
  })
})
