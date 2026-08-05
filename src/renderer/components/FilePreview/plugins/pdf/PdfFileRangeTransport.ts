import { PDFDataRangeTransport } from 'pdfjs-dist'

import { ipcApi } from '@renderer/ipc'
import type { FileHandle } from '@shared/data/types/file'
import type { FileVersion } from '@shared/types/file'

export const PDF_RANGE_CHUNK_SIZE_BYTES = 1024 * 1024
const PDF_MAX_ASSEMBLED_RANGE_BYTES = 16 * PDF_RANGE_CHUNK_SIZE_BYTES

export class PdfRangeTooLargeError extends RangeError {
  readonly maxRangeLength = PDF_MAX_ASSEMBLED_RANGE_BYTES
  readonly rangeLength: number

  constructor(
    readonly begin: number,
    readonly end: number
  ) {
    const rangeLength = end - begin
    super(`PDF byte range is too large to assemble: ${rangeLength} bytes exceeds ${PDF_MAX_ASSEMBLED_RANGE_BYTES}`)
    this.name = 'PdfRangeTooLargeError'
    this.rangeLength = rangeLength
  }
}

export class PdfFileRangeTransport extends PDFDataRangeTransport {
  private aborted = false
  private expectedVersion: FileVersion | null = null
  private failed = false

  constructor(
    private readonly handle: FileHandle,
    length: number,
    private readonly onError: (error: Error) => void
  ) {
    super(length, null, true)
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new RangeError(`Invalid PDF file length: ${length}`)
    }
  }

  override requestDataRange(begin: number, end: number): void {
    if (this.isInactive()) return

    void this.readRange(begin, end).catch((error: unknown) => {
      if (this.isInactive()) return
      this.failed = true
      this.onError(error instanceof Error ? error : new Error(String(error)))
    })
  }

  override abort(): void {
    this.aborted = true
  }

  private async readRange(begin: number, end: number): Promise<void> {
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > this.length) {
      throw new RangeError(`Invalid PDF byte range: ${begin}-${end} of ${this.length}`)
    }

    const rangeLength = end - begin
    if (rangeLength > PDF_MAX_ASSEMBLED_RANGE_BYTES) {
      throw new PdfRangeTooLargeError(begin, end)
    }

    const data = new Uint8Array(rangeLength)
    for (let offset = begin; offset < end; offset += PDF_RANGE_CHUNK_SIZE_BYTES) {
      if (this.isInactive()) return

      const length = Math.min(PDF_RANGE_CHUNK_SIZE_BYTES, end - offset)
      const { content: chunk, version } = await ipcApi.request('file.read', {
        handle: this.handle,
        options: { mode: 'range', offset, length }
      })
      if (this.isInactive()) return
      this.validateVersion(version)
      if (chunk.byteLength !== length) {
        throw new Error(`Short PDF read at offset ${offset}: expected ${length} bytes, received ${chunk.byteLength}`)
      }
      data.set(chunk, offset - begin)
    }

    if (!this.isInactive()) {
      this.onDataRange(begin, data)
    }
  }

  private validateVersion(version: FileVersion): void {
    if (version.size !== this.length) {
      throw new Error(
        `PDF file size changed during range read: expected ${this.length} bytes, received ${version.size}`
      )
    }

    if (this.expectedVersion === null) {
      this.expectedVersion = { ...version }
      return
    }

    if (version.mtime !== this.expectedVersion.mtime || version.size !== this.expectedVersion.size) {
      throw new Error(
        `PDF file changed during range read: expected mtime ${this.expectedVersion.mtime} and size ${this.expectedVersion.size}, received mtime ${version.mtime} and size ${version.size}`
      )
    }
  }

  private isInactive(): boolean {
    return this.aborted || this.failed
  }
}
