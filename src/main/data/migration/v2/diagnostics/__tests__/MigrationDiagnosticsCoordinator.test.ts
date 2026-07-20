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

const initialLocation = { scope: 'gate', phase: 'resolve_paths' } as const
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
      app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
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
    expect((await subject.snapshot()).previous?.failure.errorCode).toBe('sqlite_constraint')
    subject.updateLocation(executeLocation)
    subject.finishAttempt({ status: 'failed', failure: writeFailure('sqlite_too_big') })

    now = new Date('2026-07-21T08:02:00.000Z')
    subject.beginAttempt('recovered_retry')
    const snapshot = await subject.snapshot()

    expect(snapshot.previous?.failure.errorCode).toBe('sqlite_too_big')
    expect(snapshot.current).toMatchObject({ trigger: 'recovered_retry', status: 'in_progress' })
    expect(snapshot).not.toHaveProperty('attempts')
    expect(JSON.stringify(snapshot)).not.toContain('sqlite_constraint')
  })

  it.each([
    [0, '0'],
    [1, '1'],
    [2, '2-10'],
    [10, '2-10'],
    [11, '11+']
  ] as const)('buckets %i completed warnings as %s', async (warningCount, warningCountBucket) => {
    const subject = coordinator()
    subject.beginAttempt('initial')

    subject.finishAttempt({ status: 'completed', warningCount })

    expect((await subject.snapshot()).current).toMatchObject({ status: 'completed', warningCountBucket })
  })

  it('deep-freezes snapshots and serializes concurrent saves', async () => {
    const subject = coordinator()
    subject.beginAttempt('initial')
    const snapshot = await subject.snapshot()
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.current)).toBe(true)
    expect(Object.isFrozen(snapshot.current?.lastLocation)).toBe(true)

    let release: ((value: string) => void) | undefined
    const first = subject.runSave(
      () =>
        new Promise<string>((resolve) => {
          release = resolve
        })
    )
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))

    await expect(subject.runSave(async () => 'second')).resolves.toEqual({
      status: 'failed',
      code: 'save_in_progress'
    })
    release?.('first')
    await expect(first).resolves.toBe('first')
  })

  it('removes the durable checkpoint on complete but retains the completed in-memory snapshot', async () => {
    const subject = coordinator()
    subject.attachPaths(paths())
    subject.beginAttempt('initial')
    subject.finishAttempt({ status: 'completed', warningCount: 2 })

    subject.complete()

    expect(existsSync(paths().diagnosticsJournalFile)).toBe(false)
    expect((await subject.snapshot()).current).toMatchObject({ status: 'completed', warningCountBucket: '2-10' })
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
        errorCode: 'process_interrupted',
        evidence: { kind: 'interruption', lastLocation: executeLocation, recoverySource: 'checkpoint' }
      }
    })
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)).toEqual({ kind: 'ok', journal: snapshot })
  })

  it.each([
    ['old strict v2', JSON.stringify({ version: 2, sessionId: 'strict-branch', attempts: [] }), true],
    ['old v1', JSON.stringify({ version: 1, sessionId: 'old-branch', attempts: [] }), true],
    ['damaged JSON', '{"formatVersion":', true],
    ['oversized', 'x'.repeat(1_048_577), true],
    ['non-regular', null, false]
  ] as const)('quarantines or ignores %s without touching business data', async (_name, content, quarantined) => {
    writeFileSync(path.join(testDir, 'cherrystudio.sqlite'), 'business-canary')
    if (content === null) fs.mkdirSync(paths().diagnosticsJournalFile)
    else writeFileSync(paths().diagnosticsJournalFile, content)
    const subject = coordinator()

    expect(() => subject.attachPaths(paths())).not.toThrow()

    expect(subject.recovered).toBe(false)
    expect(await subject.snapshot()).toMatchObject({ state: 'active' })
    expect(readFileSync(path.join(testDir, 'cherrystudio.sqlite'), 'utf8')).toBe('business-canary')
    expect(fs.readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v2.corrupt.'))).toBe(
      quarantined
    )
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
