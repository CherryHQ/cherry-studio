import {
  createKnowledgeVectorRebuildProfileRows,
  KNOWLEDGE_VECTOR_REBUILD_PROFILE
} from '../../../migrators/KnowledgeVectorMigrator'
import {
  EXPECTED_MIGRATION_DATABASE_OBJECTS,
  type MigrationDatabaseColumnCountBucket,
  type MigrationDatabaseCompletedDiagnosticResult,
  type MigrationDatabaseDiagnosticResult,
  migrationDatabaseDiagnosticResultSchema
} from '../../migrationDatabaseDiagnosticsSchemas'
import {
  type MigrationDiagnosticEvent,
  type MigrationDiagnosticsSession,
  migrationDiagnosticsSessionSchema,
  type MigrationErrorCategory,
  type MigrationErrorCode,
  type PayloadLengthProfile,
  type PayloadLengthSlotProfile,
  type PayloadProfileSlot,
  type PayloadProfileTarget
} from '../../migrationDiagnosticsSchemas'
import { type ClassifiedMigrationError, classifyMigrationError } from '../../migrationErrorClassifier'
import { profilePayloadLengths } from '../../payloadLengthProfiler'

const SESSION_STARTED_AT = '2026-07-20T10:00:00.000Z'
const FAILURE_RECORDED_AT = '2026-07-20T10:00:01.000Z'
const ATTEMPT_ENDED_AT = '2026-07-20T10:00:02.000Z'

export const ACCEPTANCE_PRIVACY_CANARIES = Object.freeze([
  'USER_MESSAGE_CANARY_DO_NOT_SHARE',
  '/Users/private/MIGRATION_PATH_CANARY',
  'sk-proj-MIGRATION_MODEL_KEY_CANARY',
  'Bearer MIGRATION_BEARER_CANARY',
  'cookie=MIGRATION_COOKIE_CANARY',
  'password=MIGRATION_PASSWORD_CANARY',
  '-----BEGIN PRIVATE KEY-----MIGRATION_PEM_CANARY',
  'postgresql://private:MIGRATION_DATABASE_PASSWORD@localhost/cherry',
  'private-migration-user@example.com',
  'device-id=MIGRATION_DEVICE_ID_CANARY',
  'at privateMigration (/Users/private/MIGRATION_STACK_CANARY.ts:1:1)'
])

export const ACCEPTANCE_FORBIDDEN_CONTENT = Object.freeze([
  'RAW_DATABASE_PAYLOAD_CANARY',
  'RAW_WAL_PAYLOAD_CANARY',
  'RAW_SHM_PAYLOAD_CANARY',
  'RAW_APPLICATION_LOG_CANARY',
  'RAW_MIGRATION_LOG_CANARY'
])

type EventScope = MigrationDiagnosticEvent['scope']
type EventPhase = MigrationDiagnosticEvent['phase']

interface FailureSignal {
  readonly category: MigrationErrorCategory
  readonly code: MigrationErrorCode
  readonly causeDepth?: number
  readonly scope: EventScope
  readonly phase: EventPhase
  readonly migratorId?: string
  readonly payloadProfile?: PayloadLengthProfile
}

interface ExpectedPayload {
  readonly target: PayloadProfileTarget
  readonly traversal: PayloadLengthProfile['traversal']
  readonly slot: PayloadProfileSlot
  readonly profile: Partial<PayloadLengthSlotProfile>
}

interface ExpectedDatabase {
  readonly completion: Record<string, unknown>
  readonly level?: 'l0' | 'l1' | 'l2'
  readonly levelResult?: Record<string, unknown>
  readonly object?: Record<string, unknown>
  readonly foreignKey?: Record<string, unknown>
}

