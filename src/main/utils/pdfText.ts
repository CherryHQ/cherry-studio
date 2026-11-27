import { createPdfParser } from './pdf'

export function isScannedPdfError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'needsOcr'
}

export function isMalformedPdfError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'malformed'
}

export async function inspectPdfText(pdfBytes: Uint8Array): Promise<{ pageCount: number; hasTextlessPages: boolean }> {
  const parser = await createPdfParser({ data: new Uint8Array(pdfBytes) })
  try {
    const result = await parser.getText()
    return {
      pageCount: result.total,
      hasTextlessPages: result.pages.some((page) => page.text.trim().length === 0)
    }
  } finally {
    await parser.destroy()
  }
}

export async function extractPdfTextLayerMarkdown(pdfBytes: Uint8Array): Promise<string> {
  const parser = await createPdfParser({ data: new Uint8Array(pdfBytes) })
  try {
    const result = await parser.getText()
    return result.pages
      .map((page) => page.text.trim())
      .filter((text) => text.length > 0)
      .join('\n\n')
  } finally {
    await parser.destroy()
  }
}
