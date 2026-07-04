import { describe, expect, it } from 'vitest'

import { FilePathSchema } from '../common'

describe('FilePathSchema', () => {
  // FilePathSchema validates absolute-path SHAPE only and does NOT canonicalize:
  // `parse(x)` returns `x` byte-for-byte. Canonicalization (NFC + segment
  // resolve + trailing-strip + drive-letter upcase) is a separate concern owned
  // by `canonicalizeFilePath` / `canonicalizeAbsolutePath` — its behavior is
  // pinned in `@shared/utils/file/__tests__/canonicalize.test.ts`.

  it('returns a POSIX absolute path unchanged', () => {
    expect(FilePathSchema.parse('/Users/me/doc.pdf')).toBe('/Users/me/doc.pdf')
  })

  it('returns a Windows backslash absolute path unchanged', () => {
    expect(FilePathSchema.parse('C:\\Users\\me\\doc.pdf')).toBe('C:\\Users\\me\\doc.pdf')
  })

  it('accepts a Windows forward-slash absolute path and returns it unchanged (no backslash conversion)', () => {
    expect(FilePathSchema.parse('C:/Users/me/doc.pdf')).toBe('C:/Users/me/doc.pdf')
  })

  it('does NOT NFC-normalize decomposed (NFD) input — returns it unchanged', () => {
    const nfd = '/Users/me/cafe\u0301.txt' // "cafe\u0301" as e + U+0301 combining acute (NFD)
    expect(FilePathSchema.parse(nfd)).toBe(nfd)
  })

  it('does NOT strip a trailing separator — returns it unchanged', () => {
    expect(FilePathSchema.parse('/foo/bar/')).toBe('/foo/bar/')
  })

  it('does NOT resolve . and .. segments — returns them unchanged', () => {
    expect(FilePathSchema.parse('/foo/./baz/../bar')).toBe('/foo/./baz/../bar')
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
