import { AbsoluteFilePathSchema } from '@shared/types/file'
import { describe, expect, it } from 'vitest'

/**
 * `AbsoluteFilePathSchema` is declared in `@shared/types/file/common` — a purely
 * declarative Zod chain, which [shared-layer-architecture §3.1](../../../../../docs/references/shared-layer-architecture.md)
 * permits to stay in `types/`. Its *behavioral* test cannot live there, though:
 * the same section allows only type-level tests under `types/`. So the suite
 * sits here, next to `canonicalize.test.ts`, which pins the `CanonicalFilePath`
 * half of the same contract.
 */

describe('AbsoluteFilePathSchema', () => {
  // AbsoluteFilePathSchema validates absolute-path SHAPE only and does NOT canonicalize:
  // `parse(x)` returns `x` byte-for-byte. Canonicalization (byte-faithful
  // lexical cleanup: segment-resolve + trailing-strip + drive-letter upcase,
  // NOT Unicode-normalized) is a separate concern owned by `canonicalizeFilePath`
  // / `CanonicalFilePathSchema` — its behavior is pinned in
  // `@shared/utils/file/__tests__/canonicalize.test.ts`.

  it('returns a POSIX absolute path unchanged', () => {
    expect(AbsoluteFilePathSchema.parse('/Users/me/doc.pdf')).toBe('/Users/me/doc.pdf')
  })

  it('returns a Windows backslash absolute path unchanged', () => {
    expect(AbsoluteFilePathSchema.parse('C:\\Users\\me\\doc.pdf')).toBe('C:\\Users\\me\\doc.pdf')
  })

  it('accepts a Windows forward-slash absolute path and returns it unchanged (no backslash conversion)', () => {
    expect(AbsoluteFilePathSchema.parse('C:/Users/me/doc.pdf')).toBe('C:/Users/me/doc.pdf')
  })

  it('does NOT NFC-normalize decomposed (NFD) input — returns it unchanged', () => {
    const nfd = '/Users/me/cafe\u0301.txt' // "cafe\u0301" as e + U+0301 combining acute (NFD)
    expect(AbsoluteFilePathSchema.parse(nfd)).toBe(nfd)
  })

  it('does NOT strip a trailing separator — returns it unchanged', () => {
    expect(AbsoluteFilePathSchema.parse('/foo/bar/')).toBe('/foo/bar/')
  })

  it('does NOT resolve . and .. segments — returns them unchanged', () => {
    expect(AbsoluteFilePathSchema.parse('/foo/./baz/../bar')).toBe('/foo/./baz/../bar')
  })

  it('rejects a relative path', () => {
    expect(AbsoluteFilePathSchema.safeParse('foo/bar').success).toBe(false)
    expect(AbsoluteFilePathSchema.safeParse('./foo').success).toBe(false)
  })

  it('rejects a file:// URL', () => {
    expect(AbsoluteFilePathSchema.safeParse('file:///Users/me/doc.pdf').success).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(AbsoluteFilePathSchema.safeParse('').success).toBe(false)
  })

  it('rejects a null byte', () => {
    expect(AbsoluteFilePathSchema.safeParse('/foo/\0bar').success).toBe(false)
  })
})
