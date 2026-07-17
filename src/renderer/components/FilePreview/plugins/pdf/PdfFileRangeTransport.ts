import { ipcApi } from '@renderer/ipc'
import type { FileHandle } from '@shared/data/types/file'
import { PDFDataRangeTransport } from 'pdfjs-dist'

export const PDF_RANGE_CHUNK_SIZE_BYTES = 1024 * 1024

export class PdfFileRangeTransport extends PDFDataRangeTransport {
  private aborted = false
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

    const data = new Uint8Array(end - begin)
    for (let offset = begin; offset < end; offset += PDF_RANGE_CHUNK_SIZE_BYTES) {
      if (this.isInactive()) return

      const length = Math.min(PDF_RANGE_CHUNK_SIZE_BYTES, end - offset)
      const chunk = await ipcApi.request('file.read_chunk', { handle: this.handle, offset, length })
      if (this.isInactive()) return
      if (chunk.byteLength !== length) {
        throw new Error(`Short PDF read at offset ${offset}: expected ${length} bytes, received ${chunk.byteLength}`)
      }
      data.set(chunk, offset - begin)
    }

    if (!this.isInactive()) {
      this.onDataRange(begin, data)
    }
  }

  private isInactive(): boolean {
    return this.aborted || this.failed
  }
}
