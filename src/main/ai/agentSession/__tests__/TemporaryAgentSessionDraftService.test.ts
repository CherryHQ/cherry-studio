import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { TemporaryAgentSessionDraftService } from '@main/ai/agentSession/TemporaryAgentSessionDraftService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function seedAgent(db: ReturnType<typeof setupTestDatabase>['db'], agentId: string) {
  await db.insert(agentTable).values({
    id: agentId,
    type: 'claude-code',
    name: 'Agent A',
    instructions: 'You are helpful.',
    model: null,
    orderKey: 'a'
  })
}

describe('TemporaryAgentSessionDraftService', () => {
  const dbh = setupTestDatabase()
  let service: TemporaryAgentSessionDraftService

  beforeEach(async () => {
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const base = `/tmp/cherry-test/${key}`
      return filename ? `${base}/${filename}` : base
    })
    await seedAgent(dbh.db, 'agent-a')
    await seedAgent(dbh.db, 'agent-b')
    service = new TemporaryAgentSessionDraftService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leases a user-workspace draft without writing agent_session', async () => {
    const workspace = await application
      .get('DbService')
      .withWriteTx((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, '/tmp/cherry-user-workspace'))

    const session = await service.createSession({
      agentId: 'agent-a',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.agentId).toBe('agent-a')
    expect(session.workspaceSource).toEqual({ type: 'user', workspaceId: workspace.id })
    expect(session.workspace?.id).toBe(workspace.id)

    const rows = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))
    expect(rows).toHaveLength(0)
  })

  it('updates agent and workspace source on the same draft id', async () => {
    const workspace = await application
      .get('DbService')
      .withWriteTx((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, '/tmp/cherry-user-workspace'))
    const draft = await service.createSession({ agentId: 'agent-a', workspace: { type: 'system' } })

    const updated = await service.updateSession(draft.id, {
      agentId: 'agent-b',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    expect(updated.id).toBe(draft.id)
    expect(updated.agentId).toBe('agent-b')
    expect(updated.workspaceSource).toEqual({ type: 'user', workspaceId: workspace.id })
    expect(updated.workspace?.id).toBe(workspace.id)
  })

  it('persists a system draft through AgentSessionService without creating a real directory', async () => {
    const draft = await service.createSession({ agentId: 'agent-a', workspace: { type: 'system' } })

    const persisted = await service.persist(draft.id)

    expect(persisted.id).not.toBe(draft.id)
    expect(persisted.agentId).toBe('agent-a')
    expect(persisted.workspace.type).toBe('system')
    expect(persisted.workspace.path).toContain(persisted.id)

    const draftRows = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, draft.id))
    expect(draftRows).toHaveLength(0)
    const systemWorkspaces = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, persisted.workspaceId))
    expect(systemWorkspaces).toHaveLength(1)
  })

  it('restores the draft when persist fails', async () => {
    const draft = await service.createSession({ agentId: 'agent-a', workspace: { type: 'system' } })
    vi.spyOn(application, 'getPath').mockImplementation(() => '')

    await expect(service.persist(draft.id)).rejects.toThrow()
    await expect(service.deleteSession(draft.id)).resolves.toBeUndefined()
  })
})
