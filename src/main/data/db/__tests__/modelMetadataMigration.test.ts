import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { userProviderTable } from '@data/db/schemas/userProvider'

// Nullable provenance must not relabel or alter pre-existing model values.
describe('model metadata provenance migrate-forward', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0042_model_metadata_provenance' })
  it('preserves populated models, timestamps and foreign keys, and is idempotent', () => {
    dbh.db.insert(userProviderTable).values({ providerId: 'custom', name: 'Custom', orderKey: 'a0' }).run()
    dbh.sqlite
      .prepare(
        'INSERT INTO user_model (id, provider_id, model_id, context_window, max_output_tokens, capabilities, created_at, updated_at, order_key, name, supports_streaming) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run('custom::model', 'custom', 'model', 32000, 4000, '[]', 1000, 2000, 'a0', 'Model', 1)
    const read = () => dbh.sqlite.prepare('SELECT * FROM user_model').get() as Record<string, unknown>
    const before = read()
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(read()).toEqual({ ...before, provider_metadata: null, metadata_sources: null })
    applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
    expect(read()).toEqual({ ...before, provider_metadata: null, metadata_sources: null })
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
