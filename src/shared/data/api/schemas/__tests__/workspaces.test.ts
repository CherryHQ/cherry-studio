import { describe, expect, it } from 'vitest'

import { AgentSessionEntitySchema, CreateSessionSchema, UpdateSessionSchema } from '../sessions'
import { WorkspaceEntitySchema } from '../workspaces'

describe('WorkspaceEntitySchema', () => {
  const workspace = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'workspace',
    path: '/tmp/workspace',
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('describes normalized workspace rows', () => {
    expect(WorkspaceEntitySchema.parse(workspace)).toEqual(workspace)
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

  it('allows migrated sessions without a workspace binding', () => {
    expect(
      AgentSessionEntitySchema.parse({
        id: 'session-1',
        agentId: 'agent-1',
        name: 'Session',
        description: '',
        workspaceId: null,
        workspace: null,
        orderKey: 'a0',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }).workspaceId
    ).toBeNull()
  })

  it('allows workspace selection on session create only', () => {
    expect(
      CreateSessionSchema.parse({ agentId: 'agent-1', name: 'Session', workspaceId: workspace.id }).workspaceId
    ).toBe(workspace.id)
    expect(UpdateSessionSchema.safeParse({ workspaceId: workspace.id }).success).toBe(false)
  })
})
