import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  MIGRATION_DATABASE_OBJECT_DEFINITIONS,
  type MigrationDatabaseDiagnosticResult
} from '../../migrationDatabaseDiagnosticsSchemas'
import { MigrationDiagnosticsCoordinator } from '../../MigrationDiagnosticsCoordinator'
import type {
  MigrationDiagnosticFailure,
  MigrationDiagnosticLocation,
  MigrationDiagnosticsSnapshot
} from '../../migrationDiagnosticsSchemas'
import { classifyMigrationError } from '../../migrationErrorClassifier'

export const BLOCKING_FIXTURES = [
  'database-open',
  'database-corrupt',
  'database-schema',
  'database-constraint',
  'oversized-string',
  'oversized-json',
  'oversized-blob',
  'source-parse',
  'path-permission',
  'renderer-crash',
  'renderer-hang',
  'retry-recovery'
] as const

export const SUPPORT_CHAIN_FIXTURES = ['archive-finalization-failure', 'database-process-partial'] as const

export const ACCEPTANCE_PRIVACY_CANARIES = Object.freeze([
  'PRIVATE_PATH_CANARY',
  'RAW_ERROR_CANARY',
  'STACK_CANARY',
  'SQL_CANARY',
  'TOKEN_CANARY',
  'RECORD_ID_CANARY'
])

type BlockingFixtureName = (typeof BLOCKING_FIXTURES)[number]
type SupportChainFixtureName = (typeof SUPPORT_CHAIN_FIXTURES)[number]
type DatabaseCollector = () => Promise<MigrationDatabaseDiagnosticResult>
type WriteFailure = Extract<MigrationDiagnosticFailure, { kind: 'migration_write_failed' }>
type FailedWriteValue = NonNullable<WriteFailure['evidence']>['values'][number]

interface MigrationDiagnosticAcceptanceFixtureBase {
  readonly createSnapshot: (testDir: string) => Promise<MigrationDiagnosticsSnapshot>
  readonly collectDatabaseDiagnostics: DatabaseCollector
  readonly expectedSqlite: Readonly<Record<string, unknown>>
}

export interface BlockingMigrationDiagnosticAcceptanceFixture extends MigrationDiagnosticAcceptanceFixtureBase {
  readonly name: BlockingFixtureName
  readonly role: 'blocking_root' | 'process_interruption'
  readonly expectedRoot: { readonly attempt: 'current' | 'previous'; readonly errorCode: string }
}

export interface SupportChainMigrationDiagnosticAcceptanceFixture extends MigrationDiagnosticAcceptanceFixtureBase {
  readonly name: SupportChainFixtureName
  readonly role: 'support_chain'
  readonly expectedSaveStatus: 'saved' | 'failed'
  readonly failArchiveFinalization?: true
}

export type MigrationDiagnosticAcceptanceFixture =
  | BlockingMigrationDiagnosticAcceptanceFixture
  | SupportChainMigrationDiagnosticAcceptanceFixture

