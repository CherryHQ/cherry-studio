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
import type { MigrationDiagnosticsSession } from '../migrationDiagnosticsSchemas'
import {
  type MigrationDiagnosticsV1Session,
  migrationDiagnosticsV1SessionSchema
} from '../migrationDiagnosticsV1Schemas'

let testDir = ''

function journalFile(): string {
  return path.join(testDir, 'migration-diagnostics-v2.json')
}

function legacyJournalFile(): string {
  return path.join(testDir, 'migration-diagnostics-v1.json')
}

function session(): MigrationDiagnosticsSession {
  return {
    version: 2,
    sessionId: 'session-1',
    appVersion: '2.0.0',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: '2026-07-19T10:00:00.000Z',
    state: 'active',
    attempts: []
  }
}

function legacySession(): MigrationDiagnosticsV1Session {
  return {
    version: 1,
    sessionId: 'legacy-session-1',
    appVersion: '1.9.12',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: '2026-07-19T09:00:00.000Z',
    state: 'active',
    attempts: []
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

    writeMigrationDiagnosticsJournal(journalFile(), session())
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'ok', journal: session() })

    const secret = 'sk-user-message-/Users/alice'
    writeFileSync(journalFile(), `{ "raw": "${secret}"`)
    const corrupt = readMigrationDiagnosticsJournal(journalFile())
    expect(corrupt).toEqual({ kind: 'corrupt', reason: 'invalid' })
    expect(JSON.stringify(corrupt)).not.toContain(secret)
  })

  it('rejects oversized input without returning its content', () => {
    const marker = 'MODEL_KEY_SHOULD_NOT_ECHO'
    const oversized = Buffer.alloc(MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES + 1, 'x')
    oversized.set(Buffer.from(marker), 0)
    writeFileSync(journalFile(), oversized)

    const result = readMigrationDiagnosticsJournal(journalFile())

    expect(result).toEqual({ kind: 'corrupt', reason: 'oversized' })
    expect(JSON.stringify(result)).not.toContain(marker)
  })

  it('uses a caller-supplied strict schema without weakening content-free outcomes', () => {
    writeFileSync(legacyJournalFile(), JSON.stringify(legacySession()), { mode: 0o600 })

    expect(readMigrationDiagnosticsJournal(legacyJournalFile(), migrationDiagnosticsV1SessionSchema)).toEqual({
      kind: 'ok',
      journal: legacySession()
    })

    const canary = 'LEGACY_UNKNOWN_FIELD_CANARY_/Users/alice'
    writeFileSync(legacyJournalFile(), JSON.stringify({ ...legacySession(), rawError: canary }), { mode: 0o600 })
    const invalid = readMigrationDiagnosticsJournal(legacyJournalFile(), migrationDiagnosticsV1SessionSchema)

    expect(invalid).toEqual({ kind: 'corrupt', reason: 'invalid' })
    expect(JSON.stringify(invalid)).not.toContain(canary)
  })
})

