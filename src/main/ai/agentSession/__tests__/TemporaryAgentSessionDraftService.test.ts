import { TemporaryAgentSessionDraftService } from '@main/ai/agentSession/TemporaryAgentSessionDraftService'
import { describe, expect, it } from 'vitest'

describe('TemporaryAgentSessionDraftService', () => {
  it('leases a user-workspace draft without validating the ids', async () => {
    const service = new TemporaryAgentSessionDraftService()

    const session = await service.createSession({
      agentId: 'missing-agent',
      workspace: { type: 'user', workspaceId: 'missing-workspace' }
    })

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.agentId).toBe('missing-agent')
    expect(session.workspaceSource).toEqual({ type: 'user', workspaceId: 'missing-workspace' })
  })

  it('updates agent and workspace source on the same draft id', async () => {
    const service = new TemporaryAgentSessionDraftService()
    const draft = await service.createSession({ agentId: 'agent-a', workspace: { type: 'system' } })

    const updated = await service.updateSession(draft.id, {
      agentId: 'agent-b',
      workspace: { type: 'user', workspaceId: 'workspace-b' }
    })

    expect(updated.id).toBe(draft.id)
    expect(updated.agentId).toBe('agent-b')
    expect(updated.workspaceSource).toEqual({ type: 'user', workspaceId: 'workspace-b' })
  })

  it('hands off the draft params on persist and clears the in-memory draft', async () => {
    const service = new TemporaryAgentSessionDraftService()
    const draft = await service.createSession({ agentId: 'agent-a', workspace: { type: 'system' } })

    const persisted = await service.persist(draft.id)

    expect(persisted).toEqual(draft)
    await expect(service.deleteSession(draft.id)).rejects.toThrow(/not found/i)
  })
})