export interface MigrationDiagnosticAcceptanceFixture {
  readonly name: string
  readonly snapshot: MigrationDiagnosticsSession
  readonly collectDatabaseDiagnostics: () => Promise<MigrationDatabaseDiagnosticResult>
  readonly expected: {
    readonly category: MigrationErrorCategory
    readonly code: MigrationErrorCode
    readonly scope: EventScope
    readonly phase: EventPhase
    readonly migratorId?: string
    readonly attemptTriggers: readonly ('initial' | 'manual_retry' | 'recovered_retry')[]
    readonly payload?: ExpectedPayload
    readonly database: ExpectedDatabase
  }
}

function classifiedError(code: string): ClassifiedMigrationError {
  const error = Object.assign(
    new Error([...ACCEPTANCE_PRIVACY_CANARIES, ...ACCEPTANCE_FORBIDDEN_CONTENT].join(' | ')),
    { code }
  )
  error.stack = ACCEPTANCE_PRIVACY_CANARIES.at(-1)
  return classifyMigrationError(error)
}

function failureSignal(
  classification: Pick<ClassifiedMigrationError, 'category' | 'code' | 'causeDepth'>,
  location: Pick<FailureSignal, 'scope' | 'phase' | 'migratorId' | 'payloadProfile'>
): FailureSignal {
  return { ...classification, ...location }
}

function failedSnapshot(signal: FailureSignal): MigrationDiagnosticsSession {
  const attemptId = 'acceptance-private-attempt-id'
  return migrationDiagnosticsSessionSchema.parse({
    version: 1,
    sessionId: 'acceptance-private-session-id',
    appVersion: '2.0.0-private-build',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: SESSION_STARTED_AT,
    state: 'failed',
    attempts: [
      {
        id: attemptId,
        trigger: 'initial',
        startedAt: SESSION_STARTED_AT,
        outcome: 'failed',
        endedAt: ATTEMPT_ENDED_AT,
        events: [
          {
            sequence: 1,
            at: FAILURE_RECORDED_AT,
            attemptId,
            scope: signal.scope,
            phase: signal.phase,
            state: 'failed',
            code: signal.code,
            category: signal.category,
            causeDepth: signal.causeDepth,
            migratorId: signal.migratorId,
            payloadProfile: signal.payloadProfile
          },
          {
            sequence: 2,
            at: ATTEMPT_ENDED_AT,
            attemptId,
            scope: 'engine',
            phase: 'finalize',
            state: 'failed',
            code: 'unknown',
            category: 'unknown'
          }
        ]
      }
    ]
  })
}

function completedWarningSnapshot(signal: FailureSignal): MigrationDiagnosticsSession {
  const attemptId = 'acceptance-private-completed-warning-attempt-id'
  return migrationDiagnosticsSessionSchema.parse({
    version: 1,
    sessionId: 'acceptance-private-completed-warning-session-id',
    appVersion: '2.0.0-private-build',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: SESSION_STARTED_AT,
    state: 'completed',
    attempts: [
      {
        id: attemptId,
        trigger: 'initial',
        startedAt: SESSION_STARTED_AT,
        outcome: 'completed',
        endedAt: ATTEMPT_ENDED_AT,
        events: [
          {
            sequence: 1,
            at: FAILURE_RECORDED_AT,
            attemptId,
            scope: signal.scope,
            phase: signal.phase,
            state: 'failed',
            code: signal.code,
            category: signal.category,
            causeDepth: signal.causeDepth,
            migratorId: signal.migratorId,
            payloadProfile: signal.payloadProfile
          },
          {
            sequence: 2,
            at: ATTEMPT_ENDED_AT,
            attemptId,
            scope: 'engine',
            phase: 'finalize',
            state: 'completed',
            code: 'unknown'
          }
        ]
      }
    ]
  })
}

