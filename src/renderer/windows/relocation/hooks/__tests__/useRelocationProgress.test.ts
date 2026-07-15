import type { RelocationProgress } from '@shared/types/relocation'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRelocationProgress } from '../useRelocationProgress'

const requestMock = vi.fn()
const onMock = vi.fn()
const unsubscribeMock = vi.fn()
let progressListener: ((progress: RelocationProgress) => void) | undefined

beforeEach(() => {
  requestMock.mockReset()
  onMock.mockReset()
  unsubscribeMock.mockReset()
  progressListener = undefined
  onMock.mockImplementation((_event: string, listener: (progress: RelocationProgress) => void) => {
    progressListener = listener
    return unsubscribeMock
  })
  ;(window as unknown as { api: { ipcApi: unknown } }).api.ipcApi = {
    request: requestMock,
    on: onMock
  }
})

describe('useRelocationProgress', () => {
  it('keeps a newer progress event when the initial progress request resolves later', async () => {
    let resolveInitial: ((result: { ok: true; data: RelocationProgress }) => void) | undefined
    requestMock.mockImplementationOnce(
      () =>
        new Promise<{ ok: true; data: RelocationProgress }>((resolve) => {
          resolveInitial = resolve
        })
    )
    const copying = makeProgress('copying', 40, 100)
    const { result } = renderHook(() => useRelocationProgress())

    act(() => progressListener?.(copying))
    await act(async () => resolveInitial?.({ ok: true, data: makeProgress('preparing', 0, 0) }))

    expect(result.current.progress).toEqual(copying)
  })

  it('loads the current progress and unsubscribes on unmount', async () => {
    const current = makeProgress('committing', 100, 100)
    requestMock.mockResolvedValueOnce({ ok: true, data: current })

    const { result, unmount } = renderHook(() => useRelocationProgress())

    await waitFor(() => expect(result.current.progress).toEqual(current))
    unmount()

    expect(onMock).toHaveBeenCalledWith('app.user_data_relocation.progress', expect.any(Function))
    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })

  it('requests a restart through the relocation-scoped route', () => {
    requestMock.mockResolvedValue({ ok: true, data: null })
    const { result } = renderHook(() => useRelocationProgress())

    act(() => result.current.restart())

    expect(requestMock).toHaveBeenCalledWith('app.user_data_relocation.restart', undefined)
  })
})

function makeProgress(stage: RelocationProgress['stage'], bytesCopied: number, bytesTotal: number): RelocationProgress {
  return {
    stage,
    from: '/old/data',
    to: '/new/data',
    copy: true,
    bytesCopied,
    bytesTotal
  }
}
