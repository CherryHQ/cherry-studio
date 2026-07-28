import { describe, expect, it } from 'vitest'

import {
  isSafeRelativeSubpath,
  portableCollisionKey,
  RELATIVE_SUBPATH_LIMITS,
  RelativeSubpathSchema,
  toRelativeSegments
} from '../relativePath'

describe('isSafeRelativeSubpath', () => {
  it('accepts normalized relative subpaths', () => {
    for (const p of ['a', 'a/b', 'a/b/c.txt', 'Files/blob', 'Notes/root/note.md']) {
      expect(isSafeRelativeSubpath(p)).toBe(true)
    }
  })

  it('rejects non-strings and empty', () => {
    for (const p of [undefined, null, 42, '', {}]) {
      expect(isSafeRelativeSubpath(p as unknown)).toBe(false)
    }
  })

  it('rejects absolute paths (posix and windows drive)', () => {
    for (const p of ['/a', '/etc/passwd', 'C:/x', 'c:\\x', 'C:x']) {
      expect(isSafeRelativeSubpath(p)).toBe(false)
    }
  })

  it('rejects backslash and NUL', () => {
    expect(isSafeRelativeSubpath('a\\b')).toBe(false)
    expect(isSafeRelativeSubpath('a\0b')).toBe(false)
  })

  it('rejects traversal, current-dir, and empty segments', () => {
    for (const p of ['..', 'a/..', '../a', 'a/../b', '.', 'a/./b', 'a//b', 'a/', '/a/']) {
      expect(isSafeRelativeSubpath(p)).toBe(false)
    }
  })

  it('enforces length and depth limits', () => {
    const limits = { maxLength: 8, maxDepth: 3 }
    expect(isSafeRelativeSubpath('a/b/c', limits)).toBe(true)
    expect(isSafeRelativeSubpath('a/b/c/d', limits)).toBe(false) // depth 4 > 3
    expect(isSafeRelativeSubpath('abcdefghi', limits)).toBe(false) // length 9 > 8
  })

  it('has frozen default limits', () => {
    expect(Object.isFrozen(RELATIVE_SUBPATH_LIMITS)).toBe(true)
    expect(RELATIVE_SUBPATH_LIMITS.maxDepth).toBeGreaterThan(0)
    expect(RELATIVE_SUBPATH_LIMITS.maxLength).toBeGreaterThan(0)
  })

  it('rejects malformed UTF-16 before Node aliases it to the replacement character', () => {
    for (const path of ['a\ud800b', 'a\udfffb', '\ud800/name', 'name/\udfff']) {
      expect(isSafeRelativeSubpath(path)).toBe(false)
    }
    expect(isSafeRelativeSubpath('emoji-😀/file')).toBe(true)
  })

  it('rejects ASCII control characters (incl. 0x1F and DEL)', () => {
    expect(isSafeRelativeSubpath('a\x01b')).toBe(false)
    expect(isSafeRelativeSubpath('a\x1fb')).toBe(false)
    expect(isSafeRelativeSubpath('a\x7fb')).toBe(false)
    expect(isSafeRelativeSubpath('a\tb')).toBe(false)
  })

  it('rejects Windows-reserved characters', () => {
    for (const p of ['a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b']) {
      expect(isSafeRelativeSubpath(p)).toBe(false)
    }
  })

  it('rejects segments with a trailing dot or space (Windows aliasing)', () => {
    for (const p of ['a./b', 'a /b', 'dir/leaf.', 'dir/leaf ']) {
      expect(isSafeRelativeSubpath(p)).toBe(false)
    }
  })

  it('rejects Windows reserved device names (with or without extension, any case)', () => {
    for (const p of ['con', 'CON', 'con.txt', 'aux', 'nul', 'com1', 'LPT9', 'a/PRN/b', 'nul.md']) {
      expect(isSafeRelativeSubpath(p)).toBe(false)
    }
  })

  it('rejects the ISO-8859-1 superscript COM/LPT aliases reserved by Windows', () => {
    for (const p of ['COM¹', 'com².txt', 'Com³.log', 'LPT¹', 'lpt².md', 'Lpt³']) {
      expect(isSafeRelativeSubpath(p)).toBe(false)
    }
  })

  it('still accepts names that merely contain reserved stems', () => {
    for (const p of ['console/log', 'coma', 'coms/1', 'coma.txt', 'lpt10']) {
      expect(isSafeRelativeSubpath(p)).toBe(true)
    }
  })

  it('keeps digits, dashes, and dots inside names valid', () => {
    expect(isSafeRelativeSubpath('base-1/kb-2/file.name.md')).toBe(true)
  })
})

describe('portableCollisionKey', () => {
  it('folds case', () => {
    expect(portableCollisionKey('Data/Foo/A')).toBe(portableCollisionKey('data/foo/a'))
  })

  it('unifies NFC and NFD Unicode forms', () => {
    const nfc = 'caf\u00e9' // é precomposed (NFC)
    const nfd = 'cafe\u0301' // e + combining acute (NFD)
    expect(nfc).not.toBe(nfd)
    expect(portableCollisionKey(nfc)).toBe(portableCollisionKey(nfd))
  })

  it('keeps genuinely distinct paths distinct', () => {
    expect(portableCollisionKey('Data/a')).not.toBe(portableCollisionKey('Data/b'))
  })
})

describe('RelativeSubpathSchema', () => {
  it('mirrors the predicate', () => {
    expect(RelativeSubpathSchema.safeParse('a/b').success).toBe(true)
    expect(RelativeSubpathSchema.safeParse('/a').success).toBe(false)
    expect(RelativeSubpathSchema.safeParse('a/../b').success).toBe(false)
  })
})

describe('toRelativeSegments', () => {
  it('splits on slash', () => {
    expect(toRelativeSegments('a/b/c')).toEqual(['a', 'b', 'c'])
    expect(toRelativeSegments('a')).toEqual(['a'])
  })
})
