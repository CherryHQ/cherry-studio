import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { transformAgentBlocksToParts } from '../AgentsMigrator'

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
      instructions: '',
      model: null,
      orderKey: 'a0'
    })
  })

  async function seedSession(id: string): Promise<void> {
    await dbh.db.insert(agentSessionTable).values({
      id,
      agentId: 'a1',
      name: id,
      orderKey: 'a0'
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

  it('normalizes transient message.status to error when reshaping blocks', async () => {
    // A mid-stream row persisted as status: 'pending' with blocks still present —
    // blocks→parts conversion must collapse the transient status so the renderer
    // doesn't keep treating it as streaming. ('processing' | 'sending' |
    // 'searching' share the same fate; one representative case is enough since
    // normalizeStatus is covered exhaustively in ChatMappings tests.)
    await seedSession('s-pending')
    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-pending',
      role: 'assistant',
      content: {
        message: { id: 'm', role: 'assistant', status: 'pending', blocks: ['b1'] },
        blocks: [{ id: 'b1', type: 'main_text', content: 'x', createdAt: 0 }]
      } as any
    })

    const result = await transformAgentBlocksToParts(dbh.db)
    expect(result.messagesConverted).toBe(1)

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-pending'))
    const content = row.content as { message: { status: string } }
    expect(content.message.status).toBe('error')
  })

  it('preserves terminal message.status (success/paused) during reshape', async () => {
    await seedSession('s-success')
    await dbh.db.insert(agentSessionMessageTable).values({
      sessionId: 's-success',
      role: 'assistant',
      content: {
        message: { id: 'm', role: 'assistant', status: 'success', blocks: ['b1'] },
        blocks: [{ id: 'b1', type: 'main_text', content: 'x', createdAt: 0 }]
      } as any
    })

    await transformAgentBlocksToParts(dbh.db)

    const [row] = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 's-success'))
    const content = row.content as { message: { status: string } }
    expect(content.message.status).toBe('success')
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