function retryRecoverySnapshot(signal: FailureSignal): MigrationDiagnosticsSession {
  const firstAttemptId = 'acceptance-private-first-attempt-id'
  const manualAttemptId = 'acceptance-private-manual-attempt-id'
  const recoveredAttemptId = 'acceptance-private-recovered-attempt-id'
  return migrationDiagnosticsSessionSchema.parse({
    version: 1,
    sessionId: 'acceptance-private-recovery-session-id',
    appVersion: '2.0.0-private-build',
    platform: 'darwin',
    arch: 'arm64',
    startedAt: SESSION_STARTED_AT,
    state: 'failed',
    attempts: [
      {
        id: firstAttemptId,
        trigger: 'initial',
        startedAt: SESSION_STARTED_AT,
        outcome: 'failed',
        endedAt: '2026-07-20T10:00:02.000Z',
        events: [
          {
            sequence: 1,
            at: FAILURE_RECORDED_AT,
            attemptId: firstAttemptId,
            scope: signal.scope,
            phase: signal.phase,
            state: 'failed',
            code: signal.code,
            category: signal.category,
            causeDepth: signal.causeDepth,
            migratorId: signal.migratorId,
            payloadProfile: signal.payloadProfile
          },
          {
            sequence: 2,
            at: '2026-07-20T10:00:02.000Z',
            attemptId: firstAttemptId,
            scope: 'engine',
            phase: 'finalize',
            state: 'failed',
            code: 'unknown',
            category: 'unknown'
          }
        ]
      },
      {
        id: manualAttemptId,
        trigger: 'manual_retry',
        startedAt: '2026-07-20T10:00:03.000Z',
        outcome: 'interrupted',
        endedAt: '2026-07-20T10:00:05.000Z',
        events: [
          {
            sequence: 3,
            at: '2026-07-20T10:00:04.000Z',
            attemptId: manualAttemptId,
            scope: signal.scope,
            phase: signal.phase,
            state: 'failed',
            code: signal.code,
            category: signal.category,
            causeDepth: signal.causeDepth,
            migratorId: signal.migratorId,
            payloadProfile: signal.payloadProfile
          },
          {
            sequence: 4,
            at: '2026-07-20T10:00:05.000Z',
            attemptId: manualAttemptId,
            scope: 'gate',
            phase: 'finalize',
            state: 'interrupted',
            code: 'unknown',
            category: 'process'
          }
        ]
      },
      {
        id: recoveredAttemptId,
        trigger: 'recovered_retry',
        startedAt: '2026-07-20T10:00:06.000Z',
        outcome: 'failed',
        endedAt: '2026-07-20T10:00:08.000Z',
        events: [
          {
            sequence: 5,
            at: '2026-07-20T10:00:07.000Z',
            attemptId: recoveredAttemptId,
            scope: signal.scope,
            phase: signal.phase,
            state: 'failed',
            code: signal.code,
            category: signal.category,
            causeDepth: signal.causeDepth,
            migratorId: signal.migratorId,
            payloadProfile: signal.payloadProfile
          },
          {
            sequence: 6,
            at: '2026-07-20T10:00:08.000Z',
            attemptId: recoveredAttemptId,
            scope: 'engine',
            phase: 'finalize',
            state: 'failed',
            code: 'unknown',
            category: 'unknown'
          }
        ]
      }
    ]
  })
}

function bucketColumnCount(count: number | undefined): MigrationDatabaseColumnCountBucket {
  if (count === undefined) return 'unavailable'
  if (count === 0) return '0'
  if (count <= 5) return '1_to_5'
  if (count <= 10) return '6_to_10'
  if (count <= 20) return '11_to_20'
  if (count <= 40) return '21_to_40'
  return '41_plus'
}

function regularL0() {
  return {
    level: 'l0' as const,
    status: 'success' as const,
    data: {
      exists: true,
      fileKind: 'regular' as const,
      sizeBucket: '1_mib_to_16_mib' as const,
      mtimeAgeBucket: 'under_1_hour' as const,
      header: 'valid' as const,
      writeMode: 'rollback' as const,
      walSidecars: 'none' as const
    }
  }
}

function missingL0() {
  return {
    level: 'l0' as const,
    status: 'success' as const,
    data: {
      exists: false,
      fileKind: 'missing' as const,
      sizeBucket: 'unavailable' as const,
      mtimeAgeBucket: 'unavailable' as const,
      header: 'unavailable' as const,
      writeMode: 'unavailable' as const,
      walSidecars: 'none' as const
    }
  }
}