function objects(
  role?: (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['role'],
  status: 'missing_table' | 'missing_columns' = 'missing_table'
) {
  return MIGRATION_DATABASE_OBJECT_DEFINITIONS.map((definition) =>
    definition.role === role
      ? {
          role: definition.role,
          tableName: definition.table,
          standardColumns: definition.columns,
          status,
          ...(status === 'missing_columns' ? { missingColumnRoles: [definition.columns[0]] } : {})
        }
      : {
          role: definition.role,
          tableName: definition.table,
          standardColumns: definition.columns,
          status: 'present' as const
        }
  )
}

function availableDatabase(options?: {
  readonly role?: (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['role']
  readonly status?: 'missing_table' | 'missing_columns'
  readonly foreignKeyViolationCountBucket?: '0' | '1' | '2-10' | '11+'
}): MigrationDatabaseDiagnosticResult {
  return {
    file: {
      status: 'readable',
      sizeBucket: '1m-100m',
      sqliteHeader: 'valid',
      walPresent: true,
      shmPresent: true
    },
    sqlite: {
      status: 'available',
      quickCheck: 'ok',
      foreignKeyViolationCountBucket: options?.foreignKeyViolationCountBucket ?? '0',
      objects: objects(options?.role, options?.status)
    }
  }
}

function unavailableDatabase(
  reason: 'not_attempted' | 'open_failed' | 'query_failed' | 'timeout',
  sqliteHeader: 'valid' | 'invalid' | 'unavailable' = 'valid'
): MigrationDatabaseDiagnosticResult {
  return sqliteHeader === 'unavailable'
    ? {
        file: { status: 'unreadable', sqliteHeader: 'unavailable' },
        sqlite: { status: 'unavailable', reason }
      }
    : {
        file: {
          status: 'readable',
          sizeBucket: '1m-100m',
          sqliteHeader,
          walPresent: false,
          shmPresent: false
        },
        sqlite: { status: 'unavailable', reason }
      }
}

function coordinator(clock = () => new Date('2026-07-21T08:00:00.000Z')): MigrationDiagnosticsCoordinator {
  return new MigrationDiagnosticsCoordinator({ appVersion: '2.0.0', platform: 'darwin', arch: 'arm64', clock })
}

function locationForFailure(failure: MigrationDiagnosticFailure): MigrationDiagnosticLocation {
  if (failure.kind === 'process_interrupted') return failure.evidence.lastLocation
  return {
    scope: failure.scope,
    phase: failure.phase,
    ...('migratorId' in failure && failure.migratorId !== undefined ? { migratorId: failure.migratorId } : {})
  }
}

async function terminalSnapshot(failure: MigrationDiagnosticFailure): Promise<MigrationDiagnosticsSnapshot> {
  Object.defineProperty(failure, 'testOnlyCause', {
    value: new Error(ACCEPTANCE_PRIVACY_CANARIES.join(' ')),
    enumerable: false
  })
  const subject = coordinator()
  subject.beginAttempt('initial')
  subject.updateLocation(locationForFailure(failure))
  if (failure.kind === 'process_interrupted') subject.finishAttempt({ status: 'interrupted', failure })
  else subject.finishAttempt({ status: 'failed', failure })
  return subject.snapshot()
}

async function completedSnapshot(): Promise<MigrationDiagnosticsSnapshot> {
  const subject = coordinator()
  subject.beginAttempt('initial')
  subject.updateLocation({ scope: 'engine', phase: 'finalize' })
  subject.finishAttempt({ status: 'completed', warningCount: 0 })
  return subject.snapshot()
}

async function retryRecoverySnapshot(testDir: string): Promise<MigrationDiagnosticsSnapshot> {
  let now = new Date('2026-07-21T08:00:00.000Z')
  const clock = () => new Date(now)
  const paths = { diagnosticsJournalFile: path.join(testDir, 'migration-diagnostics-v2.json') }
  const firstProcess = coordinator(clock)
  firstProcess.attachPaths(paths)
  firstProcess.beginAttempt('initial')
  firstProcess.updateLocation({ scope: 'migrator', phase: 'execute', migratorId: 'chat' })

  now = new Date('2026-07-21T08:01:00.000Z')
  const recoveredProcess = coordinator(clock)
  recoveredProcess.attachPaths(paths)
  recoveredProcess.beginAttempt('recovered_retry')
  recoveredProcess.updateLocation({ scope: 'engine', phase: 'finalize' })
  now = new Date('2026-07-21T08:02:00.000Z')
  recoveredProcess.finishAttempt({ status: 'completed', warningCount: 0 })
  return recoveredProcess.snapshot()
}

async function pathPermissionSnapshot(testDir: string): Promise<MigrationDiagnosticsSnapshot> {
  const restrictedDir = path.join(testDir, ACCEPTANCE_PRIVACY_CANARIES[0])
  const restrictedFile = path.join(restrictedDir, 'private.json')
  mkdirSync(restrictedDir)
  writeFileSync(restrictedFile, ACCEPTANCE_PRIVACY_CANARIES.join(' '))
  let cause: unknown = Object.assign(new Error('permission denied'), { code: 'EACCES' })
  if (process.platform !== 'win32') {
    chmodSync(restrictedDir, 0o000)
    try {
      readFileSync(restrictedFile)
    } catch (error) {
      cause = error
    } finally {
      chmodSync(restrictedDir, 0o700)
    }
  }
  if (classifyMigrationError(cause).errorCode !== 'file_permission') throw new Error('Expected file_permission')
  return terminalSnapshot({
    kind: 'preboot_failed',
    scope: 'gate',
    phase: 'resolve_paths',
    errorCode: 'path_resolution_failed'
  })
}

function blocking(
  name: BlockingFixtureName,
  failure: MigrationDiagnosticFailure,
  collectDatabaseDiagnostics: DatabaseCollector,
  expectedSqlite: Readonly<Record<string, unknown>>
): BlockingMigrationDiagnosticAcceptanceFixture {
  return {
    name,
    role: failure.kind === 'process_interrupted' ? 'process_interruption' : 'blocking_root',
    createSnapshot: () => terminalSnapshot(failure),
    collectDatabaseDiagnostics,
    expectedRoot: { attempt: 'current', errorCode: failure.errorCode },
    expectedSqlite
  }
}

function oversized(
  name: Extract<BlockingFixtureName, `oversized-${string}`>,
  migratorId: NonNullable<WriteFailure['migratorId']>,
  value: FailedWriteValue,
  operationRole: NonNullable<WriteFailure['evidence']>['operationRole'] = 'insert'
): BlockingMigrationDiagnosticAcceptanceFixture {
  return blocking(
    name,
    {
      kind: 'migration_write_failed',
      scope: 'migrator',
      phase: 'execute',
      migratorId,
      errorCode: 'sqlite_too_big',
      evidence: { kind: 'failed_write', operationRole, truncated: false, values: [value] }
    },
    async () => availableDatabase(),
    { status: 'available', quickCheck: 'ok' }
  )
}

const blockingFixtures: readonly BlockingMigrationDiagnosticAcceptanceFixture[] = [
  blocking(
    'database-open',
    { kind: 'preboot_failed', scope: 'database', phase: 'initialize', errorCode: 'sqlite_open_failed' },
    async () => unavailableDatabase('open_failed'),
    { status: 'unavailable', reason: 'open_failed' }
  ),
  blocking(
    'database-corrupt',
    { kind: 'preboot_failed', scope: 'database', phase: 'initialize', errorCode: 'sqlite_corrupt' },
    async () => unavailableDatabase('query_failed', 'invalid'),
    { status: 'unavailable', reason: 'query_failed' }
  ),
  blocking(
    'database-schema',
    { kind: 'migration_validation_failed', scope: 'database', phase: 'validate', errorCode: 'sqlite_schema' },
    async () => availableDatabase({ role: 'preference', status: 'missing_columns' }),
    { status: 'available', quickCheck: 'ok' }
  ),
  blocking(
    'database-constraint',
    { kind: 'migration_write_failed', scope: 'database', phase: 'execute', errorCode: 'sqlite_constraint' },
    async () => availableDatabase({ foreignKeyViolationCountBucket: '1' }),
    { status: 'available', foreignKeyViolationCountBucket: '1' }
  ),
  oversized('oversized-string', 'prompt', {
    role: 'text_value',
    kind: 'string',
    byteLength: 262_145,
    byteLengthBucket: '262145+'
  }),
  oversized('oversized-json', 'mcp_server', {
    role: 'json_value',
    kind: 'json',
    byteLength: 262_145,
    byteLengthBucket: '262145+'
  }),
  oversized(
    'oversized-blob',
    'knowledge_vector',
    { role: 'blob_value', kind: 'blob', byteLength: 262_145, byteLengthBucket: '262145+' },
    'temporary_index_write'
  ),
  blocking(
    'source-parse',
    {
      kind: 'renderer_export_failed',
      scope: 'renderer_export',
      phase: 'finalize',
      errorCode: 'source_parse_failed',
      evidence: { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'parse' }
    },
    async () => {
      throw new Error(ACCEPTANCE_PRIVACY_CANARIES.join(' '))
    },
    { status: 'unavailable', reason: 'not_attempted' }
  ),
  {
    ...blocking(
      'path-permission',
      { kind: 'preboot_failed', scope: 'gate', phase: 'resolve_paths', errorCode: 'path_resolution_failed' },
      async () => unavailableDatabase('not_attempted', 'unavailable'),
      { status: 'unavailable', reason: 'not_attempted' }
    ),
    createSnapshot: pathPermissionSnapshot
  },
  blocking(
    'renderer-crash',
    {
      kind: 'process_interrupted',
      scope: 'engine',
      phase: 'interrupted',
      errorCode: 'renderer_process_gone',
      evidence: {
        kind: 'interruption',
        lastLocation: { scope: 'renderer_export', phase: 'prepare' },
        recoverySource: 'live_renderer_event'
      }
    },
    async () => availableDatabase(),
    { status: 'available', quickCheck: 'ok' }
  ),
  blocking(
    'renderer-hang',
    {
      kind: 'process_interrupted',
      scope: 'engine',
      phase: 'interrupted',
      errorCode: 'renderer_unresponsive',
      evidence: {
        kind: 'interruption',
        lastLocation: { scope: 'migrator', phase: 'execute', migratorId: 'chat' },
        recoverySource: 'live_renderer_event'
      }
    },
    async () => unavailableDatabase('timeout'),
    { status: 'unavailable', reason: 'timeout' }
  ),
  {
    name: 'retry-recovery',
    role: 'process_interruption',
    createSnapshot: retryRecoverySnapshot,
    collectDatabaseDiagnostics: async () => availableDatabase(),
    expectedRoot: { attempt: 'previous', errorCode: 'process_interrupted' },
    expectedSqlite: { status: 'available', quickCheck: 'ok' }
  }
]

const supportChainFixtures: readonly SupportChainMigrationDiagnosticAcceptanceFixture[] = [
  {
    name: 'archive-finalization-failure',
    role: 'support_chain',
    createSnapshot: completedSnapshot,
    collectDatabaseDiagnostics: async () => availableDatabase(),
    expectedSqlite: { status: 'available', quickCheck: 'ok' },
    expectedSaveStatus: 'failed',
    failArchiveFinalization: true
  },
  {
    name: 'database-process-partial',
    role: 'support_chain',
    createSnapshot: completedSnapshot,
    collectDatabaseDiagnostics: async () => unavailableDatabase('timeout'),
    expectedSqlite: { status: 'unavailable', reason: 'timeout' },
    expectedSaveStatus: 'saved'
  }
]

export function createMigrationDiagnosticAcceptanceFixtures(): readonly MigrationDiagnosticAcceptanceFixture[] {
  return [...blockingFixtures, ...supportChainFixtures]
}
