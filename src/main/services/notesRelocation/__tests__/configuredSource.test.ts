import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveConfiguredNotesDirectoryPath } from '../configuredSource'

const preferenceGet = vi.fn()
const getPath = vi.fn()

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') {
        return { get: preferenceGet }
      }
      throw new Error(`unexpected service ${name}`)
    },
    getPath: (...args: unknown[]) => getPath(...args)
  }
}))

describe('resolveConfiguredNotesDirectoryPath', () => {
  let tempDir: string
  let defaultNotes: string

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
    preferenceGet.mockReset()
    getPath.mockReset()
  })

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-configured-'))
    defaultNotes = path.join(tempDir, 'default-notes')
    fs.mkdirSync(defaultNotes)
    fs.mkdirSync(path.join(tempDir, 'appdata'))
    fs.mkdirSync(path.join(tempDir, 'files'))
    getPath.mockImplementation((key: string) => {
      if (key === 'feature.notes.data') {
        return defaultNotes
      }
      if (key === 'sys.appdata') {
        return path.join(tempDir, 'appdata')
      }
      if (key === 'feature.files.data') {
        return path.join(tempDir, 'files')
      }
      throw new Error(`unexpected path key ${key}`)
    })
    fs.mkdirSync(path.join(tempDir, 'appdata'), { recursive: true })
    fs.mkdirSync(path.join(tempDir, 'files'), { recursive: true })
  })

  it('falls back to the default notes directory when the preference path is not writable', () => {
    const custom = path.join(tempDir, 'read-only-notes')
    fs.mkdirSync(custom)
    fs.chmodSync(custom, fs.constants.S_IRUSR | fs.constants.S_IXUSR)

    preferenceGet.mockReturnValue(custom)

    expect(resolveConfiguredNotesDirectoryPath()).toBe(defaultNotes)
  })

  it('falls back to the default notes directory when the preference path is protected', () => {
    const filesDir = path.join(tempDir, 'files')
    preferenceGet.mockReturnValue(filesDir)

    expect(resolveConfiguredNotesDirectoryPath()).toBe(defaultNotes)
  })

  it('returns the preference path when it exists and is writable', () => {
    const custom = path.join(tempDir, 'writable-notes')
    fs.mkdirSync(custom)

    preferenceGet.mockReturnValue(custom)

    expect(resolveConfiguredNotesDirectoryPath()).toBe(custom)
  })
})
