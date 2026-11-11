import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMocks
  }
}))

const { application } = await import('@application')
const { validateNotesDirectory, resolveEffectiveNotesRoot, readNoteSource } = await import('../notesDirectory')

describe('validateNotesDirectory', () => {
  let root: string
  let appDataPath: string
  let filesPath: string
  let notesPath: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-notes-directory-'))
    appDataPath = path.join(root, 'AppData')
    filesPath = path.join(root, 'Files')
    notesPath = path.join(root, 'Notes')
    await Promise.all([mkdir(appDataPath), mkdir(filesPath), mkdir(notesPath), mkdir(path.join(root, 'CustomNotes'))])
    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      if (key === 'sys.appdata') return appDataPath
      if (key === 'feature.files.data') return filesPath
      if (key === 'feature.notes.data') return notesPath
      throw new Error(`Unexpected application.getPath(${key})`)
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('accepts a writable directory outside application-managed paths', () => {
    expect(validateNotesDirectory(path.join(root, 'CustomNotes'))).toBe(true)
  })

  it('rejects application data, FileManager data, and the default Notes directory', () => {
    expect(validateNotesDirectory(appDataPath)).toBe(false)
    expect(validateNotesDirectory(filesPath)).toBe(false)
    expect(validateNotesDirectory(notesPath)).toBe(false)
  })

  it('resolves the effective root on every call', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', '')
    expect(resolveEffectiveNotesRoot()).toBe(notesPath)
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', notesPath)
    expect(resolveEffectiveNotesRoot()).toBe(notesPath)
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', path.join(root, 'CustomNotes'))
    expect(resolveEffectiveNotesRoot()).toBe(path.join(root, 'CustomNotes'))
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', path.join(root, 'missing'))
    expect(resolveEffectiveNotesRoot()).toBe(notesPath)
  })

  it('reads only contained regular Markdown files, including empty and Unicode paths', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.notes.path', '')
    const source = path.join(notesPath, '笔记 with spaces.MD')
    const outside = path.join(root, 'Notes2')
    await mkdir(outside)
    await writeFile(source, '')
    await writeFile(path.join(notesPath, 'other.txt'), 'text')
    await writeFile(path.join(outside, 'outside.md'), 'secret')
    await symlink(path.join(outside, 'outside.md'), path.join(notesPath, 'link.md'))
    expect(await readNoteSource(source)).toEqual({ ok: true, path: source, text: '' })
    expect(await readNoteSource(path.join(notesPath, 'missing.md'))).toEqual({ ok: false, reason: 'missing' })
    expect(await readNoteSource(notesPath)).toEqual({ ok: false, reason: 'not-a-file' })
    expect(await readNoteSource(path.join(notesPath, 'other.txt'))).toEqual({ ok: false, reason: 'not-markdown' })
    expect(await readNoteSource(path.join(outside, 'outside.md'))).toEqual({ ok: false, reason: 'outside-root' })
    expect(await readNoteSource(path.join(notesPath, 'link.md'))).toEqual({ ok: false, reason: 'outside-root' })
  })
})
