import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { TemporarySessionService } from '@data/services/TemporarySessionService'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function seedAgent(db: ReturnType<typeof setupTestDatabase>['db'], agentId: string, model: string | null) {
  if (model) {
    await db.insert(userProviderTable).values({
      providerId: 'provider-a',
      name: 'Provider A',
      orderKey: 'a'
    })
    await db.insert(userModelTable).values({
      id: model,
      providerId: 'provider-a',
      modelId: 'model-a',
      name: 'Model A',
      orderKey: 'a'
    })
  }

  await db.insert(agentTable).values({
    id: agentId,
    type: 'claude-code',
    name: 'Agent A',
    instructions: 'You are helpful.',
    model,
    orderKey: 'a'
  })
}

describe('TemporarySessionService', () => {
  const dbh = setupTestDatabase()
  let service: TemporarySessionService
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-temporary-session-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, 'Agents', filename) : path.join(root, 'Agents')
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    service = new TemporarySessionService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('leases a user-workspace temporary session without writing agent_session', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'user-project'))
    const session = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceId: workspace.id })

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.agentId).toBe('agent-a')
    expect(session.name).toBe('Draft')
    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)

    const persisted = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))
    expect(persisted).toHaveLength(0)
  })

  it('persists a user-workspace temporary session with the same id', async () => {
    await seedAgent(dbh.db, 'agent-a', 'provider-a:model-a')
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'user-project'))

    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceId: workspace.id })
    const persisted = await service.persist(draft.id)

    expect(persisted.id).toBe(draft.id)
    expect(persisted.workspaceId).toBe(workspace.id)
    expect(persisted.workspace?.path).toBe(workspace.path)

    const rows = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, draft.id))
    expect(rows).toHaveLength(1)
  })

  it('leases a no-project temporary session without creating a system workspace', async () => {
    const session = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })

    expect(session.workspaceMode).toBe('system')
    expect(session.workspaceId).toBeNull()
    expect(session.workspace).toBeNull()

    const sessions = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))
    expect(sessions).toHaveLength(0)
    const workspaces = await dbh.db.select().from(agentWorkspaceTable)
    expect(workspaces).toHaveLength(0)
    await expect(stat(path.join(root, 'Agents', 'system'))).rejects.toThrow()
  })

  it('persists a no-project temporary session by creating a real system workspace', async () => {
    await seedAgent(dbh.db, 'agent-a', 'provider-a:model-a')
    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })

    const persisted = await service.persist(draft.id)

    expect(persisted.id).toBe(draft.id)
    expect(persisted.workspaceId).toBeTruthy()
    expect(persisted.workspace).toMatchObject({ type: 'system' })
    expect(persisted.workspace?.path).toContain(path.join('Agents', 'system'))
    await expect(stat(persisted.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('discards a no-project temporary session without workspace side effects', async () => {
    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })

    await service.deleteSession(draft.id)

    await expect(service.persist(draft.id)).rejects.toThrow(/not found/i)
    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
    await expect(stat(path.join(root, 'Agents', 'system'))).rejects.toThrow()
  })

  it('rejects persist when the agent has no model and leaves no real session or system workspace', async () => {
    await seedAgent(dbh.db, 'agent-a', null)
    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })

    await expect(service.persist(draft.id)).rejects.toThrow(/validation/i)

    const sessions = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, draft.id))
    expect(sessions).toHaveLength(0)
    const workspaces = await dbh.db.select().from(agentWorkspaceTable)
    expect(workspaces).toHaveLength(0)
    await expect(stat(path.join(root, 'Agents', 'system'))).rejects.toThrow()
  })
})
