import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

const { useAutoSyncStatus } = await import('../useAutoSyncStatus')

const FIRST = { destination: 'webdav', lastSuccessAt: 1_000 }
const LATER = { destination: 'webdav', lastSuccessAt: 2_000 }

describe('useAutoSyncStatus', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // A scheduled run finishes in main with no event to the page.
  it('picks up a run that finishes while the page is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    requestMock.mockResolvedValueOnce([FIRST]).mockResolvedValue([LATER])

    const { result } = renderHook(() => useAutoSyncStatus('webdav'))
    await waitFor(() => expect(result.current.status).toEqual(FIRST))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(result.current.status).toEqual(LATER)
  })

  // Blanking the status on a failed read would show "never synced".
  it('keeps the last status when a read fails', async () => {
    requestMock.mockResolvedValueOnce([FIRST]).mockRejectedValueOnce(new Error('ipc down'))

    const { result } = renderHook(() => useAutoSyncStatus('webdav'))
    await waitFor(() => expect(result.current.status).toEqual(FIRST))

    await act(() => result.current.refresh())

    expect(result.current.status).toEqual(FIRST)
  })
})