describe('writeMigrationDiagnosticsJournal', () => {
  it('validates before touching disk', () => {
    const open = vi.mocked(fs.openSync)
    const invalid = { ...session(), rawError: 'secret' } as MigrationDiagnosticsSession

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

    writeMigrationDiagnosticsJournal(journalFile(), session(), { platform: 'darwin' })

    const tmpFile = `${journalFile()}.tmp`
    expect(open.mock.calls[0]).toEqual([tmpFile, 'wx', 0o600])
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0])
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(fsync.mock.invocationCallOrder[0])
    expect(fsync.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(rename.mock.invocationCallOrder[0])
    expect(rename).toHaveBeenCalledWith(tmpFile, journalFile())
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[1])
    expect(open.mock.calls[1]).toEqual([testDir, 'r'])
    expect(open.mock.invocationCallOrder[1]).toBeLessThan(fsync.mock.invocationCallOrder[1])
    expect(fsync.mock.invocationCallOrder[1]).toBeLessThan(close.mock.invocationCallOrder[1])
    expect(lstatSync(journalFile()).mode & 0o777).toBe(0o600)
  })

  it('skips parent-directory fsync on Windows', () => {
    const open = vi.mocked(fs.openSync)
    const fsync = vi.mocked(fs.fsyncSync)

    writeMigrationDiagnosticsJournal(journalFile(), session(), { platform: 'win32' })

    expect(open).toHaveBeenCalledTimes(1)
    expect(fsync).toHaveBeenCalledTimes(1)
  })

  it('safely replaces an exact stale tmp sibling', () => {
    writeFileSync(`${journalFile()}.tmp`, 'stale secret')

    writeMigrationDiagnosticsJournal(journalFile(), session())

    expect(existsSync(`${journalFile()}.tmp`)).toBe(false)
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'ok', journal: session() })
  })

  it('reports stable typed failures before and after atomic publication', () => {
    const rawBeforeFailure = 'secret-before-/Users/alice'
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error(rawBeforeFailure)
    })
    let beforeFailure: unknown

    try {
      writeMigrationDiagnosticsJournal(journalFile(), session(), { platform: 'darwin' })
    } catch (error) {
      beforeFailure = error
    }

    expect(beforeFailure).toMatchObject({
      name: 'MigrationDiagnosticsJournalWriteError',
      code: 'journal_write_failed',
      publication: 'not_published'
    })
    expect(beforeFailure).toBeInstanceOf(Error)
    if (!(beforeFailure instanceof Error)) {
      throw new Error('Expected a journal write error')
    }
    expect(beforeFailure.message).toBe('Migration diagnostics journal write failed before publication')
    expect(beforeFailure.message).not.toContain(rawBeforeFailure)
    expect(beforeFailure.message).not.toContain(testDir)
    expect(existsSync(journalFile())).toBe(false)

    const rawAfterFailure = 'secret-after-/Users/alice'
    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(() => {
        throw new Error(rawAfterFailure)
      })
    let afterFailure: unknown

    try {
      writeMigrationDiagnosticsJournal(journalFile(), session(), { platform: 'darwin' })
    } catch (error) {
      afterFailure = error
    }

    expect(afterFailure).toMatchObject({
      name: 'MigrationDiagnosticsJournalWriteError',
      code: 'journal_write_failed',
      publication: 'published'
    })
    expect(afterFailure).toBeInstanceOf(Error)
    if (!(afterFailure instanceof Error)) {
      throw new Error('Expected a journal write error')
    }
    expect(afterFailure.message).toBe('Migration diagnostics journal write failed after publication')
    expect(afterFailure.message).not.toContain(rawAfterFailure)
    expect(afterFailure.message).not.toContain(testDir)
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'ok', journal: session() })
  })
})

