import type { PosixPath, WindowsPath } from '@shared/utils/file/pathSpec'
import {
  type PosixRelativeFilePath,
  PosixRelativeFilePathSchema,
  type RelativeFilePath,
  resolvePosixRelativeSegments,
  resolveWindowsRelativeSegments,
  type WindowsRelativeFilePath,
  WindowsRelativeFilePathSchema
} from '@shared/utils/file/relativeFilePath'
import { describe, expect, it } from 'vitest'

const accepts = (schema: { safeParse: (v: string) => { success: boolean } }, value: string) =>
  schema.safeParse(value).success

describe('PosixRelativeFilePathSchema — structure', () => {
  it.each([
    ['single segment', 'a.pdf'],
    ['multi segment', 'docs/a.pdf'],
    ['the base itself', '.'],
    ['a climb landing back on the base', 'a/..'],
    ['an interior climb', 'a/../b'],
    ['an explicit here-prefix', './a'],
    ['repeated separators', 'a//b'],
    ['a trailing separator', 'docs/'],
    ['non-ASCII segments', '中文/文件.pdf'],
    ['a leading space, which is a legal filename character', ' a.pdf'],
    ['a backslash, legal in a POSIX filename', 'a\\b.txt'],
    ['a name that is only legal on POSIX', 'a<b'],
    // Containment is not this brand's business — see the block below.
    ['a climb above the base', '../x'],
    ['a bare climb', '..'],
    ['a climb that escapes after descending', 'a/../../b'],
    ['a leading backslash, one POSIX filename', '\\foo'],
    ['a drive-looking prefix, one POSIX filename', 'C:foo']
  ])('accepts %s', (_label, value) => {
    expect(accepts(PosixRelativeFilePathSchema, value)).toBe(true)
  })

  it.each([
    ['the empty string', ''],
    ['a POSIX absolute path', '/x'],
    ['the POSIX root', '/']
  ])('rejects %s', (_label, value) => {
    expect(accepts(PosixRelativeFilePathSchema, value)).toBe(false)
  })

  it('does not judge containment — `../x` is a relative path that points outside', () => {
    // The brands answer "is this anchored to a root", nothing more. Whether a
    // climb-out is allowed belongs to whoever owns the base; `resolve*Segments`
    // returns null so that owner has something to check.
    expect(accepts(PosixRelativeFilePathSchema, '../x')).toBe(true)
    expect(resolvePosixRelativeSegments('../x')).toBeNull()
  })

  it('accepts a control character, which is a legal POSIX filename byte', () => {
    // The Windows leaf refuses these; POSIX forbids only `/` and NUL.
    expect(accepts(PosixRelativeFilePathSchema, 'a\u0001b.txt')).toBe(true)
    expect(accepts(WindowsRelativeFilePathSchema, 'a\u0001b.txt')).toBe(false)
  })

  it('rejects a NUL byte, which no filesystem could hold', () => {
    // The reason there is no standalone "structurally relative" brand: `a\0b` is
    // non-empty and unanchored, yet cannot exist on any filesystem. Segment
    // legality only exists per platform, so only a leaf can rule it out.
    expect(accepts(PosixRelativeFilePathSchema, 'a\0b')).toBe(false)
  })

  it('accepts an over-long segment, which is a capacity limit rather than a syntax error', () => {
    expect(accepts(PosixRelativeFilePathSchema, 'x'.repeat(300))).toBe(true)
  })

  it('returns the input unchanged — no trimming, no normalization', () => {
    expect(PosixRelativeFilePathSchema.parse(' a.pdf')).toBe(' a.pdf')
    expect(PosixRelativeFilePathSchema.parse('a//b')).toBe('a//b')
    expect(PosixRelativeFilePathSchema.parse('a/../b')).toBe('a/../b')
    expect(PosixRelativeFilePathSchema.parse('docs\\a.pdf')).toBe('docs\\a.pdf')
  })
})

describe('PosixRelativeFilePathSchema — segment legality', () => {
  it.each([
    ['a backslash as one filename', 'a\\b.txt'],
    ['a colon, legal on macOS and Linux alike', 'a:b.txt'],
    ['a Windows-illegal character', 'a<b'],
    ['a Windows reserved device name', 'CON.txt'],
    ['a trailing dot', 'name.'],
    ['a nested path', 'docs/sub/a.pdf']
  ])('accepts %s', (_label, value) => {
    expect(accepts(PosixRelativeFilePathSchema, value)).toBe(true)
  })

  it.each([
    ['an absolute path', '/x'],
    ['the empty string', ''],
    ['a null byte', 'a\0b']
  ])('rejects %s', (_label, value) => {
    expect(accepts(PosixRelativeFilePathSchema, value)).toBe(false)
  })

  it('accepts a climb-out, which is a relative path like any other', () => {
    expect(accepts(PosixRelativeFilePathSchema, '../x')).toBe(true)
  })
})

describe('WindowsRelativeFilePathSchema', () => {
  it.each([
    ['a backslash-separated path', 'a\\b.txt'],
    ['a forward-slash path', 'docs/a.pdf'],
    ['an interior climb', 'a\\..\\b'],
    ['a climb out, which containment — not this brand — would refuse', '..\\x']
  ])('accepts %s', (_label, value) => {
    expect(accepts(WindowsRelativeFilePathSchema, value)).toBe(true)
  })

  it.each([
    ['a leading separator, absolute on the current drive', '\\foo'],
    ['a drive-relative path', 'C:foo'],
    ['a drive-absolute path', 'C:\\foo'],
    ['a single letter before a colon, which Windows reads as a drive', 'a:b.txt'],
    ['a colon inside a segment', 'ab:c.txt'],
    ['a Windows-illegal character', 'a<b'],
    ['a reserved device name', 'CON.txt'],
    ['a trailing dot', 'name.'],
    ['a trailing space', 'name ']
  ])('rejects %s', (_label, value) => {
    expect(accepts(WindowsRelativeFilePathSchema, value)).toBe(false)
  })
})

