type PDFParseConstructor = typeof import('pdf-parse').PDFParse

let PDFParse: PDFParseConstructor | null = null

function ensureNodeDOMMatrixPolyfill() {
  if (typeof DOMMatrix !== 'undefined') {
    return
  }

  // Minimal DOMMatrix shim for Node/Electron main process.
  class NodeDOMMatrix {
    multiplySelf() {
      return this
    }
    preMultiplySelf() {
      return this
    }
    invertSelf() {
      return this
    }
    translate() {
      return this
    }
    scale() {
      return this
    }
  }

  ;(globalThis as { DOMMatrix?: unknown }).DOMMatrix = NodeDOMMatrix
}

async function getPDFParse(): Promise<PDFParseConstructor> {
  if (PDFParse) {
    return PDFParse
  }

  ensureNodeDOMMatrixPolyfill()
  const mod = await import('pdf-parse')
  PDFParse = mod.PDFParse
  return PDFParse
}

/**
 * Extract text content from PDF data.
 * Works in both Node.js and browser environments (pdf-parse 2.x).
 *
 * @param data - PDF content as Uint8Array, ArrayBuffer, base64-encoded string, or URL
 * @returns Extracted text content
 */
export async function extractPdfText(data: Uint8Array | ArrayBuffer | string | URL): Promise<string> {
  const PDFParse = await getPDFParse()

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
