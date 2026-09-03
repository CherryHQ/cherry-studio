import { describe, expect, it } from 'vitest'

import {
  getArtifactPaneSelectionPath,
  getCopyableAbsolutePath,
  resolveArtifactPaneFileSelection
} from '../artifactPanePath'

describe('artifactPanePath', () => {
  it('repairs a Windows drive-root artifact path missing its slash before previewing', () => {
    const selection = resolveArtifactPaneFileSelection(
      'D:/cherry/Data/Agents/system/session',
      'D:cherry/Data/Agents/system/session/新认识论.md'
    )

    expect(selection && getArtifactPaneSelectionPath(selection)).toBe(
      'D:\\cherry\\Data\\Agents\\system\\session\\新认识论.md'
    )
  })

  it('keeps colon-prefixed artifact paths relative in a POSIX workspace', () => {
    const selection = resolveArtifactPaneFileSelection('/tmp/workspace', 'D:notes/report.md')

    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('/tmp/workspace/D:notes/report.md')
  })

  it('rejects an ambiguous Windows drive-relative path instead of redirecting it to the drive root', () => {
    expect(resolveArtifactPaneFileSelection('D:/work', 'D:notes/report.md')).toBeNull()
  })

  it.each(['\\\\server\\share\\report.md', '//server/share/report.md'])(
    'rejects UNC paths that cannot survive the artifact path canonicalizer: %s',
    (path) => {
      expect(resolveArtifactPaneFileSelection(undefined, path)).toBeNull()
      expect(resolveArtifactPaneFileSelection('/tmp/workspace', path)).toBeNull()
    }
  )
})

describe('getCopyableAbsolutePath', () => {
  it('folds a Windows drive path joined with forward slashes to native separators', () => {
    expect(getCopyableAbsolutePath('C:\\workspace/docs/report.md', true)).toBe('C:\\workspace\\docs\\report.md')
  })

  it('preserves a forward-slash UNC root and folds it to the native spelling on Windows', () => {
    expect(getCopyableAbsolutePath('//server/share/docs/report.md', true)).toBe('\\\\server\\share\\docs\\report.md')
  })

  it('repairs mixed separators under a backslash UNC root on Windows', () => {
    expect(getCopyableAbsolutePath('\\\\server\\share/docs/report.md', true)).toBe('\\\\server\\share\\docs\\report.md')
  })

  it('copies the workspace root path itself in native form on Windows', () => {
    expect(getCopyableAbsolutePath('D:/cherry/Data/Agents/system/session', true)).toBe(
      'D:\\cherry\\Data\\Agents\\system\\session'
    )
  })

  it('returns POSIX paths verbatim, keeping backslash filename characters intact', () => {
    expect(getCopyableAbsolutePath('/tmp/workspace/a\\b.txt', false)).toBe('/tmp/workspace/a\\b.txt')
    expect(getCopyableAbsolutePath('/tmp/workspace', false)).toBe('/tmp/workspace')
  })

  it('never resolves dot segments, whose lexical collapse can change the target across symlinks', () => {
    expect(getCopyableAbsolutePath('/workspace/link/../file.md', false)).toBe('/workspace/link/../file.md')
    expect(getCopyableAbsolutePath('C:/workspace/./link/../file.md', true)).toBe('C:\\workspace\\.\\link\\..\\file.md')
  })
})
