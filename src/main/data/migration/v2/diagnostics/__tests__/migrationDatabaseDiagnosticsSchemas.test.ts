import { describe, expect, it } from 'vitest'

import {
  MIGRATION_DATABASE_OBJECT_DEFINITIONS,
  migrationDatabaseDiagnosticResultSchema,
  migrationDatabaseDiagnosticsChildInputSchema,
  migrationDatabaseDiagnosticsChildMessageSchema,
  migrationDatabaseSqliteResultSchema
} from '../migrationDatabaseDiagnosticsSchemas'

const objects = MIGRATION_DATABASE_OBJECT_DEFINITIONS.map((definition) => ({
  role: definition.role,
  status: 'present' as const
}))

const availableSqlite = {
  status: 'available',
  quickCheck: 'ok',
  foreignKeyViolationCountBucket: '0',
  objects
} as const

const result = {
  file: {
    status: 'readable',
    sizeBucket: '4096-1m',
    sqliteHeader: 'valid',
    walPresent: false,
    shmPresent: false
  },
  sqlite: availableSqlite
} as const

describe('migrationDatabaseDiagnosticResultSchema', () => {
  it('accepts only native-free file facts plus the one-shot SQLite result', () => {
    expect(migrationDatabaseDiagnosticResultSchema.parse(result)).toEqual(result)
  })

  it.each(['version', 'expectedSchemaVersion', 'completion', 'l0', 'l1', 'l2', 'databaseFile', 'path', 'message'])(
    'rejects the legacy or private %s field',
    (field) => {
      expect(migrationDatabaseDiagnosticResultSchema.safeParse({ ...result, [field]: 'privacy-canary' }).success).toBe(
        false
      )
    }
  )

  it.each([
    {
      file: { status: 'missing', sqliteHeader: 'unavailable', walPresent: false, shmPresent: false },
      sqlite: { status: 'unavailable', reason: 'not_attempted' }
    },
    {
      file: { status: 'not_regular', sqliteHeader: 'unavailable' },
      sqlite: { status: 'unavailable', reason: 'not_attempted' }
    },
    {
      file: { status: 'unreadable', sizeBucket: '1-4095', sqliteHeader: 'unavailable' },
      sqlite: { status: 'unavailable', reason: 'open_failed' }
    }
  ] as const)('accepts the bounded $file.status file outcome', (value) => {
    expect(migrationDatabaseDiagnosticResultSchema.safeParse(value).success).toBe(true)
  })

  it('rejects inconsistent file facts', () => {
    expect(
      migrationDatabaseDiagnosticResultSchema.safeParse({
        ...result,
        file: { status: 'missing', sizeBucket: '4096-1m', sqliteHeader: 'valid' }
      }).success
    ).toBe(false)
    expect(
      migrationDatabaseDiagnosticResultSchema.safeParse({
        ...result,
        file: { status: 'readable', sqliteHeader: 'unavailable' }
      }).success
    ).toBe(false)
  })
})

describe('migrationDatabaseSqliteResultSchema', () => {
  it('requires exactly one result for every fixed object role', () => {
    expect(migrationDatabaseSqliteResultSchema.parse(availableSqlite)).toEqual(availableSqlite)
    expect(
      migrationDatabaseSqliteResultSchema.safeParse({ ...availableSqlite, objects: objects.slice(1) }).success
    ).toBe(false)
    expect(
      migrationDatabaseSqliteResultSchema.safeParse({ ...availableSqlite, objects: [...objects.slice(1), objects[1]] })
        .success
    ).toBe(false)
  })

  it('allows only fixed missing-column roles and only on missing_columns', () => {
    const missing = objects.map((object) =>
      object.role === 'user_model'
        ? { role: object.role, status: 'missing_columns' as const, missingColumnRoles: ['model_id'] }
        : object
    )
    expect(migrationDatabaseSqliteResultSchema.safeParse({ ...availableSqlite, objects: missing }).success).toBe(true)
    expect(
      migrationDatabaseSqliteResultSchema.safeParse({
        ...availableSqlite,
        objects: objects.map((object) =>
          object.role === 'user_model' ? { ...object, missingColumnRoles: ['private_column_name'] } : object
        )
      }).success
    ).toBe(false)
  })

  it.each(['not_attempted', 'open_failed', 'query_failed', 'timeout', 'child_exit', 'invalid_output'] as const)(
    'accepts the fixed unavailable reason %s',
    (reason) => {
      expect(migrationDatabaseSqliteResultSchema.parse({ status: 'unavailable', reason })).toEqual({
        status: 'unavailable',
        reason
      })
    }
  )
})

describe('one-shot child protocol', () => {
  it('accepts one strict path input and one strict final result message', () => {
    expect(migrationDatabaseDiagnosticsChildInputSchema.parse({ databaseFile: '/private/database.sqlite' })).toEqual({
      databaseFile: '/private/database.sqlite'
    })
    expect(migrationDatabaseDiagnosticsChildMessageSchema.parse({ type: 'result', result: availableSqlite })).toEqual({
      type: 'result',
      result: availableSqlite
    })
  })

  it.each([
    { mode: 'full', databaseFile: '/private/database.sqlite' },
    { databaseFile: '/private/database.sqlite', identity: { inode: '1' } },
    { databaseFile: '/private/database.sqlite', message: 'raw failure' }
  ])('rejects legacy/extra child input %#', (input) => {
    expect(migrationDatabaseDiagnosticsChildInputSchema.safeParse(input).success).toBe(false)
  })

  it.each([
    { type: 'ready', version: 1 },
    { type: 'step', level: 'l0' },
    { type: 'result', result: availableSqlite, databaseFile: '/private/database.sqlite' },
    { type: 'result', result: availableSqlite, message: 'raw failure' }
  ])('rejects handshake, partial, or private output %#', (message) => {
    expect(migrationDatabaseDiagnosticsChildMessageSchema.safeParse(message).success).toBe(false)
  })
})
