import type { FilePath } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PDF_RANGE_CHUNK_SIZE_BYTES, PdfFileRangeTransport } from '../PdfFileRangeTransport'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  onDataRange: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

vi.mock('pdfjs-dist', () => ({
  PDFDataRangeTransport: class {
    constructor(
      readonly length: number,
      readonly initialData: Uint8Array | null,
      readonly progressiveDone: boolean
    ) {}

    onDataRange(begin: number, chunk: Uint8Array) {
      mocks.onDataRange(begin, chunk)
    }
  }
}))

const handle = createFilePathHandle('/tmp/workspace/paper.pdf' as FilePath)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('PdfFileRangeTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads and delivers a requested range through file IPC', async () => {
    const onError = vi.fn()
    const transport = new PdfFileRangeTransport(handle, 100, onError)
    mocks.ipcRequest.mockResolvedValueOnce(new Uint8Array([5, 6, 7]))

    expect(transport).toMatchObject({ length: 100, initialData: null, progressiveDone: true })
    transport.requestDataRange(5, 8)

    await vi.waitFor(() => expect(mocks.onDataRange).toHaveBeenCalledTimes(1))
    expect(mocks.ipcRequest).toHaveBeenCalledWith('file.read_chunk', { handle, offset: 5, length: 3 })
    expect(mocks.onDataRange).toHaveBeenCalledWith(5, new Uint8Array([5, 6, 7]))
    expect(onError).not.toHaveBeenCalled()
  })

  it('splits a coalesced pdf.js range into bounded IPC reads and delivers it once', async () => {
    const requestLength = 4 * PDF_RANGE_CHUNK_SIZE_BYTES + 123
    const transport = new PdfFileRangeTransport(handle, requestLength + 10, vi.fn())
    mocks.ipcRequest.mockImplementation(async (_route: string, input: { offset: number; length: number }) =>
      new Uint8Array(input.length).fill(input.offset / PDF_RANGE_CHUNK_SIZE_BYTES)
    )

    transport.requestDataRange(0, requestLength)

    await vi.waitFor(() => expect(mocks.onDataRange).toHaveBeenCalledTimes(1))
    expect(mocks.ipcRequest).toHaveBeenCalledTimes(5)
    expect(mocks.ipcRequest.mock.calls.map(([, input]) => input)).toEqual([
      { handle, offset: 0, length: PDF_RANGE_CHUNK_SIZE_BYTES },
      { handle, offset: PDF_RANGE_CHUNK_SIZE_BYTES, length: PDF_RANGE_CHUNK_SIZE_BYTES },
      { handle, offset: 2 * PDF_RANGE_CHUNK_SIZE_BYTES, length: PDF_RANGE_CHUNK_SIZE_BYTES },
      { handle, offset: 3 * PDF_RANGE_CHUNK_SIZE_BYTES, length: PDF_RANGE_CHUNK_SIZE_BYTES },
      { handle, offset: 4 * PDF_RANGE_CHUNK_SIZE_BYTES, length: 123 }
    ])
    const [, delivered] = mocks.onDataRange.mock.calls[0] as [number, Uint8Array]
    expect(delivered).toHaveLength(requestLength)
    expect(delivered[0]).toBe(0)
    expect(delivered[PDF_RANGE_CHUNK_SIZE_BYTES]).toBe(1)
    expect(delivered[4 * PDF_RANGE_CHUNK_SIZE_BYTES]).toBe(4)
  })

  it('reports a short read without delivering partial data', async () => {
    const onError = vi.fn()
    const transport = new PdfFileRangeTransport(handle, 100, onError)
    mocks.ipcRequest.mockResolvedValueOnce(new Uint8Array([1, 2]))

    transport.requestDataRange(10, 13)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Short PDF read') })
    )
    expect(mocks.onDataRange).not.toHaveBeenCalled()
  })

  it('reports only the first active IPC failure', async () => {
    const onError = vi.fn()
    const transport = new PdfFileRangeTransport(handle, 100, onError)
    mocks.ipcRequest.mockRejectedValue(new Error('read failed'))

    transport.requestDataRange(0, 1)
    transport.requestDataRange(1, 2)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'read failed' }))
    expect(mocks.onDataRange).not.toHaveBeenCalled()
  })

  it('drops successful and failed IPC results after abort', async () => {
    const success = deferred<Uint8Array>()
    const failure = deferred<Uint8Array>()
    const onError = vi.fn()
    const transport = new PdfFileRangeTransport(handle, 100, onError)
    mocks.ipcRequest.mockReturnValueOnce(success.promise).mockReturnValueOnce(failure.promise)

    transport.requestDataRange(0, 1)
    transport.requestDataRange(1, 2)
    transport.abort()
    success.resolve(new Uint8Array([1]))
    failure.reject(new Error('late failure'))
    await Promise.allSettled([success.promise, failure.promise])
    await Promise.resolve()

    expect(mocks.onDataRange).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
