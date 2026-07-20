import {
  MIGRATION_DATABASE_OBJECT_DEFINITIONS,
  type MigrationDatabaseDiagnosticResult
} from '../../migrationDatabaseDiagnosticsSchemas'
import type { MigrationDiagnosticFailure, MigrationDiagnosticsSnapshot } from '../../migrationDiagnosticsSchemas'

export const ACCEPTANCE_PRIVACY_CANARIES = Object.freeze([
  'PRIVATE_PATH_CANARY',
  'RAW_ERROR_CANARY',
  'STACK_CANARY',
  'SQL_CANARY',
  'TOKEN_CANARY',
  'RECORD_ID_CANARY'
])

export interface MigrationDiagnosticAcceptanceFixture {
  readonly name: string
  readonly snapshot: MigrationDiagnosticsSnapshot
  readonly collectDatabaseDiagnostics: () => Promise<MigrationDatabaseDiagnosticResult>
  readonly expectedFailureCode: string
  readonly expectedSqlite: Readonly<Record<string, unknown>>
}

function objects(
  role?: (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['role'],
  status: 'missing_table' | 'missing_columns' = 'missing_table'
) {
  return MIGRATION_DATABASE_OBJECT_DEFINITIONS.map((definition) =>
    definition.role === role
      ? {
          role: definition.role,
          status,
          ...(status === 'missing_columns' ? { missingColumnRoles: [definition.columns[0]] } : {})
        }
      : { role: definition.role, status: 'present' as const }
  )
}

function availableDatabase(
  role?: (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['role'],
  status?: 'missing_table' | 'missing_columns'
): MigrationDatabaseDiagnosticResult {
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
      foreignKeyViolationCountBucket: '0',
      objects: objects(role, status)
    }
  }
}

function failedSnapshot(failure: MigrationDiagnosticFailure): MigrationDiagnosticsSnapshot {
  const snapshot: MigrationDiagnosticsSnapshot = {
    formatVersion: 1,
    app: { version: '2.0.0', platform: 'darwin', arch: 'arm64' },
    state: 'failed',
    current: {
      trigger: 'initial',
      status: 'failed',
      startedAt: '2026-07-21T08:00:00.000Z',
      endedAt: '2026-07-21T08:01:00.000Z',
      lastLocation: {
        scope: failure.scope === 'renderer_export' ? 'renderer_export' : 'migrator',
        phase: failure.phase,
        ...('migratorId' in failure && failure.migratorId !== undefined ? { migratorId: failure.migratorId } : {})
      },
      failure
    }
  }
  Object.defineProperty(snapshot.current?.failure ?? {}, 'testOnlyCause', {
    value: new Error(ACCEPTANCE_PRIVACY_CANARIES.join(' ')),
    enumerable: false
  })
  return snapshot
}

export function createMigrationDiagnosticAcceptanceFixtures(): MigrationDiagnosticAcceptanceFixture[] {
  return [
    {
      name: 'required-database-column-missing',
      snapshot: failedSnapshot({
        kind: 'migration_validation_failed',
        scope: 'migrator',
        phase: 'validate',
        migratorId: 'preferences',
        errorCode: 'validation_required_target_field',
        evidence: { kind: 'validation', checkRole: 'required_target_field', fieldRole: 'target_id' }
      }),
      collectDatabaseDiagnostics: async () => availableDatabase('preference', 'missing_columns'),
      expectedFailureCode: 'validation_required_target_field',
      expectedSqlite: { status: 'available', quickCheck: 'ok' }
    },
    {
      name: 'oversized-write',
      snapshot: failedSnapshot({
        kind: 'migration_write_failed',
        scope: 'migrator',
        phase: 'execute',
        migratorId: 'chat',
        errorCode: 'sqlite_too_big',
        evidence: {
          kind: 'failed_write',
          operationRole: 'insert',
          values: [
            {
              role: 'json_value',
              kind: 'json',
              byteLength: 262_145,
              byteLengthBucket: '262145+'
            }
          ]
        }
      }),
      collectDatabaseDiagnostics: async () => availableDatabase(),
      expectedFailureCode: 'sqlite_too_big',
      expectedSqlite: { status: 'available', quickCheck: 'ok' }
    },
    {
      name: 'renderer-export-parse',
      snapshot: failedSnapshot({
        kind: 'renderer_export_failed',
        scope: 'renderer_export',
        phase: 'finalize',
        errorCode: 'source_parse_failed',
        evidence: { kind: 'renderer_export', sourceRole: 'redux', operationRole: 'parse' }
      }),
      collectDatabaseDiagnostics: async () => {
        throw new Error(ACCEPTANCE_PRIVACY_CANARIES.join(' '))
      },
      expectedFailureCode: 'source_parse_failed',
      expectedSqlite: { status: 'unavailable', reason: 'not_attempted' }
    }
  ]
}
