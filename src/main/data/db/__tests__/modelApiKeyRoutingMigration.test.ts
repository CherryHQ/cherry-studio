import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'

describe('per-model api key routing migration: upgrade from main', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0039_talented_dust' })

  it('preserves an existing model and adds a null api_key_id', () => {
    const columnsBefore = (dbh.sqlite.pragma('table_info(user_model)') as Array<{ name: string }>).map(
      (column) => column.name
    )
    expect(columnsBefore).not.toContain('api_key_id')
    const sessionColumns = (dbh.sqlite.pragma('table_info(agent_session)') as Array<{ name: string }>).map(
      (column) => column.name
    )
    expect(sessionColumns).toContain('model')
    dbh.sqlite
      .prepare(
        "INSERT INTO user_provider (provider_id, name, order_key, created_at, updated_at) VALUES ('p1', 'Provider', 'a0', 1, 1)"
      )
      .run()
    dbh.sqlite
      .prepare(
        "INSERT INTO user_model (id, provider_id, model_id, preset_model_id, order_key, created_at, updated_at) VALUES ('p1::m1', 'p1', 'm1', 'm1', 'a0', 1, 1)"
      )
      .run()
    const readModel = () =>
      dbh.sqlite.prepare('SELECT * FROM user_model WHERE id = ?').get('p1::m1') as Record<string, unknown>
    const before = readModel()

    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))

    expect(readModel()).toEqual({ ...before, api_key_id: null })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
