/**
 * Unit coverage for the two shape transforms AgentsMigrator runs after the
 * legacy INSERT...SELECT copy:
 *   - `transformAgentModelIdFormat` rewrites `providerId:modelId` to the
 *     `UniqueModelId` `providerId::modelId` format on agent / agent_session
 *     model columns.
 *   - `transformAgentBlocksToParts` reshapes agent_session_message.content
 *     from legacy `{ blocks: [...] }` to current `{ data: { parts: [...] } }`.
 *
 * Both helpers need to be idempotent — the migrator is allowed to re-run if
 * an earlier attempt partially completed, so second runs must not churn rows.
 *
 * These tests were ported from the retired
 * src/main/services/agents/database/__tests__/migrateModelIdFormat.test.ts
 * and extended with blocks→parts cases after the two helpers moved into
 * AgentsMigrator.ts.
 */

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { transformAgentBlocksToParts, transformAgentModelIdFormat } from '../AgentsMigrator'

describe('transformAgentModelIdFormat', () => {
  const dbh = setupTestDatabase()

  // agent_session FK-references agent(id); sessions must be cleaned before
  // their parent agent and every test must start from a seeded parent so
  // session inserts don't trip the FK.
  beforeEach(async () => {
    await dbh.db.delete(agentSessionTable)
    await dbh.db.delete(agentTable)
    await dbh.db.insert(agentTable).values({
      id: 'a1',
      type: 'claude_code',
      name: 'a1',
      model: 'anchor::model'
    })
  })

  it('converts single-colon model IDs to double-colon on agent and agent_session', async () => {
    await dbh.db.update(agentTable).set({ model: 'cherryin:agent/glm-4.6v' }).where(eq(agentTable.id, 'a1'))
    await dbh.db.insert(agentSessionTable).values({
      id: 's1',
      agentType: 'claude_code',
      agentId: 'a1',
      name: 'test',
      model: 'openrouter:stepfun/step-3.5-flash:free'
    })

    const result = await transformAgentModelIdFormat(dbh.db)
    expect(result.agentsUpdated).toBe(1)
    expect(result.sessionsUpdated).toBe(1)

    const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'a1'))
    expect(agent.model).toBe('cherryin::agent/glm-4.6v')

    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 's1'))
    // Note: the SQL replaces the FIRST `:` only, so a trailing segment like
    // `:free` is preserved verbatim.
    expect(session.model).toBe('openrouter::stepfun/step-3.5-flash:free')
  })

  it('skips already-migrated values with "::"', async () => {
    await dbh.db.update(agentTable).set({ model: 'cherryin::agent/glm-4.6v' }).where(eq(agentTable.id, 'a1'))

    const result = await transformAgentModelIdFormat(dbh.db)
    expect(result.agentsUpdated).toBe(0)

    const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'a1'))
    expect(agent.model).toBe('cherryin::agent/glm-4.6v')
  })

  it('handles null and empty fields on plan_model / small_model', async () => {
    await dbh.db
      .update(agentTable)
      .set({ model: 'minimax:MiniMax-M2.7', planModel: null, smallModel: '' })
      .where(eq(agentTable.id, 'a1'))

    const result = await transformAgentModelIdFormat(dbh.db)
    expect(result.agentsUpdated).toBe(1)

    const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'a1'))
    expect(agent.model).toBe('minimax::MiniMax-M2.7')
    expect(agent.planModel).toBeNull()
    expect(agent.smallModel).toBe('')
  })

  it('migrates plan_model and small_model alongside model', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 's1',
      agentType: 'claude_code',
      agentId: 'a1',
      name: 'test',
      model: 'anthropic:claude-4',
      planModel: 'anthropic:claude-4-haiku',
      smallModel: 'anthropic:claude-4-haiku'
    })

    const result = await transformAgentModelIdFormat(dbh.db)
    expect(result.sessionsUpdated).toBe(3)

    const [session] = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 's1'))
    expect(session.model).toBe('anthropic::claude-4')
    expect(session.planModel).toBe('anthropic::claude-4-haiku')
    expect(session.smallModel).toBe('anthropic::claude-4-haiku')
  })

  it('is idempotent — the second run is a no-op', async () => {
    await dbh.db.update(agentTable).set({ model: 'cherryin:agent/kimi' }).where(eq(agentTable.id, 'a1'))

    await transformAgentModelIdFormat(dbh.db)
    const second = await transformAgentModelIdFormat(dbh.db)
    expect(second.agentsUpdated).toBe(0)

    const [agent] = await dbh.db.select().from(agentTable).where(eq(agentTable.id, 'a1'))
    expect(agent.model).toBe('cherryin::agent/kimi')
  })
})

