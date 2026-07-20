import fs, { existsSync, fsyncSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs>()
  return {
    ...actual,
    default: {
      ...actual,
      fsyncSync: vi.fn(actual.fsyncSync),
      lstatSync: vi.fn(actual.lstatSync)
    }
  }
})

import type { MigrationPaths } from '../../core/MigrationPaths'
import { MigrationDiagnosticsCoordinator } from '../MigrationDiagnosticsCoordinator'
import {
  MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES,
  readMigrationDiagnosticsJournal,
  writeMigrationDiagnosticsJournal
} from '../migrationDiagnosticsJournal'
import {
  MIGRATION_DIAGNOSTICS_MAX_EVENTS,
  type MigrationDiagnosticEventInput,
  type MigrationDiagnosticsSession,
  migrationDiagnosticsSessionSchema,
  PAYLOAD_PROFILE_SLOTS,
  type PayloadLengthProfile
} from '../migrationDiagnosticsSchemas'

let testDir = ''
let now = new Date('2026-07-19T10:00:00.000Z')
let nextId = 0

function paths(): MigrationPaths {
  return Object.freeze({
    userData: testDir,
    cherryHome: path.join(testDir, '.cherrystudio'),
    databaseFile: path.join(testDir, 'cherrystudio.sqlite'),
    knowledgeBaseDir: path.join(testDir, 'Data', 'KnowledgeBase'),
    filesDataDir: path.join(testDir, 'Data', 'Files'),
    versionLogFile: path.join(testDir, 'version.log'),
    legacyAgentDbFile: path.join(testDir, 'Data', 'agents.db'),
    agentWorkspacesDir: path.join(testDir, 'Data', 'Agents'),
    customMiniAppsFile: path.join(testDir, 'Data', 'Files', 'custom-minapps.json'),
    legacyConfigFile: path.join(testDir, '.cherrystudio', 'config', 'config.json'),
    migrationsFolder: path.join(testDir, 'migrations'),
    diagnosticsJournalFile: path.join(testDir, 'migration-diagnostics-v2.json'),
    legacyDiagnosticsJournalFile: path.join(testDir, 'migration-diagnostics-v1.json')
  })
}

function coordinator(): MigrationDiagnosticsCoordinator {
  return new MigrationDiagnosticsCoordinator({
    appVersion: '2.0.0-test',
    platform: 'darwin',
    arch: 'arm64',
    clock: () => new Date(now),
    idGenerator: () => `random-${++nextId}`
  })
}

function eventInput(overrides: Partial<MigrationDiagnosticEventInput> = {}): MigrationDiagnosticEventInput {
  return {
    scope: 'engine',
    phase: 'execute',
    state: 'started',
    code: 'unknown',
    ...overrides
  }
}

const MAXIMUM_SHAPE_PAYLOAD_PROFILE: PayloadLengthProfile = {
  target: 'knowledge_vector_status',
  rowCountBucket: '101-1000',
  profiledByteLengthBucket: '65537-262144',
  maxProfiledRowByteLengthBucket: '65537-262144',
  traversal: 'truncated',
  slots: Array.from({ length: 64 }, (_, index) => ({
    slot: PAYLOAD_PROFILE_SLOTS[index % PAYLOAD_PROFILE_SLOTS.length] ?? 'value',
    kind: 'json' as const,
    totalSerializedByteLengthBucket: '65537-262144' as const,
    maxSerializedByteLengthBucket: '65537-262144' as const,
    maxStringLeafCharLengthBucket: '65537-262144' as const,
    maxStringLeafByteLengthBucket: '65537-262144' as const,
    traversal: 'truncated' as const
  }))
}

function oldSession(overrides: Partial<MigrationDiagnosticsSession> = {}): MigrationDiagnosticsSession {
  return {
    version: 2,
    sessionId: 'old-session',
    appVersion: '1.9.12',
    platform: 'win32',
    arch: 'x64',
    startedAt: '2026-07-19T08:00:00.000Z',
    state: 'failed',
    attempts: [
      {
        id: 'old-attempt',
        trigger: 'initial',
        startedAt: '2026-07-19T08:01:00.000Z',
        outcome: 'failed',
        endedAt: '2026-07-19T08:02:00.000Z',
        events: [
          {
            sequence: 7,
            at: '2026-07-19T08:02:00.000Z',
            attemptId: 'old-attempt',
            scope: 'gate',
            phase: 'finalize',
            state: 'failed',
            code: 'unknown'
          }
        ]
      }
    ],
    ...overrides
  }
}

