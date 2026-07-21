import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
      renameSync: vi.fn(actual.renameSync)
    }
  }
})

import { MigrationDiagnosticsCoordinator } from '../MigrationDiagnosticsCoordinator'
import { readMigrationDiagnosticsJournal, writeMigrationDiagnosticsJournal } from '../migrationDiagnosticsJournal'
import type {
  MigrationDiagnosticFailure,
  MigrationDiagnosticLocation,
  MigrationDiagnosticsSnapshot
} from '../migrationDiagnosticsSchemas'

let testDir = ''
let now = new Date('2026-07-21T08:00:00.000Z')

const executeLocation = { scope: 'migrator', phase: 'execute', migratorId: 'chat' } as const

function paths(): { diagnosticsJournalFile: string } {
  return { diagnosticsJournalFile: path.join(testDir, 'migration-diagnostics-v2.json') }
}

function coordinator(): MigrationDiagnosticsCoordinator {
  return new MigrationDiagnosticsCoordinator({
    appVersion: '2.0.0-beta.1',
    platform: 'darwin',
    arch: 'arm64',
    clock: () => new Date(now)
  })
}

function writeFailure(
  errorCode: 'sqlite_too_big' | 'sqlite_constraint' = 'sqlite_too_big'
): MigrationDiagnosticFailure {
  return {
    kind: 'migration_write_failed',
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'chat',
    errorCode
  }
}

