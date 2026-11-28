import { describe, expect, it } from 'vitest'

import { safeEntryExt, safeEntryName, videoExtFromMime } from '../ImportService'

// These helpers previously used regex literals containing \0, which oxlint's
// no-control-regex rule flags. They now build the same patterns from code
// points; these tests pin the exact sanitization behavior so the lint fix
// cannot change what the importer accepts or strips.
const NUL = String.fromCharCode(0)

describe('safeEntryName', () => {
  it('replaces path separators and control characters with underscores', () => {
    expect(safeEntryName(`a/b\\c${NUL}d.png`, 'attachment')).toBe('a_b_c_d.png')
  })

  it('trims, falls back on empty or dot-only names, and caps at 255 characters', () => {
    expect(safeEntryName('  spaced.png  ', 'attachment')).toBe('spaced.png')
    expect(safeEntryName('', 'attachment')).toBe('attachment')
    expect(safeEntryName(undefined, 'attachment')).toBe('attachment')
    expect(safeEntryName('.', 'attachment')).toBe('attachment')
    expect(safeEntryName('..', 'attachment')).toBe('attachment')
    expect(safeEntryName('x'.repeat(300), 'attachment')).toHaveLength(255)
  })
})

describe('safeEntryExt', () => {
  it('accepts a bare SafeExt-compatible extension', () => {
    expect(safeEntryExt('photo.PNG')).toBe('PNG')
    expect(safeEntryExt('archive.tar.gz')).toBe('gz')
  })

  it('rejects missing, path-like, whitespace, and control-character extensions', () => {
    expect(safeEntryExt('noext')).toBeNull()

    expect(safeEntryExt('a.b/c')).toBeNull()
    expect(safeEntryExt('a.b c')).toBeNull()
    expect(safeEntryExt(`a.b${NUL}c`)).toBeNull()
    expect(safeEntryExt(`a.${'b'.repeat(256)}`)).toBeNull()
  })
})

describe('videoExtFromMime', () => {
  it('maps video mime subtypes to bare extensions', () => {
    expect(videoExtFromMime('video/mp4')).toBe('mp4')
    expect(videoExtFromMime('video/quicktime')).toBe('quicktime')
  })

  it('rejects non-video mimes and unsafe subtypes', () => {
    expect(videoExtFromMime('image/png')).toBeNull()
    expect(videoExtFromMime('video/x y')).toBeNull()
    expect(videoExtFromMime(`video/x${NUL}y`)).toBeNull()
    expect(videoExtFromMime('video/a/b')).toBeNull()
  })
})
