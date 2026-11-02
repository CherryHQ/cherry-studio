import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { degradedFaultHostService } from '@renderer/services/DegradedFaultHostService'
import { toast } from '@renderer/services/toast'
import { createAppErrorContext } from '@shared/utils/appError'

import { AppErrorRuntime } from '../AppErrorRuntime'

type IpcListener = (payload: unknown) => void

const originalApi = { current: undefined as PropertyDescriptor | undefined }

beforeAll(() => {
  originalApi.current = Object.getOwnPropertyDescriptor(globalThis, 'api')
})

beforeEach(() => {
  degradedFaultHostService.setDegradedFaultHandler(null)
  vi.mocked(toast.error).mockClear()
  vi.mocked(window.api.ipcApi.request).mockReset().mockResolvedValue(undefined)
  vi.mocked(window.api.ipcApi.on)
    .mockReset()
    .mockImplementation(() => () => undefined)
})

afterEach(() => {
  restoreApi(originalApi.current)
  degradedFaultHostService.setDegradedFaultHandler(null)
})

describe('AppErrorRuntime', () => {
  it('delivers window faults to the degraded host when window.api is missing', () => {
    Reflect.deleteProperty(globalThis, 'api')
    expect(window.electron.ipcRenderer).toBeTypeOf('object')
    const seen: unknown[] = []
    degradedFaultHostService.setDegradedFaultHandler((error) => {
      seen.push(error)
    })

    const error = new Error('disk full')
    const reason = new Error('database locked')
    const { unmount } = render(<AppErrorRuntime mode="degraded" />)

    act(() => {
      dispatchWindowError(error)
      dispatchRejection(reason)
      dispatchWindowError(new Error('ResizeObserver loop completed with undelivered notifications'))
    })

    expect(seen[0]).toBe(error)
    expect(seen[1]).toBe(reason)
    expect(seen).toHaveLength(2)

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
    expect(seen).toEqual([error, reason])
    expect(witnessed).toEqual([lateError, lateReason])
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

function restoreApi(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, 'api', descriptor)
    return
  }
  Reflect.deleteProperty(globalThis, 'api')
}

function toastNotices() {
  return vi.mocked(toast.error).mock.calls.flatMap(([notice]) => (typeof notice === 'string' ? [] : [notice]))
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
