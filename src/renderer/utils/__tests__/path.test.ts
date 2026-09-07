import type { AbsoluteFilePath } from '@shared/types/file'
import { PosixRelativeFilePathSchema } from '@shared/utils/file'
import { describe, expect, it } from 'vitest'

import { getRelativePath, isPathInside, isSamePath } from '../path'

/** Fixture helper — these are shape-valid absolute paths, so the brand is safe to assert. */
const p = (value: string) => value as AbsoluteFilePath

describe('isSamePath', () => {
  it('treats a path as the same as itself', () => {
    expect(isSamePath(p('/workspace/notes.md'), p('/workspace/notes.md'))).toBe(true)
  })

  it('resolves . and .. segments before comparing', () => {
    expect(isSamePath(p('/workspace/./docs/../notes.md'), p('/workspace/notes.md'))).toBe(true)
  })

  it('ignores a trailing separator', () => {
    expect(isSamePath(p('/workspace/'), p('/workspace'))).toBe(true)
  })

  it('treats the POSIX root as the same as itself', () => {
    expect(isSamePath(p('/'), p('/'))).toBe(true)
  })

  it('ignores Windows drive-letter case and separator style', () => {
    expect(isSamePath(p('c:\\workspace\\notes.md'), p('C:/workspace/notes.md'))).toBe(true)
  })

  it('is case-sensitive on the path body', () => {
    expect(isSamePath(p('/Workspace/notes.md'), p('/workspace/notes.md'))).toBe(false)
  })

  it('rejects different paths', () => {
    expect(isSamePath(p('/workspace/a.md'), p('/workspace/b.md'))).toBe(false)
  })

  it('reports byte-identical UNC paths as not provably the same, rather than throwing', () => {
    const unc = p('\\\\server\\share\\notes.md')

    expect(() => isSamePath(unc, unc)).not.toThrow()
    expect(isSamePath(unc, unc)).toBe(false)
  })
})

describe('isPathInside', () => {
  it('reports a descendant as inside', () => {
    expect(isPathInside(p('/workspace/docs/notes.md'), p('/workspace'))).toBe(true)
  })

  it('is strict: a path is not inside itself', () => {
    expect(isPathInside(p('/workspace'), p('/workspace'))).toBe(false)
  })

  it('rejects a sibling that only shares a name prefix', () => {
    expect(isPathInside(p('/workspace-2/notes.md'), p('/workspace'))).toBe(false)
  })

  it('resolves .. before comparing, so a traversal escape is not inside', () => {
    expect(isPathInside(p('/workspace/../outside/secret.txt'), p('/workspace'))).toBe(false)
  })

  it('reports a path as inside the POSIX root', () => {
    expect(isPathInside(p('/notes.md'), p('/'))).toBe(true)
  })

  it('reports a path as inside its Windows drive root', () => {
    expect(isPathInside(p('C:/notes.md'), p('C:\\'))).toBe(true)
  })

  it('matches across separator styles', () => {
    expect(isPathInside(p('c:\\workspace\\docs\\notes.md'), p('C:/workspace'))).toBe(true)
  })

  it('reports an un-canonicalizable child as not inside, rather than throwing', () => {
    expect(() => isPathInside(p('\\\\server\\share\\notes.md'), p('C:\\workspace'))).not.toThrow()
    expect(isPathInside(p('\\\\server\\share\\notes.md'), p('C:\\workspace'))).toBe(false)
  })

  it('reports nothing as inside an un-canonicalizable parent, rather than throwing', () => {
    expect(isPathInside(p('C:\\workspace\\notes.md'), p('\\\\server\\share'))).toBe(false)
  })
})

describe('getRelativePath', () => {
  it('returns the remainder for a descendant', () => {
    expect(getRelativePath(p('/workspace'), p('/workspace/docs/notes.md'))).toBe('docs/notes.md')
  })

  // `.` denotes the base; the empty string is the ABSENCE of a path (`open("")`
  // is ENOENT while `.` resolves), which is why `PosixRelativeFilePathSchema`
  // rejects it. See its "`.` is a relative path; the empty string is not".
  it('returns "." for the base itself', () => {
    expect(getRelativePath(p('/workspace'), p('/workspace'))).toBe('.')
  })

  it('returns null for a path outside the base', () => {
    expect(getRelativePath(p('/workspace'), p('/other/notes.md'))).toBe(null)
  })

  it('returns null for a sibling that only shares a name prefix', () => {
    expect(getRelativePath(p('/workspace'), p('/workspace-2/notes.md'))).toBe(null)
  })

  it('computes against the POSIX root', () => {
    expect(getRelativePath(p('/'), p('/notes.md'))).toBe('notes.md')
  })

  it('computes against a Windows drive root', () => {
    expect(getRelativePath(p('C:\\'), p('C:/notes.md'))).toBe('notes.md')
  })

  it('returns a forward-slash relative path for Windows inputs', () => {
    expect(getRelativePath(p('C:/workspace'), p('c:\\workspace\\docs\\notes.md'))).toBe('docs/notes.md')
  })

  it('returns null when either side is un-canonicalizable, rather than throwing', () => {
    expect(() => getRelativePath(p('C:\\workspace'), p('\\\\server\\share\\notes.md'))).not.toThrow()
    expect(getRelativePath(p('C:\\workspace'), p('\\\\server\\share\\notes.md'))).toBe(null)
    expect(getRelativePath(p('\\\\server\\share'), p('C:\\workspace\\notes.md'))).toBe(null)
  })
})

