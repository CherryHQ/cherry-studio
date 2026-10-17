import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getArtifactPaneSelectionPath,
  getCopyableAbsolutePath,
  getPathBasename,
  resolveArtifactPaneFileSelection
} from '../artifactPanePath'

const platformState = vi.hoisted(() => ({ isWin: false }))

vi.mock('@renderer/utils/platform', () => ({
  get isWin() {
    return platformState.isWin
  }
}))

/** The main window has no Node `process`. Restore it even when the assertion throws. */
function withRendererProcessAbsent<T>(run: () => T): T {
  const realProcess = globalThis.process
  vi.stubGlobal('process', undefined)
  try {
    if (typeof process !== 'undefined') throw new Error('process stub did not hide the Node global')
    return run()
  } finally {
    vi.stubGlobal('process', realProcess)
  }
}

describe('artifactPanePath', () => {
  afterEach(() => {
    platformState.isWin = false
  })

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

  it('keeps a relative POSIX filename that contains a backslash when the renderer has no process', () => {
    platformState.isWin = false
    const selection = withRendererProcessAbsent(() => resolveArtifactPaneFileSelection('/tmp/workspace', 'a\\b.txt'))

    expect(selection).toEqual({ workspacePath: '/tmp/workspace', filePath: 'a\\b.txt' })
    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('/tmp/workspace/a\\b.txt')
  })

  it('does not re-root a POSIX filename whose backslash is adjacent to parent dots', () => {
    platformState.isWin = false
    const selection = withRendererProcessAbsent(() =>
      resolveArtifactPaneFileSelection('/tmp/workspace', 'subdir/a\\..\\b.txt')
    )

    expect(selection).toEqual({ workspacePath: '/tmp/workspace', filePath: 'subdir/a\\..\\b.txt' })
    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('/tmp/workspace/subdir/a\\..\\b.txt')
  })

  it('keeps a POSIX filename that is literally \\..\\b.txt, including its bytes on disk', () => {
    platformState.isWin = false
    if (process.platform === 'win32') return

    const root = mkdtempSync(join(tmpdir(), 'artifact-backslash-dots-'))
    const literalName = '\\..\\b.txt'
    const strippedName = '..\\b.txt'
    const literalFile = join(root, literalName)
    const strippedFile = join(root, strippedName)
    try {
      writeFileSync(literalFile, 'LITERAL BACKSLASH')
      writeFileSync(strippedFile, 'STRIPPED NAME')

      const selection = withRendererProcessAbsent(() => resolveArtifactPaneFileSelection(root, literalFile))
      const selectedPath = selection ? getArtifactPaneSelectionPath(selection) : null

      expect(selection).toEqual({ workspacePath: root, filePath: literalName })
      expect(selectedPath).toBe(literalFile)
      expect(readFileSync(selectedPath!, 'utf8')).toBe('LITERAL BACKSLASH')
      expect(readFileSync(strippedFile, 'utf8')).toBe('STRIPPED NAME')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps a POSIX root file on one slash, including a backslash in the filename', () => {
    const backslashName = resolveArtifactPaneFileSelection('/workspace', '/a\\b.txt')
    expect(backslashName).toEqual({ workspacePath: '/', filePath: 'a\\b.txt' })
    expect(backslashName && getArtifactPaneSelectionPath(backslashName)).toBe('/a\\b.txt')

    const simple = resolveArtifactPaneFileSelection('/workspace', '/file.txt')
    expect(simple).toEqual({ workspacePath: '/', filePath: 'file.txt' })
    expect(simple && getArtifactPaneSelectionPath(simple)).toBe('/file.txt')
  })

  it('keeps a Windows drive-root file on that drive', () => {
    const selection = resolveArtifactPaneFileSelection('C:/other', 'D:/report.md')

    expect(selection).toEqual({ workspacePath: 'D:/', filePath: 'report.md' })
    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('D:\\report.md')
  })

  it('folds a relative Windows path when the renderer platform is Windows and process is absent', () => {
    platformState.isWin = true
    const selection = withRendererProcessAbsent(() => resolveArtifactPaneFileSelection('D:/work', 'notes\\report.md'))

    expect(selection).toMatchObject({ workspacePath: 'D:/work', filePath: 'notes/report.md' })
    expect(selection && getArtifactPaneSelectionPath(selection)).toBe('D:\\work\\notes\\report.md')
  })

  it('keeps a trailing space on a POSIX directory and filename', () => {
    expect(resolveArtifactPaneFileSelection(undefined, '/tmp/notes /report ')).toEqual({
      workspacePath: '/tmp/notes ',
      filePath: 'report '
    })
    expect(resolveArtifactPaneFileSelection(undefined, '/var/only /report ')).toEqual({
      workspacePath: '/var/only ',
      filePath: 'report '
    })
  })

  it.skipIf(process.platform === 'win32')('reads the spaced filename when an unspaced sibling is also present', () => {
    // Bug: trimming a trailing space opens the sibling that has no space.
    const root = mkdtempSync(join(tmpdir(), 'artifact-space-sibling-'))
    const folder = join(root, 'notes ')
    const intendedFile = join(folder, 'report ')
    const siblingFile = join(folder, 'report')
    try {
      mkdirSync(folder)
      writeFileSync(intendedFile, 'INTENDED TRAILING SPACE FILE')
      writeFileSync(siblingFile, 'UNSPACED SIBLING FILE')

      const selection = resolveArtifactPaneFileSelection(undefined, intendedFile)
      const selectedPath = selection ? getArtifactPaneSelectionPath(selection) : ''

      expect(readFileSync(selectedPath, 'utf8')).toBe('INTENDED TRAILING SPACE FILE')
      expect(readFileSync(intendedFile, 'utf8')).toBe('INTENDED TRAILING SPACE FILE')
      expect(readFileSync(siblingFile, 'utf8')).toBe('UNSPACED SIBLING FILE')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')('reads the spaced filename when no unspaced sibling exists', () => {
    // Bug: trimming a trailing space builds a path that is not the file that was opened.
    const root = mkdtempSync(join(tmpdir(), 'artifact-space-only-'))
    const folder = join(root, 'notes ')
    const intendedFile = join(folder, 'report ')
    try {
      mkdirSync(folder)
      writeFileSync(intendedFile, 'INTENDED TRAILING SPACE FILE')

      const selection = resolveArtifactPaneFileSelection(undefined, intendedFile)
      const selectedPath = selection ? getArtifactPaneSelectionPath(selection) : ''

      expect(readFileSync(selectedPath, 'utf8')).toBe('INTENDED TRAILING SPACE FILE')
      expect(readFileSync(intendedFile, 'utf8')).toBe('INTENDED TRAILING SPACE FILE')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('getPathBasename', () => {
  const BS = String.fromCharCode(0x5c)

  afterEach(() => {
    platformState.isWin = false
  })

  // A POSIX `\` is a filename byte, so the title must not keep only the last segment.
  it('keeps a literal backslash in a POSIX filename', () => {
    expect(getPathBasename(`/tmp/clip${BS}part.mp4`)).toBe(`clip${BS}part.mp4`)
    expect(getPathBasename(`clip${BS}part.mp4`)).toBe(`clip${BS}part.mp4`)
  })

  it('keeps significant filename whitespace', () => {
    expect(getPathBasename('/tmp/report.md ')).toBe('report.md ')
    expect(getPathBasename('/tmp/notes /report.md')).toBe('report.md')
  })

  it('returns the drive and UNC basename', () => {
    expect(getPathBasename('C:\\work\\notes\\report.md')).toBe('report.md')
    expect(getPathBasename('\\\\server\\share\\docs\\clip.mp4')).toBe('clip.mp4')
  })

  it('returns the last slash segment of a normal relative path', () => {
    expect(getPathBasename('src/notes.md')).toBe('notes.md')
  })

  it('splits a relative Windows path only when the renderer is Windows', () => {
    platformState.isWin = true
    expect(getPathBasename('notes\\report.md')).toBe('report.md')
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
