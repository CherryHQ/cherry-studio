// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  listeners: new Map<string, (payload: unknown) => void>()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    mocks.listeners.set(event, handler)
  }
}))

import { useWindowInitData } from '../useWindowInitData'

interface InitData {
  value: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.request.mockReset()
  mocks.listeners.clear()
})

describe('useWindowInitData', () => {
  it('returns init data from the cold-start pull', async () => {
    mocks.request.mockResolvedValue({ value: 'cold-start' })

    const { result } = renderHook(() => useWindowInitData<InitData>())

    await act(async () => {})
    expect(result.current).toEqual({ value: 'cold-start' })
  })

  it('keeps a newer reuse payload when the mount-time pull resolves later', async () => {
    const pull = deferred<InitData>()
    mocks.request.mockReturnValue(pull.promise)
    const { result } = renderHook(() => useWindowInitData<InitData>())

    act(() => {
      mocks.listeners.get('window.reused')?.({ value: 'reused' })
    })
    expect(result.current).toEqual({ value: 'reused' })

    await act(async () => {
      pull.resolve({ value: 'stale-pull' })
      await pull.promise
    })

    expect(result.current).toEqual({ value: 'reused' })
  })
})
