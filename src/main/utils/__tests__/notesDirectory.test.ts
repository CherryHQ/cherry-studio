import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
const { validateNotesDirectory } = await import('../notesDirectory')

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
})
