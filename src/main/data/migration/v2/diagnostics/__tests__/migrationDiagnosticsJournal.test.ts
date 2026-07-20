import fs, {
  chmodSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    default: {
      ...actual,
      openSync: vi.fn(actual.openSync),
      writeSync: vi.fn(actual.writeSync),
      fsyncSync: vi.fn(actual.fsyncSync),
      fchmodSync: vi.fn(actual.fchmodSync),
      closeSync: vi.fn(actual.closeSync),
      linkSync: vi.fn(actual.linkSync),
      renameSync: vi.fn(actual.renameSync),
      unlinkSync: vi.fn(actual.unlinkSync)
    }
  }
})

import {
  cleanupMigrationDiagnosticsJournal,
  garbageCollectMigrationDiagnosticsQuarantines,
  MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES,
  quarantineCorruptMigrationDiagnosticsJournal,
  readMigrationDiagnosticsJournal,
  writeMigrationDiagnosticsJournal
} from '../migrationDiagnosticsJournal'
import type { MigrationDiagnosticsSnapshot } from '../migrationDiagnosticsSchemas'

let testDir = ''

function journalFile(): string {
  return path.join(testDir, 'migration-diagnostics-v2.json')
}

function checkpoint(): MigrationDiagnosticsSnapshot {
  return {
    formatVersion: 1,
    app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
    state: 'active',
    current: {
      trigger: 'initial',
      status: 'in_progress',
      startedAt: '2026-07-21T08:00:00.000Z',
      lastLocation: { scope: 'gate', phase: 'resolve_paths' }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostics-journal-'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('readMigrationDiagnosticsJournal', () => {
  it("returns typed 'none', 'ok', and content-free 'corrupt' outcomes", () => {
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'none' })

    writeMigrationDiagnosticsJournal(journalFile(), checkpoint())
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'ok', journal: checkpoint() })

    const secret = 'sk-user-message-/Users/alice'
    writeFileSync(journalFile(), `{ "raw": "${secret}"`)
    const corrupt = readMigrationDiagnosticsJournal(journalFile())
    expect(corrupt).toEqual({ kind: 'corrupt', reason: 'invalid' })
    expect(JSON.stringify(corrupt)).not.toContain(secret)
  })

  it.each([
    ['old strict v2', { version: 2, sessionId: 'old', attempts: [] }],
    ['old v1', { version: 1, sessionId: 'old', attempts: [] }],
    ['extra private data', { ...checkpoint(), rawError: 'privacy-canary' }]
  ])('rejects %s without a compatibility reader', (_name, value) => {
    writeFileSync(journalFile(), JSON.stringify(value), { mode: 0o600 })

    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'corrupt', reason: 'invalid' })
  })

  it('rejects oversized and non-regular input without returning content', () => {
    const marker = 'MODEL_KEY_SHOULD_NOT_ECHO'
    const oversized = Buffer.alloc(MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES + 1, 'x')
    oversized.set(Buffer.from(marker), 0)
    writeFileSync(journalFile(), oversized)

    const oversizedResult = readMigrationDiagnosticsJournal(journalFile())
    expect(oversizedResult).toEqual({ kind: 'corrupt', reason: 'oversized' })
    expect(JSON.stringify(oversizedResult)).not.toContain(marker)

    rmSync(journalFile())
    fs.mkdirSync(journalFile())
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'corrupt', reason: 'unreadable' })
  })
})

describe('writeMigrationDiagnosticsJournal', () => {
  it('validates before touching disk', () => {
    const open = vi.mocked(fs.openSync)
    const invalid = { ...checkpoint(), rawError: 'secret' } as MigrationDiagnosticsSnapshot

    expect(() => writeMigrationDiagnosticsJournal(journalFile(), invalid)).toThrow()
    expect(open).not.toHaveBeenCalled()
    expect(existsSync(journalFile())).toBe(false)
  })

  it('uses tmp open → write → file fsync → close → rename → directory fsync on POSIX', () => {
    const open = vi.mocked(fs.openSync)
    const write = vi.mocked(fs.writeSync)
    const fsync = vi.mocked(fs.fsyncSync)
    const close = vi.mocked(fs.closeSync)
    const rename = vi.mocked(fs.renameSync)

    writeMigrationDiagnosticsJournal(journalFile(), checkpoint(), { platform: 'darwin' })

    const tmpFile = `${journalFile()}.tmp`
    expect(open.mock.calls[0]).toEqual([tmpFile, 'wx', 0o600])
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(fsync.mock.invocationCallOrder[0])
    expect(fsync.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0])
    expect(rename).toHaveBeenCalledWith(tmpFile, journalFile())
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[1])
    expect(open.mock.calls[1]).toEqual([testDir, 'r'])
    expect(lstatSync(journalFile()).mode & 0o777).toBe(0o600)
  })

  it('skips parent-directory fsync on Windows and replaces an exact stale tmp sibling', () => {
    writeFileSync(`${journalFile()}.tmp`, 'stale secret')

    writeMigrationDiagnosticsJournal(journalFile(), checkpoint(), { platform: 'win32' })

    expect(vi.mocked(fs.openSync)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fs.fsyncSync)).toHaveBeenCalledTimes(1)
    expect(existsSync(`${journalFile()}.tmp`)).toBe(false)
  })

  it('reports stable typed failures before and after atomic publication', () => {
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('secret-before-/Users/alice')
    })
    expect(() => writeMigrationDiagnosticsJournal(journalFile(), checkpoint())).toThrowError(
      expect.objectContaining({
        name: 'MigrationDiagnosticsJournalWriteError',
        code: 'journal_write_failed',
        publication: 'not_published'
      })
    )
    expect(existsSync(journalFile())).toBe(false)

    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(() => {
        throw new Error('secret-after-/Users/alice')
      })
    expect(() => writeMigrationDiagnosticsJournal(journalFile(), checkpoint())).toThrowError(
      expect.objectContaining({
        name: 'MigrationDiagnosticsJournalWriteError',
        code: 'journal_write_failed',
        publication: 'published'
      })
    )
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'ok', journal: checkpoint() })
  })
})

