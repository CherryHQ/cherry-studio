import { describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_DELETE_MAX_IDS,
  AgentSessionMessageEntitySchema,
  CreateAgentSessionMessageSchema,
  CreateAgentSessionMessagesSchema,
  DeleteAgentSessionsQuerySchema,
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

  it('caps bulk delete ids', () => {
    const validIds = Array.from({ length: AGENT_SESSION_DELETE_MAX_IDS }, (_, index) => `session-${index}`).join(',')
    const tooManyIds = `${validIds},session-overflow`

    expect(DeleteAgentSessionsQuerySchema.safeParse({ ids: validIds }).success).toBe(true)
    expect(DeleteAgentSessionsQuerySchema.safeParse({ ids: tooManyIds }).success).toBe(false)
  })
})
