import { describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_DELETE_MAX_IDS,
  AgentSessionStatsQuerySchema,
  CreateAgentSessionSchema,
  DeleteAgentSessionsQuerySchema,
  LatestAgentSessionQuerySchema,
  ListAgentSessionsQuerySchema,
  ReusableAgentSessionPlaceholdersQuerySchema,
  SetAgentSessionWorkspaceSchema,
  UpdateAgentSessionSchema
} from '../agentSessions'

const AGENT_ID = '018f6ed6-73b8-4f40-8d0d-9bb2f8f1d001'
const WORKSPACE_ID = 'workspace-1'

describe('ListAgentSessionsQuerySchema', () => {
  it('accepts agentId/cursor/limit without sortBy when the ordinary stream is explicit', () => {
    expect(ListAgentSessionsQuerySchema.parse({ agentId: AGENT_ID, limit: 10, pinned: false })).toEqual({
      agentId: AGENT_ID,
      limit: 10,
      pinned: false
    })
    expect(() => ListAgentSessionsQuerySchema.parse({ agentId: AGENT_ID, limit: 10 })).toThrow()
  })

  it.each([
    { q: 'x' },
    { searchScope: 'name-or-owner' },
    { agentId: 'unlinked' },
    { workspaceId: WORKSPACE_ID },
    { workspaceId: 'system' }
  ])('accepts record filter %j without sortBy', (filter) => {
    expect(ListAgentSessionsQuerySchema.parse({ pinned: false, ...filter })).toMatchObject(filter)
    expect(ListAgentSessionsQuerySchema.parse({ pinned: false, sortBy: 'lastActivityAt', ...filter })).toMatchObject(
      filter
    )
  })

  it('accepts immutable creation order and rejects unknown values or non-uuid owner scopes', () => {
    expect(ListAgentSessionsQuerySchema.parse({ pinned: false, sortBy: 'createdAt' })).toEqual({
      pinned: false,
      sortBy: 'createdAt'
    })
    expect(() => ListAgentSessionsQuerySchema.parse({ pinned: false, sortBy: 'name' })).toThrow()
    expect(() =>
      ListAgentSessionsQuerySchema.parse({ pinned: false, sortBy: 'lastActivityAt', searchScope: 'desc' })
    ).toThrow()
    expect(() =>
      ListAgentSessionsQuerySchema.parse({ pinned: false, sortBy: 'lastActivityAt', agentId: 'not-a-uuid' })
    ).toThrow()
  })

  it('accepts the pin-owned stream without sortBy and rejects every sort dimension', () => {
    expect(
      ListAgentSessionsQuerySchema.parse({ pinned: true, q: 'x', searchScope: 'name-or-owner', workspaceId: 'system' })
    ).toEqual({ pinned: true, q: 'x', searchScope: 'name-or-owner', workspaceId: 'system' })
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'lastActivityAt', pinned: true })).toThrow(
      /unrecognized/i
    )
    expect(() => ListAgentSessionsQuerySchema.parse({ sortBy: 'pinOrderKey', pinned: true })).toThrow()
  })
})

describe('ReusableAgentSessionPlaceholdersQuerySchema', () => {
  it('requires one concrete agent and accepts an optional exact workspace scope', () => {
    expect(ReusableAgentSessionPlaceholdersQuerySchema.parse({ agentId: AGENT_ID })).toEqual({ agentId: AGENT_ID })
    expect(ReusableAgentSessionPlaceholdersQuerySchema.parse({ agentId: AGENT_ID, workspaceId: 'system' })).toEqual({
      agentId: AGENT_ID,
      workspaceId: 'system'
    })
    expect(ReusableAgentSessionPlaceholdersQuerySchema.parse({ agentId: AGENT_ID, workspaceId: WORKSPACE_ID })).toEqual(
      { agentId: AGENT_ID, workspaceId: WORKSPACE_ID }
    )
  })

  it('rejects aggregate owners and list-only dimensions', () => {
    expect(() => ReusableAgentSessionPlaceholdersQuerySchema.parse({ agentId: 'unlinked' })).toThrow()
    expect(() => ReusableAgentSessionPlaceholdersQuerySchema.parse({ agentId: AGENT_ID, pinned: false })).toThrow(
      /unrecognized/i
    )
  })
})

describe('LatestAgentSessionQuerySchema', () => {
  it('accepts global, concrete live-agent, and unknown-owner scopes', () => {
    expect(LatestAgentSessionQuerySchema.parse({})).toEqual({})
    expect(LatestAgentSessionQuerySchema.parse({ agentId: AGENT_ID })).toEqual({ agentId: AGENT_ID })
    expect(LatestAgentSessionQuerySchema.parse({ agentId: 'unlinked' })).toEqual({ agentId: 'unlinked' })
  })

  it('rejects pin and list-order dimensions', () => {
    expect(() => LatestAgentSessionQuerySchema.parse({ pinned: true })).toThrow(/unrecognized/i)
    expect(() => LatestAgentSessionQuerySchema.parse({ sortBy: 'createdAt' })).toThrow(/unrecognized/i)
  })
})

describe('AgentSessionStatsQuerySchema', () => {
  it('rejects cursor/limit/sortBy/pinned — stats take record filters only', () => {
    expect(() => AgentSessionStatsQuerySchema.parse({ cursor: 'x' })).toThrow()
    expect(() => AgentSessionStatsQuerySchema.parse({ limit: 10 })).toThrow()
    expect(() => AgentSessionStatsQuerySchema.parse({ sortBy: 'lastActivityAt' })).toThrow()
    expect(() => AgentSessionStatsQuerySchema.parse({ pinned: true })).toThrow()
  })

  it.each(['workspaceId', 'searchScope'])('rejects unused list-only filter %s', (key) => {
    expect(() => AgentSessionStatsQuerySchema.parse({ [key]: 'unused' })).toThrow(/unrecognized/i)
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