function legacySession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    sessionId: 'legacy-session',
    appVersion: '1.9.12',
    platform: 'win32',
    arch: 'x64',
    startedAt: '2026-07-19T08:00:00.000Z',
    state: 'active',
    attempts: [
      {
        id: 'legacy-attempt',
        trigger: 'initial',
        startedAt: '2026-07-19T08:01:00.000Z',
        outcome: 'in_progress',
        events: [
          {
            sequence: 7,
            at: '2026-07-19T08:03:00.000Z',
            attemptId: 'legacy-attempt',
            migratorId: 'future-v1-migrator',
            scope: 'gate',
            phase: 'validate',
            state: 'unavailable',
            code: 'upgrade_path_blocked',
            category: 'source',
            causeDepth: 2,
            payloadProfile: {
              target: 'preference',
              rowCountBucket: '1',
              profiledByteLengthBucket: '1-256',
              maxProfiledRowByteLengthBucket: '1-256',
              traversal: 'complete',
              slots: [
                {
                  slot: 'value',
                  kind: 'string',
                  totalByteLengthBucket: '1-256',
                  maxCharLengthBucket: '1-256',
                  maxByteLengthBucket: '1-256'
                }
              ]
            },
            versionGate: {
              reason: 'v1_too_old',
              currentVersion: '2.0.0',
              previousVersion: '1.8.0',
              requiredVersion: '1.9.12',
              gatewayVersion: null,
              versionLog: 'present'
            }
          },
          {
            sequence: 8,
            at: '2026-07-19T08:04:00.000Z',
            attemptId: 'legacy-attempt',
            scope: 'gate',
            phase: 'validate',
            state: 'unavailable',
            code: 'upgrade_path_blocked',
            versionGate: {
              reason: 'no_version_log',
              currentVersion: '2.0.0',
              previousVersion: null,
              requiredVersion: '1.9.12',
              gatewayVersion: null,
              versionLog: 'missing'
            }
          },
          {
            sequence: 9,
            at: '2026-07-19T08:05:00.000Z',
            attemptId: 'legacy-attempt',
            migratorId: 'bootConfig',
            scope: 'engine',
            phase: 'execute',
            state: 'started',
            code: 'unknown'
          }
        ]
      }
    ],
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  testDir = mkdtempSync(path.join(tmpdir(), 'cs-migration-diagnostics-coordinator-'))
  now = new Date('2026-07-19T10:00:00.000Z')
  nextId = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(testDir, { recursive: true, force: true })
})