// `getRelativePath` asserts the `PosixRelativeFilePath` brand rather than
// re-parsing, on the argument that its output cannot fail the schema: NUL is
// already refused by `AbsoluteFilePathSchema`, canonicalization drops empty
// segments, and neither branch can leave a `/` inside a segment. These cases
// are that argument's guard — if a branch ever produces something the schema
// refuses, the brand becomes a lie and one of these fails.
describe('getRelativePath output satisfies PosixRelativeFilePathSchema', () => {
  const parses = (value: string | null) => {
    expect(value).not.toBeNull()
    return PosixRelativeFilePathSchema.safeParse(value).success
  }

  it('holds for a nested POSIX descendant', () => {
    expect(parses(getRelativePath(p('/workspace'), p('/workspace/docs/notes.md')))).toBe(true)
  })

  it('holds for the base itself', () => {
    expect(parses(getRelativePath(p('/workspace'), p('/workspace')))).toBe(true)
  })

  it('holds for a Windows descendant, whose separators are folded to "/"', () => {
    expect(parses(getRelativePath(p('C:/workspace'), p('c:\\workspace\\docs\\notes.md')))).toBe(true)
  })

  it('holds for a POSIX filename containing a backslash, which stays one segment', () => {
    const relative = getRelativePath(p('/workspace'), p('/workspace/a\\b.txt'))
    expect(parses(relative)).toBe(true)
    expect(PosixRelativeFilePathSchema.parse(relative)).toBe('a\\b.txt')
  })

  it('holds against a filesystem root, where the base already ends in a separator', () => {
    expect(parses(getRelativePath(p('/'), p('/notes.md')))).toBe(true)
    expect(parses(getRelativePath(p('C:\\'), p('C:/notes.md')))).toBe(true)
  })
})

// On POSIX a backslash is an ordinary filename character, not a separator, so
// `/workspace/a\b.txt` is ONE file named `a\b.txt` — not `b.txt` inside `a`.
// `canonicalizeFilePath` already models this (its POSIX branch splits on `/`
// only), and these primitives must not undo it.
describe('POSIX paths containing a literal backslash', () => {
  const backslashName = '/workspace/a\\b.txt'

  it('does not treat a backslash in a filename as a separator', () => {
    expect(isSamePath(p(backslashName), p('/workspace/a/b.txt'))).toBe(false)
    expect(isPathInside(p(backslashName), p('/workspace/a'))).toBe(false)
    expect(getRelativePath(p('/workspace/a'), p(backslashName))).toBe(null)
  })

  it('still matches such a path against itself', () => {
    expect(isSamePath(p(backslashName), p(backslashName))).toBe(true)
  })

  it('still resolves genuine containment for such a path', () => {
    expect(isPathInside(p(backslashName), p('/workspace'))).toBe(true)
    expect(getRelativePath(p('/workspace'), p(backslashName))).toBe('a\\b.txt')
  })

  it('does not confuse a backslash name with a real directory of the same spelling', () => {
    expect(isPathInside(p('/workspace/a/b.txt'), p('/workspace/a'))).toBe(true)
    expect(isSamePath(p('/workspace/a/b.txt'), p(backslashName))).toBe(false)
  })
})

// `//server/share` is the forward-slash spelling of UNC on Windows and is
// implementation-defined on POSIX. `canonicalizeFilePath` collapses the leading
// `//` to `/`, which would otherwise make it compare equal to an unrelated
// POSIX path, so it gets the same verdict as `\\server\share`: not provable.
describe('double-slash (forward-slash UNC) paths', () => {
  it('is not the same as the single-slash path it collapses to', () => {
    expect(isSamePath(p('//server/share/a.txt'), p('/server/share/a.txt'))).toBe(false)
  })

  it('is not provably the same as itself', () => {
    expect(isSamePath(p('//server/share/a.txt'), p('//server/share/a.txt'))).toBe(false)
  })

  it('is not provably inside anything, on either side', () => {
    expect(isPathInside(p('//server/share/a.txt'), p('//server/share'))).toBe(false)
    expect(isPathInside(p('//server/share/a.txt'), p('/server'))).toBe(false)
    expect(isPathInside(p('/server/share/a.txt'), p('//server/share'))).toBe(false)
  })

  it('yields no relative path, on either side', () => {
    expect(getRelativePath(p('//server/share'), p('//server/share/a.txt'))).toBe(null)
    expect(getRelativePath(p('/server/share'), p('//server/share/a.txt'))).toBe(null)
  })
})
