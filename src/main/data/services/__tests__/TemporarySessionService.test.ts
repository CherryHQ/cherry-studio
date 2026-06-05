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

  it('leases a temporary session without writing agent_session', async () => {
    const session = await service.createSession({ agentId: 'agent-a', name: 'Draft' })

    expect(session.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(session.agentId).toBe('agent-a')
    expect(session.name).toBe('Draft')

    const persisted = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))
    expect(persisted).toHaveLength(0)
  })

  it('persists with the same id and reuses SessionService workspace fallback', async () => {
    await seedAgent(dbh.db, 'agent-a', 'provider-a:model-a')
    await dbh.db.insert(agentWorkspaceTable).values({
      id: 'ws-a',
      name: 'cherry-temporary-session-test',
      path: '/private/tmp/cherry-temporary-session-test',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: 'sibling-session',
      agentId: 'agent-a',
      name: 'Sibling',
      workspaceId: 'ws-a',
      orderKey: 'a0'
    })

    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft' })
    const persisted = await service.persist(draft.id)

    expect(persisted.id).toBe(draft.id)
    // No workspaceId supplied → SessionService inherits the latest sibling's workspace.
    expect(persisted.workspaceId).toBe('ws-a')
    expect(persisted.workspace?.path).toBe('/private/tmp/cherry-temporary-session-test')

    const rows = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, draft.id))
    expect(rows).toHaveLength(1)
  })

  it('leases a no-project temporary session with a system workspace', async () => {
    const session = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace).toMatchObject({ type: 'system' })
    expect(session.workspace?.path).toContain(path.join('Agents', 'system'))
    await expect(stat(session.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })

    const persisted = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))
    expect(persisted).toHaveLength(0)
  })

  it('sweeps stale system workspace rows while preserving active temporary leases', async () => {
    const active = await service.createSession({ agentId: 'agent-a', name: 'Active', workspaceMode: 'system' })
    const orphan = await agentWorkspaceService.createSystemWorkspaceForSession('stale-temporary-session')
    const orphanWorkspacePath = orphan.path

    await service.createSession({ agentId: 'agent-a', name: 'Next' })

    await expect(stat(active.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(stat(orphanWorkspacePath)).rejects.toThrow()
    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, orphan.id))
    expect(rows).toHaveLength(0)
  })

  it('persists a no-project temporary session using the same system workspace', async () => {
    await seedAgent(dbh.db, 'agent-a', 'provider-a:model-a')
    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })
    const draftWorkspacePath = draft.workspace!.path

    const persisted = await service.persist(draft.id)

    expect(persisted.id).toBe(draft.id)
    expect(persisted.workspaceId).toBe(draft.workspaceId)
    expect(persisted.workspace).toMatchObject({ path: draftWorkspacePath, type: 'system' })
    await expect(stat(draftWorkspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('deletes the system workspace when discarding a no-project temporary session', async () => {
    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft', workspaceMode: 'system' })
    const workspacePath = draft.workspace!.path

    await service.deleteSession(draft.id)

    await expect(stat(workspacePath)).rejects.toThrow()
    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, draft.workspaceId!))
    expect(rows).toHaveLength(0)
  })

  it('rejects persist when the agent has no model and leaves no real session', async () => {
    await seedAgent(dbh.db, 'agent-a', null)
    const draft = await service.createSession({ agentId: 'agent-a', name: 'Draft' })

    await expect(service.persist(draft.id)).rejects.toThrow(/validation/i)

    const rows = await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, draft.id))
    expect(rows).toHaveLength(0)
  })
})
