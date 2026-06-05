import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { agentSessionWorkflowService } from '@main/services/agentWorkspace/AgentSessionWorkflowService'
import { agentWorkspaceDirectoryService } from '@main/services/agentWorkspace/AgentWorkspaceDirectoryService'
import { AgentWorkspaceWorkflowService } from '@main/services/agentWorkspace/AgentWorkspaceWorkflowService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('AgentWorkspaceWorkflowService', () => {
  const dbh = setupTestDatabase()
  const service = new AgentWorkspaceWorkflowService()
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
    const workspace = await service.findOrCreateWorkspaceByPath(path.join(root, 'user-project'))
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-workflow',
      name: 'User workspace session',
      workspaceId: workspace.id
    })

    await service.deleteWorkspace(workspace.id)

    await expect(agentWorkspaceService.getById(workspace.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('normalizes paths, creates the directory, and dedupes by path', async () => {
    const rawPath = path.join(root, 'project', '..', 'project')
    const normalizedPath = path.join(root, 'project')

    const first = await service.findOrCreateWorkspaceByPath(rawPath)
    const second = await service.findOrCreateWorkspaceByPath(normalizedPath)

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      name: 'project',
      path: normalizedPath,
      type: 'user'
    })
    await expect(stat(normalizedPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('creates system workspaces with deterministic path metadata', async () => {
    const workspace = await service.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    expect(workspace).toMatchObject({
      name: 'No project 2026-05-25 14:30:12',
      path: path.join(root, 'system', '2026-05-25', '143012-12345678'),
      type: 'system'
    })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('hides system workspaces from default delete callers', async () => {
    const workspace = await service.createSystemWorkspaceForSession('workflow-system-session')

    await expect(service.deleteWorkspace(workspace.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).resolves.toMatchObject({
      id: workspace.id
    })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('deletes a system workspace and removes its backing directory when explicitly allowed', async () => {
    const workspace = await service.createSystemWorkspaceForSession('workflow-system-session')

    await service.deleteWorkspace(workspace.id, { includeSystem: true })

    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspace.path)).rejects.toThrow()
  })

  it('keeps the delete result consistent when post-commit system directory cleanup fails', async () => {
    const workspace = await service.createSystemWorkspaceForSession('cleanup-failure-session')
    const deleteSystemWorkspaceDirectorySpy = vi
      .spyOn(agentWorkspaceDirectoryService, 'deleteSystemWorkspaceDirectory')
      .mockImplementation(() => {
        throw new Error('rm failed')
      })

    await expect(service.deleteWorkspace(workspace.id, { includeSystem: true })).resolves.toBeUndefined()

    expect(deleteSystemWorkspaceDirectorySpy).toHaveBeenCalledWith(workspace.path)
    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('throws not found when deleting a missing workspace', async () => {
    await expect(service.deleteWorkspace('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })
})