function healthyL1(objectStatus?: { readonly id: string; readonly status: 'missing' }) {
  return {
    level: 'l1' as const,
    status: 'success' as const,
    data: {
      metadata: {
        pageSize: '4096' as const,
        encoding: 'utf8' as const,
        userVersionBucket: '0' as const,
        schemaVersionBucket: '1_to_10' as const,
        applicationId: 'unset' as const,
        queryOnly: true as const
      },
      objects: EXPECTED_MIGRATION_DATABASE_OBJECTS.map((object) => ({
        id: object.id,
        kind: object.kind,
        status: object.id === objectStatus?.id ? objectStatus.status : ('ok' as const),
        columnCountBucket:
          object.id === objectStatus?.id
            ? ('unavailable' as const)
            : bucketColumnCount('columnCount' in object ? object.columnCount : undefined)
      })),
      unknownObjects: []
    }
  }
}

function healthyL2() {
  return {
    level: 'l2' as const,
    status: 'success' as const,
    data: {
      quickCheck: { outcome: 'ok' as const, issueCountBucket: '0' as const, categories: [], truncated: false },
      foreignKeys: {
        outcome: 'ok' as const,
        scannedCountBucket: '0' as const,
        violations: [],
        truncated: false
      }
    }
  }
}

function constraintL2() {
  return {
    level: 'l2' as const,
    status: 'success' as const,
    data: {
      quickCheck: { outcome: 'ok' as const, issueCountBucket: '0' as const, categories: [], truncated: false },
      foreignKeys: {
        outcome: 'violations' as const,
        scannedCountBucket: '1' as const,
        violations: [
          {
            childObjectId: 'assistant_knowledge_base' as const,
            parentObjectId: 'assistant' as const,
            countBucket: '1' as const
          }
        ],
        truncated: false
      }
    }
  }
}

function completedDatabase(
  overrides: Partial<Pick<MigrationDatabaseCompletedDiagnosticResult, 'l0' | 'l1' | 'l2'>> = {}
): MigrationDatabaseDiagnosticResult {
  return migrationDatabaseDiagnosticResultSchema.parse({
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'completed' },
    l0: regularL0(),
    l1: healthyL1(),
    l2: healthyL2(),
    ...overrides
  })
}

function unavailableDatabase(): MigrationDatabaseDiagnosticResult {
  return migrationDatabaseDiagnosticResultSchema.parse({
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'failed', code: 'lease_unavailable' }
  })
}

function timedOutDatabaseWithL0(): MigrationDatabaseDiagnosticResult {
  return migrationDatabaseDiagnosticResultSchema.parse({
    version: 1,
    expectedSchemaVersion: 1,
    completion: { status: 'timed_out', code: 'process_timeout' },
    l0: regularL0()
  })
}

function expectedFromSignal(
  signal: FailureSignal,
  database: ExpectedDatabase,
  options: {
    readonly attemptTriggers?: readonly ('initial' | 'manual_retry' | 'recovered_retry')[]
    readonly payload?: ExpectedPayload
  } = {}
): MigrationDiagnosticAcceptanceFixture['expected'] {
  return {
    category: signal.category,
    code: signal.code,
    scope: signal.scope,
    phase: signal.phase,
    migratorId: signal.migratorId,
    attemptTriggers: options.attemptTriggers ?? ['initial'],
    payload: options.payload,
    database
  }
}

function fixture(
  name: string,
  signal: FailureSignal,
  databaseResult: MigrationDatabaseDiagnosticResult,
  databaseExpectation: ExpectedDatabase,
  options: {
    readonly snapshot?: MigrationDiagnosticsSession
    readonly attemptTriggers?: readonly ('initial' | 'manual_retry' | 'recovered_retry')[]
    readonly payload?: ExpectedPayload
  } = {}
): MigrationDiagnosticAcceptanceFixture {
  return {
    name,
    snapshot: options.snapshot ?? failedSnapshot(signal),
    collectDatabaseDiagnostics: async () => databaseResult,
    expected: expectedFromSignal(signal, databaseExpectation, options)
  }
}

