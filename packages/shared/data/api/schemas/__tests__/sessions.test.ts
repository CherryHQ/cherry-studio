import { describe, expect, it } from 'vitest'

import {
  AgentSessionMessageEntitySchema,
  CreateAgentSessionMessageSchema,
  CreateAgentSessionMessagesSchema,
  ListSessionsQuerySchema,
  SearchSessionMessagesQuerySchema
} from '../sessions'

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

describe('ListSessionsQuerySchema', () => {
  it('trims search while preserving existing cursor pagination fields', () => {
    expect(
      ListSessionsQuerySchema.parse({
        agentId: 'agent-1',
        cursor: 'cursor-1',
        limit: '10',
        search: '  plan  '
      })
    ).toEqual({
      agentId: 'agent-1',
      cursor: 'cursor-1',
      limit: 10,
      search: 'plan'
    })
  })

  it('rejects blank search', () => {
    expect(() => ListSessionsQuerySchema.parse({ search: '   ' })).toThrow()
  })
})

describe('SearchSessionMessagesQuerySchema', () => {
  it('normalizes session message search queries', () => {
    expect(SearchSessionMessagesQuerySchema.parse({ q: '  deploy  ' })).toEqual({
      q: 'deploy'
    })
  })

  it('accepts session filter and pagination', () => {
    expect(
      SearchSessionMessagesQuerySchema.parse({
        q: 'plan',
        sessionId: 'session-1',
        matchMode: 'substring',
        limit: '20',
        createdAtFrom: '2026-05-01T00:00:00.000Z'
      })
    ).toEqual({
      q: 'plan',
      sessionId: 'session-1',
      matchMode: 'substring',
      limit: 20,
      createdAtFrom: '2026-05-01T00:00:00.000Z'
    })
  })

  it('rejects invalid createdAtFrom', () => {
    expect(() => SearchSessionMessagesQuerySchema.parse({ q: 'plan', createdAtFrom: 'today' })).toThrow()
  })
})
