// Product tests for the @generated dbSchemaRefs.ts (Track A2 codegen output).
// These pin the codegen contract from codegen.md / types-contracts.md: membership,
// camelCase column keys, PK heuristic (H1–H5), FK edge cases, FTS mapping, and the
// compile-time-validation helpers. If a Drizzle schema changes, regenerate
// (pnpm backup:refs:generate) and update the expected counts here.
import { describe, expect, it } from 'vitest'

import { ALWAYS_STRIP_TABLES } from './exclusions'
import {
  column,
  columns,
  DB_COLUMNS_BY_TABLE,
  DB_FOREIGN_KEYS,
  DB_FTS_VIRTUAL_TABLES,
  DB_PRIMARY_KEYS,
  DB_TABLES,
  table
} from './dbSchemaRefs'

// Current business-table count (sqliteTable() definitions). Update if schemas change.
const EXPECTED_TABLE_COUNT = 35

describe('DB_TABLES membership', () => {
  it('discovers exactly the sqliteTable() business tables, sorted ascending', () => {
    expect(DB_TABLES).toHaveLength(EXPECTED_TABLE_COUNT)
    expect([...DB_TABLES]).toEqual([...DB_TABLES].sort())
  })

  it('excludes __drizzle_migrations (drizzle runtime infra, not a sqliteTable)', () => {
    expect(DB_TABLES).not.toContain('__drizzle_migrations')
  })

  it('excludes FTS5 virtual tables (raw CREATE VIRTUAL TABLE SQL, not sqliteTable)', () => {
    expect(DB_TABLES).not.toContain('message_fts')
    expect(DB_TABLES).not.toContain('agent_session_message_fts')
  })

  it('includes the always-strip DB tables (they ARE sqliteTable definitions)', () => {
    // app_state and job are always stripped from backups but still discovered as
    // business tables — the coverage universe iterates DB_TABLES, and exclusions
    // account for them separately.
    expect(DB_TABLES).toContain('app_state')
    expect(DB_TABLES).toContain('job')
    for (const t of DB_TABLES) {
      expect(ALWAYS_STRIP_TABLES.has(t)).toBe(t === 'app_state' || t === 'job' ? true : false)
    }
  })
})

