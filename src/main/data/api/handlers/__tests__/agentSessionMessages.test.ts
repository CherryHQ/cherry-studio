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

  it('expands oversized text, inline media, and tool input without reading the other parts', async () => {
    const huge = 'x'.repeat(64 * 1024)
    const parts = [
      { type: 'text' as const, text: 'start ' + huge + ' end' },
      { type: 'file' as const, url: 'data:image/png;base64,' + huge, filename: 'inline.png', mediaType: 'image/png' },
      {
        type: 'dynamic-tool' as const,
        toolName: 'Write',
        toolCallId: 'write',
        state: 'output-available' as const,
        input: { content: huge },
        output: { result: huge }
      }
    ]
    const message = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'assistant', data: { parts } }
    })
    const params = { sessionId, messageId: message.id }
    const compact = AgentSessionMessageEntitySchema.parse(
      await detail.GET({ params, query: { deferToolOutputs: true } })
    )
    const partRoute = agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/parts/:partId']
    const previews = compact.data.parts ?? []
    expect(previews.map((part) => part.type)).toEqual(Array(3).fill('data-deferred-history-part'))
    expect(JSON.stringify(compact).length).toBeLessThan(3000)

    for (const [index, partId] of compact.partIds!.entries()) {
      await expect(partRoute.GET({ params: { ...params, partId } })).resolves.toEqual(parts[index])
    }
    await expect(partRoute.GET({ params: { ...params, partId: 'missing' } })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
    await expect(
      partRoute.GET({
        params: { ...params, messageId: 'other', partId: compact.partIds![0] }
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(
      partRoute.GET({
        params: { ...params, sessionId: 'background', partId: compact.partIds![0] }
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(detail.GET({ params })).resolves.toMatchObject({ data: { parts } })
  })

  it('keeps bounded citation identity for oversized web_search parts across deferred list and detail reads', async () => {
    const metadata = {
      type: 'mcp',
      name: 'web_search',
      serverName: 'cherry-tools',
      serverId: 'cherry-tools'
    }
    const mismatchOutput = {
      content: [{ id: '3f2a1b9c-1', title: 'Handler Source', url: 'https://example.com/handler', content: '' }],
      metadata
    }
    mismatchOutput.content[0].content = 'a'.repeat(32_674 - Buffer.byteLength(JSON.stringify(mismatchOutput)))
    const mismatchPart = {
      type: 'dynamic-tool' as const,
      toolName: 'mcp__cherry-tools__web_search',
      toolCallId: 'call-handler-mismatch',
      state: 'output-available' as const,
      input: { query: 'mismatch' },
      output: mismatchOutput
    }
    const hugeInputPart = {
      type: 'dynamic-tool' as const,
      toolName: 'tool_call',
      toolCallId: 'call-handler-huge-input',
      state: 'output-available' as const,
      input: { name: 'mcp__cherry-tools__web_search', params: { query: 'x'.repeat(64 * 1024) } },
      output: {
        content: [{ id: '3f2a1b9c-2', title: 'Huge Handler', url: 'https://example.com/huge', content: 'snippet' }],
        metadata
      }
    }

    const message = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'assistant', status: 'success', data: { parts: [mismatchPart, hugeInputPart] } }
    })
    const params = { sessionId, messageId: message.id }
    const query = { deferToolOutputs: true }

    const compact = AgentSessionMessageEntitySchema.parse(await detail.GET({ params, query }))
    const page = await list.GET({ params: { sessionId }, query })
    if (!('items' in page)) throw new Error('Expected a message page')
    expect(page.items).toEqual([compact])

    const [projectedMismatch, projectedHugeInput] = compact.data.parts ?? []
    expect(Buffer.byteLength(JSON.stringify(projectedMismatch))).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
    expect(Buffer.byteLength(JSON.stringify(projectedHugeInput))).toBeLessThanOrEqual(DEFER_TOOL_OUTPUT_BYTES)
    expect(projectedMismatch).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'mcp__cherry-tools__web_search',
      output: {
        skeleton: {
          content: [{ id: '3f2a1b9c-1', title: 'Handler Source', url: 'https://example.com/handler' }]
        }
      }
    })
    expect(projectedHugeInput).toMatchObject({
      type: 'data-deferred-history-part',
      data: {
        partId: compact.partIds![1],
        citation: {
          toolName: 'web_search',
          skeleton: {
            content: [{ id: '3f2a1b9c-2', title: 'Huge Handler', url: 'https://example.com/huge' }]
          }
        }
      }
    })

    const partRoute = agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/parts/:partId']
    await expect(partRoute.GET({ params: { ...params, partId: compact.partIds![1] } })).resolves.toEqual(hugeInputPart)
    await expect(detail.GET({ params })).resolves.toMatchObject({ data: { parts: [mismatchPart, hugeInputPart] } })
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