describe('MigrationDiagnosticsCoordinator attachment and recovery', () => {
  it('works in memory without constructing or writing a filesystem path', async () => {
    const subject = coordinator()
    const attemptId = subject.beginAttempt('initial')
    subject.recordEvent(eventInput())

    const snapshot = await subject.snapshot()

    expect(attemptId).toBe('random-2')
    expect(snapshot.sessionId).toBe('random-1')
    expect(snapshot.attempts).toHaveLength(1)
    expect(readdirSync(testDir)).toEqual([])
  })

  it('persists its current memory session when attach finds no journal', () => {
    const subject = coordinator()
    subject.beginAttempt('initial')

    subject.attachPaths(paths())

    const persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind).toBe('ok')
    if (persisted.kind === 'ok') {
      expect(persisted.journal.sessionId).toBe('random-1')
      expect(persisted.journal.attempts[0]?.id).toBe('random-2')
    }
    expect(subject.recovered).toBe(false)
  })

  it('recovers a valid unfinished journal without overwriting it', async () => {
    writeMigrationDiagnosticsJournal(paths().diagnosticsJournalFile, oldSession())
    const subject = coordinator()

    subject.attachPaths(paths())

    expect(subject.recovered).toBe(true)
    expect((await subject.snapshot()).sessionId).toBe('old-session')
    const persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.sessionId).toBe('old-session')
  })

  it('upgrades a valid unfinished v1 journal through the strict allowlist before recovering it', async () => {
    writeFileSync(paths().legacyDiagnosticsJournalFile, JSON.stringify(legacySession()), { mode: 0o600 })
    const subject = coordinator()

    subject.attachPaths(paths())

    const snapshot = await subject.snapshot()
    const legacyEvent = snapshot.attempts[0]?.events[0]
    const missingMigratorEvent = snapshot.attempts[0]?.events[1]
    const fixedMigratorEvent = snapshot.attempts[0]?.events[2]
    expect(subject.recovered).toBe(true)
    expect(snapshot.version).toBe(2)
    expect(snapshot.sessionId).toBe('legacy-session')
    expect(snapshot.state).toBe('failed')
    expect(snapshot.attempts[0]?.outcome).toBe('interrupted')
    expect(legacyEvent).toMatchObject({
      sequence: 7,
      at: '2026-07-19T08:03:00.000Z',
      attemptId: 'legacy-attempt',
      migratorId: 'unknown',
      category: 'source',
      causeDepth: 2,
      versionGate: {
        reason: 'v1_too_old',
        directorySelectionRole: 'unknown',
        versionLog: {
          state: 'parsed',
          validRecordCountBucket: 'unknown',
          invalidRecordCountBucket: 'unknown'
        }
      }
    })
    expect(legacyEvent?.payloadProfile).toEqual(
      (legacySession().attempts as Array<{ events: Array<{ payloadProfile: unknown }> }>)[0]?.events[0]?.payloadProfile
    )
    expect(legacyEvent).not.toHaveProperty('semanticEvidence')
    expect(missingMigratorEvent).not.toHaveProperty('migratorId')
    expect(missingMigratorEvent?.versionGate).toMatchObject({
      directorySelectionRole: 'unknown',
      versionLog: { state: 'missing' }
    })
    expect(fixedMigratorEvent?.migratorId).toBe('bootConfig')
    expect(snapshot.attempts[0]?.events.at(-1)).toMatchObject({ sequence: 10, state: 'interrupted' })
    expect(existsSync(paths().legacyDiagnosticsJournalFile)).toBe(false)
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)).toEqual({ kind: 'ok', journal: snapshot })
  })

  it('publishes a valid completed v1 journal before replacing it with the fresh active v2 session', async () => {
    const completed = legacySession({
      state: 'completed',
      attempts: [
        {
          id: 'legacy-completed-attempt',
          trigger: 'initial',
          startedAt: '2026-07-19T08:01:00.000Z',
          outcome: 'completed',
          endedAt: '2026-07-19T08:02:00.000Z',
          events: [
            {
              sequence: 1,
              at: '2026-07-19T08:02:00.000Z',
              attemptId: 'legacy-completed-attempt',
              scope: 'gate',
              phase: 'finalize',
              state: 'completed',
              code: 'unknown'
            }
          ]
        }
      ]
    })
    writeFileSync(paths().legacyDiagnosticsJournalFile, JSON.stringify(completed), { mode: 0o600 })
    const subject = coordinator()

    subject.attachPaths(paths())

    expect(subject.recovered).toBe(false)
    expect((await subject.snapshot()).sessionId).toBe('random-1')
    expect(existsSync(paths().legacyDiagnosticsJournalFile)).toBe(false)
    const persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.sessionId).toBe('random-1')
  })

  it('upgrades a schema-valid v1 renderer failure with only fixed unknown compatibility evidence', async () => {
    const canary = 'RENDERER_USER_CANARY_/Users/alice'
    const rendererFailure = legacySession({
      state: 'failed',
      attempts: [
        {
          id: 'legacy-renderer-attempt',
          trigger: 'initial',
          startedAt: '2026-07-19T08:01:00.000Z',
          outcome: 'failed',
          endedAt: '2026-07-19T08:02:00.000Z',
          events: [
            {
              sequence: 1,
              at: '2026-07-19T08:02:00.000Z',
              attemptId: 'legacy-renderer-attempt',
              migratorId: canary,
              scope: 'renderer_export',
              phase: 'finalize',
              state: 'failed',
              code: 'source_parse',
              category: 'source',
              causeDepth: 4
            }
          ]
        }
      ]
    })
    writeFileSync(paths().legacyDiagnosticsJournalFile, JSON.stringify(rendererFailure), { mode: 0o600 })
    const subject = coordinator()

    subject.attachPaths(paths())

    const snapshot = await subject.snapshot()
    expect(subject.recovered).toBe(true)
    expect(snapshot.attempts[0]?.events[0]).toEqual({
      sequence: 1,
      at: '2026-07-19T08:02:00.000Z',
      attemptId: 'legacy-renderer-attempt',
      migratorId: 'unknown',
      scope: 'renderer_export',
      phase: 'finalize',
      state: 'failed',
      code: 'unknown',
      category: 'unknown',
      semanticEvidence: {
        kind: 'renderer_export_failure',
        sourceRole: 'unknown',
        operationRole: 'unknown'
      }
    })
    expect(migrationDiagnosticsSessionSchema.safeParse(snapshot).success).toBe(true)
    expect(existsSync(paths().legacyDiagnosticsJournalFile)).toBe(false)
    expect(readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v1.corrupt.'))).toBe(false)
    expect(readFileSync(paths().diagnosticsJournalFile, 'utf8')).not.toContain(canary)
  })

  it('does not delete the only valid v1 journal when v2 publication fails', () => {
    const serialized = JSON.stringify(legacySession())
    writeFileSync(paths().legacyDiagnosticsJournalFile, serialized, { mode: 0o600 })
    vi.mocked(fs.fsyncSync).mockImplementationOnce(() => {
      throw new Error('publication-canary-/Users/alice')
    })
    const subject = coordinator()

    expect(() => subject.attachPaths(paths())).toThrow('Migration diagnostics journal write failed before publication')

    expect(readFileSync(paths().legacyDiagnosticsJournalFile, 'utf8')).toBe(serialized)
    expect(existsSync(paths().diagnosticsJournalFile)).toBe(false)
  })

  it('retains upgraded memory and v1 when v2 was renamed into place but publication durability is uncertain', async () => {
    const serialized = JSON.stringify(legacySession())
    writeFileSync(paths().legacyDiagnosticsJournalFile, serialized, { mode: 0o600 })
    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(() => {
        throw new Error('directory-fsync-canary-/Users/alice')
      })
    const subject = coordinator()

    expect(() => subject.attachPaths(paths())).toThrow('Migration diagnostics journal write failed after publication')

    expect(readFileSync(paths().legacyDiagnosticsJournalFile, 'utf8')).toBe(serialized)
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile).kind).toBe('ok')
    expect((await subject.snapshot()).sessionId).toBe('legacy-session')
  })

  it('keeps upgraded history in memory when legacy cleanup unlinks v1 before directory fsync fails', async () => {
    const completedFailure = legacySession({
      state: 'failed',
      attempts: [
        {
          id: 'legacy-failed-attempt',
          trigger: 'initial',
          startedAt: '2026-07-19T08:01:00.000Z',
          outcome: 'failed',
          endedAt: '2026-07-19T08:02:00.000Z',
          events: [
            {
              sequence: 7,
              at: '2026-07-19T08:02:00.000Z',
              attemptId: 'legacy-failed-attempt',
              scope: 'gate',
              phase: 'finalize',
              state: 'failed',
              code: 'unknown'
            }
          ]
        }
      ]
    })
    writeFileSync(paths().legacyDiagnosticsJournalFile, JSON.stringify(completedFailure), { mode: 0o600 })
    vi.mocked(fs.fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(fsyncSync)
      .mockImplementationOnce(() => {
        throw new Error('legacy-cleanup-directory-fsync-failed')
      })
    const subject = coordinator()

    expect(() => subject.attachPaths(paths())).toThrow('legacy-cleanup-directory-fsync-failed')
    expect(existsSync(paths().legacyDiagnosticsJournalFile)).toBe(false)

    subject.beginAttempt('initial')
    subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))

    const snapshot = await subject.snapshot()
    expect(snapshot.sessionId).toBe('legacy-session')
    expect(snapshot.attempts).toHaveLength(2)
    expect(snapshot.attempts[0]?.id).toBe('legacy-failed-attempt')
    expect(snapshot.attempts[0]?.events[0]?.sequence).toBe(7)
    expect(snapshot.attempts[1]).toMatchObject({ id: 'random-2', trigger: 'initial', outcome: 'failed' })
    expect(snapshot.attempts[1]?.events.at(-1)?.sequence).toBe(8)
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)).toEqual({ kind: 'ok', journal: snapshot })
  })

  it('quarantines invalid v1 without allowing its privacy canary into fresh v2 state', async () => {
    const canary = 'INVALID_V1_SECRET_sk-user-/Users/alice'
    writeFileSync(paths().legacyDiagnosticsJournalFile, JSON.stringify({ ...legacySession(), rawError: canary }), {
      mode: 0o600
    })
    const subject = coordinator()

    const result = subject.attachPaths(paths())

    const snapshot = await subject.snapshot()
    const persisted = readFileSync(paths().diagnosticsJournalFile, 'utf8')
    expect(result).toBeUndefined()
    expect(subject.recovered).toBe(false)
    expect(snapshot.sessionId).toBe('random-1')
    expect(JSON.stringify(snapshot)).not.toContain(canary)
    expect(persisted).not.toContain(canary)
    expect(readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v1.corrupt.'))).toBe(true)
  })

  it('quarantines oversized v1 without allowing its privacy canary into fresh v2 state', async () => {
    const canary = 'OVERSIZED_V1_SECRET_sk-user-/Users/alice'
    const oversized = Buffer.alloc(MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES + 1, 'x')
    oversized.set(Buffer.from(canary), 0)
    writeFileSync(paths().legacyDiagnosticsJournalFile, oversized, { mode: 0o600 })
    const subject = coordinator()

    const result = subject.attachPaths(paths())

    const snapshot = await subject.snapshot()
    const persisted = readFileSync(paths().diagnosticsJournalFile, 'utf8')
    expect(result).toBeUndefined()
    expect(subject.recovered).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain(canary)
    expect(persisted).not.toContain(canary)
    expect(readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v1.corrupt.'))).toBe(true)
  })

  it('gives an existing valid v2 journal precedence without reading or modifying v1', async () => {
    writeMigrationDiagnosticsJournal(paths().diagnosticsJournalFile, oldSession())
    const legacyRaw = JSON.stringify({ ...legacySession(), precedenceCanary: 'must-remain-untouched' })
    writeFileSync(paths().legacyDiagnosticsJournalFile, legacyRaw, { mode: 0o600 })
    const subject = coordinator()
    vi.mocked(fs.lstatSync).mockClear()

    subject.attachPaths(paths())

    expect(subject.recovered).toBe(true)
    expect((await subject.snapshot()).sessionId).toBe('old-session')
    expect(readFileSync(paths().legacyDiagnosticsJournalFile, 'utf8')).toBe(legacyRaw)
    expect(vi.mocked(fs.lstatSync).mock.calls.some(([file]) => file === paths().legacyDiagnosticsJournalFile)).toBe(
      false
    )
    expect(readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v1.corrupt.'))).toBe(false)
  })

  it('quarantines corrupt v2 and starts fresh without falling back to valid v1', async () => {
    const v2Canary = 'CORRUPT_V2_SECRET'
    const legacyRaw = JSON.stringify(legacySession())
    writeFileSync(paths().diagnosticsJournalFile, `{ "rawError": "${v2Canary}"`)
    writeFileSync(paths().legacyDiagnosticsJournalFile, legacyRaw, { mode: 0o600 })
    const subject = coordinator()
    vi.mocked(fs.lstatSync).mockClear()

    subject.attachPaths(paths())

    const snapshot = await subject.snapshot()
    expect(subject.recovered).toBe(false)
    expect(snapshot.sessionId).toBe('random-1')
    expect(readFileSync(paths().legacyDiagnosticsJournalFile, 'utf8')).toBe(legacyRaw)
    expect(vi.mocked(fs.lstatSync).mock.calls.some(([file]) => file === paths().legacyDiagnosticsJournalFile)).toBe(
      false
    )
    expect(readdirSync(testDir).some((name) => name.startsWith('migration-diagnostics-v2.corrupt.'))).toBe(true)
    expect(readFileSync(paths().diagnosticsJournalFile, 'utf8')).not.toContain(v2Canary)
  })

  it('quarantines corrupt input and persists only the fresh safe session', async () => {
    writeFileSync(paths().diagnosticsJournalFile, '{"rawError":"sk-secret"')
    const subject = coordinator()

    subject.attachPaths(paths())

    expect(subject.recovered).toBe(false)
    expect((await subject.snapshot()).sessionId).toBe('random-1')
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile).kind).toBe('ok')
    expect(readdirSync(testDir).filter((name) => name.includes('.corrupt.'))).toHaveLength(1)
  })

  it('quarantines a completed journal that contradictorily retains an active attempt', async () => {
    const contradictoryJournal = {
      version: 2,
      sessionId: 'contradictory-session',
      appVersion: '1.9.12',
      platform: 'win32',
      arch: 'x64',
      startedAt: '2026-07-19T08:00:00.000Z',
      state: 'completed',
      attempts: [
        {
          id: 'unfinished-attempt',
          trigger: 'initial',
          startedAt: '2026-07-19T08:01:00.000Z',
          outcome: 'in_progress',
          events: []
        }
      ]
    }
    writeFileSync(paths().diagnosticsJournalFile, JSON.stringify(contradictoryJournal), { mode: 0o600 })
    const subject = coordinator()

    subject.attachPaths(paths())

    expect(subject.recovered).toBe(false)
    expect((await subject.snapshot()).sessionId).toBe('random-1')
    expect(readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile).kind).toBe('ok')
    expect(readdirSync(testDir).filter((name) => name.includes('.corrupt.'))).toHaveLength(1)
  })

  it('allows paths to attach only once', () => {
    const subject = coordinator()
    subject.attachPaths(paths())

    expect(() => subject.attachPaths(paths())).toThrow('already attached')
  })

  it('closes a recovered in-progress attempt at its last recorded time, excluding downtime', async () => {
    const unfinished = oldSession({
      state: 'active',
      attempts: [
        {
          id: 'old-attempt',
          trigger: 'initial',
          startedAt: '2026-07-19T08:01:00.000Z',
          outcome: 'in_progress',
          events: [
            {
              sequence: 7,
              at: '2026-07-19T08:03:00.000Z',
              attemptId: 'old-attempt',
              scope: 'engine',
              phase: 'execute',
              state: 'started',
              code: 'unknown'
            }
          ]
        }
      ]
    })
    writeMigrationDiagnosticsJournal(paths().diagnosticsJournalFile, unfinished)
    now = new Date('2026-07-19T12:00:00.000Z')
    const subject = coordinator()

    subject.attachPaths(paths())
    const recovered = await subject.snapshot()
    const recoveredAttempt = recovered.attempts[0]

    expect(recovered.state).toBe('failed')
    expect(recoveredAttempt?.outcome).toBe('interrupted')
    if (recoveredAttempt?.outcome !== 'interrupted') {
      throw new Error('Expected the recovered attempt to be interrupted')
    }
    expect(recoveredAttempt.endedAt).toBe('2026-07-19T08:03:00.000Z')
    expect(recoveredAttempt.events.at(-1)).toEqual({
      sequence: 8,
      at: '2026-07-19T08:03:00.000Z',
      attemptId: 'old-attempt',
      scope: 'gate',
      phase: 'finalize',
      state: 'interrupted',
      code: 'unknown'
    })
  })
})

