import { applyMigrations } from '@data/db/applyMigrations'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { ArchiveAdmissionError, renderUntrustedName } from '../errors'

interface SchemaObject {
  readonly type: string
  readonly name: string
  readonly tableName: string
  readonly sql: string | null
}

function normalizeSql(sql: string | null): string | null {
  return sql?.replace(/\s+/g, ' ').trim() ?? null
}

function readApplicationSchema(sqlite: Database.Database): readonly SchemaObject[] {
  return (
    sqlite
      .prepare(
        `SELECT type, name, tbl_name AS tableName, sql
         FROM sqlite_schema
         WHERE substr(name, 1, 7) <> 'sqlite_'
         ORDER BY type, name`
      )
      .all() as Array<Omit<SchemaObject, 'sql'> & { sql: string | null }>
  ).map((object) => ({ ...object, sql: normalizeSql(object.sql) }))
}

function keyOf(object: SchemaObject): string {
  return `${object.type}\u0000${object.name}`
}

/**
 * Prove that an imported database has exactly the schema produced by this
 * build's migrations and custom SQL.
 *
 * Migration journal rows are attacker-controlled data, not a schema proof.
 * This comparison rejects extra triggers/views/tables/indexes before portable
 * materialization executes any UPDATE that such an object could intercept.
 */
export function assertTrustedApplicationSchema(sqlite: Database.Database, migrationsFolder: string): void {
  const trusted = new Database(':memory:')
  let expected: readonly SchemaObject[]
  try {
    applyMigrations(drizzle({ client: trusted, casing: 'snake_case' }), migrationsFolder)
    expected = readApplicationSchema(trusted)
  } finally {
    trusted.close()
  }

  let actual: readonly SchemaObject[]
  try {
    actual = readApplicationSchema(sqlite)
  } catch {
    throw new ArchiveAdmissionError('schema-mismatch', 'staged database schema could not be enumerated')
  }

  const expectedByKey = new Map(expected.map((object) => [keyOf(object), object]))
  const actualByKey = new Map(actual.map((object) => [keyOf(object), object]))

  for (const object of actual) {
    const trustedObject = expectedByKey.get(keyOf(object))
    if (!trustedObject) {
      throw new ArchiveAdmissionError(
        'schema-mismatch',
        `unexpected ${object.type}: ${renderUntrustedName(object.name)}`
      )
    }
    if (object.tableName !== trustedObject.tableName || object.sql !== trustedObject.sql) {
      throw new ArchiveAdmissionError(
        'schema-mismatch',
        `${object.type} differs from production schema: ${renderUntrustedName(object.name)}`
      )
    }
  }

  for (const object of expected) {
    if (!actualByKey.has(keyOf(object))) {
      throw new ArchiveAdmissionError('schema-mismatch', `missing ${object.type}: ${renderUntrustedName(object.name)}`)
    }
  }
}
