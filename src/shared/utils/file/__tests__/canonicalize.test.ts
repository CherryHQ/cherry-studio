/**
 * Equivalence tests for `canonicalizeAbsolutePath` — the shared, pure-JS
 * implementation that backs the FileEntry schema's `externalPath` refine.
 *
 * For inputs that match the host platform, the result must equal what the
 * main-side `path.resolve` + trailing-strip pipeline produces (byte-faithful,
 * NO Unicode normalization); this keeps the canonicalize-on-write path
 * (`canonicalizeFilePath`, applied at the external-path boundary) and the
 * schema's `externalPath` canonical-equivalence refine in lockstep.
 * Cross-platform cases (Windows-shaped paths processed on POSIX hosts and vice
 * versa) are pinned by handcrafted expectations because `path.resolve` is
 * host-aware and can't be used as the oracle there.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { canonicalizeAbsolutePath, canonicalizeFilePath } from '../canonicalize'

function nodeCanonicalize(raw: string): string {
  // Byte-faithful: `path.resolve` (segment resolve) + trailing-strip only.
  // No `.normalize('NFC')` — canonicalization deliberately preserves the
  // exact bytes so the path reaches the real file on every filesystem.
  let normalized = path.resolve(raw)
  if (normalized.length > 1 && (normalized.endsWith(path.sep) || normalized.endsWith('/'))) {
    normalized = normalized.slice(0, -1)
  }
  return normalized
}

describe('canonicalizeAbsolutePath — POSIX', () => {
  it('rejects null bytes', () => {
    expect(() => canonicalizeAbsolutePath('/foo/bar\0/baz')).toThrow(/null byte/i)
  })

  it('rejects non-absolute input', () => {
    expect(() => canonicalizeAbsolutePath('foo/bar')).toThrow(/absolute/i)
  })

  it('collapses `.` and `..` segments', () => {
    expect(canonicalizeAbsolutePath('/foo/./bar/../baz')).toBe('/foo/baz')
  })

  it('strips trailing separator (except root)', () => {
    expect(canonicalizeAbsolutePath('/foo/bar/')).toBe('/foo/bar')
    expect(canonicalizeAbsolutePath('/')).toBe('/')
  })

  it('collapses repeated separators', () => {
    expect(canonicalizeAbsolutePath('/foo//bar')).toBe('/foo/bar')
  })

  it('does NOT Unicode-normalize \u2014 returns decomposed (NFD) input byte-faithfully unchanged', () => {
    // Canonicalization is byte-faithful: an NFD path stays NFD so it still
    // reaches the real file on normalization-sensitive filesystems (Linux
    // ext4). ASCII \\u escapes keep the literals stable across tooling.
    const nfd = '/users/qu\u0065\u0301' // qu + e + combining acute (NFD)
    const nfc = '/users/qu\u00E9' // qu + e-precomposed (NFC)
    expect(nfd).not.toBe(nfc) // byte-distinct inputs
    expect(canonicalizeAbsolutePath(nfd)).toBe(nfd) // unchanged, NOT folded to NFC
  })

  it('matches node:path on the host platform for representative inputs', () => {
    if (process.platform === 'win32') return // skipped on win32 (host expects \-paths)
    for (const raw of ['/foo/bar', '/foo/./bar/../baz', '/foo/bar/', '/foo//bar', '/']) {
      expect(canonicalizeAbsolutePath(raw)).toBe(nodeCanonicalize(raw))
    }
  })
})

describe('canonicalizeAbsolutePath — Windows', () => {
  it('uppercases the drive letter and uses backslash separators', () => {
    expect(canonicalizeAbsolutePath('c:\\Foo\\Bar')).toBe('C:\\Foo\\Bar')
  })

  it('treats `/` and `\\` interchangeably as segment separators', () => {
    expect(canonicalizeAbsolutePath('C:\\foo/bar\\baz')).toBe('C:\\foo\\bar\\baz')
  })

  it('collapses `.` and `..` segments', () => {
    expect(canonicalizeAbsolutePath('C:\\foo\\.\\bar\\..\\baz')).toBe('C:\\foo\\baz')
  })

  it('strips trailing separator (except drive root)', () => {
    expect(canonicalizeAbsolutePath('C:\\foo\\')).toBe('C:\\foo')
    expect(canonicalizeAbsolutePath('C:\\')).toBe('C:\\')
  })
})

describe('canonicalizeFilePath (branding factory)', () => {
  // The sole sanctioned producer of the CanonicalFilePath brand. At runtime it
  // is exactly canonicalizeAbsolutePath + a phantom (compile-time) brand.
  it('returns the canonicalized string (same result as canonicalizeAbsolutePath)', () => {
    expect(canonicalizeFilePath('/foo/./bar/../baz')).toBe('/foo/baz')
    expect(canonicalizeFilePath('/foo/bar/')).toBe('/foo/bar')
  })

  it('throws on non-absolute / null-byte input (delegated to canonicalizeAbsolutePath)', () => {
    expect(() => canonicalizeFilePath('foo/bar')).toThrow(/absolute/i)
    expect(() => canonicalizeFilePath('/foo/\0bar')).toThrow(/null byte/i)
  })
})
