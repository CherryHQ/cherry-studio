import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockWorkbookModel } from '../mockModel'
import type { XlsxParseRequest, XlsxParseResponse } from '../renderModel'
import { useXlsxWorkbook, XLSX_PREVIEW_MAX_SIZE_BYTES } from '../useXlsxWorkbook'

class FakeXlsxWorker {
  onmessage: ((event: { data: XlsxParseResponse }) => void) | null = null
  onerror: ((event: { message: string; error?: unknown }) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn((request: XlsxParseRequest) => {
    mocks.requests.push(request)
  })

  constructor() {
    mocks.workers.push(this)
  }

  respond(response: XlsxParseResponse) {
    this.onmessage?.({ data: response })
  }
}

const mocks = vi.hoisted(() => ({
  fsRead: vi.fn(),
  workers: [] as unknown[],
  requests: [] as Array<{ id: number; fileName: string; data: ArrayBuffer }>,
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => mocks.logger }
}))

vi.mock('../worker/xlsxParser.worker?worker', () => ({
  default: FakeXlsxWorker
}))

const lastWorker = () => {
  const worker = mocks.workers.at(-1)
  if (!worker) throw new Error('Expected a worker instance')
  return worker as unknown as FakeXlsxWorker
}

describe('useXlsxWorkbook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workers.length = 0
    mocks.requests.length = 0
    mocks.fsRead.mockResolvedValue(new Uint8Array([1, 2, 3, 4]))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { fs: { read: mocks.fsRead } }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns oversize without creating a worker when the file exceeds the 20MB cap', async () => {
    const oversizeBytes = XLSX_PREVIEW_MAX_SIZE_BYTES + 1
    mocks.fsRead.mockResolvedValue(new ArrayBuffer(oversizeBytes))

    const { result } = renderHook(() => useXlsxWorkbook('/tmp/big.xlsx', 0))

    await waitFor(() => expect(result.current.status).toBe('oversize'))
    expect(result.current).toEqual({ status: 'oversize', sizeBytes: oversizeBytes })
    expect(mocks.workers).toHaveLength(0)
  })

  it('returns oversize from sourceSize without reading the file', async () => {
    const oversizeBytes = XLSX_PREVIEW_MAX_SIZE_BYTES + 1
    const { result } = renderHook(() => useXlsxWorkbook('/tmp/big.xlsx', 0, oversizeBytes))

    await waitFor(() => expect(result.current).toEqual({ status: 'oversize', sizeBytes: oversizeBytes }))
    expect(mocks.fsRead).not.toHaveBeenCalled()
    expect(mocks.workers).toHaveLength(0)
  })

  it('parses via the worker and reaches ready', async () => {
    const model = createMockWorkbookModel()
    const { result } = renderHook(() => useXlsxWorkbook('/tmp/dir/book.xlsx', 0))

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(mocks.requests).toHaveLength(1))
    expect(mocks.requests[0].fileName).toBe('book.xlsx')

    act(() => lastWorker().respond({ id: mocks.requests[0].id, ok: true, model }))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toEqual({ status: 'ready', model })
  })

  it('discards responses whose id does not match the latest request', async () => {
    const model = createMockWorkbookModel()
    const { result } = renderHook(() => useXlsxWorkbook('/tmp/book.xlsx', 0))

    await waitFor(() => expect(mocks.requests).toHaveLength(1))
    const currentId = mocks.requests[0].id

    act(() => lastWorker().respond({ id: currentId - 1, ok: true, model }))
    expect(result.current.status).toBe('loading')

    act(() => lastWorker().respond({ id: currentId, ok: true, model }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })

  it('spawns a fresh worker per reparse and terminates the superseded one', async () => {
    const model = createMockWorkbookModel()
    const { result, rerender } = renderHook(({ refreshKey }) => useXlsxWorkbook('/tmp/book.xlsx', refreshKey), {
      initialProps: { refreshKey: 0 }
    })

    await waitFor(() => expect(mocks.requests).toHaveLength(1))
    const firstWorker = lastWorker()
    act(() => firstWorker.respond({ id: mocks.requests[0].id, ok: true, model }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    rerender({ refreshKey: 1 })

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(mocks.requests).toHaveLength(2))
    expect(mocks.fsRead).toHaveBeenCalledTimes(2)
    expect(mocks.requests[1].id).toBeGreaterThan(mocks.requests[0].id)
    // A slow parse must not pin a shared worker: the reparse gets its own worker and the old one is terminated.
    expect(mocks.workers).toHaveLength(2)
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)

    // The pre-refresh response id is now stale — it must not flip the state.
    act(() => lastWorker().respond({ id: mocks.requests[0].id, ok: true, model }))
    expect(result.current.status).toBe('loading')

    act(() => lastWorker().respond({ id: mocks.requests[1].id, ok: true, model }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })

  it('does not let a superseded worker crash flip the new request to error', async () => {
    const model = createMockWorkbookModel()
    const { result, rerender } = renderHook(({ refreshKey }) => useXlsxWorkbook('/tmp/book.xlsx', refreshKey), {
      initialProps: { refreshKey: 0 }
    })

    // Switch files before the first (slow) parse responds.
    await waitFor(() => expect(mocks.requests).toHaveLength(1))
    const oldWorker = lastWorker()

    rerender({ refreshKey: 1 })
    await waitFor(() => expect(mocks.requests).toHaveLength(2))
    expect(oldWorker.terminate).toHaveBeenCalledTimes(1)

    // A worker ErrorEvent carries no request id; the old worker crashing must not touch the new request.
    act(() => oldWorker.onerror?.({ message: 'old parse crashed' }))
    expect(result.current.status).toBe('loading')

    act(() => lastWorker().respond({ id: mocks.requests[1].id, ok: true, model }))
    await waitFor(() => expect(result.current.status).toBe('ready'))
  })

  it('maps a failed parse response to the error state', async () => {
    const { result } = renderHook(() => useXlsxWorkbook('/tmp/corrupt.xlsx', 0))

    await waitFor(() => expect(mocks.requests).toHaveLength(1))
    act(() => lastWorker().respond({ id: mocks.requests[0].id, ok: false, message: 'not an xlsx' }))

    await waitFor(() => expect(result.current).toEqual({ status: 'error', message: 'not an xlsx' }))
  })

  it('maps a file read failure to the error state without creating a worker', async () => {
    mocks.fsRead.mockRejectedValue(new Error('ENOENT: gone'))

    const { result } = renderHook(() => useXlsxWorkbook('/tmp/gone.xlsx', 0))

    await waitFor(() => expect(result.current).toEqual({ status: 'error', message: 'ENOENT: gone' }))
    expect(mocks.workers).toHaveLength(0)
  })

  it('terminates the worker on unmount', async () => {
    const { unmount } = renderHook(() => useXlsxWorkbook('/tmp/book.xlsx', 0))

    await waitFor(() => expect(mocks.workers).toHaveLength(1))
    const worker = lastWorker()

    unmount()

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('logs model warnings deduplicated across parses', async () => {
    const model = createMockWorkbookModel()
    model.warnings = ['w-a', 'w-a', 'w-b']

    const { result, rerender } = renderHook(({ refreshKey }) => useXlsxWorkbook('/tmp/book.xlsx', refreshKey), {
      initialProps: { refreshKey: 0 }
    })

    await waitFor(() => expect(mocks.requests).toHaveLength(1))
    act(() => lastWorker().respond({ id: mocks.requests[0].id, ok: true, model }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.logger.warn).toHaveBeenCalledTimes(2)
    expect(mocks.logger.warn).toHaveBeenCalledWith('w-a')
    expect(mocks.logger.warn).toHaveBeenCalledWith('w-b')

    // Same warnings from a re-parse are not logged again.
    rerender({ refreshKey: 1 })
    await waitFor(() => expect(mocks.requests).toHaveLength(2))
    act(() => lastWorker().respond({ id: mocks.requests[1].id, ok: true, model }))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.logger.warn).toHaveBeenCalledTimes(2)
  })
})