describe('DB_COLUMNS_BY_TABLE', () => {
  it('uses camelCase JS keys for name and dbName (not snake_case physical columns)', () => {
    const names = DB_COLUMNS_BY_TABLE.message.map((c) => c.name)
    expect(names).toContain('id')
    expect(names).toContain('topicId')
    expect(names).toContain('parentId')
    expect(names).toContain('ftsRowid')
    // dbName mirrors the JS key; the physical snake_case column is derived by
    // DbService casing:'snake_case' at query time, never stored here.
    for (const c of DB_COLUMNS_BY_TABLE.message) {
      expect(c.dbName).toBe(c.name)
    }
  })

  it('marks the id column as a non-nullable primary key', () => {
    const id = DB_COLUMNS_BY_TABLE.message.find((c) => c.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
    expect(id?.isNullable).toBe(false)
  })

  it('resolves DB-name override columns to their camelCase JS keys, not snake_case', () => {
    // These columns pass an explicit snake_case name to the column builder
    // (e.g. text('app_id')); codegen must emit the JS property key, never the
    // override. A buildKeyLookup regression (reading column.name) would flip these
    // to snake_case, so the negative assertions are the real guard here.
    const noteNames = DB_COLUMNS_BY_TABLE.note.map((c) => c.name)
    expect(noteNames).toContain('rootPath')
    expect(noteNames).not.toContain('root_path')

    const miniAppNames = DB_COLUMNS_BY_TABLE.mini_app.map((c) => c.name)
    expect(miniAppNames).toContain('appId')
    expect(miniAppNames).not.toContain('app_id')
    expect(miniAppNames).toContain('presetMiniAppId')
    expect(miniAppNames).not.toContain('preset_mini_app_id')

    const userProviderNames = DB_COLUMNS_BY_TABLE.user_provider.map((c) => c.name)
    expect(userProviderNames).toContain('endpointConfigs')
    expect(userProviderNames).not.toContain('endpoint_configs')
    expect(userProviderNames).toContain('apiFeatures')
    expect(userProviderNames).not.toContain('api_features')

    // orderKey comes from the spread orderKeyColumns helper (text('order_key')).
    const topicNames = DB_COLUMNS_BY_TABLE.topic.map((c) => c.name)
    expect(topicNames).toContain('orderKey')
    expect(topicNames).not.toContain('order_key')
  })
})

describe('DB_PRIMARY_KEYS heuristic (H1–H5)', () => {
  it('classifies uuidPrimaryKeyOrdered id columns as uuid-v7, unambiguous', () => {
    expect(DB_PRIMARY_KEYS.message).toMatchObject({ kind: 'uuid-v7', ambiguous: false })
    expect(DB_PRIMARY_KEYS.agent_session_message).toMatchObject({ kind: 'uuid-v7', ambiguous: false })
  })

  it('classifies composite primary keys (H1) without ambiguity', () => {
    expect(DB_PRIMARY_KEYS.agent_skill).toMatchObject({ kind: 'composite', ambiguous: false })
    expect([...DB_PRIMARY_KEYS.agent_skill.columns]).toEqual(['agentId', 'skillId'])
    expect(DB_PRIMARY_KEYS.preference).toMatchObject({ kind: 'composite' })
    expect([...DB_PRIMARY_KEYS.preference.columns]).toEqual(['scope', 'key'])
  })

  it('flags non-id natural keys as ambiguous (H4), requiring contributor override', () => {
    expect(DB_PRIMARY_KEYS.mini_app).toMatchObject({ kind: 'natural', ambiguous: true })
    expect([...DB_PRIMARY_KEYS.mini_app.columns]).toEqual(['appId'])
    expect(DB_PRIMARY_KEYS.translate_language).toMatchObject({ kind: 'natural', ambiguous: true })
  })

  it('flags id columns without a UUID helper default as ambiguous (H5)', () => {
    expect(DB_PRIMARY_KEYS.user_model).toMatchObject({ kind: 'natural', ambiguous: true })
  })

  it('flags every PK column as isPrimaryKey in DB_COLUMNS_BY_TABLE (inline + composite)', () => {
    // Composite PK constituents don't carry Drizzle's inline .primary flag, so this
    // guards the codegen's pkKeySet re-derivation (entity_tag/preference/agent_skill/…).
    for (const table of DB_TABLES) {
      for (const pkCol of DB_PRIMARY_KEYS[table].columns) {
        const col = DB_COLUMNS_BY_TABLE[table].find((c) => c.name === pkCol)
        expect(col?.isPrimaryKey, `${table}.${pkCol} should be isPrimaryKey`).toBe(true)
      }
    }
  })
})

describe('DB_FOREIGN_KEYS', () => {
  it('captures inline .references() and table-level foreignKey() builders', () => {
    const messageFks = DB_FOREIGN_KEYS.message
    expect(messageFks).toContainEqual({
      columns: ['topicId'],
      targetTable: 'topic',
      targetColumns: ['id'],
      onDelete: 'cascade'
    })
    expect(messageFks).toContainEqual({
      columns: ['modelId'],
      targetTable: 'user_model',
      targetColumns: ['id'],
      onDelete: 'set null'
    })
    // Self-referential FK declared via the 3rd-arg foreignKey() builder.
    expect(messageFks).toContainEqual({
      columns: ['parentId'],
      targetTable: 'message',
      targetColumns: ['id'],
      onDelete: 'cascade'
    })
  })

  it('handles a foreign key to a non-id primary-key column', () => {
    // translate_language.langCode is the PK; translate_history references it.
    expect(DB_FOREIGN_KEYS.translate_history).toContainEqual({
      columns: ['sourceLanguage'],
      targetTable: 'translate_language',
      targetColumns: ['langCode'],
      onDelete: 'set null'
    })
  })

  it('captures the composite self-referential FK on knowledge_item (multi-column + self-ref)', () => {
    // [baseId, groupId] -> [baseId, id] onDelete cascade: exercises table-level
    // foreignKey() extraction, multi-column targetColumns ORDER, and self-reference.
    expect(DB_FOREIGN_KEYS.knowledge_item).toContainEqual({
      columns: ['baseId', 'groupId'],
      targetTable: 'knowledge_item',
      targetColumns: ['baseId', 'id'],
      onDelete: 'cascade'
    })
  })

  it('normalizes an absent ON DELETE to "no action" (never undefined)', () => {
    for (const facts of Object.values(DB_FOREIGN_KEYS)) {
      for (const fk of facts) {
        expect(fk.onDelete).toMatch(/^(cascade|restrict|set null|no action|set default)$/)
      }
    }
  })

  it('emits an empty array for tables without foreign keys', () => {
    expect(DB_FOREIGN_KEYS.prompt).toEqual([])
  })

  it('targets only known business tables', () => {
    const known = new Set(DB_TABLES)
    for (const facts of Object.values(DB_FOREIGN_KEYS)) {
      for (const fk of facts) expect(known.has(fk.targetTable)).toBe(true)
    }
  })
})

describe('DB_FTS_VIRTUAL_TABLES', () => {
  it('maps both FTS5 virtual tables to their content tables', () => {
    expect(DB_FTS_VIRTUAL_TABLES.message_fts).toBe('message')
    expect(DB_FTS_VIRTUAL_TABLES.agent_session_message_fts).toBe('agent_session_message')
    expect(Object.keys(DB_FTS_VIRTUAL_TABLES)).toHaveLength(2)
  })

  it('content tables are known business tables', () => {
    const known = new Set(DB_TABLES)
    for (const contentTable of Object.values(DB_FTS_VIRTUAL_TABLES)) {
      expect(known.has(contentTable)).toBe(true)
    }
  })
})

describe('helper functions (compile-time validation)', () => {
  it('table() returns the literal unchanged', () => {
    expect(table('message')).toBe('message')
  })

  it('column() returns the literal unchanged and is typed per table', () => {
    // The generic argument is itself the compile-time check: 'topicId' must be a
    // known message column or this line fails tsc. Runtime just echoes it back.
    expect(column<'message'>('topicId')).toBe('topicId')
  })

  it('columns() returns the array unchanged', () => {
    expect([...columns<'message'>(['id', 'topicId'])]).toEqual(['id', 'topicId'])
  })
})
