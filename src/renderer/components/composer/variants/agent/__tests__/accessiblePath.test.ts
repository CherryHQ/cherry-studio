import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AbsoluteFilePath } from '@shared/types/file'

import { getAccessiblePathRelativePath, isPathWithinAccessiblePath } from '../accessiblePath'

/**
 * `getPathComparisonKey` is the only export here that reads the platform, so it
 * is the only one loaded through a module mock. The containment helpers are
 * platform-independent and use the static import above.
 */
async function loadWithPlatform(platform: { isMac: boolean; isWin: boolean; isLinux: boolean }) {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => platform)
  return import('../accessiblePath')
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

/** Fixture helper — these are shape-valid absolute paths, so the brand is safe to assert. */
const p = (value: string) => value as AbsoluteFilePath
const ps = (...values: string[]) => values as AbsoluteFilePath[]

describe('accessiblePath', () => {
  it('treats the base path itself and its descendants as within', () => {
    expect(isPathWithinAccessiblePath(p('/workspace'), ps('/workspace'))).toBe(true)
    expect(isPathWithinAccessiblePath(p('/workspace/docs/notes.md'), ps('/workspace'))).toBe(true)
  })

  it('rejects paths outside every accessible base', () => {
    expect(isPathWithinAccessiblePath(p('/other/notes.md'), ps('/workspace'))).toBe(false)
  })

  it('rejects a sibling directory that only shares a name prefix', () => {
    expect(isPathWithinAccessiblePath(p('/workspace-2/notes.md'), ps('/workspace'))).toBe(false)
  })

  it('resolves .. segments before comparing, closing the traversal gap', () => {
    expect(isPathWithinAccessiblePath(p('/workspace/../outside/secret.txt'), ps('/workspace'))).toBe(false)
  })

  it('is case-sensitive on every platform', () => {
    expect(isPathWithinAccessiblePath(p('/Workspace/notes.md'), ps('/workspace'))).toBe(false)
    expect(isPathWithinAccessiblePath(p('/Workspace/docs/notes.md'), ps('/workspace'))).toBe(false)
  })

  it('accepts Windows drive-letter paths with backslashes or forward slashes', () => {
    expect(isPathWithinAccessiblePath(p('C:/workspace/docs/notes.md'), ps('C:\\workspace'))).toBe(true)
    expect(isPathWithinAccessiblePath(p('c:\\workspace\\docs\\notes.md'), ps('C:/workspace'))).toBe(true)
  })

  it('matches against the POSIX filesystem root', () => {
    expect(isPathWithinAccessiblePath(p('/notes.md'), ps('/'))).toBe(true)
    expect(getAccessiblePathRelativePath(p('/notes.md'), ps('/'))).toBe('notes.md')
  })

  it('matches against a Windows drive root', () => {
    expect(isPathWithinAccessiblePath(p('C:/notes.md'), ps('C:\\'))).toBe(true)
  })

  it('rejects everything when there are no accessible paths', () => {
    expect(isPathWithinAccessiblePath(p('/workspace/notes.md'), ps())).toBe(false)
  })

  it('computes the relative path against the matching base', () => {
    expect(getAccessiblePathRelativePath(p('/workspace/docs/notes.md'), ps('/workspace'))).toBe('docs/notes.md')
  })

  it('returns the input unchanged when no base matches', () => {
    expect(getAccessiblePathRelativePath(p('/other/notes.md'), ps('/workspace'))).toBe('/other/notes.md')
  })

  // A POSIX file named `a\b.txt` must not be mistaken for `b.txt` inside `a/`:
  // that would classify an attachment as accessible and send a `file://`
  // reference pointing at a different file.
  it('does not treat a backslash in a POSIX filename as a directory separator', () => {
    expect(isPathWithinAccessiblePath(p('/workspace/a\\b.txt'), ps('/workspace/a'))).toBe(false)
    expect(getAccessiblePathRelativePath(p('/workspace/a\\b.txt'), ps('/workspace/a'))).toBe('/workspace/a\\b.txt')
  })

  it('still resolves such a file against a base that genuinely contains it', () => {
    expect(isPathWithinAccessiblePath(p('/workspace/a\\b.txt'), ps('/workspace'))).toBe(true)
    expect(getAccessiblePathRelativePath(p('/workspace/a\\b.txt'), ps('/workspace'))).toBe('a\\b.txt')
  })
})

describe('accessiblePath with un-canonicalizable input (UNC)', () => {
  // UNC is a valid `AbsoluteFilePath` but `canonicalizeFilePath` throws on it.
  // Containment is a predicate and must stay total: an un-canonicalizable path
  // is simply not provably inside anything. See
  // `docs/references/file/file-manager-architecture.md §1.2 "UNC paths"`.

  it('reports a UNC file path as not contained instead of throwing', () => {
    expect(() => isPathWithinAccessiblePath(p('\\\\server\\share\\notes.md'), ps('C:\\workspace'))).not.toThrow()
    expect(isPathWithinAccessiblePath(p('\\\\server\\share\\notes.md'), ps('C:\\workspace'))).toBe(false)
  })

  it('skips a UNC accessible base without discarding the usable ones', () => {
    expect(isPathWithinAccessiblePath(p('C:\\workspace\\notes.md'), ps('\\\\server\\share', 'C:\\workspace'))).toBe(
      true
    )
  })

  it('returns the path unchanged from getAccessiblePathRelativePath', () => {
    expect(getAccessiblePathRelativePath(p('\\\\server\\share\\notes.md'), ps('C:\\workspace'))).toBe(
      '\\\\server\\share\\notes.md'
    )
  })
})

describe('getPathComparisonKey', () => {
  const LINUX = { isMac: false, isWin: false, isLinux: true }
  const MACOS = { isMac: true, isWin: false, isLinux: false }

  it('is case-sensitive on a case-sensitive platform', async () => {
    const { getPathComparisonKey } = await loadWithPlatform(LINUX)

    expect(getPathComparisonKey('/Workspace/docs')).not.toBe(getPathComparisonKey('/workspace/docs'))
  })

  it('folds case on a case-insensitive platform, after canonicalization', async () => {
    const { getPathComparisonKey } = await loadWithPlatform(MACOS)

    expect(getPathComparisonKey('/Workspace/Docs/./')).toBe(getPathComparisonKey('/workspace/docs'))
  })

  // The two below are what keying through `toPathKey` gains over an
  // unconditional `\` → `/` fold: dedup must not merge paths that denote
  // different files.

  it('keeps a POSIX filename containing a backslash distinct from a nested path', async () => {
    const { getPathComparisonKey } = await loadWithPlatform(LINUX)

    expect(getPathComparisonKey('/workspace/a\\b.txt')).not.toBe(getPathComparisonKey('/workspace/a/b.txt'))
  })

  it('leaves an un-canonicalizable UNC path spelled as it came in', async () => {
    const { getPathComparisonKey } = await loadWithPlatform(LINUX)

    expect(getPathComparisonKey('\\\\server\\share\\a.txt')).toBe('\\\\server\\share\\a.txt')
  })

  it('falls back to the raw value for input that is not an absolute path', async () => {
    const { getPathComparisonKey } = await loadWithPlatform(LINUX)

    expect(getPathComparisonKey('')).toBe('')
    expect(getPathComparisonKey('docs/notes.md')).toBe('docs/notes.md')
  })
})
