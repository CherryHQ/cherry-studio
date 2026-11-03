import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import type { CherryMessagePart } from '@shared/data/types/message'

import { agentSessionMessageHandlers } from '../agentSessionMessages'

describe('agentSessionMessageHandlers list with real storage', () => {
  const dbh = setupTestDatabase()
  const sessionId = 'session-1'

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace-1', name: 'Workspace', path: '/workspace', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, workspaceId: 'workspace-1', name: 'Session', orderKey: 'a0' })
      .run()
  })

  function insert(id: string, role: 'assistant' | 'user', parts: CherryMessagePart[], createdAt: number) {
    dbh.db
      .insert(agentSessionMessageTable)
      .values({ id, sessionId, role, data: { parts }, status: 'success', createdAt, updatedAt: createdAt })
      .run()
  }

  async function list(query?: {
    deferToolOutputs?: boolean
    limit?: number
    cursor?: string
  }): Promise<CursorPaginationResponse<AgentSessionMessageEntity>> {
    const result = await agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
      params: { sessionId },
      query
    } as never)
    if (!('items' in result)) throw new Error('Expected a direct message page')
    return result
  }

  it('replaces an oversized assistant tool output with a reference, leaving the stored data alone', async () => {
    const output = { content: 'x'.repeat(64 * 1024) }
    const parts: CherryMessagePart[] = [
      { type: 'text', text: 'answer' },
      {
        type: 'dynamic-tool',
        toolName: 'probe',
        toolCallId: 'tool-call-1',
        state: 'output-available',
        input: {},
        output
      }
    ]
    const userParts: CherryMessagePart[] = [
      {
        type: 'dynamic-tool',
        toolName: 'probe',
        toolCallId: 'user-tool',
        state: 'output-available',
        input: {},
        output
      }
    ]
    insert('assistant-message', 'assistant', parts, 200)
    insert('user-message', 'user', userParts, 100)
    const result = await list({ deferToolOutputs: true })
    expect(result.items.map((m) => m.id)).toEqual(['assistant-message', 'user-message'])
    expect(result.items[0].data.parts).toEqual([
      { type: 'text', text: 'answer' },
      {
        type: 'dynamic-tool',
        toolName: 'probe',
        toolCallId: 'tool-call-1',
        state: 'output-available',
        input: {},
        output: {
          $deferredToolResult: {
            topicId: 'agent-session:session-1',
            messageId: 'assistant-message',
            toolCallId: 'tool-call-1'
          }
        }
      }
    ])
    expect(result.items[1].data.parts).toEqual(userParts)
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, 'assistant-message')).get()
        ?.data.parts
    ).toEqual(parts)
    expect(result.nextCursor).toBeUndefined()
  })

  it('leaves a small tool output inline so no round trip is needed to render it', async () => {
    const parts: CherryMessagePart[] = [
      {
        type: 'dynamic-tool',
        toolName: 'probe',
        toolCallId: 'tool-call-1',
        state: 'output-available',
        input: {},
        output: { a: 1 }
      }
    ]
    insert('assistant-message', 'assistant', parts, 200)
    const result = await list({ deferToolOutputs: true })
    expect(result.items).toMatchObject([
      { id: 'assistant-message', sessionId, role: 'assistant', status: 'success', data: { parts } }
    ])
    expect(result.nextCursor).toBeUndefined()
  })

  it.each([undefined, false])(
    'returns stored tool outputs verbatim with deferToolOutputs=%s',
    async (deferToolOutputs) => {
      const parts: CherryMessagePart[] = [
        {
          type: 'dynamic-tool',
          toolName: 'probe',
          toolCallId: 'tool-call-1',
          state: 'output-available',
          input: {},
          output: { content: 'x'.repeat(64 * 1024) }
        }
      ]
      insert('assistant-message', 'assistant', parts, 200)
      const result = await list(deferToolOutputs === undefined ? undefined : { deferToolOutputs })
      expect(result.items).toMatchObject([{ id: 'assistant-message', data: { parts } }])
      expect(result.nextCursor).toBeUndefined()
      expect(dbh.db.select().from(agentSessionMessageTable).get()?.data.parts).toEqual(parts)
    }
  )

  it('keeps the same nextCursor for projected and default reads', async () => {
    for (let i = 0; i < 4; i++)
      insert(
        `message-${i}`,
        'assistant',
        [
          {
            type: 'dynamic-tool',
            toolName: 'probe',
            toolCallId: `call-${i}`,
            state: 'output-available',
            input: {},
            output: 'x'.repeat(64 * 1024)
          }
        ],
        100
      )
    const original = await list({ limit: 2 })
    const projected = await list({ limit: 2, deferToolOutputs: true })
    expect(projected.items.map((m) => m.id)).toEqual(original.items.map((m) => m.id))
    expect(projected.nextCursor).toBe('100:message-2')
    expect(projected.nextCursor).toBe(original.nextCursor)
    expect(
      (await list({ limit: 2, cursor: projected.nextCursor, deferToolOutputs: true })).items.map((m) => m.id)
    ).toEqual(['message-1', 'message-0'])
  })

  it.each(['background', 'archived'])('does not expose messages from a %s session', async (scope) => {
    insert('private-message', 'assistant', [{ type: 'text', text: 'private' }], 100)
    dbh.db
      .update(agentSessionTable)
      .set(scope === 'background' ? { type: 'background' } : { deletedAt: 100 })
      .where(eq(agentSessionTable.id, sessionId))
      .run()
    for (const deferToolOutputs of [undefined, false, true]) {
      await expect(list({ deferToolOutputs })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(dbh.db.select().from(agentSessionMessageTable).get()?.data.parts).toEqual([
      { type: 'text', text: 'private' }
    ])
  })
})
