import fs, { existsSync, fsyncSync, lstatSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
      renameSync: vi.fn(actual.renameSync),
      unlinkSync: vi.fn(actual.unlinkSync)
    }
  }
})

import {
  cleanupMigrationDiagnosticsJournal,
  MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES,
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

  it('leaves pre-publication failures unpublished and post-publication failures durable', () => {
    vi.mocked(fs.renameSync).mockImplementationOnce(() => {
      throw new Error('secret-before-/Users/alice')
    })
    expect(() => writeMigrationDiagnosticsJournal(journalFile(), checkpoint())).toThrow()
    expect(existsSync(journalFile())).toBe(false)

    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(() => {
        throw new Error('secret-after-/Users/alice')
      })
    expect(() => writeMigrationDiagnosticsJournal(journalFile(), checkpoint())).toThrow()
    expect(readMigrationDiagnosticsJournal(journalFile())).toEqual({ kind: 'ok', journal: checkpoint() })
  })
})

describe('cleanupMigrationDiagnosticsJournal', () => {
  it('deletes only the live journal and exact tmp while preserving unrelated files', () => {
    const unrelated = path.join(testDir, 'unrelated.json')
    writeFileSync(journalFile(), 'live')
    writeFileSync(`${journalFile()}.tmp`, 'tmp')
    writeFileSync(unrelated, 'unrelated')

    cleanupMigrationDiagnosticsJournal(journalFile(), { platform: 'darwin' })

    expect(readdirSync(testDir)).toEqual([path.basename(unrelated)])
  })

  it('treats ENOENT as benign', () => {
    expect(() => cleanupMigrationDiagnosticsJournal(journalFile())).not.toThrow()
  })
})
