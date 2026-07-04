import { describe, expect, it } from 'vitest'

import { FilePathSchema } from '../common'

describe('FilePathSchema', () => {
  it('accepts a POSIX absolute path unchanged (already canonical)', () => {
    expect(FilePathSchema.parse('/Users/me/doc.pdf')).toBe('/Users/me/doc.pdf')
  })

  it('accepts a Windows backslash absolute path unchanged', () => {
    expect(FilePathSchema.parse('C:\\Users\\me\\doc.pdf')).toBe('C:\\Users\\me\\doc.pdf')
  })

  it('accepts a Windows forward-slash absolute path and canonicalizes to backslash', () => {
    expect(FilePathSchema.parse('C:/Users/me/doc.pdf')).toBe('C:\\Users\\me\\doc.pdf')
  })

  it('NFC-normalizes decomposed (NFD) input', () => {
    const nfd = '/Users/me/cafe\u0301.txt' // "café" as e + U+0301 combining acute (NFD)
    const nfc = '/Users/me/caf\u00e9.txt' // "café" with precomposed U+00E9 (NFC)
    expect(FilePathSchema.parse(nfd)).toBe(nfc)
  })

  it('strips a trailing separator', () => {
    expect(FilePathSchema.parse('/foo/bar/')).toBe('/foo/bar')
  })

  it('resolves . and .. segments', () => {
    expect(FilePathSchema.parse('/foo/./baz/../bar')).toBe('/foo/bar')
  })

  it('is idempotent', () => {
    const once = FilePathSchema.parse('/foo/../bar/')
    expect(FilePathSchema.parse(once)).toBe(once)
  })

  it('rejects a relative path', () => {
    expect(FilePathSchema.safeParse('foo/bar').success).toBe(false)
    expect(FilePathSchema.safeParse('./foo').success).toBe(false)
  })

  it('rejects a file:// URL', () => {
    expect(FilePathSchema.safeParse('file:///Users/me/doc.pdf').success).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(FilePathSchema.safeParse('').success).toBe(false)
  })

  it('rejects a null byte', () => {
    expect(FilePathSchema.safeParse('/foo/\0bar').success).toBe(false)
  })
})
