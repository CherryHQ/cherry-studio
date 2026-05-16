import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

describe('AgentSessionMessageService', () => {
  const dbh = setupTestDatabase()

  async function seedSessionMessage({
    rowId = 'row-message-1',
    messageId = 'ui-message-1',
    sessionId = 'session-1'
  }: {
    rowId?: string
    messageId?: string
    sessionId?: string
  } = {}) {
    await dbh.db.insert(agentSessionTable).values({
      id: sessionId,
      name: 'Agent Session',
      orderKey: 'a0'
    })

    await dbh.db.insert(agentSessionMessageTable).values({
      id: rowId,
      sessionId,
      role: 'assistant',
      content: {
        message: {
          id: messageId,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'hello' }] }
        },
        blocks: []
      },
      agentSessionId: null
    })
  }

  it('deletes a session message by rendered message id', async () => {
    await seedSessionMessage()

    await agentSessionMessageService.deleteSessionMessage('session-1', 'ui-message-1')

    const rows = await dbh.db.select().from(agentSessionMessageTable)
    expect(rows).toHaveLength(0)
  })

  it('keeps existing row-id delete semantics', async () => {
    await seedSessionMessage({
      rowId: 'row-message-2',
      messageId: 'ui-message-2',
      sessionId: 'session-2'
    })

    await agentSessionMessageService.deleteSessionMessage('session-2', 'row-message-2')

    const rows = await dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, 'session-2'))
    expect(rows).toHaveLength(0)
  })
})
