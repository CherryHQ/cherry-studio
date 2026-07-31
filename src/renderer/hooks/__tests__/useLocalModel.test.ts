import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLocalModel } from '../useLocalModel'

type ProgressPayload = { model: 'embedding' | 'ocr'; status: string; percent: number }

const { mockRequest, progressHandler } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  progressHandler: { current: undefined as ((payload: ProgressPayload) => void) | undefined }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mockRequest(...args) },
  useIpcOn: (_event: string, handler: (payload: ProgressPayload) => void) => {
    progressHandler.current = handler
  }
}))

describe('useLocalModel', () => {
  beforeEach(() => {
    mockRequest.mockReset()
    progressHandler.current = undefined
  })

  it('tracks matching progress and external ready events', async () => {
    mockRequest.mockResolvedValue({ status: 'not_downloaded' })
    const { result } = renderHook(() => useLocalModel('embedding'))

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { model: 'embedding' }))

    act(() => progressHandler.current?.({ model: 'ocr', status: 'downloading', percent: 20 }))
    expect(result.current.percent).toBe(0)

    act(() => progressHandler.current?.({ model: 'embedding', status: 'downloading', percent: 45 }))
    expect(result.current.status).toBe('downloading')
    expect(result.current.percent).toBe(45)

    act(() => progressHandler.current?.({ model: 'embedding', status: 'ready', percent: 100 }))
    expect(result.current.status).toBe('ready')
  })

  it('reports a successful embedding download', async () => {
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download') return Promise.resolve()
      return Promise.resolve()
    })
    const { result } = renderHook(() => useLocalModel('embedding'))
    await waitFor(() => expect(result.current.status).toBe('not_downloaded'))

    let completed = false
    await act(async () => {
      completed = await result.current.download()
    })

    expect(completed).toBe(true)
    expect(result.current.status).toBe('ready')
    expect(result.current.percent).toBe(100)
  })

  it('returns to idle without surfacing cancellation as a download failure', async () => {
    let rejectDownload: ((error: Error) => void) | undefined
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download') {
        return new Promise<void>((_resolve, reject) => {
          rejectDownload = reject
        })
      }
      return Promise.resolve()
    })
    const { result } = renderHook(() => useLocalModel('embedding'))
    await waitFor(() => expect(result.current.status).toBe('not_downloaded'))

    let downloadPromise: Promise<boolean>
    act(() => {
      downloadPromise = result.current.download()
    })
    await waitFor(() => expect(result.current.status).toBe('downloading'))

    await act(async () => {
      await result.current.cancel()
    })
    act(() => rejectDownload?.(new Error('download cancelled')))

    await expect(downloadPromise!).resolves.toBe(false)
    expect(result.current.status).toBe('not_downloaded')
  })

  it('keeps a genuine download failure retryable and rethrows it to the caller', async () => {
    const failure = new Error('download failed')
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.get_status') return Promise.resolve({ status: 'not_downloaded' })
      if (route === 'local_model.download') return Promise.reject(failure)
      return Promise.resolve()
    })
    const { result } = renderHook(() => useLocalModel('embedding'))
    await waitFor(() => expect(result.current.status).toBe('not_downloaded'))

    let caught: unknown
    await act(async () => {
      try {
        await result.current.download()
      } catch (error) {
        caught = error
      }
    })

    expect(caught).toBe(failure)
    expect(result.current.status).toBe('error')
  })
})
