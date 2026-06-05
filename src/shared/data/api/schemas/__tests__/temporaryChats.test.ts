import { describe, expect, it } from 'vitest'

import { CreateTemporarySessionSchema, TemporarySessionEntitySchema } from '../temporaryChats'

describe('Temporary session schemas', () => {
  const workspace = {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    type: 'user',
    orderKey: 'a0',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }

  it('requires either a user workspace id or system workspace mode', () => {
    expect(
      CreateTemporarySessionSchema.parse({
        agentId: 'agent-1',
        name: 'Draft',
        workspaceId: workspace.id
      }).workspaceId
    ).toBe(workspace.id)
    expect(
      CreateTemporarySessionSchema.parse({
        agentId: 'agent-1',
        name: 'Draft',
        workspaceMode: 'system'
      }).workspaceMode
    ).toBe('system')
    expect(
      CreateTemporarySessionSchema.safeParse({
        agentId: 'agent-1',
        name: 'Draft'
      }).success
    ).toBe(false)
    expect(
      CreateTemporarySessionSchema.safeParse({
        agentId: 'agent-1',
        name: 'Draft',
        workspaceId: workspace.id,
        workspaceMode: 'system'
      }).success
    ).toBe(false)
    expect(
      CreateTemporarySessionSchema.safeParse({
        agentId: 'agent-1',
        name: 'Draft',
        workspaceMode: 'user'
      }).success
    ).toBe(false)
  })

  it('describes temporary draft sessions separately from persisted sessions', () => {
    const systemDraft = {
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Draft',
      description: '',
      workspaceId: null,
      workspace: null,
      workspaceMode: 'system',
      orderKey: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const userDraft = {
      ...systemDraft,
      workspaceId: workspace.id,
      workspace,
      workspaceMode: undefined
    }

    expect(TemporarySessionEntitySchema.parse(systemDraft).workspaceMode).toBe('system')
    expect(TemporarySessionEntitySchema.parse(userDraft).workspace?.id).toBe(workspace.id)
    expect(TemporarySessionEntitySchema.safeParse({ ...systemDraft, accessiblePaths: [] }).success).toBe(false)
  })
})
