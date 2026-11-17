// @vitest-environment node

import { Buffer } from 'node:buffer'

import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas'
import type * as PdfJsModule from 'pdfjs-dist'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const PDF_RANGE_CHUNK_SIZE_BYTES = 1024 * 1024
const PDF_STREAM_LENGTH_BYTES = 20 * PDF_RANGE_CHUNK_SIZE_BYTES
const EXPECTED_LARGE_RANGE = {
  begin: PDF_RANGE_CHUNK_SIZE_BYTES,
  end: 19 * PDF_RANGE_CHUNK_SIZE_BYTES,
  length: 18 * PDF_RANGE_CHUNK_SIZE_BYTES
}

let getDocument: typeof PdfJsModule.getDocument
let PDFDataRangeTransport: typeof PdfJsModule.PDFDataRangeTransport

function buildLargeStreamPdf(): Uint8Array {
  const chunks: Buffer[] = []
  const offsets = new Map<number, number>()
  let size = 0

  const append = (value: string | Buffer) => {
    const chunk = typeof value === 'string' ? Buffer.from(value, 'binary') : value
    chunks.push(chunk)
    size += chunk.byteLength
  }
  const appendObject = (number: number, body: string) => {
    offsets.set(number, size)
    append(`${number} 0 obj\n${body}\nendobj\n`)
  }

  append('%PDF-1.7\n%\xff\xff\xff\xff\n')
  appendObject(1, '<< /Type /Catalog /Pages 2 0 R >>')
  appendObject(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  appendObject(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>')
  offsets.set(4, size)
  append(`4 0 obj\n<< /Length ${PDF_STREAM_LENGTH_BYTES} >>\nstream\n`)
  // Whitespace is valid PDF page content and keeps the large stream deterministic.
  append(Buffer.alloc(PDF_STREAM_LENGTH_BYTES, 0x20))
  append('\nendstream\nendobj\n')

  const xrefOffset = size
  append('xref\n0 5\n0000000000 65535 f \n')
  for (let objectNumber = 1; objectNumber <= 4; objectNumber += 1) {
    append(`${String(offsets.get(objectNumber)).padStart(10, '0')} 00000 n \n`)
  }
  append(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const pdf = Buffer.concat(chunks)
  return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength)
}

describe('pdf.js large stream ranges', () => {
  beforeAll(async () => {
    vi.stubGlobal('DOMMatrix', DOMMatrix)
    vi.stubGlobal('ImageData', ImageData)
    vi.stubGlobal('Path2D', Path2D)
    vi.stubGlobal('Worker', undefined)

    const pdfJsModule = await import('pdfjs-dist')
    getDocument = pdfJsModule.getDocument
    PDFDataRangeTransport = pdfJsModule.PDFDataRangeTransport
  })

  it('requests a coalesced 18 MiB range for a valid 20 MiB PDF stream', async () => {
    const pdf = buildLargeStreamPdf()
    const requests: Array<{ begin: number; end: number; length: number }> = []
    let loadingTask: PDFDocumentLoadingTask | null = null

    class RecordingRangeTransport extends PDFDataRangeTransport {
      constructor() {
        super(pdf.byteLength, null, true)
      }

      override requestDataRange(begin: number, end: number): void {
        requests.push({ begin, end, length: end - begin })
        // pdf.js registers its range reader immediately after making this request.
        queueMicrotask(() => this.onDataRange(begin, pdf.slice(begin, end)))
      }
    }

    const transport = new RecordingRangeTransport()
    loadingTask = getDocument({
      range: transport,
      rangeChunkSize: PDF_RANGE_CHUNK_SIZE_BYTES,
      disableAutoFetch: true,
      disableStream: true
    })

    try {
      const document = await loadingTask.promise
      const page = await document.getPage(1)
      await page.getOperatorList()

      expect(requests).toContainEqual({
        begin: EXPECTED_LARGE_RANGE.begin,
        end: EXPECTED_LARGE_RANGE.end,
        length: EXPECTED_LARGE_RANGE.length
      })

      await loadingTask.destroy()
      loadingTask = null
    } finally {
      await loadingTask?.destroy().catch(() => undefined)
    }
  })
})
