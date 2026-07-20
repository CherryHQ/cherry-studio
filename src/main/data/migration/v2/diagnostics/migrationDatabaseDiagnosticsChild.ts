import process from 'node:process'

import Database from 'better-sqlite3'

import {
  MIGRATION_DATABASE_OBJECT_DEFINITIONS,
  migrationDatabaseDiagnosticsChildInputSchema,
  type MigrationDatabaseDiagnosticsChildMessage,
  migrationDatabaseDiagnosticsChildMessageSchema,
  type MigrationDatabaseObjectCheck,
  type MigrationDatabaseSqliteResult
} from './migrationDatabaseDiagnosticsSchemas'

interface ColumnRow {
  readonly name?: unknown
}

function foreignKeyBucket(count: number): '0' | '1' | '2-10' | '11+' {
  if (count === 0) return '0'
  if (count === 1) return '1'
  if (count <= 10) return '2-10'
  return '11+'
}

function inspectForeignKeys(database: Database.Database): '0' | '1' | '2-10' | '11+' {
  const row = database
    .prepare('SELECT count(*) AS count FROM (SELECT 1 FROM pragma_foreign_key_check LIMIT 11)')
    .get() as { readonly count: number }
  return foreignKeyBucket(row.count)
}

function inspectObject(
  database: Database.Database,
  definition: (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]
): MigrationDatabaseObjectCheck {
  const table = database
    .prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1")
    .get(definition.table)
  if (table === undefined) return { role: definition.role, status: 'missing_table' }

  const columns = new Set(
    (database.pragma(`table_info(${definition.table})`) as ColumnRow[])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string')
  )
  const missingColumnRoles = definition.columns.filter((column) => !columns.has(column))
  return missingColumnRoles.length === 0
    ? { role: definition.role, status: 'present' }
    : { role: definition.role, status: 'missing_columns', missingColumnRoles }
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
    const foreignKeyViolationCountBucket = inspectForeignKeys(database)
    const objects = MIGRATION_DATABASE_OBJECT_DEFINITIONS.map((definition) => inspectObject(database, definition))
    return { status: 'available', quickCheck, foreignKeyViolationCountBucket, objects }
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
