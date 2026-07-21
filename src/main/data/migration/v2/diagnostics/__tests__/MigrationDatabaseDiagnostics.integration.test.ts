import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { inspectMigrationDatabaseSqlite } from '../migrationDatabaseDiagnosticsChild'
import { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from '../migrationDatabaseDiagnosticsSchemas'

describe('migration database SQLite child queries', () => {
  const dbh = setupTestDatabase()
  let testDir = ''

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'migration-database-child-'))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function copyProductionDatabase(name: string): string {
    dbh.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    const destination = path.join(testDir, name)
    copyFileSync(dbh.sqlite.name, destination)
    return destination
  }

  it('reports quick_check and every fixed production table/column role without changing the database', () => {
    const databaseFile = copyProductionDatabase('healthy.sqlite')
    const before = readFileSync(databaseFile)

    const result = inspectMigrationDatabaseSqlite(databaseFile)

    expect(result).toEqual({
      status: 'available',
      quickCheck: 'ok',
      foreignKeyViolationCountBucket: '0',
      objects: MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role, table, columns }) => ({
        role,
        tableName: table,
        standardColumns: columns,
        status: 'present'
      }))
    })
    expect(readFileSync(databaseFile)).toEqual(before)
  })

  it('buckets a real foreign-key violation without exposing row, table, or identifier values', () => {
    const databaseFile = copyProductionDatabase('foreign-key.sqlite')
    const database = new Database(databaseFile)
    database.pragma('foreign_keys = OFF')
    database
      .prepare(
        'INSERT INTO topic (id, name, is_name_manually_edited, assistant_id, order_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run('PRIVATE_RECORD_ID', '', 0, 'PRIVATE_PARENT_ID', 'a0', 1, 1)
    database.close()

    const result = inspectMigrationDatabaseSqlite(databaseFile)

    expect(result).toMatchObject({ status: 'available', foreignKeyViolationCountBucket: '1' })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_RECORD_ID|PRIVATE_PARENT_ID/)
  })

  it('returns fixed open/query failures for missing and corrupt files', () => {
    const missing = inspectMigrationDatabaseSqlite(path.join(testDir, 'missing.sqlite'))
    expect(missing).toEqual({ status: 'unavailable', reason: 'open_failed' })

    const corrupt = copyProductionDatabase('corrupt.sqlite')
    writeFileSync(corrupt, 'not a database')
    expect(inspectMigrationDatabaseSqlite(corrupt)).toEqual({ status: 'unavailable', reason: 'query_failed' })
  })

  it('reports a missing object role after the production schema loses a required table', () => {
    const databaseFile = copyProductionDatabase('missing-schema-object.sqlite')
    const database = new Database(databaseFile)
    database.exec('DROP TABLE mcp_server')
    database.close()

    const result = inspectMigrationDatabaseSqlite(databaseFile)

    expect(result).toMatchObject({ status: 'available', quickCheck: 'ok' })
    if (result.status !== 'available') throw new Error('Expected the damaged production schema to remain readable')
    expect(result.objects.find(({ role }) => role === 'mcp_server')).toEqual({
      role: 'mcp_server',
      tableName: 'mcp_server',
      standardColumns: MIGRATION_DATABASE_OBJECT_DEFINITIONS.find(({ role }) => role === 'mcp_server')?.columns,
      status: 'missing_table'
    })
  })

  it('reports a missing standard field from a readable production table', () => {
    const databaseFile = copyProductionDatabase('missing-schema-column.sqlite')
    const database = new Database(databaseFile)
    database.exec('ALTER TABLE prompt DROP COLUMN content')
    database.close()

    const result = inspectMigrationDatabaseSqlite(databaseFile)

    expect(result).toMatchObject({ status: 'available', quickCheck: 'ok' })
    if (result.status !== 'available') throw new Error('Expected the damaged production schema to remain readable')
    expect(result.objects.find(({ role }) => role === 'prompt')).toEqual({
      role: 'prompt',
      tableName: 'prompt',
      standardColumns: MIGRATION_DATABASE_OBJECT_DEFINITIONS.find(({ role }) => role === 'prompt')?.columns,
      status: 'missing_columns',
      missingColumnRoles: ['content']
    })
  })
})