describe('MigrationDiagnosticsCoordinator attempts and retention', () => {
  it('persists attempt, event, failure, and retry boundaries after attachment', () => {
    const subject = coordinator()
    subject.attachPaths(paths())
    const attemptId = subject.beginAttempt('initial')
    let persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.attempts[0]?.id).toBe(attemptId)

    subject.recordEvent(eventInput())
    persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.attempts[0]?.events).toHaveLength(1)

    now = new Date('2026-07-19T10:01:00.000Z')
    subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))
    persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.state).toBe('failed')
    expect(persisted.kind === 'ok' && persisted.journal.attempts[0]?.outcome).toBe('failed')

    subject.beginAttempt('manual_retry')
    persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.state).toBe('active')
  })

  it('rejects recording or finishing without an active attempt', () => {
    const subject = coordinator()

    expect(() => subject.recordEvent(eventInput())).toThrow('active attempt')
    expect(() =>
      subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))
    ).toThrow('active attempt')
  })

  it('validates safe event input before mutation or persistence', async () => {
    const subject = coordinator()
    subject.attachPaths(paths())
    subject.beginAttempt('initial')

    expect(() =>
      subject.recordEvent({ ...eventInput(), rawError: 'sk-secret' } as MigrationDiagnosticEventInput)
    ).toThrow()
    expect((await subject.snapshot()).attempts[0]?.events).toEqual([])
    const persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.attempts[0]?.events).toEqual([])
  })

  it('adopts a snapshot published before its parent-directory fsync failure', async () => {
    const subject = coordinator()
    subject.attachPaths(paths())
    const rawFailure = 'secret-dirsync-/Users/alice'
    const fsync = vi.mocked(fs.fsyncSync)
    fsync.mockImplementationOnce(fsyncSync).mockImplementationOnce(() => {
      throw new Error(rawFailure)
    })
    let failure: unknown

    try {
      subject.beginAttempt('initial')
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({
      name: 'MigrationDiagnosticsJournalWriteError',
      code: 'journal_write_failed',
      publication: 'published'
    })
    expect(failure).toBeInstanceOf(Error)
    if (!(failure instanceof Error)) {
      throw new Error('Expected a journal write error')
    }
    expect(failure.message).toBe('Migration diagnostics journal write failed after publication')
    expect(failure.message).not.toContain(rawFailure)
    expect(failure.message).not.toContain(testDir)
    fsync.mockImplementation(fsyncSync)

    const published = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(published.kind === 'ok' && published.journal.attempts[0]?.id).toBe('random-2')
    expect((await subject.snapshot()).attempts[0]?.id).toBe('random-2')

    subject.recordEvent(eventInput())

    expect((await subject.snapshot()).attempts[0]?.events[0]?.sequence).toBe(1)
    const persisted = readMigrationDiagnosticsJournal(paths().diagnosticsJournalFile)
    expect(persisted.kind === 'ok' && persisted.journal.attempts[0]?.events[0]?.sequence).toBe(1)
  })

  it('retains at most five newest attempts', async () => {
    const subject = coordinator()
    for (let index = 0; index < 6; index += 1) {
      subject.beginAttempt(index === 0 ? 'initial' : 'manual_retry')
      subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))
    }

    const snapshot = await subject.snapshot()

    expect(snapshot.attempts).toHaveLength(5)
    expect(snapshot.attempts.map((attempt) => attempt.id)).toEqual([
      'random-3',
      'random-4',
      'random-5',
      'random-6',
      'random-7'
    ])
  })

  it('retains 200 total events plus every terminal and causal representative across five attempts', async () => {
    const subject = coordinator()
    const causalSequences: number[] = []
    for (let attemptIndex = 0; attemptIndex < 5; attemptIndex += 1) {
      subject.beginAttempt(attemptIndex === 0 ? 'initial' : 'manual_retry')
      for (let eventIndex = 0; eventIndex < 45; eventIndex += 1) {
        const isCause = eventIndex === 10
        subject.recordEvent(
          eventInput(isCause ? { state: 'warning', code: 'source_parse', category: 'source' } : undefined)
        )
        if (isCause) causalSequences.push(attemptIndex * 46 + eventIndex + 1)
      }
      subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))
    }

    const snapshot = await subject.snapshot()
    const events = snapshot.attempts.flatMap((attempt) => attempt.events)

    expect(events).toHaveLength(200)
    for (const attempt of snapshot.attempts) {
      expect(attempt.events.at(-1)?.state).toBe('failed')
      expect(attempt.events.at(-1)?.phase).toBe('finalize')
    }
    expect(events.at(-1)?.sequence).toBe(230)
    expect(events.some((event) => event.sequence === 1)).toBe(false)
    expect(causalSequences).toEqual([11, 57, 103, 149, 195])
    expect(causalSequences.every((sequence) => events.some((event) => event.sequence === sequence))).toBe(true)
    expect(events.map((event) => event.sequence)).toEqual(
      [...events.map((event) => event.sequence)].sort((left, right) => left - right)
    )
  })

  it('independently enforces the 1 MiB limit for maximum-shape safe profiles', async () => {
    expect(
      Buffer.byteLength(JSON.stringify(MAXIMUM_SHAPE_PAYLOAD_PROFILE), 'utf8') * MIGRATION_DIAGNOSTICS_MAX_EVENTS
    ).toBeGreaterThan(MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES)

    const subject = coordinator()
    for (let attemptIndex = 0; attemptIndex < 5; attemptIndex += 1) {
      subject.beginAttempt(attemptIndex === 0 ? 'initial' : 'manual_retry')
      for (let eventIndex = 0; eventIndex < 45; eventIndex += 1) {
        subject.recordEvent(eventInput({ payloadProfile: MAXIMUM_SHAPE_PAYLOAD_PROFILE }))
      }
      subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))
    }

    const snapshot = await subject.snapshot()
    const events = snapshot.attempts.flatMap((attempt) => attempt.events)
    const sequences = events.map((event) => event.sequence)

    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThanOrEqual(
      MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES
    )
    expect(snapshot.attempts).toHaveLength(5)
    expect(events.length).toBeLessThanOrEqual(200)
    expect(sequences).not.toContain(1)
    expect([45, 91, 137, 183, 229].every((sequence) => sequences.includes(sequence))).toBe(true)
    expect(sequences.some((sequence, index) => index > 0 && sequence > sequences[index - 1] + 1)).toBe(true)
    expect(sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1])).toBe(true)
    expect(snapshot.attempts.map((attempt) => attempt.events.at(-1)?.sequence)).toEqual([46, 92, 138, 184, 230])
    for (const attempt of snapshot.attempts) {
      expect(attempt.events.at(-1)?.state).toBe('failed')
      expect(attempt.events.at(-1)?.phase).toBe('finalize')
    }
    expect(migrationDiagnosticsSessionSchema.safeParse(snapshot).success).toBe(true)
  })

  it('throws the fixed size error instead of deleting the protected minimum', () => {
    const subject = coordinator()
    subject.beginAttempt('initial')
    subject.recordEvent(eventInput({ state: 'warning', code: 'source_parse', category: 'source' }))
    const serializedCandidates: string[] = []
    vi.spyOn(Buffer, 'byteLength').mockImplementation((value) => {
      serializedCandidates.push(String(value))
      return MIGRATION_DIAGNOSTICS_JOURNAL_MAX_BYTES + 1
    })

    expect(() =>
      subject.finishAttempt('failed', eventInput({ scope: 'gate', phase: 'finalize', state: 'failed' }))
    ).toThrow('Migration diagnostics journal cannot satisfy its fixed size limit')
    expect(serializedCandidates.length).toBeGreaterThan(0)
    for (const candidate of serializedCandidates) {
      expect(candidate).toContain('source_parse')
      expect(candidate).toContain('"phase":"finalize"')
    }
  })
})

