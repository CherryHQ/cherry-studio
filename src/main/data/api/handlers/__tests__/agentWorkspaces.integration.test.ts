import { application } from '@application'
import { agentWorkspaceHandlers } from '@data/api/handlers/agentWorkspaces'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { beforeEach, describe, expect, it, type Mock } from 'vitest'

describe('agentWorkspaceHandlers integration', () => {
  const dbh = setupTestDatabase()
  const agentId = 'agent-workspace-handler-test'

  beforeEach(async () => {
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation(async (fn) =>
      dbh.db.transaction(fn as never)
    )
    await dbh.db.insert(agentTable).values({
      id: agentId,
      type: 'claude-code',
      name: 'Workspace Handler Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  function workspacePath(name: string): string {
    return path.join('/tmp', 'cherry-workspace-handler', name)
  }

  async function createWorkspace(name: string): Promise<AgentWorkspaceEntity> {
    return await dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, workspacePath(name)))
  }

  it('deletes a user workspace and its bound sessions and pins in one handler call', async () => {
    const workspace = await createWorkspace('cascade')
    const first = await agentSessionService.create({
      agentId,
      name: 'First',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    const second = await agentSessionService.create({
      agentId,
      name: 'Second',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-first-session',
      entityType: 'session',
      entityId: first.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].DELETE({
        params: { workspaceId: workspace.id }
      } as never)
    ).resolves.toBeUndefined()

    expect(await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id))).toEqual([])
    expect(
      await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.workspaceId, workspace.id))
    ).toEqual([])
    expect(await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, first.id))).toEqual([])
    await expect(agentSessionService.getById(second.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects system workspace deletes and preserves the backing session and pin', async () => {
    const session = await agentSessionService.create({
      agentId,
      name: 'System Session',
      workspace: { type: 'system' }
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-system-session',
      entityType: 'session',
      entityId: session.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    await expect(
      agentWorkspaceHandlers['/agent-workspaces/:workspaceId'].DELETE({
        params: { workspaceId: session.workspace.id }
      } as never)
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    const workspaceRows = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspace.id))
    expect(workspaceRows).toHaveLength(1)
    expect(await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))).toHaveLength(1)
    expect(await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, session.id))).toHaveLength(1)
  })
})
