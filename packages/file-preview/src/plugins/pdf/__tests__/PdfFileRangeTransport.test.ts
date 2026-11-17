import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PreviewDocument } from '../../../source'
import { PDF_RANGE_CHUNK_SIZE_BYTES, PdfFileRangeTransport, PdfRangeTooLargeError } from '../PdfFileRangeTransport'

const mocks = vi.hoisted(() => ({ readRange: vi.fn(), onDataRange: vi.fn() }))
vi.mock('pdfjs-dist', () => ({
  PDFDataRangeTransport: class {
    constructor(readonly length: number) {}
    onDataRange(begin: number, data: Uint8Array) {
      mocks.onDataRange(begin, data)
    }
  }
}))

function document(size: number): PreviewDocument {
  return { size, revision: 'test', readRange: mocks.readRange, close: async () => {} }
}

beforeEach(() => vi.resetAllMocks())

describe('PDF range transport', () => {
  it('assembles bounded reads in order before delivering a coalesced range', async () => {
    const size = 4 * PDF_RANGE_CHUNK_SIZE_BYTES + 123
    const transport = new PdfFileRangeTransport(document(size), vi.fn())
    mocks.readRange.mockImplementation(async (offset: number, length: number) =>
      new Uint8Array(length).fill(offset / PDF_RANGE_CHUNK_SIZE_BYTES)
    )
    transport.requestDataRange(0, size)
    await vi.waitFor(() => expect(mocks.onDataRange).toHaveBeenCalledTimes(1))
    const bytes = mocks.onDataRange.mock.lastCall![1] as Uint8Array
    expect(bytes).toHaveLength(size)
    for (let index = 0; index < 5; index++) expect(bytes[index * PDF_RANGE_CHUNK_SIZE_BYTES]).toBe(index)
    expect(mocks.readRange.mock.calls.every(([, length]) => length <= PDF_RANGE_CHUNK_SIZE_BYTES)).toBe(true)
  })

  it('rejects ranges over the assembly budget before reading', async () => {
    const onError = vi.fn()
    const size = 20 * PDF_RANGE_CHUNK_SIZE_BYTES
    const transport = new PdfFileRangeTransport(document(size), onError)
    transport.requestDataRange(PDF_RANGE_CHUNK_SIZE_BYTES, 19 * PDF_RANGE_CHUNK_SIZE_BYTES)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(PdfRangeTooLargeError)))
    expect(mocks.readRange).not.toHaveBeenCalled()
    expect(mocks.onDataRange).not.toHaveBeenCalled()
  })

  it.each([
    [-1, 1],
    [0, 101],
    [4, 4],
    [2.5, 4]
  ])('rejects invalid range %s..%s before reading', async (begin, end) => {
    const onError = vi.fn()
    new PdfFileRangeTransport(document(100), onError).requestDataRange(begin, end)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_range' })))
    expect(mocks.readRange).not.toHaveBeenCalled()
  })

  it('rejects a short read without delivering partial data', async () => {
    const onError = vi.fn()
    mocks.readRange.mockResolvedValue(new Uint8Array(2))
    new PdfFileRangeTransport(document(100), onError).requestDataRange(10, 13)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'short_read' })))
    expect(mocks.onDataRange).not.toHaveBeenCalled()
  })

  it('reports only the first active failure', async () => {
    const onError = vi.fn()
    mocks.readRange.mockRejectedValue(new Error('read failed'))
    const transport = new PdfFileRangeTransport(document(100), onError)
    transport.requestDataRange(0, 1)
    transport.requestDataRange(1, 2)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(mocks.onDataRange).not.toHaveBeenCalled()
  })

  it('aborts pending reads and discards their late data', async () => {
    const onError = vi.fn()
    let resolve!: (bytes: Uint8Array) => void
    mocks.readRange.mockImplementation(
      () =>
        new Promise<Uint8Array>((done) => {
          resolve = done
        })
    )
    const transport = new PdfFileRangeTransport(document(100), onError)
    transport.requestDataRange(0, 1)
    const signal = mocks.readRange.mock.lastCall![2] as AbortSignal
    transport.abort()
    resolve(new Uint8Array([1]))
    await Promise.resolve()
    await Promise.resolve()
    expect(signal.aborted).toBe(true)
    expect(mocks.onDataRange).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
