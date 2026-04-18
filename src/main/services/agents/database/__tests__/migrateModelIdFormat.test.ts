import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runModelIdFormatMigration } from '../migrateModelIdFormat'
import * as schema from '../schema'

function createTestDb() {
  const client = createClient({ url: ':memory:' })
  const db = drizzle(client, { schema })
  return { db, client }
}

describe('migrateModelIdFormat', () => {
  let db: ReturnType<typeof createTestDb>['db']
  let client: ReturnType<typeof createTestDb>['client']

  beforeEach(async () => {
    const created = createTestDb()
    db = created.db
    client = created.client

    await client.executeMultiple(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'claude_code',
        name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        plan_model TEXT,
        small_model TEXT,
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL DEFAULT 'claude_code',
        agent_id TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        plan_model TEXT,
        small_model TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT ''
      );
    `)
  })

  afterEach(() => {
    client.close()
  })

  it('converts single-colon model IDs to double-colon', async () => {
    await client.execute(`INSERT INTO agents (id, model) VALUES ('a1', 'cherryin:agent/glm-4.6v')`)
    await client.execute(
      `INSERT INTO sessions (id, agent_id, name, model) VALUES ('s1', 'a1', 'test', 'openrouter:stepfun/step-3.5-flash:free')`
    )

    const result = await runModelIdFormatMigration(db as any)
    expect(result.agentsUpdated).toBe(1)
    expect(result.sessionsUpdated).toBe(1)

    const agent = await client.execute(`SELECT model FROM agents WHERE id = 'a1'`)
    expect(agent.rows[0].model).toBe('cherryin::agent/glm-4.6v')

    const session = await client.execute(`SELECT model FROM sessions WHERE id = 's1'`)
    expect(session.rows[0].model).toBe('openrouter::stepfun/step-3.5-flash:free')
  })

  it('skips already-migrated values with "::"', async () => {
    await client.execute(`INSERT INTO agents (id, model) VALUES ('a1', 'cherryin::agent/glm-4.6v')`)

    const result = await runModelIdFormatMigration(db as any)
    expect(result.agentsUpdated).toBe(0)

    const agent = await client.execute(`SELECT model FROM agents WHERE id = 'a1'`)
    expect(agent.rows[0].model).toBe('cherryin::agent/glm-4.6v')
  })

  it('handles null and empty model fields', async () => {
    await client.execute(
      `INSERT INTO agents (id, model, plan_model, small_model) VALUES ('a1', 'minimax:MiniMax-M2.7', NULL, '')`
    )

    const result = await runModelIdFormatMigration(db as any)
    expect(result.agentsUpdated).toBe(1)

    const agent = await client.execute(`SELECT model, plan_model, small_model FROM agents WHERE id = 'a1'`)
    expect(agent.rows[0].model).toBe('minimax::MiniMax-M2.7')
    expect(agent.rows[0].plan_model).toBeNull()
    expect(agent.rows[0].small_model).toBe('')
  })

  it('migrates plan_model and small_model too', async () => {
    await client.execute(
      `INSERT INTO sessions (id, agent_id, name, model, plan_model, small_model) VALUES ('s1', 'a1', 'test', 'anthropic:claude-4', 'anthropic:claude-4-haiku', 'anthropic:claude-4-haiku')`
    )

    const result = await runModelIdFormatMigration(db as any)
    expect(result.sessionsUpdated).toBe(3)

    const session = await client.execute(`SELECT model, plan_model, small_model FROM sessions WHERE id = 's1'`)
    expect(session.rows[0].model).toBe('anthropic::claude-4')
    expect(session.rows[0].plan_model).toBe('anthropic::claude-4-haiku')
    expect(session.rows[0].small_model).toBe('anthropic::claude-4-haiku')
  })

  it('is idempotent — running twice produces same result', async () => {
    await client.execute(`INSERT INTO agents (id, model) VALUES ('a1', 'cherryin:agent/kimi')`)

    await runModelIdFormatMigration(db as any)
    const result2 = await runModelIdFormatMigration(db as any)
    expect(result2.agentsUpdated).toBe(0)

    const agent = await client.execute(`SELECT model FROM agents WHERE id = 'a1'`)
    expect(agent.rows[0].model).toBe('cherryin::agent/kimi')
  })
})