describe('corrupt quarantine', () => {
  const now = new Date('2026-07-21T10:00:00.000Z')

  it('uses a collision-safe UTC-basic filename without overwriting an existing copy', () => {
    const collision = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260721T100000Z.json')
    writeFileSync(collision, 'existing')
    writeFileSync(journalFile(), 'new-corrupt')

    expect(quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now, platform: 'darwin' })).toBe(true)
    expect(readFileSync(collision, 'utf8')).toBe('existing')
    expect(readFileSync(path.join(testDir, 'migration-diagnostics-v2.corrupt.20260721T100001Z.json'), 'utf8')).toBe(
      'new-corrupt'
    )
  })

  it('does not overwrite a destination claimed by a local competitor', () => {
    const first = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260721T100000Z.json')
    const second = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260721T100001Z.json')
    vi.mocked(fs.linkSync).mockImplementationOnce((existingPath, newPath) => {
      writeFileSync(newPath, 'competitor-canary', { flag: 'wx' })
      linkSync(existingPath, newPath)
    })
    writeFileSync(journalFile(), 'new-corrupt')

    expect(quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now })).toBe(true)
    expect(readFileSync(first, 'utf8')).toBe('competitor-canary')
    expect(readFileSync(second, 'utf8')).toBe('new-corrupt')
  })

  it('tightens the quarantined inode to 0600 before removing the live name', () => {
    const quarantined = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260721T100000Z.json')
    writeFileSync(journalFile(), 'corrupt')
    chmodSync(journalFile(), 0o644)

    quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now, platform: 'darwin' })

    expect(lstatSync(quarantined).mode & 0o777).toBe(0o600)
    expect(existsSync(journalFile())).toBe(false)
  })

  it('retains only two recent regular quarantines and preserves unrelated or symlink files', () => {
    const expired = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260712T100000Z.json')
    const retained = [
      path.join(testDir, 'migration-diagnostics-v2.corrupt.20260720T100000Z.json'),
      path.join(testDir, 'migration-diagnostics-v2.corrupt.20260720T110000Z.json'),
      path.join(testDir, 'migration-diagnostics-v2.corrupt.20260720T120000Z.json')
    ]
    const target = path.join(testDir, 'outside-target.txt')
    const symlink = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260711T100000Z.json')
    writeFileSync(expired, 'expired')
    const expiredTime = new Date('2026-07-12T09:59:59.000Z')
    utimesSync(expired, expiredTime, expiredTime)
    retained.forEach((file, index) => {
      writeFileSync(file, String(index))
      const time = new Date(`2026-07-20T${String(10 + index).padStart(2, '0')}:00:00.000Z`)
      utimesSync(file, time, time)
    })
    writeFileSync(target, 'outside')
    symlinkSync(target, symlink)

    garbageCollectMigrationDiagnosticsQuarantines(journalFile(), { now })

    expect(existsSync(expired)).toBe(false)
    expect(existsSync(retained[0])).toBe(false)
    expect(existsSync(retained[1])).toBe(true)
    expect(existsSync(retained[2])).toBe(true)
    expect(lstatSync(symlink).isSymbolicLink()).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('outside')
  })
})

describe('cleanupMigrationDiagnosticsJournal', () => {
  it('deletes only the live journal and exact tmp while preserving quarantines', () => {
    const corrupt = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260721T100000Z.json')
    writeFileSync(journalFile(), 'live')
    writeFileSync(`${journalFile()}.tmp`, 'tmp')
    writeFileSync(corrupt, 'corrupt')

    cleanupMigrationDiagnosticsJournal(journalFile(), { platform: 'darwin' })

    expect(readdirSync(testDir)).toEqual([path.basename(corrupt)])
  })

  it('treats ENOENT as benign', () => {
    expect(() => cleanupMigrationDiagnosticsJournal(journalFile())).not.toThrow()
  })
})
