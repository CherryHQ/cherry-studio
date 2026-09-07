import { cacheService } from '@data/CacheService'
import {
  LOCAL_MODEL_STATUS_CACHE_KEY,
  type LocalModelBundleId,
  type LocalModelStatusSnapshot
} from '@shared/data/presets/localModel'
import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLocalModel } from '../useLocalModel'

// Exercise the production read-only Shared Cache hook against the reactive CacheService mock.
vi.unmock('@data/hooks/useCache')

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mockRequest } }))

function publish(id: LocalModelBundleId, snapshot: LocalModelStatusSnapshot): void {
  const snapshots = cacheService.getSharedSnapshot(LOCAL_MODEL_STATUS_CACHE_KEY) ?? {}
  cacheService.setShared(LOCAL_MODEL_STATUS_CACHE_KEY, { ...snapshots, [id]: snapshot })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useLocalModel', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    mockRequest.mockReset()
    mockRequest.mockResolvedValue(undefined)
  })

  it('stays unresolved until Main publishes a snapshot and ignores the RPC response body', async () => {
    const statusResponse = deferred<{ status: 'not_downloaded' }>()
    mockRequest.mockReturnValueOnce(statusResponse.promise)
    const { result } = renderHook(() => useLocalModel(EMBEDDING))

    expect(result.current).toMatchObject({
      status: 'not_downloaded',
      errorCode: null,
      isStatusResolved: false,
      percent: 0
    })

    act(() => publish(EMBEDDING, { status: 'downloading', percent: 35 }))
    expect(result.current).toMatchObject({ status: 'downloading', isStatusResolved: true, percent: 35 })

    await act(async () => {
      statusResponse.resolve({ status: 'not_downloaded' })
      await statusResponse.promise
    })
    expect(result.current).toMatchObject({ status: 'downloading', percent: 35 })
  })

  it('updates every hook instance from the same shared snapshot', () => {
    const first = renderHook(() => useLocalModel(EMBEDDING))
    const second = renderHook(() => useLocalModel(EMBEDDING))

    act(() => publish(EMBEDDING, { status: 'downloading', percent: 48 }))

    expect(first.result.current).toMatchObject({ status: 'downloading', percent: 48 })
    expect(second.result.current).toMatchObject({ status: 'downloading', percent: 48 })

    act(() => publish(EMBEDDING, { status: 'ready', percent: 100 }))
    expect(first.result.current.status).toBe('ready')
    expect(second.result.current.status).toBe('ready')
  })

  it('projects the matching map entry when the observed bundle changes', () => {
    act(() => {
      cacheService.setShared(LOCAL_MODEL_STATUS_CACHE_KEY, {
        [EMBEDDING]: { status: 'ready', percent: 100 },
        [OCR]: { status: 'error', percent: 0, errorCode: 'incomplete_cache' }
      })
    })
    const { result, rerender } = renderHook(({ id }: { id: LocalModelBundleId }) => useLocalModel(id), {
      initialProps: { id: EMBEDDING as LocalModelBundleId }
    })

    expect(result.current).toMatchObject({ status: 'ready', errorCode: null, percent: 100 })

    rerender({ id: OCR })

    expect(result.current).toMatchObject({
      status: 'error',
      errorCode: 'incomplete_cache',
      isStatusResolved: true,
      percent: 0
    })
  })

  it('does not optimistically change status while commands are pending or complete', async () => {
    act(() => publish(EMBEDDING, { status: 'ready', percent: 100 }))
    const downloadResponse = deferred<{ result: 'ready' }>()
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.download') return downloadResponse.promise
      if (route === 'local_model.remove') return Promise.resolve({ removed: true })
      return Promise.resolve(undefined)
    })
    const { result } = renderHook(() => useLocalModel(EMBEDDING))

    let download!: Promise<boolean>
    act(() => {
      download = result.current.download()
    })
    expect(result.current.status).toBe('ready')

    await act(async () => {
      downloadResponse.resolve({ result: 'ready' })
      await expect(download).resolves.toBe(true)
    })
    expect(result.current).toMatchObject({ status: 'ready', percent: 100 })

    await act(async () => {
      await expect(result.current.cancel()).resolves.toBeUndefined()
    })
    expect(result.current).toMatchObject({ status: 'ready', percent: 100 })

    await act(async () => {
      await expect(result.current.remove()).resolves.toEqual({ removed: true })
    })
    expect(result.current).toMatchObject({ status: 'ready', percent: 100 })
  })

  it('returns false for cancellation and preserves genuine command failures', async () => {
    const failure = new Error('download failed')
    act(() => publish(EMBEDDING, { status: 'error', percent: 0, errorCode: 'download_failed' }))
    mockRequest.mockImplementation((route: string) => {
      if (route === 'local_model.download') return Promise.resolve({ result: 'cancelled' })
      return Promise.resolve(undefined)
    })
    const { result } = renderHook(() => useLocalModel(EMBEDDING))

    await act(async () => {
      await expect(result.current.download()).resolves.toBe(false)
    })
    expect(result.current.errorCode).toBe('download_failed')

    mockRequest.mockRejectedValueOnce(failure)
    await act(async () => {
      await expect(result.current.download()).rejects.toBe(failure)
    })
    expect(result.current.errorCode).toBe('download_failed')
  })

  it('asks Main to refresh each newly observed bundle', async () => {
    const { rerender } = renderHook(({ id }: { id: LocalModelBundleId }) => useLocalModel(id), {
      initialProps: { id: EMBEDDING as LocalModelBundleId }
    })

    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { id: EMBEDDING }))
    rerender({ id: OCR })
    await waitFor(() => expect(mockRequest).toHaveBeenCalledWith('local_model.get_status', { id: OCR }))
  })
})
