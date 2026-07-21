import process from 'node:process'

import Database from 'better-sqlite3'

import {
  MIGRATION_DATABASE_OBJECT_DEFINITIONS,
  migrationDatabaseDiagnosticsChildInputSchema,
  type MigrationDatabaseDiagnosticsChildMessage,
  migrationDatabaseDiagnosticsChildMessageSchema,
  type MigrationDatabaseSqliteResult
} from './migrationDatabaseDiagnosticsSchemas'

interface ColumnRow {
  readonly name?: unknown
}

function inspectForeignKeys(database: Database.Database): number {
  const row = database.prepare('SELECT count(*) AS count FROM pragma_foreign_key_check').get() as {
    readonly count: number
  }
  return row.count
}

type ObjectAnomaly =
  | { readonly table: string; readonly kind: 'missing_table' }
  | { readonly table: string; readonly kind: 'missing_columns'; readonly columns: string[] }

function inspectObject(
  database: Database.Database,
  definition: (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]
): ObjectAnomaly | null {
  const table = database
    .prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1")
    .get(definition.table)
  if (table === undefined) return { table: definition.table, kind: 'missing_table' }

  const columns = new Set(
    (database.pragma(`table_info(${definition.table})`) as ColumnRow[])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string')
  )
  const missingColumns = definition.columns.filter((column) => !columns.has(column))
  return missingColumns.length === 0
    ? null
    : { table: definition.table, kind: 'missing_columns', columns: missingColumns }
}

export function inspectMigrationDatabaseSqlite(databaseFile: string): MigrationDatabaseSqliteResult {
  let database: Database.Database
  try {
    database = new Database(databaseFile, { readonly: true, fileMustExist: true })
  } catch {
    return { status: 'unavailable', reason: 'open_failed' }
  }

  try {
    database.pragma('query_only = ON')
    const quickCheck = database.pragma('quick_check(1)', { simple: true }) === 'ok' ? 'ok' : 'failed'
    const foreignKeyViolationCount = inspectForeignKeys(database)
    const anomalies = MIGRATION_DATABASE_OBJECT_DEFINITIONS.map((definition) =>
      inspectObject(database, definition)
    ).filter((anomaly): anomaly is ObjectAnomaly => anomaly !== null)
    const missingTables: string[] = []
    const missingColumns: Record<string, string[]> = {}
    for (const anomaly of anomalies) {
      if (anomaly.kind === 'missing_table') {
        missingTables.push(anomaly.table)
      } else {
        missingColumns[anomaly.table] = anomaly.columns
      }
    }
    const schema =
      anomalies.length === 0
        ? ({ status: 'ok' } as const)
        : ({ status: 'mismatch', missingTables, missingColumns } as const)
    return { status: 'available', quickCheck, foreignKeyViolationCount, schema }
  } catch {
    return { status: 'unavailable', reason: 'query_failed' }
  } finally {
    try {
      database.close()
    } catch {
      // Read-only support diagnostics never replace their fixed query result.
    }
  }
}

function sendResult(result: MigrationDatabaseSqliteResult): void {
  const message: MigrationDatabaseDiagnosticsChildMessage = { type: 'result', result }
  const validated = migrationDatabaseDiagnosticsChildMessageSchema.parse(message)
  process.send?.(validated)
}

if (process.env.CHERRY_MIGRATION_DATABASE_DIAGNOSTICS_CHILD === '1' && process.send !== undefined) {
  process.once('message', (rawInput) => {
    const input = migrationDatabaseDiagnosticsChildInputSchema.safeParse(rawInput)
    sendResult(
      input.success
        ? inspectMigrationDatabaseSqlite(input.data.databaseFile)
        : { status: 'unavailable', reason: 'open_failed' }
    )
    process.disconnect()
  })
}
