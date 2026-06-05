import { describe, expect, it } from 'vitest'

import {
  AgentSessionMessageEntitySchema,
  CreateAgentSessionMessageSchema,
  CreateAgentSessionMessagesSchema,
  UpdateAgentSessionSchema
} from '../agentSessions'

describe('AgentSessionMessage schemas', () => {
  const baseMessage = {
    id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001',
    sessionId: 'session-1',
    role: 'assistant',
    data: { parts: [{ type: 'text', text: 'hello' }] },
    searchableText: 'hello',
    status: 'success',
    modelId: null,
    modelSnapshot: null,
    traceId: null,
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

  it('allows batch create without runtimeResumeToken', () => {
    const parsed = CreateAgentSessionMessagesSchema.parse({
      sessionId: 'session-1',
      messages: [{ role: 'user', data: { parts: [{ type: 'text', text: 'hello' }] } }]
    })

    expect(parsed.runtimeResumeToken).toBeUndefined()
  })
})

describe('AgentSession schemas', () => {
  it('rejects workspace updates because workspace binding is insert-only', () => {
    expect(
      UpdateAgentSessionSchema.safeParse({
        workspaceId: 'workspace-1'
      }).success
    ).toBe(false)
  })
})
