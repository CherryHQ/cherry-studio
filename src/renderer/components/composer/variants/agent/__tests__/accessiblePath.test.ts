import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadAccessiblePath(platform: { isMac: boolean; isWin: boolean; isLinux: boolean }) {
  vi.resetModules()
  vi.doMock('@renderer/utils/platform', () => platform)
  return import('../accessiblePath')
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('accessiblePath on a case-sensitive platform (linux)', () => {
  const platform = { isMac: false, isWin: false, isLinux: true }

  it('treats the base path itself and its descendants as within', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/workspace', ['/workspace'])).toBe(true)
    expect(isPathWithinAccessiblePath('/workspace/docs/notes.md', ['/workspace'])).toBe(true)
  })

  it('rejects paths outside every accessible base', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/other/notes.md', ['/workspace'])).toBe(false)
    expect(isPathWithinAccessiblePath('/workspace-2/notes.md', ['/workspace'])).toBe(false)
  })

  it('resolves .. segments before comparing, closing the traversal gap', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/workspace/../outside/secret.txt', ['/workspace'])).toBe(false)
  })

  it('is case-sensitive', async () => {
    const { getPathComparisonKey, isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/Workspace/notes.md', ['/workspace'])).toBe(false)
    expect(getPathComparisonKey('/Workspace/docs')).not.toBe(getPathComparisonKey('/workspace/docs'))
  })

  it('computes the relative path against the matching base', async () => {
    const { getAccessiblePathRelativePath } = await loadAccessiblePath(platform)

    expect(getAccessiblePathRelativePath('/workspace/docs/notes.md', ['/workspace'])).toBe('docs/notes.md')
  })

  it('returns the input unchanged when no base matches', async () => {
    const { getAccessiblePathRelativePath } = await loadAccessiblePath(platform)

    expect(getAccessiblePathRelativePath('/other/notes.md', ['/workspace'])).toBe('/other/notes.md')
  })

  it('matches against the POSIX filesystem root', async () => {
    const { isPathWithinAccessiblePath, getAccessiblePathRelativePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/notes.md', ['/'])).toBe(true)
    expect(getAccessiblePathRelativePath('/notes.md', ['/'])).toBe('notes.md')
  })

  it('rejects everything when there are no accessible paths', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/workspace/notes.md', [])).toBe(false)
  })
})

describe('accessiblePath on a case-insensitive platform (macOS/Windows)', () => {
  const platform = { isMac: true, isWin: false, isLinux: false }

  it('matches regardless of case', async () => {
    const { getPathComparisonKey, isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/Workspace/docs/notes.md', ['/workspace'])).toBe(true)
    expect(getPathComparisonKey('/Workspace/Docs/./')).toBe(getPathComparisonKey('/workspace/docs'))
  })

  it('accepts Windows drive-letter paths with backslashes or forward slashes', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('C:/workspace/docs/notes.md', ['C:\\workspace'])).toBe(true)
    expect(isPathWithinAccessiblePath('c:\\workspace\\docs\\notes.md', ['C:/workspace'])).toBe(true)
  })

  it('rejects a sibling directory that only shares a name prefix', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/workspace-2/notes.md', ['/workspace'])).toBe(false)
  })

  it('matches against a Windows drive root', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('C:/notes.md', ['C:\\'])).toBe(true)
  })
})

describe('accessiblePath with un-canonicalizable input (UNC)', () => {
  // UNC is a valid `AbsoluteFilePath` but `canonicalizeFilePath` throws on it.
  // Containment is a predicate and must stay total: an un-canonicalizable path
  // is simply not provably inside anything. See
  // `docs/references/file/file-manager-architecture.md §1.2 "UNC paths"`.
  const platform = { isMac: false, isWin: true, isLinux: false }

  it('reports a UNC file path as not contained instead of throwing', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(() => isPathWithinAccessiblePath('\\\\server\\share\\notes.md', ['C:\\workspace'])).not.toThrow()
    expect(isPathWithinAccessiblePath('\\\\server\\share\\notes.md', ['C:\\workspace'])).toBe(false)
  })

  it('skips a UNC accessible base without discarding the usable ones', async () => {
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('C:\\workspace\\notes.md', ['\\\\server\\share', 'C:\\workspace'])).toBe(true)
  })

  it('returns the path unchanged from getAccessiblePathRelativePath', async () => {
    const { getAccessiblePathRelativePath } = await loadAccessiblePath(platform)

    expect(getAccessiblePathRelativePath('\\\\server\\share\\notes.md', ['C:\\workspace'])).toBe(
      '\\\\server\\share\\notes.md'
    )
  })
})
