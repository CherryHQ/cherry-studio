import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

import { application } from '@application'

import { inspectNotesRelocation, migrateNotesDirectory } from '../migrate'
import { assertNotesRelocationPaths } from '../validation'

describe('notesRelocation', () => {
  let tempRoot: string
  let defaultNotesDir: string

  beforeEach(() => {
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

    const inspection = inspectNotesRelocation(source, target)
    expect(inspection.valid).toBe(true)
    if (!inspection.valid) return

    expect(inspection.source.markdownFileCount).toBe(2)
    expect(inspection.source.folderCount).toBe(1)

    const result = await migrateNotesDirectory(source, target, { merge: false })
    expect(result.target.markdownFileCount).toBe(2)
    expect(fs.existsSync(path.join(target, 'image.png'))).toBe(true)
    expect(fs.readFileSync(path.join(source, 'note-a.md'), 'utf8')).toBe('# A')
  })

  it('rejects migration when target already contains non-markdown files without merge', async () => {
    const source = path.join(tempRoot, 'source-notes-non-md')
    const target = path.join(tempRoot, 'target-notes-non-md')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# Source')
    fs.writeFileSync(path.join(target, 'image.png'), 'png')

    await expect(migrateNotesDirectory(source, target, { merge: false })).rejects.toMatchObject({
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

    await expect(migrateNotesDirectory(source, target, { merge: false })).rejects.toMatchObject({
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

    const result = await migrateNotesDirectory(source, target, { merge: true })
    expect(result.target.markdownFileCount).toBe(2)
    expect(fs.readFileSync(path.join(target, 'new-note.md'), 'utf8')).toBe('# New')
  })

  it('merges when the target only contains non-markdown files', async () => {
    const source = path.join(tempRoot, 'source-notes-5')
    const target = path.join(tempRoot, 'target-notes-5')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'note.md'), '# New')
    fs.writeFileSync(path.join(target, 'image.png'), 'png')

    const result = await migrateNotesDirectory(source, target, { merge: true })
    expect(result.target.markdownFileCount).toBe(1)
    expect(fs.readFileSync(path.join(target, 'image.png'), 'utf8')).toBe('png')
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

    await expect(migrateNotesDirectory(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_VERIFY_FAILED'
    })
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

    await expect(migrateNotesDirectory(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_MERGE_CONFLICT'
    })
  })

  it('rejects merge when the same relative path exists with same-sized different content', async () => {
    const source = path.join(tempRoot, 'source-notes-same-size')
    const target = path.join(tempRoot, 'target-notes-same-size')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'conflict.md'), 'aaaa')
    fs.writeFileSync(path.join(target, 'conflict.md'), 'bbbb')

    await expect(migrateNotesDirectory(source, target, { merge: true })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_MERGE_CONFLICT'
    })
  })

  it('rejects migration when the target contains a pre-existing symlinked directory', async () => {
    const source = path.join(tempRoot, 'source-notes-symlink-dest')
    const target = path.join(tempRoot, 'target-notes-symlink-dest')
    const outside = path.join(tempRoot, 'outside-symlink-dest')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.mkdirSync(outside)
    fs.mkdirSync(path.join(source, 'folder-a'))
    fs.writeFileSync(path.join(source, 'folder-a', 'note.md'), '# A')
    fs.symlinkSync(outside, path.join(target, 'folder-a'))

    await expect(migrateNotesDirectory(source, target, { merge: false })).rejects.toThrow(/Destination is a symlink/)
    expect(fs.existsSync(path.join(outside, 'note.md'))).toBe(false)
  })

  it('copies into the physical directory when the selected target root is a symlink', async () => {
    const source = path.join(tempRoot, 'source-notes-symlink-root')
    const physical = path.join(tempRoot, 'physical-symlink-root')
    const target = path.join(tempRoot, 'target-link-symlink-root')
    fs.mkdirSync(source)
    fs.mkdirSync(physical)
    fs.writeFileSync(path.join(source, 'note.md'), '# A')
    fs.symlinkSync(physical, target)

    const result = await migrateNotesDirectory(source, target, { merge: false })

    expect(fs.existsSync(path.join(physical, 'note.md'))).toBe(true)
    expect(result.target.markdownFileCount).toBe(1)
  })

  it('copies into the physical directory when the target has a symlinked ancestor', async () => {
    const source = path.join(tempRoot, 'source-notes-symlink-ancestor')
    const physicalRoot = path.join(tempRoot, 'physical-symlink-ancestor')
    const target = path.join(physicalRoot, 'link', 'notes')
    fs.mkdirSync(source)
    fs.mkdirSync(path.join(physicalRoot, 'real', 'notes'), { recursive: true })
    fs.writeFileSync(path.join(source, 'note.md'), '# A')
    fs.symlinkSync(path.join(physicalRoot, 'real'), path.join(physicalRoot, 'link'))

    const result = await migrateNotesDirectory(source, target, { merge: false })

    expect(fs.existsSync(path.join(physicalRoot, 'real', 'notes', 'note.md'))).toBe(true)
    expect(result.target.markdownFileCount).toBe(1)
  })

  it('rejects migration when the target symlink resolves to a protected directory', async () => {
    const source = path.join(tempRoot, 'source-notes-symlink-protected')
    const target = path.join(tempRoot, 'target-link-symlink-protected')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'note.md'), '# A')
    fs.symlinkSync(path.join(tempRoot, 'files'), target)

    await expect(migrateNotesDirectory(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_INVALID'
    })
    expect(fs.existsSync(path.join(tempRoot, 'files', 'note.md'))).toBe(false)
  })

  it('rejects the managed files root as a notes target', () => {
    const source = path.join(tempRoot, 'source-notes-protected')
    const filesRoot = path.join(tempRoot, 'files')
    fs.mkdirSync(source)
    fs.writeFileSync(path.join(source, 'note.md'), '# Note')

    expect(() => assertNotesRelocationPaths(source, filesRoot)).toThrow()
  })

  it('rejects a target nested inside the application data directory', () => {
    const source = path.join(tempRoot, 'source-notes-appdata')
    const nestedTarget = path.join(tempRoot, 'appdata', 'nested-notes')
    fs.mkdirSync(source)
    fs.mkdirSync(nestedTarget, { recursive: true })
    fs.writeFileSync(path.join(source, 'note.md'), '# Note')

    expect(() => assertNotesRelocationPaths(source, nestedTarget)).toThrow()
  })

  it('rejects non-merge migration when the target gains a file during copying', async () => {
    const source = path.join(tempRoot, 'source-notes-late-target')
    const target = path.join(tempRoot, 'target-notes-late-target')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'first.md'), '# first')
    fs.writeFileSync(path.join(source, 'second.md'), '# second')

    const originalCopyFile = fs.promises.copyFile.bind(fs.promises)
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (from, to, mode?) => {
      if (String(from).endsWith('second.md')) {
        fs.writeFileSync(String(to), 'late arrival')
      }
      return originalCopyFile(from, to, mode)
    })

    await expect(migrateNotesDirectory(source, target, { merge: false })).rejects.toMatchObject({
      code: 'NOTES_RELOCATION_TARGET_NOT_EMPTY'
    })
    expect(fs.readFileSync(path.join(target, 'second.md'), 'utf8')).toBe('late arrival')
  })
})
