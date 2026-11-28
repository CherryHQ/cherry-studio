import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from '@renderer/services/toast'
import { createAppErrorContext } from '@shared/utils/appError'

import { AppErrorRuntime } from '../AppErrorRuntime'

type IpcListener = (payload: unknown) => void

beforeEach(() => {
  vi.mocked(toast.error).mockClear()
  vi.mocked(window.api.ipcApi.request).mockReset().mockResolvedValue(undefined)
  vi.mocked(window.api.ipcApi.on)
    .mockReset()
    .mockImplementation(() => () => undefined)
})

describe('AppErrorRuntime', () => {
  it('reports real window faults until unmount and ignores layout-observer noise', async () => {
    const error = new Error('disk full')
    const reason = new Error('database locked')
    const resizeNoise = new Error('ResizeObserver loop completed with undelivered notifications')
    const { unmount } = render(<AppErrorRuntime mode="local" />)

    act(() => {
      dispatchWindowError(resizeNoise)
      dispatchWindowError(error)
      dispatchRejection(reason)
    })
    await waitFor(() => {
      expect(toastCauses()).toEqual(expect.arrayContaining([error, reason]))
    })
    expect(toastCauses()).not.toContain(resizeNoise)

    unmount()
    const lateError = new Error('after unmount')
    const lateReason = new Error('rejection after unmount')
    const witnessed: unknown[] = []
    const witness = (event: ErrorEvent) => {
      witnessed.push(event.error)
    }
    const rejectionWitness = (event: Event) => {
      witnessed.push(rejectionReason(event))
    }
    window.addEventListener('error', witness)
    window.addEventListener('unhandledrejection', rejectionWitness)
    try {
      act(() => {
        dispatchWindowError(lateError)
        dispatchRejection(lateReason)
      })
    } finally {
      window.removeEventListener('error', witness)
      window.removeEventListener('unhandledrejection', rejectionWitness)
    }
    expect(witnessed).toEqual([lateError, lateReason])

    // A fresh runtime's fault lands after any stray late delivery would have.
    const sentinel = new Error('sentinel')
    const next = render(<AppErrorRuntime mode="local" />)
    act(() => {
      dispatchWindowError(sentinel)
    })
    await waitFor(() => {
      expect(toastCauses()).toContain(sentinel)
    })
    expect(toastCauses()).not.toContain(lateError)
    expect(toastCauses()).not.toContain(lateReason)
    next.unmount()
  })

  it('ignores aborted and permission-denied rejections but still reports real faults', async () => {
    const notAllowed = new DOMException('Document is not focused.', 'NotAllowedError')
    const domAbort = new DOMException('The operation was aborted.', 'AbortError')
    const errorAbort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const real = new Error('database locked')
    const { unmount } = render(<AppErrorRuntime mode="local" />)

    act(() => {
      dispatchRejection(notAllowed)
      dispatchRejection(domAbort)
      dispatchRejection(errorAbort)
      dispatchRejection(real)
    })

    await waitFor(() => {
      expect(toastCauses()).toContain(real)
    })
    expect(toastCauses()).toEqual([real])
    unmount()
  })

  it('keeps local and handoff windows off the main handoff channel', async () => {
    const bridge = attachIpcBridge()
    const localError = new Error('local boom')
    const handoffError = new Error('handoff boom')

    const local = render(<AppErrorRuntime mode="local" />)
    expect(bridge.listeners.get('app.error.open')?.size ?? 0).toBe(0)
    expect(bridge.request.mock.calls.some(([route]) => route === 'app.surface.receiver')).toBe(false)

    act(() => {
      dispatchWindowError(localError)
    })
    await waitFor(() => {
      expect(vi.mocked(toast.error)).toHaveBeenCalled()
    })
    expect(toastNotices().some((notice) => notice.cause === localError)).toBe(true)
    expect(bridge.listeners.get('app.error.open')?.size ?? 0).toBe(0)
    local.unmount()

    bridge.request.mockClear()
    const handoff = render(<AppErrorRuntime mode="handoff" />)
    act(() => {
      dispatchWindowError(handoffError)
    })
    await waitFor(() => {
      expect(bridge.request).toHaveBeenCalledWith(
        'app.error.handoff',
        expect.objectContaining({ message: 'handoff boom', operation: 'window.error' })
      )
    })

    expect(bridge.listeners.get('app.error.open')?.size ?? 0).toBe(0)
    expect(bridge.request.mock.calls.some(([route]) => route === 'app.surface.receiver')).toBe(false)
    handoff.unmount()
  })

  it('registers the main receiver and presents the same handed-off context until unmount', async () => {
    const bridge = attachIpcBridge()
    const context = createAppErrorContext({
      id: 'handoff-1',
      message: 'screencapture exited 1',
      operation: 'screenshot.capture',
      source: 'main'
    })
    const errorToast = vi.mocked(toast.error)

    const view = render(<AppErrorRuntime mode="main" />)

    expect(bridge.listeners.get('app.error.open')?.size).toBe(1)
    expect(bridge.request).toHaveBeenCalledWith('app.surface.receiver', { kind: 'error', ready: true })

    act(() => {
      bridge.emit('app.error.open', context)
    })
    await waitFor(() => {
      expect(errorToast).toHaveBeenCalled()
    })
    expect(toastNotices().some((notice) => errorContextOf(notice.data) === context)).toBe(true)

    view.rerender(<AppErrorRuntime mode="local" />)
    expect(bridge.listeners.get('app.error.open')?.size ?? 0).toBe(0)
    expect(lastReceiverInput(bridge.request)).toEqual({ kind: 'error', ready: false })

    errorToast.mockClear()
    await act(async () => {
      bridge.emit('app.error.open', context)
    })
    expect(errorToast).not.toHaveBeenCalled()

    view.rerender(<AppErrorRuntime mode="main" />)
    expect(bridge.listeners.get('app.error.open')?.size).toBe(1)
    expect(lastReceiverInput(bridge.request)).toEqual({ kind: 'error', ready: true })

    view.unmount()
    expect(bridge.listeners.get('app.error.open')?.size ?? 0).toBe(0)
    expect(lastReceiverInput(bridge.request)).toEqual({ kind: 'error', ready: false })
  })
})

