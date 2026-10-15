import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

  it('preserves a UNC file outside the current workspace', () => {
    const selection = resolveArtifactPaneFileSelection('D:/work', '\\\\server\\share\\docs\\report.md')

    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('\\\\server\\share\\docs\\report.md')
  })

  it('folds a Windows drive path that uses backslash separators onto that same file', () => {
    const selection = resolveArtifactPaneFileSelection('D:/work', 'D:\\work\\notes\\report.md')

    expect(selection).toMatchObject({ workspacePath: 'D:/work', filePath: 'notes/report.md' })
    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('D:\\work\\notes\\report.md')
  })

  it('selects the POSIX file whose name contains a backslash, not the slash-normalized path', () => {
    const original = '/tmp/a\\b.txt'
    const selection = resolveArtifactPaneFileSelection('/workspace', original)

    expect(selection && getArtifactPaneSelectionPath(selection)).toBe(original)

    if (process.platform === 'win32') return

    const root = mkdtempSync(join(tmpdir(), 'artifact-backslash-'))
    const originalFile = join(root, 'a\\b.txt')
    const differentFile = join(root, 'a', 'b.txt')
    try {
      mkdirSync(join(root, 'a'))
      writeFileSync(originalFile, 'CORRECT ORIGINAL')
      writeFileSync(differentFile, 'DIFFERENT FILE')

      const liveSelection = resolveArtifactPaneFileSelection(root, originalFile)
      const selectedPath = liveSelection ? getArtifactPaneSelectionPath(liveSelection) : null

      expect(selectedPath).toBe(originalFile)
      expect(readFileSync(selectedPath!, 'utf8')).toBe('CORRECT ORIGINAL')
      expect(readFileSync(differentFile, 'utf8')).toBe('DIFFERENT FILE')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
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
