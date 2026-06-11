import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { workspaceWorkflowService } from '@data/services/WorkspaceWorkflowService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest'

describe('WorkspaceWorkflowService', () => {
  const dbh = setupTestDatabase()
  const root = path.join('/tmp', 'cherry-workspace-workflow')

  beforeEach(async () => {
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation(async (fn) =>
      dbh.db.transaction(fn as never)
    )
    await dbh.db.insert(agentTable).values({
      id: 'agent-workspace-workflow-test',
      type: 'claude-code',
      name: 'Workspace Workflow Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  afterEach(() => {
    ;(application.get('DbService').withWriteTx as Mock).mockReset()
  })

  async function createUserWorkspace(name: string) {
    return await dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, path.join(root, name)))
  }

  it('deletes a user workspace with its sessions and pins in one workflow', async () => {
    const workspace = await createUserWorkspace('user-owned')
    const session = await agentSessionService.create({
      agentId: 'agent-workspace-workflow-test',
      name: 'User workspace session',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-user-workspace-session',
      entityType: 'session',
      entityId: session.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    await workspaceWorkflowService.deleteWorkspace(workspace.id)

    expect(await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id))).toEqual([])
    expect(await dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id))).toEqual([])
    expect(await dbh.db.select().from(pinTable)).toEqual([])
  })

  it('does not delete system workspaces through the public workspace workflow', async () => {
    const session = await agentSessionService.create({
      agentId: 'agent-workspace-workflow-test',
      name: 'System workspace session',
      workspace: { type: 'system' }
    })

    await expect(workspaceWorkflowService.deleteWorkspace(session.workspaceId)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })

    await expect(agentSessionService.getById(session.id)).resolves.toMatchObject({ id: session.id })
    await expect(agentWorkspaceService.getById(session.workspaceId, { includeSystem: true })).resolves.toMatchObject({
      id: session.workspaceId,
      type: 'system'
    })
  })
})
