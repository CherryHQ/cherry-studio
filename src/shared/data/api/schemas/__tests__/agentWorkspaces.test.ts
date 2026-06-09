import { describe, expect, it } from 'vitest'

import { AgentSessionEntitySchema, CreateAgentSessionSchema, UpdateAgentSessionSchema } from '../agentSessions'
import { AgentSessionWorkspaceSourceSchema, AgentWorkspaceEntitySchema } from '../agentWorkspaces'

describe('AgentWorkspaceEntitySchema', () => {
  const workspace = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'workspace',
    path: '/tmp/workspace',
    type: 'user',
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('describes normalized workspace rows', () => {
    expect(AgentWorkspaceEntitySchema.parse(workspace)).toEqual(workspace)
  })

  it('exposes workspace on sessions instead of accessiblePaths', () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Session',
      description: '',
      workspaceId: workspace.id,
      workspace,
      orderKey: 'a0',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }

    expect(AgentSessionEntitySchema.parse(session).workspace?.path).toBe('/tmp/workspace')
    expect(AgentSessionEntitySchema.safeParse({ ...session, accessiblePaths: ['/tmp/workspace'] }).success).toBe(false)
  })

  it('rejects sessions without a workspace binding', () => {
    expect(
      AgentSessionEntitySchema.safeParse({
        id: 'session-1',
        agentId: 'agent-1',
        name: 'Session',
        description: '',
        workspaceId: null,
        workspace: null,
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }).success
    ).toBe(false)
  })

  it('allows workspace selection on session create only', () => {
    expect(
      CreateAgentSessionSchema.parse({
        agentId: 'agent-1',
        name: 'Session',
        workspace: { type: 'user', workspaceId: workspace.id }
      }).workspace
    ).toEqual({ type: 'user', workspaceId: workspace.id })
    expect(
      CreateAgentSessionSchema.parse({
        agentId: 'agent-1',
        name: 'Session',
        workspace: { type: 'system' }
      }).workspace
    ).toEqual({ type: 'system' })
    expect(CreateAgentSessionSchema.safeParse({ agentId: 'agent-1', name: 'Session' }).success).toBe(false)
    expect(UpdateAgentSessionSchema.safeParse({ workspace: { type: 'system' } }).success).toBe(false)
  })

  it('rejects malformed workspace source shapes', () => {
    expect(AgentSessionWorkspaceSourceSchema.safeParse({ type: 'user' }).success).toBe(false)
    expect(AgentSessionWorkspaceSourceSchema.safeParse({ type: 'user', workspaceId: '' }).success).toBe(false)
    expect(AgentSessionWorkspaceSourceSchema.safeParse({ type: 'external', workspaceId: workspace.id }).success).toBe(
      false
    )
    expect(AgentSessionWorkspaceSourceSchema.safeParse({ type: 'system', workspaceId: workspace.id }).success).toBe(
      false
    )
  })
})