describe('MigrationDiagnosticsCoordinator snapshot, save, and completion', () => {
  it('shares an in-flight snapshot Promise and returns a deeply frozen detached clone', async () => {
    const subject = coordinator()
    subject.beginAttempt('initial')
    subject.recordEvent(eventInput())

    const firstPromise = subject.snapshot()
    const secondPromise = subject.snapshot()
    expect(secondPromise).toBe(firstPromise)
    const first = await firstPromise

    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.attempts)).toBe(true)
    expect(Object.isFrozen(first.attempts[0])).toBe(true)
    expect(Object.isFrozen(first.attempts[0]?.events)).toBe(true)
    expect(Reflect.set(first as object, 'state', 'completed')).toBe(false)

    subject.recordEvent(eventInput({ phase: 'validate' }))
    expect(first.attempts[0]?.events).toHaveLength(1)
    expect((await subject.snapshot()).attempts[0]?.events).toHaveLength(2)
  })

  it('returns save_in_progress without invoking an overlapping operation and resets after success', async () => {
    const subject = coordinator()
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstCalls = 0
    let secondCalls = 0

    const first = subject.runSave(async () => {
      firstCalls += 1
      await blocked
      return { status: 'saved' as const }
    })
    const overlap = await subject.runSave(async () => {
      secondCalls += 1
      return { status: 'saved' as const }
    })

    expect(overlap).toEqual({ status: 'failed', code: 'save_in_progress' })
    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(0)
    release()
    await expect(first).resolves.toEqual({ status: 'saved' })
    await expect(subject.runSave(async () => ({ status: 'saved' as const }))).resolves.toEqual({ status: 'saved' })
  })

  it('resets the save guard when the operation rejects', async () => {
    const subject = coordinator()

    await expect(
      subject.runSave(async () => {
        throw new Error('archive failed')
      })
    ).rejects.toThrow('archive failed')
    await expect(subject.runSave(async () => ({ status: 'saved' as const }))).resolves.toEqual({ status: 'saved' })
  })

  it('completes in memory and deletes only the live journal/tmp', async () => {
    const subject = coordinator()
    subject.attachPaths(paths())
    subject.beginAttempt('initial')
    subject.finishAttempt('completed', eventInput({ scope: 'gate', phase: 'finalize', state: 'completed' }))
    writeFileSync(`${paths().diagnosticsJournalFile}.tmp`, 'stale')
    const corrupt = path.join(testDir, 'migration-diagnostics-v2.corrupt.20260719T100000Z.json')
    writeFileSync(corrupt, 'corrupt')

    subject.complete()

    expect((await subject.snapshot()).state).toBe('completed')
    expect(existsSync(paths().diagnosticsJournalFile)).toBe(false)
    expect(existsSync(`${paths().diagnosticsJournalFile}.tmp`)).toBe(false)
    expect(existsSync(corrupt)).toBe(true)
  })

  it('completes before any attempt and deletes the live journal', async () => {
    const subject = coordinator()
    subject.attachPaths(paths())

    subject.complete()

    expect((await subject.snapshot()).state).toBe('completed')
    expect((await subject.snapshot()).attempts).toEqual([])
    expect(existsSync(paths().diagnosticsJournalFile)).toBe(false)
  })
})