describe('transformAgentBlocksToParts', () => {
  const dbh = setupTestDatabase()
  const insertedSessions: string[] = []

  beforeEach(async () => {
    await dbh.db.delete(agentSessionMessageTable)
    // agent_session_message FK-cascades from agent_session; cleaning the
    // sessions inserted by previous cases keeps each test isolated without
    // needing to manage transactions.
    for (const sid of insertedSessions) {
      await dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sid))
    }
    insertedSessions.length = 0
    await dbh.db.delete(agentTable)
    await dbh.db.insert(agentTable).values({
      id: 'a1',
      type: 'claude_code',
      name: 'a1',
      model: 'cherryin::agent/kimi'
    })
  })

  async function seedSession(id: string): Promise<void> {
    await dbh.db.insert(agentSessionTable).values({
      id,
      agentType: 'claude_code',
      agentId: 'a1',
      name: id,
      model: 'cherryin::agent/kimi'
    })
    insertedSessions.push(id)
  }

  it('reshapes legacy blocks[] payloads into parts[] and clears the old arrays', async () => {
    await seedSession('s-blocks')

    const legacyPayload = {
      message: {
        id: 'msg-1',
        role: 'assistant',
        blocks: ['b1', 'b2']
      },
      blocks: [
        { id: 'b1', type: 'main_text', content: 'hello ', createdAt: 0 },
        { id: 'b2', type: 'main_text', content: 'world', createdAt: 0 }
      ]
    }

    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-blocks',
      role: 'assistant',
      // Drizzle JSON column accepts both objects and strings; test the
      // object path which matches what the Drizzle ORM writes locally.
      content: legacyPayload as any
    })

    const result = await transformAgentBlocksToParts(dbh.db)
    expect(result.totalMessages).toBe(1)
    expect(result.messagesConverted).toBe(1)
    expect(result.messagesSkipped).toBe(0)
    expect(result.errors).toEqual([])

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-blocks'))
    const content = row.content as { blocks: unknown[]; message: { blocks: unknown[]; data: { parts: unknown[] } } }
    expect(content.blocks).toEqual([])
    expect(content.message.blocks).toEqual([])
    expect(Array.isArray(content.message.data.parts)).toBe(true)
    expect(content.message.data.parts.length).toBeGreaterThan(0)
  })

  it('skips rows that have no legacy blocks (already reshaped or freshly written)', async () => {
    await seedSession('s-modern')

    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-modern',
      role: 'user',
      content: {
        message: {
          id: 'msg-2',
          role: 'user',
          data: { parts: [{ type: 'text', text: 'hi' }] }
        },
        blocks: []
      } as any
    })

    const result = await transformAgentBlocksToParts(dbh.db)
    expect(result.messagesSkipped).toBe(1)
    expect(result.messagesConverted).toBe(0)
  })

  it('is idempotent — a second pass does not reconvert', async () => {
    await seedSession('s-idempotent')

    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-idempotent',
      role: 'assistant',
      content: {
        message: { id: 'm', role: 'assistant', blocks: ['b1'] },
        blocks: [{ id: 'b1', type: 'main_text', content: 'x', createdAt: 0 }]
      } as any
    })

    await transformAgentBlocksToParts(dbh.db)
    const second = await transformAgentBlocksToParts(dbh.db)
    expect(second.messagesConverted).toBe(0)
    expect(second.messagesSkipped).toBe(1)
  })

  it('tolerates malformed content without aborting the whole transform', async () => {
    await seedSession('s-ok')
    await seedSession('s-bad')

    // Malformed row — content.message is missing; helper records an error
    // row-by-row but must keep going so the valid row still converts.
    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-bad',
      role: 'assistant',
      content: 'not-json-at-all' as any
    })
    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-ok',
      role: 'assistant',
      content: {
        message: { id: 'm', role: 'assistant', blocks: ['b1'] },
        blocks: [{ id: 'b1', type: 'main_text', content: 'x', createdAt: 0 }]
      } as any
    })

    const result = await transformAgentBlocksToParts(dbh.db)
    expect(result.messagesConverted).toBe(1)
    expect(result.errors.length).toBe(1)
  })
})
