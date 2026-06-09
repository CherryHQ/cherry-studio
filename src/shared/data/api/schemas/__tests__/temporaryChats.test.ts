import { describe, expect, it } from 'vitest'

import {
  CreateTemporarySessionSchema,
  TemporarySessionEntitySchema,
  UpdateTemporarySessionSchema,
  UpdateTemporaryTopicSchema
} from '../temporaryChats'

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

  it('requires a workspace source', () => {
    expect(
      CreateTemporarySessionSchema.parse({
        agentId: 'agent-1',
        workspace: { type: 'user', workspaceId: workspace.id }
      }).workspace
    ).toEqual({ type: 'user', workspaceId: workspace.id })
    expect(
      CreateTemporarySessionSchema.parse({
        agentId: 'agent-1',
        workspace: { type: 'system' }
      }).workspace
    ).toEqual({ type: 'system' })
    expect(
      CreateTemporarySessionSchema.safeParse({
        agentId: 'agent-1'
      }).success
    ).toBe(false)
    expect(
      CreateTemporarySessionSchema.safeParse({
        agentId: 'agent-1',
        workspace: { type: 'system', workspaceId: workspace.id }
      }).success
    ).toBe(false)
    expect(
      CreateTemporarySessionSchema.safeParse({
        agentId: 'agent-1',
        workspace: { type: 'user' }
      }).success
    ).toBe(false)
  })

  it('does not validate agent id content', () => {
    expect(
      CreateTemporarySessionSchema.parse({
        agentId: '',
        workspace: { type: 'system' }
      }).agentId
    ).toBe('')
  })

  it('requires at least one update field', () => {
    expect(UpdateTemporarySessionSchema.parse({ agentId: 'agent-2' }).agentId).toBe('agent-2')
    expect(UpdateTemporarySessionSchema.parse({ workspace: { type: 'system' } }).workspace).toEqual({
      type: 'system'
    })
    expect(UpdateTemporarySessionSchema.safeParse({}).success).toBe(false)
  })

  it('requires at least one temporary topic update field', () => {
    expect(UpdateTemporaryTopicSchema.parse({ assistantId: 'agent-2' }).assistantId).toBe('agent-2')
    expect(UpdateTemporaryTopicSchema.parse({ assistantId: null }).assistantId).toBeNull()
    expect(UpdateTemporaryTopicSchema.safeParse({}).success).toBe(false)
  })

  it('describes temporary draft sessions separately from persisted sessions', () => {
    const systemDraft = {
      id: 'session-1',
      agentId: 'agent-1',
      workspaceSource: { type: 'system' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const userDraft = {
      ...systemDraft,
      workspaceSource: { type: 'user', workspaceId: workspace.id }
    }

    expect(TemporarySessionEntitySchema.parse(systemDraft).workspaceSource.type).toBe('system')
    expect(TemporarySessionEntitySchema.parse(userDraft).workspaceSource).toEqual({
      type: 'user',
      workspaceId: workspace.id
    })
    expect(TemporarySessionEntitySchema.safeParse({ ...systemDraft, accessiblePaths: [] }).success).toBe(false)
  })
})
