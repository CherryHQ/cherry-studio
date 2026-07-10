import type { LoadParameters } from 'pdf-parse'

/**
 * Extract text content from PDF data.
 *
 * @param data - PDF content as Uint8Array, ArrayBuffer, base64-encoded string, or URL
 * @returns Extracted text content
 */
export async function extractPdfText(data: Uint8Array | ArrayBuffer | string | URL): Promise<string> {
  if (data instanceof URL) {
    const parser = await createPdfParser({ url: data.href })
    try {
      const result = await parser.getText()
      return result.text
    } finally {
      await parser.destroy()
    }
  }

  let buffer: Uint8Array
  if (typeof data === 'string') {
    // base64 string → Uint8Array
    const binaryString = atob(data)
    buffer = Uint8Array.from(binaryString, (c) => c.charCodeAt(0))
  } else if (data instanceof ArrayBuffer) {
    buffer = new Uint8Array(data)
  } else {
    buffer = data
  }

  const parser = await createPdfParser({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}

async function createPdfParser(options: LoadParameters) {
  // Loads @napi-rs/canvas DOM globals that pdf-parse expects in Electron main.
  const { CanvasFactory } = await import('pdf-parse/worker')
  const { PDFParse } = await import('pdf-parse')

  return new PDFParse({ ...options, CanvasFactory })
}
