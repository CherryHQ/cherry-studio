import { describe, expect, it } from 'vitest'

import type { UnsupportedFileTextReason } from '../fileTextSnapshot'
import { decodeFileText, encodeFileText, UnsupportedFileTextError } from '../fileTextSnapshot'

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

/** Capture the reason of the `UnsupportedFileTextError` a synchronous decode throws. */
function reasonOf(bytes: Uint8Array): UnsupportedFileTextReason | undefined {
  try {
    decodeFileText(bytes)
  } catch (error) {
    return error instanceof UnsupportedFileTextError ? error.reason : undefined
  }
  return undefined
}

function utf8(content: string): Uint8Array {
  return new TextEncoder().encode(content)
}

function withUtf8Bom(content: string): Uint8Array {
  const encoded = utf8(content)
  const result = new Uint8Array(UTF8_BOM.length + encoded.length)
  result.set(UTF8_BOM)
  result.set(encoded, UTF8_BOM.length)
  return result
}

describe('decodeFileText', () => {
  it('decodes plain LF UTF-8 without a BOM', () => {
    expect(decodeFileText(utf8('hello\nworld\n'))).toEqual({
      content: 'hello\nworld\n',
      lineEnding: 'lf',
      hasBom: false
    })
  })

  it('normalizes CRLF to LF and remembers the CRLF style + BOM', () => {
    expect(decodeFileText(withUtf8Bom('first\r\nsecond\r\n'))).toEqual({
      content: 'first\nsecond\n',
      lineEnding: 'crlf',
      hasBom: true
    })
  })

  it('rejects invalid UTF-8 as an encoding error', () => {
    // GBK bytes for "你好" are not valid UTF-8.
    expect(reasonOf(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]))).toBe('encoding')
  })

  it('rejects content containing a NUL byte as binary', () => {
    expect(reasonOf(utf8('valid\0binary'))).toBe('encoding')
  })

  it('rejects files that mix CRLF and lone LF', () => {
    expect(reasonOf(utf8('first\r\nsecond\n'))).toBe('mixed-line-endings')
  })

  it('rejects a lone CR', () => {
    expect(reasonOf(utf8('first\rsecond'))).toBe('mixed-line-endings')
  })
})

describe('encodeFileText round-trip', () => {
  it('restores CRLF + BOM byte-for-byte', () => {
    const bytes = withUtf8Bom('first\r\nsecond\r\n')
    const decoded = decodeFileText(bytes)
    const reencoded = encodeFileText(decoded.content, decoded.lineEnding, decoded.hasBom)
    expect(reencoded).toEqual(bytes)
  })

  it('restores plain LF without a BOM', () => {
    const bytes = utf8('a\nb\n')
    const decoded = decodeFileText(bytes)
    expect(encodeFileText(decoded.content, decoded.lineEnding, decoded.hasBom)).toEqual(bytes)
  })

  it('re-applies CRLF to edited content', () => {
    expect(encodeFileText('changed\ncontent\n', 'crlf', true)).toEqual(withUtf8Bom('changed\r\ncontent\r\n'))
  })
})