function attachIpcBridge() {
  const listeners = new Map<string, Set<IpcListener>>()
  const request = vi.mocked(window.api.ipcApi.request)
  const on = vi.mocked(window.api.ipcApi.on)
  request.mockReset()
  request.mockImplementation(() => Promise.resolve({ ok: true, data: undefined }))
  on.mockReset()
  on.mockImplementation((event: string, callback: IpcListener) => {
    const bucket = listeners.get(event) ?? new Set<IpcListener>()
    bucket.add(callback)
    listeners.set(event, bucket)
    return () => {
      bucket.delete(callback)
    }
  })
  return {
    emit(event: string, payload: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(payload)
    },
    listeners,
    request
  }
}

function toastNotices() {
  return vi.mocked(toast.error).mock.calls.flatMap(([notice]) => (typeof notice === 'string' ? [] : [notice]))
}

function toastCauses(): unknown[] {
  return toastNotices().map((notice) => notice.cause)
}

function errorContextOf(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || !('errorContext' in data)) return undefined
  return data.errorContext
}

function lastReceiverInput(request: { mock: { calls: unknown[][] } }) {
  const calls = request.mock.calls.filter((call) => call[0] === 'app.surface.receiver')
  return calls.at(-1)?.[1]
}

function dispatchWindowError(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  window.dispatchEvent(new ErrorEvent('error', { error, message }))
}

function dispatchRejection(reason: unknown) {
  const promise = Promise.reject(reason)
  promise.catch(() => undefined)
  const event = new Event('unhandledrejection')
  Object.defineProperty(event, 'promise', { value: promise })
  Object.defineProperty(event, 'reason', { value: reason })
  window.dispatchEvent(event)
}

function rejectionReason(event: Event): unknown {
  if (!('reason' in event)) return undefined
  return event.reason
}
