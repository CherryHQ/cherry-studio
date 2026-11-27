import { PDFDocument, StandardFonts } from 'pdf-lib'
import { describe, expect, it } from 'vitest'

import { extractPdfTextLayerMarkdown, isMalformedPdfError } from '../pdfText'

const CNKI_TRAILER_XML =
  '<FileProperty><Title>Sample Article</Title><Author>CNKI</Author><Source>Journal</Source><Year>2026</Year></FileProperty>'

async function createTextPdf(pages: string[]): Promise<Uint8Array> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)

  for (const text of pages) {
    const page = document.addPage()
    if (text.length > 0) {
      page.drawText(text, { x: 72, y: 700, size: 14, font })
    }
  }

  return document.save()
}

describe('isMalformedPdfError', () => {
  it('returns true for an Error with code malformed', () => {
    const error = Object.assign(new Error("malformed document: couldn't parse input: invalid file trailer"), {
      code: 'malformed'
    })
    expect(isMalformedPdfError(error)).toBe(true)
  })

  it.each([
    Object.assign(new Error('page 1 needs OCR'), { code: 'needsOcr' }),
    Object.assign(new Error('document is encrypted'), { code: 'encrypted' }),
    new Error('malformed document'),
    { code: 'malformed' },
    null,
    undefined
  ])('returns false for non-malformed error value: %j', (value) => {
    expect(isMalformedPdfError(value)).toBe(false)
  })
})

describe('extractPdfTextLayerMarkdown', () => {
  it('extracts page text joined by double newlines and drops blank pages', async () => {
    const twoPagePdf = await createTextPdf(['First page text', 'Second page text'])
    await expect(extractPdfTextLayerMarkdown(twoPagePdf)).resolves.toBe('First page text\n\nSecond page text')

    const pdfWithBlankPage = await createTextPdf(['First page text', '', 'Third page text'])
    await expect(extractPdfTextLayerMarkdown(pdfWithBlankPage)).resolves.toBe('First page text\n\nThird page text')
  })

  it('extracts text from a PDF with CNKI-style FileProperty XML appended after %%EOF', async () => {
    const pdfBytes = await createTextPdf(['First page text', 'Second page text'])
    const withTrailingXml = Buffer.concat([pdfBytes, Buffer.from(CNKI_TRAILER_XML, 'utf8')])

    await expect(extractPdfTextLayerMarkdown(withTrailingXml)).resolves.toBe('First page text\n\nSecond page text')
  })
})
