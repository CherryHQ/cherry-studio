import { type RelocationProgress, UserDataRelocationIpcChannels } from '@shared/types/userDataRelocation'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useRelocationProgress } from '../useRelocationProgress'

const invokeMock = vi.fn()
const onMock = vi.fn()
const unsubscribeMock = vi.fn()
let progressListener: ((event: unknown, progress: RelocationProgress) => void) | undefined

beforeEach(() => {
  invokeMock.mockReset()
  onMock.mockReset()
  unsubscribeMock.mockReset()
  progressListener = undefined
  onMock.mockImplementation((_channel: string, listener: (event: unknown, progress: RelocationProgress) => void) => {
    progressListener = listener
    return unsubscribeMock
  })
  ;(window as unknown as { electron: { ipcRenderer: unknown } }).electron = {
    ipcRenderer: { invoke: invokeMock, on: onMock }
  }
})

describe('useRelocationProgress', () => {
  it('keeps a newer progress event when the initial progress request resolves later', async () => {
    let resolveInitial: ((progress: RelocationProgress) => void) | undefined
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<RelocationProgress>((resolve) => {
          resolveInitial = resolve
        })
    )
    const copying = makeProgress('copying', 40, 100)
    const { result } = renderHook(() => useRelocationProgress())

    act(() => progressListener?.({}, copying))
    await act(async () => resolveInitial?.(makeProgress('preparing', 0, 0)))

    expect(result.current.progress).toEqual(copying)
  })

  it('loads the current progress and unsubscribes on unmount', async () => {
    const current = makeProgress('committing', 100, 100)
    invokeMock.mockResolvedValueOnce(current)

    const { result, unmount } = renderHook(() => useRelocationProgress())

    await waitFor(() => expect(result.current.progress).toEqual(current))
    unmount()

    expect(onMock).toHaveBeenCalledWith(UserDataRelocationIpcChannels.Progress, expect.any(Function))
    expect(unsubscribeMock).toHaveBeenCalledOnce()
  })

  it('requests a restart through the dedicated relocation channel', () => {
    invokeMock.mockResolvedValue(undefined)
    const { result } = renderHook(() => useRelocationProgress())

    act(() => result.current.restart())

    expect(invokeMock).toHaveBeenCalledWith(UserDataRelocationIpcChannels.Restart)
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