describe('corrupt quarantine', () => {
  const now = new Date('2026-07-19T10:00:00.000Z')

  it('uses a collision-safe UTC-basic filename without overwriting an existing copy', () => {
    const collision = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json')
    writeFileSync(collision, 'existing')
    writeFileSync(journalFile(), 'new-corrupt')

    const quarantined = quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now, platform: 'darwin' })
    const quarantineFile = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100001Z.json')

    expect(quarantined).toBe(true)
    expect(readFileSync(collision, 'utf8')).toBe('existing')
    expect(readFileSync(quarantineFile, 'utf8')).toBe('new-corrupt')
    expect(existsSync(journalFile())).toBe(false)
  })

  it('atomically skips a destination created immediately before the first quarantine claim', () => {
    const firstCandidate = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json')
    const laterCandidate = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100001Z.json')
    const racerCanary = 'racer-canary-must-not-be-overwritten'
    const corruptJournal = 'new-corrupt-journal'
    vi.mocked(fs.linkSync).mockImplementationOnce((existingPath, newPath) => {
      writeFileSync(newPath, racerCanary, { flag: 'wx' })
      linkSync(existingPath, newPath)
    })
    writeFileSync(journalFile(), corruptJournal)

    const result = quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now, platform: 'darwin' })

    expect(result).toBe(true)
    expect(vi.mocked(fs.linkSync)).toHaveBeenCalledTimes(2)
    expect(readFileSync(firstCandidate, 'utf8')).toBe(racerCanary)
    expect(readFileSync(laterCandidate, 'utf8')).toBe(corruptJournal)
    expect(existsSync(journalFile())).toBe(false)
    expect(JSON.stringify(result)).not.toContain(testDir)
    expect(JSON.stringify(result)).not.toContain(racerCanary)
    expect(JSON.stringify(result)).not.toContain(corruptJournal)
  })

  it('tightens a permissive source inode to 0600 and durably syncs it before removing live', () => {
    const quarantineFile = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json')
    writeFileSync(journalFile(), 'corrupt')
    chmodSync(journalFile(), 0o644)
    const link = vi.mocked(fs.linkSync)
    const open = vi.mocked(fs.openSync)
    const fchmod = vi.mocked(fs.fchmodSync)
    const fsync = vi.mocked(fs.fsyncSync)
    const close = vi.mocked(fs.closeSync)
    const unlink = vi.mocked(fs.unlinkSync)

    quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now, platform: 'darwin' })

    expect(lstatSync(quarantineFile).mode & 0o777).toBe(0o600)
    expect(link.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0])
    expect(open.mock.calls[0]).toEqual([quarantineFile, 'r'])
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(fchmod.mock.invocationCallOrder[0])
    expect(fchmod.mock.calls[0]?.[1]).toBe(0o600)
    expect(fchmod.mock.invocationCallOrder[0]).toBeLessThan(fsync.mock.invocationCallOrder[0])
    expect(fsync.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0])
    expect(close.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[1])
    expect(open.mock.calls[1]).toEqual([testDir, 'r'])
    expect(close.mock.invocationCallOrder[1]).toBeLessThan(unlink.mock.invocationCallOrder[0])
    expect(unlink.mock.calls[0]?.[0]).toBe(journalFile())
    expect(unlink.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[2])
    expect(open.mock.calls[2]).toEqual([testDir, 'r'])
  })

  it('keeps at most two matching regular copies and evicts the oldest when adding a third', () => {
    const oldest = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260718T090000Z.json')
    const newer = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T090000Z.json')
    writeFileSync(oldest, 'oldest')
    writeFileSync(newer, 'newer')
    utimesSync(oldest, new Date('2026-07-18T09:00:00.000Z'), new Date('2026-07-18T09:00:00.000Z'))
    utimesSync(newer, new Date('2026-07-19T09:00:00.000Z'), new Date('2026-07-19T09:00:00.000Z'))
    writeFileSync(journalFile(), 'newest')

    quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now })
    const newest = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json')

    expect(existsSync(oldest)).toBe(false)
    expect(existsSync(newer)).toBe(true)
    expect(existsSync(newest)).toBe(true)
  })

  it('deletes an 8-day-old matching file but preserves 7-day, symlink, and unrelated files', () => {
    const expired = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260711T100000Z.json')
    const retained = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260712T100000Z.json')
    const target = path.join(testDir, 'outside-target.txt')
    const symlink = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260710T100000Z.json')
    const unrelated = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260711T100000Z.json.extra')
    writeFileSync(expired, 'expired')
    writeFileSync(retained, 'retained')
    writeFileSync(target, 'outside')
    symlinkSync(target, symlink)
    writeFileSync(unrelated, 'unrelated')
    utimesSync(expired, new Date('2026-07-11T09:59:59.000Z'), new Date('2026-07-11T09:59:59.000Z'))
    utimesSync(retained, new Date('2026-07-12T10:00:00.000Z'), new Date('2026-07-12T10:00:00.000Z'))

    garbageCollectMigrationDiagnosticsQuarantines(journalFile(), { now })

    expect(existsSync(expired)).toBe(false)
    expect(existsSync(retained)).toBe(true)
    expect(lstatSync(symlink).isSymbolicLink()).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('outside')
    expect(existsSync(unrelated)).toBe(true)
  })

  it('derives independent v1 and v2 quarantine basenames from the supplied journal file', () => {
    writeFileSync(journalFile(), 'corrupt-v2')
    writeFileSync(legacyJournalFile(), 'corrupt-v1')

    quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now })
    quarantineCorruptMigrationDiagnosticsJournal(legacyJournalFile(), { now })

    expect(readFileSync(path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json'), 'utf8')).toBe(
      'corrupt-v2'
    )
    expect(readFileSync(path.join(testDir, 'migration-diagnostics-v1.corrupt.20260719T100000Z.json'), 'utf8')).toBe(
      'corrupt-v1'
    )
  })
})

describe('cleanupMigrationDiagnosticsJournal', () => {
  it('deletes only the live journal and exact tmp while preserving corrupt and unrelated files', () => {
    const corrupt = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json')
    const unrelated = path.join(testDir, 'migration-diagnostics-v2.json.backup')
    writeFileSync(journalFile(), 'live')
    writeFileSync(`${journalFile()}.tmp`, 'tmp')
    writeFileSync(corrupt, 'corrupt')
    writeFileSync(unrelated, 'unrelated')

    cleanupMigrationDiagnosticsJournal(journalFile(), { platform: 'darwin' })

    expect(existsSync(journalFile())).toBe(false)
    expect(existsSync(`${journalFile()}.tmp`)).toBe(false)
    expect(existsSync(corrupt)).toBe(true)
    expect(existsSync(unrelated)).toBe(true)
  })

  it('treats ENOENT as benign', () => {
    expect(() => cleanupMigrationDiagnosticsJournal(journalFile())).not.toThrow()
    expect(readdirSync(testDir)).toEqual([])
  })
})