function activeCheckpoint(lastLocation: MigrationDiagnosticLocation = executeLocation): MigrationDiagnosticsSnapshot {
  return {
    formatVersion: 1,
    app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
    state: 'active',
    current: {
      trigger: 'initial',
      status: 'in_progress',
      startedAt: '2026-07-20T07:00:00.000Z',
      lastLocation
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostics-coordinator-'))
  now = new Date('2026-07-21T08:00:00.000Z')
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('minimal previous/current state', () => {
  it('runs fully in memory and normalizes app metadata', async () => {
    const subject = coordinator()

    subject.beginAttempt('initial')
    subject.updateLocation(executeLocation)
    now = new Date('2026-07-21T08:01:00.000Z')
    subject.finishAttempt({ status: 'failed', failure: writeFailure() })

    expect(await subject.snapshot()).toEqual({
      formatVersion: 1,
      app: { version: '2.0.0-beta.1', platform: 'darwin', arch: 'arm64' },
      state: 'failed',
      current: {
        trigger: 'initial',
        status: 'failed',
        startedAt: '2026-07-21T08:00:00.000Z',
        endedAt: '2026-07-21T08:01:00.000Z',
        lastLocation: executeLocation,
        failure: writeFailure()
      }
    })
    expect(fs.readdirSync(testDir)).toEqual([])
  })

  it('retains only the newest previous failed/interrupted attempt', async () => {
    const subject = coordinator()
    subject.beginAttempt('initial')
    subject.finishAttempt({ status: 'failed', failure: writeFailure('sqlite_constraint') })

    now = new Date('2026-07-21T08:01:00.000Z')
    subject.beginAttempt('manual_retry')
    const firstRetry = await subject.snapshot()
    expect(firstRetry.previous?.status).toBe('failed')
    expect(firstRetry.previous?.status === 'failed' ? firstRetry.previous.failure.errorCode : undefined).toBe(
      'sqlite_constraint'
    )
    subject.updateLocation(executeLocation)
    subject.finishAttempt({ status: 'failed', failure: writeFailure('sqlite_too_big') })

    now = new Date('2026-07-21T08:02:00.000Z')
    subject.beginAttempt('recovered_retry')
    const snapshot = await subject.snapshot()

    expect(snapshot.previous?.status).toBe('failed')
    expect(snapshot.previous?.status === 'failed' ? snapshot.previous.failure.errorCode : undefined).toBe(
      'sqlite_too_big'
    )
    expect(snapshot.current).toMatchObject({ trigger: 'recovered_retry', status: 'in_progress' })
    expect(snapshot).not.toHaveProperty('attempts')
    expect(JSON.stringify(snapshot)).not.toContain('sqlite_constraint')
  })

  it('records completion without persisting non-blocking warning metadata', async () => {
    const subject = coordinator()
    subject.beginAttempt('initial')

    subject.finishAttempt({ status: 'completed' })

    expect((await subject.snapshot()).current).toEqual({
      trigger: 'initial',
      status: 'completed',
      startedAt: '2026-07-21T08:00:00.000Z',
      endedAt: '2026-07-21T08:00:00.000Z',
      lastLocation: { scope: 'gate', phase: 'resolve_paths' }
    })
  })

  it('deep-freezes snapshots', async () => {
    const subject = coordinator()
    subject.beginAttempt('initial')
    const snapshot = await subject.snapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.current)).toBe(true)
    expect(Object.isFrozen(snapshot.current?.lastLocation)).toBe(true)
  })

  it('removes the durable checkpoint on complete but retains the completed in-memory snapshot', async () => {
    const subject = coordinator()
    subject.attachPaths(paths())
    subject.beginAttempt('initial')
    subject.finishAttempt({ status: 'completed' })

    subject.complete()

    expect(existsSync(paths().diagnosticsJournalFile)).toBe(false)
    expect((await subject.snapshot()).current).toMatchObject({ status: 'completed' })
    expect((await subject.snapshot()).current).not.toHaveProperty('warningCountBucket')
  })
})

describe('attachment and interruption recovery', () => {
  it('turns a durable in-progress checkpoint into a single interrupted failure', async () => {
    writeMigrationDiagnosticsJournal(paths().diagnosticsJournalFile, activeCheckpoint())
    const subject = coordinator()

    subject.attachPaths(paths())

    const snapshot = await subject.snapshot()
    expect(subject.recovered).toBe(true)
    expect(snapshot.state).toBe('failed')
    expect(snapshot.current).toEqual({
      trigger: 'initial',
      status: 'interrupted',
      startedAt: '2026-07-20T07:00:00.000Z',
      endedAt: '2026-07-21T08:00:00.000Z',
      lastLocation: executeLocation,
      failure: {
        kind: 'process_interrupted',
        scope: 'engine',
        phase: 'interrupted',
        errorCode: 'process_interrupted'
      }
    })
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)).toEqual({ kind: 'ok', journal: snapshot })
  })

  it('does not present an ordinary terminal failure as an interrupted recovery', async () => {
    writeMigrationDiagnosticsJournal(paths().diagnosticsJournalFile, {
      ...activeCheckpoint(),
      state: 'failed',
      current: {
        trigger: 'initial',
        status: 'failed',
        startedAt: '2026-07-20T07:00:00.000Z',
        endedAt: '2026-07-20T07:01:00.000Z',
        lastLocation: executeLocation,
        failure: writeFailure()
      }
    })
    const subject = coordinator()

    subject.attachPaths(paths())

    expect(subject.recovered).toBe(false)
    expect((await subject.snapshot()).current).toMatchObject({ status: 'failed' })
  })

  it.each([
    ['old strict v2', JSON.stringify({ version: 2, sessionId: 'strict-branch', attempts: [] }), 'none'],
    ['old v1', JSON.stringify({ version: 1, sessionId: 'old-branch', attempts: [] }), 'none'],
    ['damaged JSON', '{"formatVersion":', 'none'],
    ['oversized', 'x'.repeat(1_048_577), 'none'],
    ['non-regular', null, 'corrupt']
  ] as const)('discards or ignores %s without touching business data', async (_name, content, journalKind) => {
    writeFileSync(path.join(testDir, 'cherrystudio.sqlite'), 'business-canary')
    if (content === null) fs.mkdirSync(paths().diagnosticsJournalFile)
    else writeFileSync(paths().diagnosticsJournalFile, content)
    const subject = coordinator()

    expect(() => subject.attachPaths(paths())).not.toThrow()

    expect(subject.recovered).toBe(false)
    expect(await subject.snapshot()).toMatchObject({ state: 'active' })
    expect(readFileSync(path.join(testDir, 'cherrystudio.sqlite'), 'utf8')).toBe('business-canary')
    expect(fs.readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v2.corrupt.'))).toBe(false)
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile).kind).toBe(journalKind)
  })
})

describe('diagnostics non-interference', () => {
  it.each(['open', 'write', 'fsync', 'rename'] as const)(
    'keeps memory state usable when checkpoint %s fails',
    async (operation) => {
      const subject = coordinator()
      subject.attachPaths(paths())
      const method =
        operation === 'open'
          ? fs.openSync
          : operation === 'write'
            ? fs.writeSync
            : operation === 'fsync'
              ? fs.fsyncSync
              : fs.renameSync
      vi.mocked(method).mockImplementationOnce(() => {
        throw new Error(`private-${operation}-failure-/Users/alice`)
      })

      expect(() => subject.beginAttempt('initial')).not.toThrow()
      expect(() => subject.updateLocation(executeLocation)).not.toThrow()
      expect(() => subject.finishAttempt({ status: 'failed', failure: writeFailure() })).not.toThrow()

      expect(subject.recovered).toBe(false)
      expect((await subject.snapshot()).current).toMatchObject({
        status: 'failed',
        lastLocation: executeLocation,
        failure: { errorCode: 'sqlite_too_big' }
      })
    }
  )
})
