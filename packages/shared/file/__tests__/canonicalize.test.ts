/**
 * Equivalence tests for `canonicalizeAbsolutePath` — the shared, pure-JS
 * implementation that backs the FileEntry schema's `externalPath` refine.
 *
 * For inputs that match the host platform, the result must equal what the
 * main-side `path.resolve` + NFC + trailing-strip pipeline produces; this
 * keeps the canonicalize-on-write (main) and canonicalize-on-parse (schema)
 * sides in lockstep. Cross-platform cases (Windows-shaped paths processed on
 * POSIX hosts and vice versa) are pinned by handcrafted expectations because
 * `path.resolve` is host-aware and can't be used as the oracle there.
 */

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { canonicalizeAbsolutePath } from '../canonicalize'

function nodeCanonicalize(raw: string): string {
  let normalized = path.resolve(raw)
  normalized = normalized.normalize('NFC')
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

  it('NFC-normalizes Unicode', () => {
    const nfd = '/users/qué' // qu + e + combining acute
    const nfc = '/users/qué' // qu + é
    expect(canonicalizeAbsolutePath(nfd)).toBe(nfc)
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
