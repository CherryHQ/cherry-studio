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
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/Workspace/notes.md', ['/workspace'])).toBe(false)
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
    const { isPathWithinAccessiblePath } = await loadAccessiblePath(platform)

    expect(isPathWithinAccessiblePath('/Workspace/docs/notes.md', ['/workspace'])).toBe(true)
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
