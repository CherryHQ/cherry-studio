import { describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_DELETE_MAX_IDS,
  CreateAgentSessionSchema,
  DeleteAgentSessionsQuerySchema,
  SetAgentSessionWorkspaceSchema,
  UpdateAgentSessionSchema
} from '../agentSessions'

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
