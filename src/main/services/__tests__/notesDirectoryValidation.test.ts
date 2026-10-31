import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ appdata: '', files: '', notes: '' }))

vi.mock('@application', () => ({
  application: {
    getPath: (key: string) =>
      key === 'sys.appdata' ? paths.appdata : key === 'feature.files.data' ? paths.files : paths.notes
  }
}))

import { isNotesDirectoryAcceptedForLoading } from '../notesDirectoryValidation'

describe('isNotesDirectoryAcceptedForLoading', () => {
  let root: string

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'notes-validation-')))
    paths.appdata = path.join(root, 'Library', 'Application Support')
    paths.files = path.join(paths.appdata, 'Data', 'Files')
    paths.notes = path.join(paths.appdata, 'Data', 'Notes')
    fs.mkdirSync(paths.files, { recursive: true })
    fs.mkdirSync(paths.notes, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects directories inside protected app storage', () => {
    const inside = path.join(paths.files, 'notes')
    fs.mkdirSync(inside)
    expect(isNotesDirectoryAcceptedForLoading(inside)).toBe(false)
    expect(isNotesDirectoryAcceptedForLoading(paths.appdata)).toBe(false)
  })

  it('rejects a symlinked alias that resolves into protected storage', () => {
    const alias = path.join(root, 'alias')
    fs.symlinkSync(paths.files, alias, 'dir')
    const target = path.join(alias, 'Notes')
    fs.mkdirSync(target)
    expect(isNotesDirectoryAcceptedForLoading(target)).toBe(false)
  })

  it('accepts a distinct directory that only differs by case where the filesystem is case-sensitive', () => {
    const lowerCase = path.join(root, 'library', 'Application Support', 'notes')
    fs.mkdirSync(lowerCase, { recursive: true })
    const caseSensitive = !fs.existsSync(path.join(root, 'LIBRARY'))
    expect(isNotesDirectoryAcceptedForLoading(lowerCase)).toBe(caseSensitive)
  })

  it('accepts an ordinary writable directory outside app storage', () => {
    const outside = path.join(root, 'MyNotes')
    fs.mkdirSync(outside)
    expect(isNotesDirectoryAcceptedForLoading(outside)).toBe(true)
  })
})
