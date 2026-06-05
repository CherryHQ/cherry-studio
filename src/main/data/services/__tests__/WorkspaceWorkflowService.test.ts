import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { WorkspaceWorkflowService } from '@data/services/WorkspaceWorkflowService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('WorkspaceWorkflowService', () => {
  const dbh = setupTestDatabase()
  const service = new WorkspaceWorkflowService()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-workflow-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    await dbh.db.insert(agentTable).values({
      id: 'agent-workflow',
      type: 'claude-code',
      name: 'Workflow Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes a user workspace and its sessions without removing the directory', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'user-project'))
    const session = await agentSessionService.createSession({
      agentId: 'agent-workflow',
      name: 'User workspace session',
      workspaceId: workspace.id
    })

    await service.deleteWorkspace(workspace.id)

    await expect(agentWorkspaceService.getById(workspace.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('deletes a system workspace and removes its backing directory', async () => {
    const workspace = await agentWorkspaceService.createSystemWorkspaceForSession('workflow-system-session')

    await service.deleteWorkspace(workspace.id)

    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspace.path)).rejects.toThrow()
  })

  it('throws not found when deleting a missing workspace', async () => {
    await expect(service.deleteWorkspace('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })
})