export function createMigrationDiagnosticAcceptanceFixtures(): MigrationDiagnosticAcceptanceFixture[] {
  const dbOpenSignal = failureSignal(classifiedError('SQLITE_CANTOPEN_ISDIR'), {
    scope: 'gate',
    phase: 'initialize'
  })
  const dbOpenResult = completedDatabase({
    l0: missingL0(),
    l1: { level: 'l1', status: 'failed', code: 'open_failed' },
    l2: { level: 'l2', status: 'failed', code: 'open_failed' }
  })

  const corruptSignal = failureSignal(classifiedError('SQLITE_CORRUPT'), {
    scope: 'gate',
    phase: 'initialize'
  })
  const corruptResult = completedDatabase({
    l1: { level: 'l1', status: 'failed', code: 'query_failed' },
    l2: { level: 'l2', status: 'failed', code: 'query_failed' }
  })

  const schemaSignal = failureSignal(classifiedError('SQLITE_SCHEMA'), {
    scope: 'gate',
    phase: 'validate'
  })
  const schemaResult = completedDatabase({ l1: healthyL1({ id: 'preference', status: 'missing' }) })

  const constraintSignal = failureSignal(classifiedError('SQLITE_CONSTRAINT_FOREIGNKEY'), {
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'assistant'
  })
  const constraintResult = completedDatabase({ l2: constraintL2() })

  const oversizedStringProfile = profilePayloadLengths([{ content: ACCEPTANCE_PRIVACY_CANARIES[0].repeat(12_000) }], {
    target: 'prompt',
    fields: ['content']
  })
  const oversizedStringSignal = failureSignal(classifiedError('SQLITE_TOOBIG'), {
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'prompt',
    payloadProfile: oversizedStringProfile
  })

  const oversizedJsonProfile = profilePayloadLengths(
    [
      {
        env: {
          modelKey: ACCEPTANCE_PRIVACY_CANARIES[2].repeat(12_000),
          authorization: ACCEPTANCE_PRIVACY_CANARIES[3],
          cookie: ACCEPTANCE_PRIVACY_CANARIES[4],
          password: ACCEPTANCE_PRIVACY_CANARIES[5],
          privateKey: ACCEPTANCE_PRIVACY_CANARIES[6],
          databaseUrl: ACCEPTANCE_PRIVACY_CANARIES[7],
          email: ACCEPTANCE_PRIVACY_CANARIES[8],
          deviceId: ACCEPTANCE_PRIVACY_CANARIES[9]
        }
      }
    ],
    { target: 'mcp_server', fields: ['env'] }
  )
  const oversizedJsonSignal = failureSignal(classifiedError('SQLITE_TOOBIG'), {
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'mcp_server',
    payloadProfile: oversizedJsonProfile
  })

  const oversizedBlobProfile = profilePayloadLengths(
    createKnowledgeVectorRebuildProfileRows({
      embeddings: [
        {
          embeddingTextHash: 'acceptance-large-vector-hash',
          vector: Array.from({ length: 75_000 }, () => 0)
        }
      ]
    }),
    KNOWLEDGE_VECTOR_REBUILD_PROFILE
  )
  const oversizedBlobSignal = failureSignal(classifiedError('SQLITE_TOOBIG'), {
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'knowledge_vector',
    payloadProfile: oversizedBlobProfile
  })

  const sourceParseSignal: FailureSignal = {
    category: 'source',
    code: 'source_parse',
    scope: 'renderer_export',
    phase: 'finalize'
  }
  const pathSignal = failureSignal(classifiedError('EACCES'), {
    scope: 'gate',
    phase: 'resolve_paths'
  })
  const crashSignal: FailureSignal = {
    category: 'process',
    code: 'renderer_process_gone',
    scope: 'gate',
    phase: 'finalize'
  }
  const hangSignal: FailureSignal = {
    category: 'process',
    code: 'renderer_unresponsive',
    scope: 'gate',
    phase: 'finalize'
  }
  const retrySignal = failureSignal(classifiedError('SQLITE_CONSTRAINT'), {
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'assistant'
  })
  const partialDatabaseSignal = failureSignal(classifiedError('SQLITE_CORRUPT'), {
    scope: 'migrator',
    phase: 'execute',
    migratorId: 'chat'
  })

  return [
    fixture('database-open', dbOpenSignal, dbOpenResult, {
      completion: { status: 'completed' },
      level: 'l1',
      levelResult: { level: 'l1', status: 'failed', code: 'open_failed', details: { status: 'unavailable' } }
    }),
    fixture('database-corrupt', corruptSignal, corruptResult, {
      completion: { status: 'completed' },
      level: 'l1',
      levelResult: { level: 'l1', status: 'failed', code: 'query_failed', details: { status: 'unavailable' } }
    }),
    fixture('database-schema', schemaSignal, schemaResult, {
      completion: { status: 'completed' },
      object: { id: 'preference', kind: 'table', status: 'missing', columnCountBucket: 'unavailable' }
    }),
    fixture('database-constraint', constraintSignal, constraintResult, {
      completion: { status: 'completed' },
      foreignKey: { childObjectId: 'assistant_knowledge_base', parentObjectId: 'assistant', countBucket: '1' }
    }),
    fixture(
      'oversized-string',
      oversizedStringSignal,
      unavailableDatabase(),
      { completion: { status: 'failed', code: 'lease_unavailable' } },
      {
        payload: {
          target: 'prompt',
          traversal: oversizedStringProfile.traversal,
          slot: 'content',
          profile: {
            kind: 'string',
            totalByteLengthBucket: '262145+',
            maxCharLengthBucket: '262145+',
            maxByteLengthBucket: '262145+'
          }
        }
      }
    ),
    fixture(
      'oversized-json',
      oversizedJsonSignal,
      unavailableDatabase(),
      { completion: { status: 'failed', code: 'lease_unavailable' } },
      {
        payload: {
          target: 'mcp_server',
          traversal: oversizedJsonProfile.traversal,
          slot: 'env',
          profile: {
            kind: 'json',
            maxStringLeafCharLengthBucket: '262145+'
          }
        }
      }
    ),
    fixture(
      'oversized-blob',
      oversizedBlobSignal,
      unavailableDatabase(),
      { completion: { status: 'failed', code: 'lease_unavailable' } },
      {
        payload: {
          target: 'knowledge_vector_rebuild',
          traversal: oversizedBlobProfile.traversal,
          slot: 'vectorBlob',
          profile: { kind: 'bytes', totalByteLengthBucket: '262145+', maxByteLengthBucket: '262145+' }
        },
        snapshot: completedWarningSnapshot(oversizedBlobSignal)
      }
    ),
    fixture('source-parse', sourceParseSignal, unavailableDatabase(), {
      completion: { status: 'failed', code: 'lease_unavailable' }
    }),
    fixture('path-permission', pathSignal, unavailableDatabase(), {
      completion: { status: 'failed', code: 'lease_unavailable' }
    }),
    fixture('renderer-crash', crashSignal, unavailableDatabase(), {
      completion: { status: 'failed', code: 'lease_unavailable' }
    }),
    fixture('renderer-hang', hangSignal, unavailableDatabase(), {
      completion: { status: 'failed', code: 'lease_unavailable' }
    }),
    fixture(
      'retry-recovery',
      retrySignal,
      unavailableDatabase(),
      { completion: { status: 'failed', code: 'lease_unavailable' } },
      {
        snapshot: retryRecoverySnapshot(retrySignal),
        attemptTriggers: ['initial', 'manual_retry', 'recovered_retry']
      }
    ),
    fixture('database-process-partial', partialDatabaseSignal, timedOutDatabaseWithL0(), {
      completion: { status: 'timed_out', code: 'process_timeout' },
      level: 'l0',
      levelResult: { level: 'l0', status: 'success', details: { status: 'included' } }
    })
  ]
}
