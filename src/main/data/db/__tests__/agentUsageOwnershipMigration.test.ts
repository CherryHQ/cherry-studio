import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'

const dbh = setupTestDatabase({ beforeMigration: '0033_pale_marten_broadcloak' })

// Adding session ownership must preserve existing monetary facts without guessing their owner.
it('migrates a populated invocation ledger without rewriting old fees', () => {
  dbh.sqlite
    .prepare(`INSERT INTO ai_usage_record
    (id, provider_id, model_id, request_id, record_kind, request_count, modality, api_key_attribution, created_at, input_tokens, output_tokens, total_tokens, cost, cost_currency, cost_source)
    VALUES ('historical', 'provider', 'model', 'request', 'invocation', 1, 'language', 'unknown', 1234, 100, 20, 120, 0.25, 'USD', 'provider')`)
    .run()
  const before = dbh.sqlite.prepare('SELECT * FROM ai_usage_record').get()
  applyMigrations(dbh.db, resolve('migrations/sqlite-drizzle'))
  expect(dbh.sqlite.prepare('SELECT * FROM ai_usage_record').get()).toEqual({ ...before!, agent_session_id: null })
  const row = dbh.db.select().from(aiUsageRecordTable).get()!
  dbh.db
    .insert(aiUsageRecordTable)
    .values({ ...row, id: 'new', requestId: 'auxiliary', agentSessionId: 'session' })
    .run()
  expect(dbh.db.select().from(aiUsageRecordTable).all()).toHaveLength(2)
  expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
})
