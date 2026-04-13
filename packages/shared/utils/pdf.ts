import { PDFParse } from 'pdf-parse'

export const MAX_INLINE_PDF_TEXT_BYTES = 4 * 1024 * 1024
export const PDF_TRUNCATED_SUFFIX = '\n[PDF truncated]'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function getUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).length
}

export function truncateUtf8Text(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text.length === 0) {
    return ''
  }

  const encoded = textEncoder.encode(text)
  if (encoded.length <= maxBytes) {
    return text
  }

  let truncated = textDecoder.decode(encoded.slice(0, maxBytes))
  while (getUtf8ByteLength(truncated) > maxBytes && truncated.length > 0) {
    truncated = truncated.slice(0, -1)
  }

  return truncated
}

export function buildPdfPromptText(
  fileName: string,
  textContent: string,
  maxBytes: number = MAX_INLINE_PDF_TEXT_BYTES
): { text: string; truncated: boolean } | null {
  if (maxBytes <= 0) {
    return null
  }

  const normalizedContent = textContent.trim()
  const prefix = `${fileName}\n`
  const prefixBytes = getUtf8ByteLength(prefix)
  const fullText = `${prefix}${normalizedContent}`

  if (getUtf8ByteLength(fullText) <= maxBytes) {
    return { text: fullText, truncated: false }
  }

  const suffixBytes = getUtf8ByteLength(PDF_TRUNCATED_SUFFIX)
  const contentBudget = maxBytes - prefixBytes - suffixBytes

  if (contentBudget <= 0) {
    return null
  }

  const truncatedContent = truncateUtf8Text(normalizedContent, contentBudget)
  const text = `${prefix}${truncatedContent}${PDF_TRUNCATED_SUFFIX}`

  if (getUtf8ByteLength(text) <= maxBytes) {
    return { text, truncated: true }
  }

  const compactText = truncateUtf8Text(text, maxBytes)
  return compactText ? { text: compactText, truncated: true } : null
}

/**
 * Extract text content from PDF data.
 * Works in both Node.js and browser environments (pdf-parse 2.x).
 *
 * @param data - PDF content as Uint8Array, ArrayBuffer, base64-encoded string, or URL
 * @returns Extracted text content
 */
export async function extractPdfText(data: Uint8Array | ArrayBuffer | string | URL): Promise<string> {
  if (data instanceof URL) {
    const parser = new PDFParse({ url: data.href })
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

  const parser = new PDFParse({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}
