import { describe, expect, it } from 'vitest'

import { isScannedPdfError } from '../documentToMarkdown/handler'

const hasNativeBinding =
  ((process.platform === 'darwin' || process.platform === 'linux') &&
    (process.arch === 'arm64' || process.arch === 'x64')) ||
  (process.platform === 'win32' && process.arch === 'x64')

/**
 * Assemble a one-page PDF from raw objects, fixing up the xref offsets. Built in
 * code rather than committed as a binary so the fixture stays inspectable.
 */
function buildPdf(objects: Buffer[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  const offsets: number[] = []
  let offset = chunks[0].length

  objects.forEach((body, index) => {
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    offsets.push(offset)
    offset += object.length
    chunks.push(object)
  })

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const entry of offsets) {
    xref += `${entry.toString().padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
  chunks.push(Buffer.from(xref))

  return Buffer.concat(chunks)
}

function stream(dict: string, body: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${body.length} >>\nstream\n`),
    body,
    Buffer.from('\nendstream')
  ])
}

/** A page holding one grayscale raster and no text operators — a scan, in miniature. */
function createScannedPdf(): Buffer {
  const size = 64
  const pixels = Buffer.alloc(size * size, 0xff)
  for (let row = 20; row < 44; row++) {
    pixels.fill(0x20, row * size, row * size + size)
  }

  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 552 552] ' +
        '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'
    ),
    stream(
      `/Type /XObject /Subtype /Image /Width ${size} /Height ${size} /ColorSpace /DeviceGray /BitsPerComponent 8`,
      pixels
    ),
    stream('', Buffer.from('q 480 0 0 480 36 36 cm /Im0 Do Q\n'))
  ])
}

/** The same page shape, but carrying a real text run. */
function createTextPdf(): Buffer {
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    stream('', Buffer.from('BT /F1 24 Tf 72 700 Td (Smoke title) Tj ET\n'))
  ])
}

async function convert(bytes: Buffer): Promise<Error | string> {
  const { toMarkdownBytes } = await import('@firecrawl/anydoc')
  try {
    return await toMarkdownBytes(bytes)
  } catch (error) {
    return error as Error
  }
}

/**
 * `isScannedPdfError` decides whether a PDF gets handed to the local OCR model, and it
 * can only go on anydoc's rejection message: the Rust `ConvertError` variant is flattened
 * to `code: 'GenericFailure'` crossing the napi boundary. These cases feed the real
 * binding's own errors back through the predicate, so an anydoc upgrade that rewords a
 * message — silently turning every scan into a hard failure, or every broken file into a
 * pointless multi-minute OCR run — fails here instead of in the field.
 */
describe.skipIf(!hasNativeBinding)('anydoc scanned-PDF detection', () => {
  it('routes a text-free PDF to OCR', async () => {
    const result = await convert(createScannedPdf())

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toContain('OCR is required')
    expect(isScannedPdfError(result)).toBe(true)
  })

  it('converts a PDF with a text layer instead of erroring', async () => {
    const result = await convert(createTextPdf())

    expect(result).not.toBeInstanceOf(Error)
    expect(result).toContain('Smoke title')
  })

  it.each([
    ['a structurally broken PDF', Buffer.from('%PDF-1.4\ngarbage')],
    ['a file that is not a PDF at all', Buffer.from('not a pdf at all')]
  ])('does not route %s to OCR', async (_label, bytes) => {
    const result = await convert(bytes)

    expect(result).toBeInstanceOf(Error)
    expect(isScannedPdfError(result)).toBe(false)
  })
})
