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

describe('notesRelocation', () => {
  let tempRoot: string
  let defaultNotesDir: string

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-relocation-'))
    defaultNotesDir = path.join(tempRoot, 'default-notes')
    fs.mkdirSync(defaultNotesDir, { recursive: true })
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

  it('does not overwrite existing target files when merging', async () => {
    const source = path.join(tempRoot, 'source-notes-4')
    const target = path.join(tempRoot, 'target-notes-4')
    fs.mkdirSync(source)
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(source, 'conflict.md'), '# Source')
    fs.writeFileSync(path.join(target, 'conflict.md'), '# Existing')
    fs.writeFileSync(path.join(source, 'added.md'), '# Added')

    await migrateNotesDirectory(source, target, { merge: true })

    expect(fs.readFileSync(path.join(target, 'conflict.md'), 'utf8')).toBe('# Existing')
    expect(fs.readFileSync(path.join(target, 'added.md'), 'utf8')).toBe('# Added')
  })
})
