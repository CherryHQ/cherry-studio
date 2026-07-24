/**
 * Text-file snapshot codec: decode raw bytes into an editable string while
 * preserving the byte-level details a round-trip must not lose (UTF-8 BOM,
 * CRLF vs LF), and encode an edited string back into the original byte shape.
 */

export type FileTextLineEnding = 'lf' | 'crlf'

/** Why a text file cannot be edited in place. `size` is enforced by the caller. */
export type UnsupportedFileTextReason = 'encoding' | 'mixed-line-endings' | 'size'

export class UnsupportedFileTextError extends Error {
  constructor(public readonly reason: UnsupportedFileTextReason) {
    super(`Text file editing is not supported (${reason})`)
    this.name = 'UnsupportedFileTextError'
  }
}

export interface DecodedFileText {
  content: string
  lineEnding: FileTextLineEnding
  hasBom: boolean
}

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= UTF8_BOM.length && UTF8_BOM.every((value, index) => bytes[index] === value)
}

/**
 * Decode UTF-8 bytes into an LF-normalized string, remembering the BOM and
 * line-ending style so `encodeFileText` can restore them.
 *
 * Throws `UnsupportedFileTextError` for non-UTF-8 / binary content (`encoding`)
 * or files that mix CRLF and lone CR/LF (`mixed-line-endings`).
 */
export function decodeFileText(bytes: Uint8Array): DecodedFileText {
  const hasBom = hasUtf8Bom(bytes)
  let content: string
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.slice(UTF8_BOM.length) : bytes)
  } catch {
    throw new UnsupportedFileTextError('encoding')
  }

  // NUL is a strong binary signal even when its byte sequence is technically valid UTF-8.
  if (content.includes('\0')) throw new UnsupportedFileTextError('encoding')

  const withoutCrlf = content.replace(/\r\n/g, '')
  const hasCrlf = content.includes('\r\n')
  if (withoutCrlf.includes('\r') || (hasCrlf && withoutCrlf.includes('\n'))) {
    throw new UnsupportedFileTextError('mixed-line-endings')
  }

  return {
    content: hasCrlf ? content.replace(/\r\n/g, '\n') : content,
    lineEnding: hasCrlf ? 'crlf' : 'lf',
    hasBom
  }
}

/** Encode an LF-normalized string back into bytes with the original EOL + BOM. */
export function encodeFileText(content: string, lineEnding: FileTextLineEnding, hasBom: boolean): Uint8Array {
  const normalized = content.replace(/\r\n?/g, '\n')
  const encoded = new TextEncoder().encode(lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized)
  if (!hasBom) return encoded

  const withBom = new Uint8Array(UTF8_BOM.length + encoded.length)
  withBom.set(UTF8_BOM)
  withBom.set(encoded, UTF8_BOM.length)
  return withBom
}