describe('where the two sub-brands disagree', () => {
  // Each of these is the reason the union brand alone is not a useful guarantee.
  it.each([
    ['\\foo', 'one POSIX filename; current-drive-absolute on Windows'],
    ['C:foo', 'one POSIX filename; drive-relative, so anchored, on Windows'],
    ['a<b', 'a POSIX filename; an illegal character on Windows'],
    ['CON.txt', 'a POSIX filename; a reserved device name on Windows'],
    ['name.', 'a POSIX filename; a trailing dot on Windows'],
    ['ab:c.txt', 'a POSIX filename; an illegal character on Windows']
  ])('%s is POSIX-only — %s', (value) => {
    expect(accepts(PosixRelativeFilePathSchema, value)).toBe(true)
    expect(accepts(WindowsRelativeFilePathSchema, value)).toBe(false)
  })

  it('nests as value sets but not as types — the brand records the reading', () => {
    // Every Windows-relative string is also POSIX-relative: POSIX only refuses the
    // empty string, a leading `/`, and NUL, all of which Windows refuses too. The
    // brands stay distinct because they mean different readings of the same string.
    const both = 'a\\b.txt'
    expect(accepts(WindowsRelativeFilePathSchema, both)).toBe(true)
    expect(accepts(PosixRelativeFilePathSchema, both)).toBe(true)
    expect(resolveWindowsRelativeSegments(both)).toEqual(['a', 'b.txt'])
    expect(resolvePosixRelativeSegments(both)).toEqual(['a\\b.txt'])
  })

  it('nests as value sets but not as types — the brand records the reading', () => {
    // Every Windows-relative string is also POSIX-relative: POSIX only refuses the
    // empty string, a leading `/`, and NUL, all of which Windows refuses too. The
    // brands stay distinct because they mean different readings of the same string.
    const both = 'a\\b.txt'
    expect(accepts(WindowsRelativeFilePathSchema, both)).toBe(true)
    expect(accepts(PosixRelativeFilePathSchema, both)).toBe(true)
    expect(resolveWindowsRelativeSegments(both)).toEqual(['a', 'b.txt'])
    expect(resolvePosixRelativeSegments(both)).toEqual(['a\\b.txt'])
  })

  it('splits a backslash name into two segments only on Windows', () => {
    expect(resolvePosixRelativeSegments('a/b/c\\d.txt')).toEqual(['a', 'b', 'c\\d.txt'])
    expect(resolveWindowsRelativeSegments('a/b/c\\d.txt')).toEqual(['a', 'b', 'c', 'd.txt'])
  })
})

describe('resolvePosixRelativeSegments', () => {
  it.each([
    ['a/b', ['a', 'b']],
    ['a//b', ['a', 'b']],
    ['./a', ['a']],
    ['a/./b', ['a', 'b']],
    ['a/../b', ['b']],
    ['docs/', ['docs']],
    ['.', []],
    ['a/..', []]
  ])('resolves %s', (value, expected) => {
    expect(resolvePosixRelativeSegments(value)).toEqual(expected)
  })

  it.each([['../a'], ['..'], ['a/../../b'], ['/a'], [''], ['a\0b']])('returns null for %s', (value) => {
    expect(resolvePosixRelativeSegments(value)).toBeNull()
  })

  it('distinguishes the base itself from an escape', () => {
    // Empty array = "the base"; null = "not a relative path at all".
    expect(resolvePosixRelativeSegments('.')).toEqual([])
    expect(resolvePosixRelativeSegments('..')).toBeNull()
  })
})

describe('brand assignability', () => {
  it('lets either leaf stand in for the union type', () => {
    const fromPosix: RelativeFilePath = PosixRelativeFilePathSchema.parse('docs/a.pdf')
    const fromWindows: RelativeFilePath = WindowsRelativeFilePathSchema.parse('docs\\a.pdf')
    expect([fromPosix, fromWindows]).toEqual(['docs/a.pdf', 'docs\\a.pdf'])
  })

  it('lets a leaf stand in for the bare spec brand it refines', () => {
    // The reason each leaf refines its platform's schema instead of getting a lone
    // brand: a consumer that only cares about syntax takes these without re-parsing.
    const asPosixPath: PosixPath = PosixRelativeFilePathSchema.parse('docs/a.pdf')
    const asWindowsPath: WindowsPath = WindowsRelativeFilePathSchema.parse('docs\\a.pdf')
    expect([asPosixPath, asWindowsPath]).toEqual(['docs/a.pdf', 'docs\\a.pdf'])
  })

  it('does not let the union stand in for either leaf', () => {
    // Taken as a parameter, not a `const` initialised from a leaf: control flow
    // analysis would narrow the latter straight back and the check would pass
    // vacuously.
    const takesUnion = (union: RelativeFilePath) => {
      // @ts-expect-error — the union does not say which reading validated it.
      const asPosix: PosixRelativeFilePath = union
      return asPosix
    }
    expect(takesUnion(PosixRelativeFilePathSchema.parse('docs/a.pdf'))).toBe('docs/a.pdf')
  })

  it('keeps the two leaves mutually exclusive', () => {
    const posix = PosixRelativeFilePathSchema.parse('a\\b.txt')
    // @ts-expect-error — POSIX legality says nothing about Windows legality.
    const asWindows: WindowsRelativeFilePath = posix
    // @ts-expect-error — likewise for the bare spec brand.
    const asWindowsPath: WindowsPath = posix
    expect([asWindows, asWindowsPath]).toEqual(['a\\b.txt', 'a\\b.txt'])
  })
})
