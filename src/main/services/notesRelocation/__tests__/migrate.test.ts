import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { application } from '@application'

import { inspectNotesRelocation, migrateNotesDirectory } from '../migrate'
import { assertNotesRelocationPaths } from '../validation'

function migrateWithPreferenceSource(
  sourcePath: string,
  targetPath: string,
  options: { merge: boolean }
): ReturnType<typeof migrateNotesDirectory> {
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', sourcePath)
  return migrateNotesDirectory(sourcePath, targetPath, options)
}

describe('notesRelocation', () => {
  let tempRoot: string
  let defaultNotesDir: string

  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-relocation-'))
    defaultNotesDir = path.join(tempRoot, 'default-notes')
    fs.mkdirSync(defaultNotesDir, { recursive: true })
    fs.mkdirSync(path.join(tempRoot, 'appdata'), { recursive: true })
    fs.mkdirSync(path.join(tempRoot, 'files'), { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'feature.notes.data') return defaultNotesDir
      if (key === 'sys.appdata') return path.join(tempRoot, 'appdata')
      if (key === 'feature.files.data') return path.join(tempRoot, 'files')
      throw new Error(`unexpected path key: ${key}`)
    })
  })

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('copies notes into an empty target and verifies the result', async () => {
    const source = path.join(tempRoot, 'source-notes')
    const target = path.join(tempRoot, 'target-notes')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.mkdirSync(path.join(source, 'folder-a'))
    fs.writeFileSync(path.join(source, 'note-a.md'), '# A')
    fs.writeFileSync(path.join(source, 'folder-a', 'note-b.md'), '# B')
    fs.writeFileSync(path.join(source, 'image.png'), 'png')

    const inspection = await inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(true)
    if (!inspection.valid) return

    expect(inspection.source.markdownFileCount).toBe(2)
    expect(inspection.source.folderCount).toBe(1)

    const result = await migrateWithPreferenceSource(source, target, { merge: false })
    expect(result.target.markdownFileCount).toBe(2)
    expect(fs.existsSync(path.join(target, 'image.png'))).toBe(true)
    expect(fs.readFileSync(path.join(source, 'note-a.md'), 'utf8')).toBe('# A')
  })

  it('copies into a target that only contains an empty folder without merge', async () => {
    const source = path.join(tempRoot, 'source-notes-empty-folder')
    const target = path.join(tempRoot, 'target-notes-empty-folder')
    fs.mkdirSync(path.join(source, 'folder-a'), { recursive: true })
    fs.mkdirSync(target)
    fs.mkdirSync(path.join(target, 'folder-a'))
    fs.writeFileSync(path.join(source, 'folder-a', 'note-b.md'), '# B')

    const result = await migrateWithPreferenceSource(source, target, { merge: false })
    expect(result.target.markdownFileCount).toBe(1)
    expect(fs.readFileSync(path.join(target, 'folder-a', 'note-b.md'), 'utf8')).toBe('# B')
  })

  it('rejects migration when target already contains non-markdown files without merge', async () => {
    const source = path.join(tempRoot, 'source-notes-non-md')
    const target = path.join(tempRoot, 'target-notes-non-md')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Source')
    fs.writeFileSync(path.join(target, 'image.png'), 'png')

    await expect(migrateWithPreferenceSource(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_TARGET_NOT_EMPTY'
    })
  })

  it('rejects migration when target already contains markdown files without merge', async () => {
    const source = path.join(tempRoot, 'source-notes-2')
    const target = path.join(tempRoot, 'target-notes-2')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Source')
    fs.writeFileSync(path.join(target, 'existing.md'), '# Existing')

    await expect(migrateWithPreferenceSource(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_TARGET_NOT_EMPTY'
    })
  })

  it('rejects non-merge migration when a nested destination file already exists', async () => {
    const source = path.join(tempRoot, 'source-notes-nested')
    const target = path.join(tempRoot, 'target-notes-nested')
    fs.mkdirSync(path.join(source, 'folder-a'), { recursive: true })
    fs.mkdirSync(path.join(target, 'folder-a'), { recursive: true })
    fs.writeFileSync(path.join(source, 'folder-a', 'note-b.md'), '# B')
    fs.writeFileSync(path.join(target, 'folder-a', 'note-b.md'), 'existing')

    await expect(migrateWithPreferenceSource(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_TARGET_NOT_EMPTY'
    })
  })

  it('merges source notes into a target that already has markdown files', async () => {
    const source = path.join(tempRoot, 'source-notes-3')
    const target = path.join(tempRoot, 'target-notes-3')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'new-note.md'), '# New')
    fs.writeFileSync(path.join(target, 'existing.md'), '# Existing')

    const result = await migrateWithPreferenceSource(source, target, { merge: true })
    expect(result.target.markdownFileCount).toBe(2)
    expect(fs.readFileSync(path.join(target, 'new-note.md'), 'utf8')).toBe('# New')
  })

  it('merges when the target only contains an empty directory', async () => {
    const source = path.join(tempRoot, 'source-notes-empty-dir')
    const target = path.join(tempRoot, 'target-notes-empty-dir')
    fs.mkdirSync(path.join(source, 'folder-a'), { recursive: true })
    fs.mkdirSync(path.join(target, 'folder-a'), { recursive: true })
    fs.writeFileSync(path.join(source, 'folder-a', 'note.md'), '# Note')

    const inspection = await inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(true)
    if (!inspection.valid) return
    expect(inspection.targetHasFiles).toBe(true)

    const result = await migrateWithPreferenceSource(source, target, { merge: true })
    expect(result.target.markdownFileCount).toBe(1)
    expect(fs.readFileSync(path.join(target, 'folder-a', 'note.md'), 'utf8')).toBe('# Note')
  })

  it('merges when the target only contains non-markdown files', async () => {
    const source = path.join(tempRoot, 'source-notes-5')
    const target = path.join(tempRoot, 'target-notes-5')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# New')
    fs.writeFileSync(path.join(target, 'image.png'), 'png')

    const result = await migrateWithPreferenceSource(source, target, { merge: true })
    expect(result.target.markdownFileCount).toBe(1)
    expect(fs.readFileSync(path.join(target, 'image.png'), 'utf8')).toBe('png')
  })

  it('fails merge verification when a skipped destination file changes to same-sized different content', async () => {
    const source = path.join(tempRoot, 'source-notes-same-size-skip')
    const target = path.join(tempRoot, 'target-notes-same-size-skip')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'shared.md'), 'same1234')
    fs.writeFileSync(path.join(target, 'shared.md'), 'same1234')
    fs.writeFileSync(path.join(source, 'new-note.md'), '# New content')
    fs.writeFileSync(path.join(target, 'existing.md'), '# Existing note')

    const copyFile = fs.promises.copyFile
    const copyFileSpy = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to, mode?) => {
      await fs.promises.writeFile(path.join(target, 'shared.md'), 'diff1234')
      await copyFile(from, to, mode)
    })

    await expect(migrateWithPreferenceSource(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_VERIFY_FAILED'
    })
    copyFileSpy.mockRestore()
  })

  it('fails merge verification when a new file lands with the wrong size', async () => {
    const source = path.join(tempRoot, 'source-notes-verify')
    const target = path.join(tempRoot, 'target-notes-verify')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'new-note.md'), '# New content')
    fs.writeFileSync(path.join(target, 'existing.txt'), 'keep')

    const copyFile = fs.promises.copyFile
    const copyFileSpy = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to) => {
      await copyFile(from, to)
      if (String(to).endsWith('new-note.md')) {
        await fs.promises.writeFile(to, '# short')
      }
    })

    await expect(migrateWithPreferenceSource(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_VERIFY_FAILED'
    })
    copyFileSpy.mockRestore()
  })

  it('stops copying top-level entries after the first failure', async () => {
    const source = path.join(tempRoot, 'source-notes-stop')
    const target = path.join(tempRoot, 'target-notes-stop')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'first.md'), '# First')
    fs.writeFileSync(path.join(source, 'second.md'), '# Second')
    fs.writeFileSync(path.join(source, 'third.md'), '# Third')

    const copyFile = fs.promises.copyFile
    let copyCalls = 0
    const copyFileSpy = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to) => {
      copyCalls += 1
      if (copyCalls === 2) {
        throw new Error('simulated copy failure')
      }
      await copyFile(from, to)
    })

    await expect(migrateWithPreferenceSource(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_FAILED'
    })
    expect(fs.existsSync(path.join(target, 'first.md'))).toBe(true)
    expect(fs.existsSync(path.join(target, 'third.md'))).toBe(false)
    copyFileSpy.mockRestore()
  })

  it('rejects merge when the same relative path exists with different content', async () => {
    const source = path.join(tempRoot, 'source-notes-4')
    const target = path.join(tempRoot, 'target-notes-4')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'conflict.md'), '# Source')
    fs.writeFileSync(path.join(target, 'conflict.md'), '# Existing')
    fs.writeFileSync(path.join(source, 'added.md'), '# Added')

    await expect(migrateWithPreferenceSource(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_MERGE_CONFLICT'
    })
  })

  it('rejects merge when the same relative path exists with same-sized different content', async () => {
    const source = path.join(tempRoot, 'source-notes-same-size')
    const target = path.join(tempRoot, 'target-notes-same-size')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'conflict.md'), 'abcd')
    fs.writeFileSync(path.join(target, 'conflict.md'), 'efgh')

    await expect(migrateWithPreferenceSource(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_MERGE_CONFLICT'
    })
  })

  it('rejects migration when the authoritative notes source no longer matches', async () => {
    const source = path.join(tempRoot, 'source-notes-stale')
    const target = path.join(tempRoot, 'target-notes-stale')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Source')

    MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', path.join(tempRoot, 'other-notes'))

    await expect(migrateNotesDirectory(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_INVALID',
      message: 'source_changed'
    })
  })

  it('rejects non-merge migration when a destination file appears after inspection', async () => {
    const source = path.join(tempRoot, 'source-notes-late-file')
    const target = path.join(tempRoot, 'target-notes-late-file')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Source')

    const inspection = await inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(true)
    if (!inspection.valid) return

    fs.writeFileSync(path.join(target, 'late.md'), 'late')

    await expect(migrateWithPreferenceSource(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_TARGET_NOT_EMPTY'
    })
  })

  it('rejects a target directory that contains symbolic links', async () => {
    const source = path.join(tempRoot, 'source-notes-target-symlink')
    const target = path.join(tempRoot, 'target-notes-target-symlink')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Note')
    fs.writeFileSync(path.join(target, 'note.md'), '# Target')
    fs.symlinkSync(path.join(target, 'note.md'), path.join(target, 'link.md'))

    const inspection = await inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(false)
    if (inspection.valid) return
    expect(inspection.reason).toBe('invalid_target')
  })

  it('rejects a source directory that is itself a symbolic link', async () => {
    const realSource = path.join(tempRoot, 'real-source')
    const source = path.join(tempRoot, 'linked-source')
    const target = path.join(tempRoot, 'target-linked-source')
    fs.mkdirSync(realSource)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(realSource, 'note.md'), '# Note')
    fs.symlinkSync(realSource, source, 'dir')

    const inspection = await inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(false)
    if (inspection.valid) return
    expect(inspection.reason).toBe('source_contains_symlinks')
  })

  it('rejects the managed files root as a notes target', async () => {
    const source = path.join(tempRoot, 'source-notes-protected')
    const filesRoot = path.join(tempRoot, 'files')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'note.md'), '# Note')

    await expect(assertNotesRelocationPaths(source, filesRoot)).rejects.toThrow()
  })

  it('rejects a target inside the managed application data directory', async () => {
    const source = path.join(tempRoot, 'source-notes-appdata')
    const appDataRoot = path.join(tempRoot, 'appdata')
    const target = path.join(appDataRoot, 'notes-export')
    fs.mkdirSync(source)
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(source, 'note.md'), '# Note')

    await expect(assertNotesRelocationPaths(source, target)).rejects.toThrow()
  })

  it('rejects a source directory that contains symbolic links', async () => {
    const source = path.join(tempRoot, 'source-notes-symlink')
    const target = path.join(tempRoot, 'target-notes-symlink')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Note')
    fs.symlinkSync(path.join(source, 'note.md'), path.join(source, 'link.md'))

    const inspection = await inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(false)
    if (inspection.valid) return
    expect(inspection.reason).toBe('source_contains_symlinks')
  })
})
