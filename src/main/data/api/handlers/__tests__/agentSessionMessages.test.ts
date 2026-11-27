import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { DEFER_TOOL_OUTPUT_BYTES } from '@main/utils/messageOutputProjection'
import { isDeferredToolOutput } from '@shared/ai/transport'
import { AgentSessionMessageEntitySchema } from '@shared/data/api/schemas/agentSessionMessages'

import { agentSessionMessageHandlers } from '../agentSessionMessages'

describe('Agent session message reads', () => {
  const dbh = setupTestDatabase()
  const sessionId = 'conversation'
  const detail = agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId']
  const list = agentSessionMessageHandlers['/agent-sessions/:sessionId/messages']

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', name: 'Work', path: '/work', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: sessionId, workspaceId: 'work', name: 'Conversation', orderKey: 'a0' },
        { id: 'background', type: 'background', workspaceId: 'work', name: 'Background', orderKey: 'a1' }
      ])
      .run()
  })

  it('reads one render-ready row with the same actions, sibling order and compact tool output as its branch page', async () => {
    const user = agentSessionMessageService.saveMessage({ sessionId, message: { role: 'user', data: { parts: [] } } })
    const output = 'x'.repeat(DEFER_TOOL_OUTPUT_BYTES + 128)
    const reply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: {
        role: 'assistant',
        status: 'success',
        data: {
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'call',
              toolName: 'Read',
              state: 'output-available',
              input: {},
              output
            }
          ]
        }
      }
    })
    const sibling = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: { role: 'assistant', status: 'success', data: { parts: [] } }
    })
    const params = { sessionId, messageId: reply.id }
    const query = { deferToolOutputs: true }
    const compact = AgentSessionMessageEntitySchema.parse(await detail.GET({ params, query }))
    const page = await list.GET({ params, query: { ...query, messageId: reply.id, limit: 1 } })
    if (!('items' in page)) throw new Error('Expected a message page')
    expect(page.items).toEqual([compact])
    expect(compact.siblings).toEqual(expect.arrayContaining([reply.id, sibling.id]))
    expect(compact.historyActions).toEqual({ fork: 'unsupported_checkpoint', edit: 'invalid_target' })
    const part = compact.data.parts?.[0]
    expect(part?.type === 'dynamic-tool' && isDeferredToolOutput(part.output)).toBe(true)
    await expect(detail.GET({ params })).resolves.toMatchObject({ data: { parts: [{ output }] } })
    expect(page.nextCursor).toBeTruthy()
    await expect(list.GET({ params, query: { cursor: page.nextCursor, limit: 1 } })).resolves.toMatchObject({
      items: [{ id: user.id }]
    })
  })

  it('reads the saved edit and rejects a patch attempting to set terminal status', async () => {
    const row = agentSessionMessageService.saveMessage({ sessionId, message: { role: 'user', data: { parts: [] } } })
    const params = { sessionId, messageId: row.id }
    const data = { parts: [{ type: 'text' as const, text: 'edited' }] }
    await detail.PATCH({ params, body: { data } })
    expect((await detail.GET({ params })).data).toEqual(data)
    await expect(detail.PATCH({ params, body: { status: 'success' } as never })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    expect((await detail.GET({ params })).data).toEqual(data)
  })

  it('keeps background messages outside every conversation endpoint', async () => {
    const message = agentSessionMessageService.saveMessage({
      sessionId: 'background',
      message: { role: 'assistant', data: { parts: [] } }
    })
    const params = { sessionId: 'background', messageId: message.id }
    await expect(list.GET({ params })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(detail.GET({ params, query: { deferToolOutputs: true } })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(detail.PATCH({ params, body: { data: { parts: [] } } })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(detail.DELETE({ params })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(agentSessionMessageService.getSessionMessage(params.sessionId, params.messageId).id).toBe(message.id)
  })
})
