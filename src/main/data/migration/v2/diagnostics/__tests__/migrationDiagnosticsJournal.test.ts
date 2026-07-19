import fs, {
  existsSync,
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
      closeSync: vi.fn(actual.closeSync),
      renameSync: vi.fn(actual.renameSync)
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

let testDir = ''

function journalFile(): string {
  return path.join(testDir, 'migration-diagnostics-v1.json')
}

function session(): MigrationDiagnosticsSession {
  return {
    version: 1,
    sessionId: 'session-1',
    appVersion: '2.0.0',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: '2026-07-19T10:00:00.000Z',
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
})

describe('corrupt quarantine', () => {
  const now = new Date('2026-07-19T10:00:00.000Z')

  it('uses a collision-safe UTC-basic filename without overwriting an existing copy', () => {
    const collision = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260719T100000Z.json')
    writeFileSync(collision, 'existing')
    writeFileSync(journalFile(), 'new-corrupt')

    const quarantined = quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now, platform: 'darwin' })
    const quarantineFile = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260719T100001Z.json')

    expect(quarantined).toBe(true)
    expect(readFileSync(collision, 'utf8')).toBe('existing')
    expect(readFileSync(quarantineFile, 'utf8')).toBe('new-corrupt')
    expect(existsSync(journalFile())).toBe(false)
  })

  it('keeps at most two matching regular copies and evicts the oldest when adding a third', () => {
    const oldest = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260718T090000Z.json')
    const newer = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260719T090000Z.json')
    writeFileSync(oldest, 'oldest')
    writeFileSync(newer, 'newer')
    utimesSync(oldest, new Date('2026-07-18T09:00:00.000Z'), new Date('2026-07-18T09:00:00.000Z'))
    utimesSync(newer, new Date('2026-07-19T09:00:00.000Z'), new Date('2026-07-19T09:00:00.000Z'))
    writeFileSync(journalFile(), 'newest')

    quarantineCorruptMigrationDiagnosticsJournal(journalFile(), { now })
    const newest = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260719T100000Z.json')

    expect(existsSync(oldest)).toBe(false)
    expect(existsSync(newer)).toBe(true)
    expect(existsSync(newest)).toBe(true)
  })

  it('deletes an 8-day-old matching file but preserves 7-day, symlink, and unrelated files', () => {
    const expired = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260711T100000Z.json')
    const retained = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260712T100000Z.json')
    const target = path.join(testDir, 'outside-target.txt')
    const symlink = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260710T100000Z.json')
    const unrelated = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260711T100000Z.json.extra')
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
})

describe('cleanupMigrationDiagnosticsJournal', () => {
  it('deletes only the live journal and exact tmp while preserving corrupt and unrelated files', () => {
    const corrupt = path.join(testDir, 'migration-diagnostics-v1.corrupt.20260719T100000Z.json')
    const unrelated = path.join(testDir, 'migration-diagnostics-v1.json.backup')
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
