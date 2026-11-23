import { createPdfParser } from './pdf'

export function isScannedPdfError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'needsOcr'
}

export async function inspectPdfText(
  pdfBytes: Uint8Array,
  timeoutMs?: number
): Promise<{ pageCount: number; hasTextlessPages: boolean }> {
  const parser = await createPdfParser({ data: new Uint8Array(pdfBytes) })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await (timeoutMs === undefined
      ? parser.getText()
      : Promise.race([
          parser.getText(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('PDF inspection timed out')), timeoutMs)
          })
        ]))
    return {
      pageCount: result.total,
      hasTextlessPages: result.pages.some((page) => page.text.trim().length === 0)
    }
  } finally {
    clearTimeout(timeout)
    await parser.destroy()
  }
}
