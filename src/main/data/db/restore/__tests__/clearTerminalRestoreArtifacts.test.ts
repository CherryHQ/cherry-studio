import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { getPath: getPathMock }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

import { clearTerminalRestoreArtifacts } from '../clearTerminalRestoreArtifacts'
import type { RestoreJournal } from '../restoreJournal'

describe('clearTerminalRestoreArtifacts', () => {
  let root: string
  let journalPath: string
  let stagingRoot: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'clear-terminal-'))
    journalPath = path.join(root, 'restore-journal.json')
    stagingRoot = path.join(root, 'restore-staging')
    fs.mkdirSync(stagingRoot, { recursive: true })
    getPathMock.mockImplementation((key: string) => {
      if (key === 'app.userdata') return root
      if (key === 'feature.backup.restore.file') return journalPath
      if (key === 'feature.backup.restore.staging') return stagingRoot
      throw new Error(`unexpected path key ${key}`)
    })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('rejects absolute aside paths before deleting anything', () => {
    fs.writeFileSync(journalPath, 'keep')
    const journal = {
      version: 1 as const,
      restoreId: 'rst-1',
      createdAt: new Date().toISOString(),
      state: 'completed' as const,
      db: {
        promote: 'restore-staging/work.sqlite',
        aside: path.join(root, 'evil-aside.sqlite'),
        fingerprint: 'abc',
        chain: [{ folderMillis: 1, hash: 'h' }]
      },
      fileResources: []
    } satisfies Extract<RestoreJournal, { state: 'completed' }>

    expect(() => clearTerminalRestoreArtifacts(journal)).toThrow(/absolute/)
    expect(fs.existsSync(journalPath)).toBe(true)
  })

  it('validates every dynamic aside before deleting any candidate', () => {
    const validAsideRel = 'restore-staging/valid-aside.sqlite'
    const validAsidePath = path.join(root, validAsideRel)
    fs.mkdirSync(path.dirname(validAsidePath), { recursive: true })
    fs.writeFileSync(validAsidePath, 'keep until validation completes')
    fs.writeFileSync(journalPath, '{}')

    const journal = {
      version: 1 as const,
      restoreId: 'rst-validation-order',
      createdAt: new Date().toISOString(),
      state: 'completed' as const,
      db: {
        promote: 'restore-staging/work.sqlite',
        aside: validAsideRel,
        fingerprint: 'abc',
        chain: [{ folderMillis: 1, hash: 'h' }]
      },
      fileResources: [
        {
          kind: 'overwrite' as const,
          stagingPath: 'restore-staging/file.txt',
          livePath: 'Data/file.txt',
          asidePath: path.join(root, 'outside.txt')
        }
      ]
    } satisfies Extract<RestoreJournal, { state: 'completed' }>

    expect(() => clearTerminalRestoreArtifacts(journal)).toThrow(/absolute/)
    expect(fs.existsSync(validAsidePath)).toBe(true)
    expect(fs.existsSync(journalPath)).toBe(true)
  })

  it('clears terminal journal, staging, and relative aside', () => {
    const asideRel = path.join('restore-staging', 'aside.sqlite')
    const asideAbs = path.join(root, asideRel)
    fs.mkdirSync(path.dirname(asideAbs), { recursive: true })
    fs.writeFileSync(asideAbs, 'db')
    fs.writeFileSync(`${asideAbs}-wal`, 'wal')
    fs.writeFileSync(`${asideAbs}-shm`, 'shm')
    const fileAside = path.join(root, 'restore-staging', 'old-note.md')
    fs.writeFileSync(fileAside, 'old note')
    fs.writeFileSync(journalPath, '{}')
    fs.writeFileSync(`${journalPath}.tmp`, 'tmp')
    fs.writeFileSync(`${journalPath}.corrupt-123`, 'corrupt')
    fs.writeFileSync(path.join(stagingRoot, 'leftover'), 'x')

    const journal = {
      version: 1 as const,
      restoreId: 'rst-2',
      createdAt: new Date().toISOString(),
      state: 'failed' as const,
      db: {
        promote: path.join('restore-staging', 'work.sqlite'),
        aside: asideRel,
        fingerprint: 'abc',
        chain: [{ folderMillis: 1, hash: 'h' }]
      },
      fileResources: [
        {
          kind: 'note-overwrite' as const,
          stagingPath: 'restore-staging/new-note.md',
          livePath: 'Data/Notes/note.md',
          asidePath: path.relative(root, fileAside)
        }
      ]
    } satisfies Extract<RestoreJournal, { state: 'failed' }>

    clearTerminalRestoreArtifacts(journal)

    expect(fs.existsSync(asideAbs)).toBe(false)
    expect(fs.existsSync(`${asideAbs}-wal`)).toBe(false)
    expect(fs.existsSync(`${asideAbs}-shm`)).toBe(false)
    expect(fs.existsSync(fileAside)).toBe(false)
    expect(fs.existsSync(journalPath)).toBe(false)
    expect(fs.existsSync(`${journalPath}.tmp`)).toBe(false)
    expect(fs.existsSync(`${journalPath}.corrupt-123`)).toBe(false)
    expect(fs.existsSync(stagingRoot)).toBe(false)
  })
})
