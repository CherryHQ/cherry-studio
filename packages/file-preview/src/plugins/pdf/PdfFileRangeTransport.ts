import { PDFDataRangeTransport } from 'pdfjs-dist'

import { assertPreviewRange, type PreviewDocument, PreviewError, readPreviewRange } from '../../source'

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
  private readonly controller = new AbortController()
  private failed = false

  constructor(
    private readonly document: PreviewDocument,
    private readonly onError: (error: Error) => void
  ) {
    super(document.size, null, true)
    assertPreviewRange(document.size, 0, document.size)
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
    this.controller.abort()
  }

  private async readRange(begin: number, end: number): Promise<void> {
    assertPreviewRange(this.length, begin, end - begin)
    if (end <= begin) {
      throw new PreviewError('invalid_range', `Invalid PDF byte range: ${begin}-${end} of ${this.length}`)
    }

    const rangeLength = end - begin
    if (rangeLength > PDF_MAX_ASSEMBLED_RANGE_BYTES) {
      throw new PdfRangeTooLargeError(begin, end)
    }

    const data = new Uint8Array(rangeLength)
    for (let offset = begin; offset < end; offset += PDF_RANGE_CHUNK_SIZE_BYTES) {
      if (this.isInactive()) return

      const length = Math.min(PDF_RANGE_CHUNK_SIZE_BYTES, end - offset)
      const chunk = await readPreviewRange(this.document, offset, length, this.controller.signal)
      if (this.isInactive()) return
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
