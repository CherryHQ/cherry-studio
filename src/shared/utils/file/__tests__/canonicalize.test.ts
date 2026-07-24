/**
 * Tests for the canonical layer's public surface: `canonicalizeFilePath` (the
 * branding factory), `CanonicalFilePathSchema` (assert-only validation), and
 * `isCanonicalFilePath` (the predicate). The canonicalization algorithm itself
 * is module-private and is exercised transitively through `canonicalizeFilePath`,
 * whose runtime result is exactly the canonicalized string (the brand is a
 * compile-time phantom).
 *
 * For inputs that match the host platform, the factory result must equal what
 * the main-side `path.resolve` + trailing-strip pipeline produces
 * (byte-faithful, NO Unicode normalization); this keeps the canonicalize-on-write
 * path (applied at the external-path boundary) and the schema's canonical-
 * equivalence assertion in lockstep. Cross-platform cases (Windows-shaped paths
 * processed on POSIX hosts and vice versa) are pinned by handcrafted
 * expectations because `path.resolve` is host-aware and can't be the oracle there.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { CanonicalFilePathSchema, canonicalizeFilePath, isCanonicalFilePath } from '../canonicalize'

// Byte-distinct NFD/NFC forms of ".../qué", written with ASCII \u escapes so the
// literals stay stable across editors/formatters (a precomposed source char
// would make the byte-faithfulness assertion tautological).
const QUE_NFD = '/users/qu\u0065\u0301' // q u e + U+0301 combining acute (NFD)
const QUE_NFC = '/users/qu\u00e9' // q u e-precomposed (NFC)

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

describe('canonicalizeFilePath — POSIX', () => {
  it('rejects null bytes', () => {
    expect(() => canonicalizeFilePath('/foo/bar\0/baz')).toThrow(/null byte/i)
  })

  it('rejects non-absolute input', () => {
    expect(() => canonicalizeFilePath('foo/bar')).toThrow(/absolute/i)
  })

  it('collapses `.` and `..` segments', () => {
    expect(canonicalizeFilePath('/foo/./bar/../baz')).toBe('/foo/baz')
  })

  it('strips trailing separator (except root)', () => {
    expect(canonicalizeFilePath('/foo/bar/')).toBe('/foo/bar')
    expect(canonicalizeFilePath('/')).toBe('/')
  })

  it('collapses repeated separators', () => {
    expect(canonicalizeFilePath('/foo//bar')).toBe('/foo/bar')
  })

  it('does NOT Unicode-normalize — returns decomposed (NFD) input byte-faithfully unchanged', () => {
    // An NFD path stays NFD so it still reaches the real file on
    // normalization-sensitive filesystems (Linux ext4), never folded to NFC.
    expect(QUE_NFD).not.toBe(QUE_NFC) // byte-distinct inputs
    expect(canonicalizeFilePath(QUE_NFD)).toBe(QUE_NFD)
  })

  it('matches node:path on the host platform for representative inputs', () => {
    if (process.platform === 'win32') return // skipped on win32 (host expects \-paths)
    for (const raw of ['/foo/bar', '/foo/./bar/../baz', '/foo/bar/', '/foo//bar', '/']) {
      expect(canonicalizeFilePath(raw)).toBe(nodeCanonicalize(raw))
    }
  })
})

describe('canonicalizeFilePath — Windows', () => {
  it('uppercases the drive letter and uses backslash separators', () => {
    expect(canonicalizeFilePath('c:\\Foo\\Bar')).toBe('C:\\Foo\\Bar')
  })

  it('treats `/` and `\\` interchangeably as segment separators', () => {
    expect(canonicalizeFilePath('C:\\foo/bar\\baz')).toBe('C:\\foo\\bar\\baz')
  })

  it('collapses `.` and `..` segments', () => {
    expect(canonicalizeFilePath('C:\\foo\\.\\bar\\..\\baz')).toBe('C:\\foo\\baz')
  })

  it('strips trailing separator (except drive root)', () => {
    expect(canonicalizeFilePath('C:\\foo\\')).toBe('C:\\foo')
    expect(canonicalizeFilePath('C:\\')).toBe('C:\\')
  })
})

describe('CanonicalFilePathSchema (assert-only, no repair)', () => {
  // Backs the FileEntry `externalPath` read path: an already-canonical value is
  // accepted unchanged; a non-canonical one is REJECTED (never silently
  // repaired), so historically non-canonical rows warn-skip rather than mutate
  // the lookup/dedup key.
  it('accepts an already-canonical path and returns it unchanged', () => {
    expect(CanonicalFilePathSchema.parse('/foo/bar')).toBe('/foo/bar')
    expect(CanonicalFilePathSchema.parse('C:\\Foo\\Bar')).toBe('C:\\Foo\\Bar')
  })

  it('accepts a byte-faithful (NFD) canonical path unchanged', () => {
    expect(CanonicalFilePathSchema.parse(QUE_NFD)).toBe(QUE_NFD)
  })

  it('rejects a non-canonical path (unresolved `.` / `..`)', () => {
    expect(CanonicalFilePathSchema.safeParse('/foo/./bar').success).toBe(false)
    expect(CanonicalFilePathSchema.safeParse('/foo/bar/../baz').success).toBe(false)
  })

  it('rejects a trailing-separator path', () => {
    expect(CanonicalFilePathSchema.safeParse('/foo/bar/').success).toBe(false)
  })

  it('rejects a lowercase Windows drive letter (non-canonical)', () => {
    expect(CanonicalFilePathSchema.safeParse('c:\\Foo\\Bar').success).toBe(false)
  })

  it('rejects non-absolute / null-byte input', () => {
    expect(CanonicalFilePathSchema.safeParse('foo/bar').success).toBe(false)
    expect(CanonicalFilePathSchema.safeParse('/foo/\0bar').success).toBe(false)
  })
})

describe('isCanonicalFilePath', () => {
  it('is true for already-canonical paths', () => {
    expect(isCanonicalFilePath('/foo/bar')).toBe(true)
    expect(isCanonicalFilePath('C:\\Foo\\Bar')).toBe(true)
  })

  it('is false for non-canonical paths', () => {
    expect(isCanonicalFilePath('/foo/./bar')).toBe(false)
    expect(isCanonicalFilePath('/foo/bar/')).toBe(false)
    expect(isCanonicalFilePath('c:\\Foo\\Bar')).toBe(false)
  })

  it('is false (does not throw) for structurally invalid input', () => {
    expect(isCanonicalFilePath('foo/bar')).toBe(false)
    expect(isCanonicalFilePath('/foo/\0bar')).toBe(false)
  })
})
