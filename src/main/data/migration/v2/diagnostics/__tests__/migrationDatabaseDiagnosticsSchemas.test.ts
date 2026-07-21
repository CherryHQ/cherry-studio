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
  tableName: definition.table,
  standardColumns: definition.columns,
  status: 'present' as const
}))

const expectedTargets = [
  ['app_state', 'app_state'],
  ['preference', 'preference'],
  ['note', 'note'],
  ['mini_app', 'mini_app'],
  ['mcp_server', 'mcp_server'],
  ['user_provider', 'user_provider'],
  ['user_model', 'user_model'],
  ['assistant', 'assistant'],
  ['assistant_mcp_server', 'assistant_mcp_server'],
  ['assistant_knowledge_base', 'assistant_knowledge_base'],
  ['tag', 'tag'],
  ['entity_tag', 'entity_tag'],
  ['file', 'file_entry'],
  ['provider_logo_file_ref', 'provider_logo_file_ref'],
  ['mini_app_logo_file_ref', 'mini_app_logo_file_ref'],
  ['agent', 'agent'],
  ['agent_session', 'agent_session'],
  ['agent_workspace', 'agent_workspace'],
  ['agent_global_skill', 'agent_global_skill'],
  ['agent_skill', 'agent_skill'],
  ['agent_channel', 'agent_channel'],
  ['agent_session_message', 'agent_session_message'],
  ['job_schedule', 'job_schedule'],
  ['agent_channel_task', 'agent_channel_task'],
  ['agent_mcp_server', 'agent_mcp_server'],
  ['knowledge_base', 'knowledge_base'],
  ['knowledge_item', 'knowledge_item'],
  ['topic', 'topic'],
  ['message', 'message'],
  ['chat_message_file_ref', 'chat_message_file_ref'],
  ['pin', 'pin'],
  ['painting', 'painting'],
  ['painting_file_ref', 'painting_file_ref'],
  ['translate_language', 'translate_language'],
  ['translate_history', 'translate_history'],
  ['prompt', 'prompt']
] as const

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
  it('covers every persistent migration target with its stable role and physical table name', () => {
    expect(MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role, table }) => [role, table])).toEqual(expectedTargets)
    expect(MIGRATION_DATABASE_OBJECT_DEFINITIONS.every(({ columns }) => columns.length > 0)).toBe(true)
  })

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
        ? { ...object, status: 'missing_columns' as const, missingColumnRoles: ['model_id'] }
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

  it('requires the exact table name and complete standard-column order for each role', () => {
    const promptIndex = objects.findIndex(({ role }) => role === 'prompt')
    const prompt = objects[promptIndex]
    if (prompt === undefined) throw new Error('Expected the prompt diagnostics target')

    const wrongTable = objects.with(promptIndex, { ...prompt, tableName: 'private_table_name' })
    expect(migrationDatabaseSqliteResultSchema.safeParse({ ...availableSqlite, objects: wrongTable }).success).toBe(
      false
    )

    const wrongColumns = objects.with(promptIndex, {
      ...prompt,
      standardColumns: [...prompt.standardColumns].reverse()
    })
    expect(migrationDatabaseSqliteResultSchema.safeParse({ ...availableSqlite, objects: wrongColumns }).success).toBe(
      false
    )
  })

  it('rejects globally valid columns that do not belong to the selected table', () => {
    const wrongMissingColumns = objects.map((object) =>
      object.role === 'prompt'
        ? { ...object, status: 'missing_columns' as const, missingColumnRoles: ['app_id'] }
        : object
    )
    expect(
      migrationDatabaseSqliteResultSchema.safeParse({ ...availableSqlite, objects: wrongMissingColumns }).success
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
