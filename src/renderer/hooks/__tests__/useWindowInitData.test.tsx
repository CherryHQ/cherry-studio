// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  request: vi.fn(),
  on: vi.fn<(event: string, handler: (payload: unknown) => void) => () => void>(),
  listeners: new Map<string, (payload: unknown) => void>()
}

import { useWindowInitData } from '../useWindowInitData'

interface InitData {
  value: string
}

const success = <T,>(data: T) => ({ ok: true as const, data })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.request.mockReset()
  mocks.on.mockReset()
  mocks.listeners.clear()
  mocks.on.mockImplementation((event, handler) => {
    mocks.listeners.set(event, handler)
    return () => {
      mocks.listeners.delete(event)
    }
  })
  ;(window as unknown as { api: unknown }).api = {
    ipcApi: { request: mocks.request, on: mocks.on }
  }
})

describe('useWindowInitData', () => {
  it('returns init data from the cold-start pull', async () => {
    mocks.request.mockResolvedValue(success({ value: 'cold-start' }))

    const { result } = renderHook(() => useWindowInitData<InitData>())

    await act(async () => {})
    expect(result.current).toEqual({ value: 'cold-start' })
  })

  it('keeps a newer reuse payload when the mount-time pull resolves later', async () => {
    const pull = deferred<ReturnType<typeof success<InitData>>>()
    mocks.request.mockReturnValue(pull.promise)
    const { result } = renderHook(() => useWindowInitData<InitData>())

    act(() => {
      mocks.listeners.get('window.reused')?.({ value: 'reused' })
    })
    expect(result.current).toEqual({ value: 'reused' })

    await act(async () => {
      pull.resolve(success({ value: 'stale-pull' }))
      await pull.promise
    })

    expect(result.current).toEqual({ value: 'reused' })
  })

  it('unsubscribes from reuse events on unmount', () => {
    mocks.request.mockReturnValue(new Promise(() => {}))

    const { unmount } = renderHook(() => useWindowInitData<InitData>())
    expect(mocks.listeners.has('window.reused')).toBe(true)

    unmount()

    expect(mocks.listeners.has('window.reused')).toBe(false)
  })
})
