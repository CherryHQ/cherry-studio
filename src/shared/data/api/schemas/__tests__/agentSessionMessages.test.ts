import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AgentSessionMessageEntitySchema,
  type AgentSessionMessageSchemas,
  AgentSessionMessagesListQuerySchema,
  CreateAgentSessionMessageSchema,
  CreateAgentSessionMessagesSchema
} from '../agentSessionMessages'

describe('AgentSessionMessage schemas', () => {
  const baseMessage = {
    id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
    sessionId: 'session-1',
    role: 'assistant',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    searchableText: 'hello',
    status: 'success',
    modelId: null,
    messageSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('requires ISO audit timestamps on entity rows', () => {
    expect(AgentSessionMessageEntitySchema.parse(baseMessage).createdAt).toBe(baseMessage.createdAt)
    expect(AgentSessionMessageEntitySchema.safeParse({ ...baseMessage, createdAt: 'not-a-date' }).success).toBe(false)
  })

  it('does not accept audit timestamps in create DTOs', () => {
    expect(
      CreateAgentSessionMessageSchema.safeParse({
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] },
        createdAt: '2026-01-01T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('does not accept caller-owned stats in create DTOs', () => {
    expect(
      CreateAgentSessionMessageSchema.safeParse({
        role: 'assistant',
        data: { parts: [{ type: 'text', text: 'hello' }] },
        stats: { totalTokens: 42 }
      }).success
    ).toBe(false)
  })

  it('allows batch create without runtimeResumeToken', () => {
    const parsed = CreateAgentSessionMessagesSchema.parse({
      sessionId: 'session-1',
      messages: [{ role: 'user', data: { parts: [{ type: 'text', text: 'hello' }] } }]
    })

    expect(parsed.runtimeResumeToken).toBeUndefined()
  })

  it('accepts messageId as a list pagination anchor', () => {
    expect(AgentSessionMessagesListQuerySchema.parse({ messageId: 'message-1', limit: '25' })).toEqual({
      messageId: 'message-1',
      limit: 25
    })
    expect(AgentSessionMessagesListQuerySchema.safeParse({ messageId: '' }).success).toBe(false)
  })

  it('keeps collection messages read-only; bulk clear is abort-and-drain, not DataApi DELETE', () => {
    expectTypeOf<keyof AgentSessionMessageSchemas['/agent-sessions/:sessionId/messages']>().toEqualTypeOf<'GET'>()
  })
})
