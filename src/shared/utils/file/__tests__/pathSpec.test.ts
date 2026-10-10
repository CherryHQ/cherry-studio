import { describe, expect, it } from 'vitest'

import { isPosixPath, isWindowsPath, parsePosixPath, parseWindowsPath } from '@shared/utils/file/pathSpec'

describe('parsePosixPath', () => {
  it.each([
    ['a/b', { isAbsolute: false, root: '', segments: ['a', 'b'] }],
    ['a//b', { isAbsolute: false, root: '', segments: ['a', 'b'] }],
    ['docs/', { isAbsolute: false, root: '', segments: ['docs'] }],
    ['./a/../b', { isAbsolute: false, root: '', segments: ['.', 'a', '..', 'b'] }],
    ['/a/b', { isAbsolute: true, root: '/', segments: ['a', 'b'] }],
    ['/', { isAbsolute: true, root: '/', segments: [] }],
    ['', { isAbsolute: false, root: '', segments: [] }]
  ])('parses %s', (value, expected) => {
    expect(parsePosixPath(value)).toEqual(expected)
  })

  it('treats backslash and colon as ordinary filename characters', () => {
    expect(parsePosixPath('a/b/c\\d.txt').segments).toEqual(['a', 'b', 'c\\d.txt'])
    expect(parsePosixPath('C:\\a').segments).toEqual(['C:\\a'])
    expect(parsePosixPath('C:\\a').isAbsolute).toBe(false)
  })
})

describe('parseWindowsPath', () => {
  it.each([
    ['a\\b', { isAbsolute: false, root: '', segments: ['a', 'b'] }],
    ['a/b', { isAbsolute: false, root: '', segments: ['a', 'b'] }],
    ['a\\b/c', { isAbsolute: false, root: '', segments: ['a', 'b', 'c'] }],
    ['C:\\a\\b', { isAbsolute: true, root: 'C:\\', segments: ['a', 'b'] }],
    ['C:/a', { isAbsolute: true, root: 'C:/', segments: ['a'] }],
    ['\\a', { isAbsolute: true, root: '\\', segments: ['a'] }],
    ['/a', { isAbsolute: true, root: '/', segments: ['a'] }],
    ['\\\\server\\share\\a', { isAbsolute: true, root: '\\\\server\\share', segments: ['a'] }]
  ])('parses %s', (value, expected) => {
    expect(parseWindowsPath(value)).toEqual(expected)
  })

  it('reports a drive-relative path as non-absolute but rooted', () => {
    // `C:foo` means "foo, relative to the working directory on drive C" — not a
    // portable relative path, and `C:` must not be mistaken for a segment.
    expect(parseWindowsPath('C:foo')).toEqual({ isAbsolute: false, root: 'C:', segments: ['foo'] })
  })

  it('reads any single letter before a colon as a drive, because Windows does', () => {
    // `a:b.txt` is drive A's `b.txt`, not a file named `a:b.txt` — so a colon
    // only looks like an illegal filename character when it is NOT in drive
    // position.
    expect(parseWindowsPath('a:b.txt')).toEqual({ isAbsolute: false, root: 'a:', segments: ['b.txt'] })
    expect(parseWindowsPath('ab:c.txt')).toEqual({ isAbsolute: false, root: '', segments: ['ab:c.txt'] })
  })
})

describe('the same string, two platforms', () => {
  it('splits a backslash-containing name differently', () => {
    expect(parsePosixPath('a/b/c\\d.txt').segments).toEqual(['a', 'b', 'c\\d.txt'])
    expect(parseWindowsPath('a/b/c\\d.txt').segments).toEqual(['a', 'b', 'c', 'd.txt'])
  })
})

describe('isPosixPath', () => {
  it.each([['a/b.txt'], ['a\\b.txt'], ['a:b.txt'], ['a<b'], ['CON.txt'], ['name.'], ['name '], ['./a/../b'], ['/abs']])(
    'accepts %s — POSIX forbids only / and NUL in a name',
    (value) => {
      expect(isPosixPath(value)).toBe(true)
    }
  )

  it('rejects a null byte', () => {
    expect(isPosixPath('a/b\0c')).toBe(false)
  })

  it('accepts an over-long segment — length is a capacity limit, not a syntax rule', () => {
    // Enforcing it here would make a value already stored in SQLite stop parsing on
    // read; too long fails at write time like a full disk does.
    expect(isPosixPath(`a/${'x'.repeat(256)}`)).toBe(true)
    expect(isWindowsPath(`a\\${'x'.repeat(256)}`)).toBe(true)
  })
})

describe('isWindowsPath', () => {
  it.each([['a\\b.txt'], ['a/b.txt'], ['C:\\a'], ['\\\\server\\share\\a'], ['./a/../b']])('accepts %s', (value) => {
    expect(isWindowsPath(value)).toBe(true)
  })

  it.each([
    ['a colon in a segment', 'ab:c.txt'],
    ['an angle bracket', 'a<b'],
    ['a reserved device name', 'CON.txt'],
    ['a reserved device name in a subdirectory', 'docs/COM1'],
    ['a trailing dot', 'name.'],
    ['a trailing space', 'name '],
    ['a null byte', 'a\0b'],
    ['a start-of-heading control char', 'ab'],
    ['a tab', 'a\tb'],
    ['a unit separator, the top of the control range', 'ab']
  ])('rejects %s', (_label, value) => {
    expect(isWindowsPath(value)).toBe(false)
  })

  it('rejects the whole ASCII control range, which POSIX allows', () => {
    // Win32 forbids U+0001–U+001F in a filename on top of NUL; POSIX forbids
    // only `/` and NUL, so the two predicates must disagree here.
    for (let code = 1; code <= 0x1f; code++) {
      const name = `a${String.fromCharCode(code)}b.txt`
      expect(isWindowsPath(name), `U+${code.toString(16).padStart(4, '0')}`).toBe(false)
      expect(isPosixPath(name), `U+${code.toString(16).padStart(4, '0')}`).toBe(true)
    }
  })

  it('does not mistake a drive root or UNC root for an illegal segment', () => {
    // `C:` and `\\server\share` are roots, not names — name rules must not apply.
    expect(isWindowsPath('C:\\docs\\a.txt')).toBe(true)
    expect(isWindowsPath('\\\\server\\share\\a.txt')).toBe(true)
  })

  it('does not name-check . or ..', () => {
    // `.` would fail the trailing-dot rule if treated as a filename.
    expect(isWindowsPath('a\\..\\b')).toBe(true)
    expect(isWindowsPath('.\\a')).toBe(true)
  })
})
