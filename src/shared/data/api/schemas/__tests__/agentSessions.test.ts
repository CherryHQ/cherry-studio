import { describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_DELETE_MAX_IDS,
  AgentSessionMessageEntitySchema,
  AgentSessionMessagesListQuerySchema,
  AgentSessionStatsQuerySchema,
  CreateAgentSessionMessageSchema,
  CreateAgentSessionMessagesSchema,
  CreateAgentSessionSchema,
  DeleteAgentSessionsQuerySchema,
  ListAgentSessionsQuerySchema,
  SetAgentSessionWorkspaceSchema,
  UpdateAgentSessionSchema
} from '../agentSessions'

const WORKSPACE_ID = 'workspace-1'

describe('ListAgentSessionsQuerySchema', () => {
  const AGENT_ID = '018f6ed6-73b8-4f40-8d0d-9bb2f8f1d001'

  it('accepts the legacy query shape (concrete agentId, cursor, limit — no sortBy)', () => {
    expect(ListAgentSessionsQuerySchema.parse({ agentId: AGENT_ID, limit: 10 })).toEqual({
      agentId: AGENT_ID,
      limit: 10
    })
  })

  it.each([
    { q: 'x' },
    { searchScope: 'full' },
    { ids: ['s1'] },
    { agentId: 'unlinked' },
    { workspaceId: WORKSPACE_ID },
    { workspaceId: 'system' }
  ])('rejects record filter %j without sortBy', (filter) => {
    expect(() => ListAgentSessionsQuerySchema.parse(filter)).toThrow(/require sortBy/)
    expect(ListAgentSessionsQuerySchema.parse({ sortBy: 'updatedAt', ...filter })).toMatchObject(filter)
  })

  it('accepts immutable creation order and rejects unknown values or non-uuid owner scopes', () => {
    expect(ListAgentSessionsQuerySchema.parse({ sortBy: 'createdAt' })).toEqual({ sortBy: 'createdAt' })
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'name' })).toThrow()
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'updatedAt', searchScope: 'desc' })).toThrow()
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'updatedAt', agentId: 'not-a-uuid' })).toThrow()
  })

  it.each(['updatedAtFrom', 'updatedAtTo'])('rejects removed date-window filter %s', (key) => {
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'updatedAt', [key]: 1 })).toThrow(/unrecognized/i)
    expect(() => AgentSessionStatsQuerySchema.parse({ [key]: 1 })).toThrow(/unrecognized/i)
  })

  it('accepts the pin-owned stream without sortBy and rejects pinOrderKey', () => {
    expect(
      ListAgentSessionsQuerySchema.parse({ pinned: true, q: 'x', searchScope: 'full', workspaceId: 'system' })
    ).toEqual({ pinned: true, q: 'x', searchScope: 'full', workspaceId: 'system' })
    expect(ListAgentSessionsQuerySchema.parse({ sortBy: 'updatedAt', pinned: true })).toEqual({
      sortBy: 'updatedAt',
      pinned: true
    })
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'pinOrderKey', pinned: true })).toThrow()
  })
})

describe('AgentSessionStatsQuerySchema', () => {
  it('rejects cursor/limit/sortBy/pinned — stats take record filters only', () => {
    expect(() => AgentSessionStatsQuerySchema.parse({ cursor: 'x' })).toThrow()
    expect(() => AgentSessionStatsQuerySchema.parse({ limit: 10 })).toThrow()
    expect(() => AgentSessionStatsQuerySchema.parse({ sortBy: 'updatedAt' })).toThrow()
    expect(() => AgentSessionStatsQuerySchema.parse({ pinned: true })).toThrow()
  })

  it.each(['ids', 'workspaceId', 'searchScope'])('rejects unused list-only filter %s', (key) => {
    expect(() => AgentSessionStatsQuerySchema.parse({ [key]: 'unused' })).toThrow(/unrecognized/i)
  })
})

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
})

describe('AgentSession schemas', () => {
  it('accepts workspace changes through the dedicated workspace source body', () => {
    expect(SetAgentSessionWorkspaceSchema.safeParse({ type: 'user', workspaceId: 'workspace-1' }).success).toBe(true)
    expect(SetAgentSessionWorkspaceSchema.safeParse({ type: 'system' }).success).toBe(true)
    expect(SetAgentSessionWorkspaceSchema.safeParse({ type: 'user' }).success).toBe(false)
  })

  it('rejects workspace fields on the generic session PATCH body', () => {
    expect(
      UpdateAgentSessionSchema.safeParse({
        workspace: { type: 'user', workspaceId: 'workspace-1' }
      }).success
    ).toBe(false)
    expect(
      UpdateAgentSessionSchema.safeParse({
        workspaceId: 'workspace-1'
      }).success
    ).toBe(false)
  })

  it('accepts manual-name marker updates', () => {
    expect(
      UpdateAgentSessionSchema.parse({
        name: 'Renamed session',
        isNameManuallyEdited: true
      })
    ).toEqual({
      name: 'Renamed session',
      isNameManuallyEdited: true
    })
  })

  it('allows blank names for untitled placeholder sessions', () => {
    expect(
      CreateAgentSessionSchema.safeParse({
        agentId: 'agent-1',
        name: '',
        workspace: { type: 'system' }
      }).success
    ).toBe(true)
    expect(UpdateAgentSessionSchema.parse({ name: '' })).toEqual({ name: '' })
  })

  it('caps session names at 255 characters, matching topic.name semantics', () => {
    const maxName = 'a'.repeat(255)
    const overflowName = 'a'.repeat(256)

    expect(
      CreateAgentSessionSchema.safeParse({
        agentId: 'agent-1',
        name: maxName,
        workspace: { type: 'system' }
      }).success
    ).toBe(true)
    expect(
      CreateAgentSessionSchema.safeParse({
        agentId: 'agent-1',
        name: overflowName,
        workspace: { type: 'system' }
      }).success
    ).toBe(false)
    expect(UpdateAgentSessionSchema.safeParse({ name: overflowName }).success).toBe(false)
  })

  it('caps bulk delete ids', () => {
    const validIds = Array.from({ length: AGENT_SESSION_DELETE_MAX_IDS }, (_, index) => `session-${index}`).join(',')
    const tooManyIds = `${validIds},session-overflow`

    expect(DeleteAgentSessionsQuerySchema.safeParse({ ids: validIds }).success).toBe(true)
    expect(DeleteAgentSessionsQuerySchema.safeParse({ ids: tooManyIds }).success).toBe(false)
  })
})
