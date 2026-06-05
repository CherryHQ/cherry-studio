import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentSessionWorkflowService } from '@data/services/AgentSessionWorkflowService'
import { AgentWorkspaceService, agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { agentWorkspaceWorkflowService } from '@data/services/AgentWorkspaceWorkflowService'
import { pinService } from '@data/services/PinService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('AgentWorkspaceService', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should export a module-level singleton of AgentWorkspaceService', () => {
    expect(agentWorkspaceService).toBeInstanceOf(AgentWorkspaceService)
  })

  it('normalizes paths, creates the directory, and dedupes by path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const rawPath = path.join(root, 'project', '..', 'project')
    const normalizedPath = path.join(root, 'project')

    const first = await agentWorkspaceService.findOrCreateByPath(rawPath)
    const second = await agentWorkspaceService.findOrCreateByPath(normalizedPath)

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      name: 'project',
      path: normalizedPath,
      type: 'user'
    })
    const stats = await stat(normalizedPath)
    expect(stats.isDirectory()).toBe(true)

    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.path, normalizedPath))
    expect(rows).toHaveLength(1)
  })

  it('inserts newly created workspaces at the front of the list', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const first = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'first'))
    const second = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'second'))

    const workspaces = await agentWorkspaceService.list()

    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id])
  })

  it('hides system workspaces from the default list and get APIs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const userWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'user-project'))
    const systemWorkspace = await agentWorkspaceService.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    await expect(agentWorkspaceService.getById(systemWorkspace.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(agentWorkspaceService.getById(systemWorkspace.id, { includeSystem: true })).resolves.toMatchObject({
      id: systemWorkspace.id,
      type: 'system'
    })
    expect((await agentWorkspaceService.list()).map((workspace) => workspace.id)).toEqual([userWorkspace.id])
  })

  it('does not return a system workspace from findOrCreateByPath', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-path-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const systemWorkspace = await agentWorkspaceService.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    await expect(agentWorkspaceService.findOrCreateByPath(systemWorkspace.path)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('rejects relative workspace paths', async () => {
    await expect(agentWorkspaceService.findOrCreateByPath('relative/project')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
  })

  it('throws not found for missing workspaces', async () => {
    await expect(agentWorkspaceService.getById('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes the workspace row and associated sessions without removing the directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'db-only-delete')
    const workspace = await agentWorkspaceService.findOrCreateByPath(workspacePath)
    const otherWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'kept-workspace'))
    await dbh.db.insert(agentTable).values({
      id: 'agent-with-deleted-workspace',
      type: 'claude-code',
      name: 'Deleted Workspace Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-with-deleted-workspace',
      name: 'Workspace binding clears',
      workspaceId: workspace.id
    })
    const otherSession = await agentSessionWorkflowService.createSession({
      agentId: 'agent-with-deleted-workspace',
      name: 'Other workspace session remains',
      workspaceId: otherWorkspace.id
    })
    await pinService.pin({ entityType: 'session', entityId: session.id })
    await pinService.pin({ entityType: 'session', entityId: otherSession.id })

    await agentWorkspaceWorkflowService.deleteWorkspace(workspace.id)

    await expect(agentWorkspaceService.getById(workspace.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    const stats = await stat(workspacePath)
    expect(stats.isDirectory()).toBe(true)
    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(agentSessionService.getById(otherSession.id)).resolves.toMatchObject({
      id: otherSession.id,
      workspaceId: otherWorkspace.id
    })
    expect((await pinService.listByEntityType('session')).map((pin) => pin.entityId)).toEqual([otherSession.id])
  })

  it('throws not found when deleting a missing workspace', async () => {
    await expect(agentWorkspaceWorkflowService.deleteWorkspace('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('returns database workspace data when the backing directory is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'deleted-on-disk')
    const workspace = await agentWorkspaceService.findOrCreateByPath(workspacePath)
    await dbh.db.insert(agentTable).values({
      id: 'agent-with-missing-workspace-dir',
      type: 'claude-code',
      name: 'Missing Workspace Dir Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-with-missing-workspace-dir',
      name: 'Session keeps DB workspace',
      workspaceId: workspace.id
    })

    await rm(workspacePath, { recursive: true, force: true })

    await expect(stat(workspacePath)).rejects.toThrow()
    await expect(agentWorkspaceService.getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      path: workspacePath
    })
    await expect(agentSessionService.getById(session.id)).resolves.toMatchObject({
      id: session.id,
      workspaceId: workspace.id,
      workspace: {
        id: workspace.id,
        path: workspacePath
      }
    })
  })

  it('surfaces directory creation failures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const filePath = path.join(root, 'not-a-directory')
    await writeFile(filePath, 'file blocks recursive mkdir')

    await expect(agentWorkspaceService.findOrCreateByPath(path.join(filePath, 'child'))).rejects.toThrow()
  })

  it('translates findOrCreateByPathTx unique races to conflict errors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'race')
    await agentWorkspaceService.findOrCreateByPath(workspacePath)

    const emptyRows = { limit: async () => [] }
    const afterWhere = { ...emptyRows, orderBy: () => emptyRows }
    const racingTx = {
      select: () => ({
        from: () => ({
          where: () => afterWhere,
          orderBy: () => emptyRows,
          limit: async () => []
        })
      }),
      insert: dbh.db.insert.bind(dbh.db)
    }

    await expect(agentWorkspaceService.findOrCreateByPathTx(racingTx as never, workspacePath)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('reorders workspaces with single and batch moves', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const first = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'first'))
    const second = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'second'))
    const third = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'third'))

    await agentWorkspaceService.reorder(first.id, { position: 'first' })
    let workspaces = await agentWorkspaceService.list()
    expect(workspaces.map((workspace) => workspace.id)).toEqual([first.id, third.id, second.id])

    await agentWorkspaceService.reorderBatch([
      { id: second.id, anchor: { before: first.id } },
      { id: third.id, anchor: { position: 'last' } }
    ])
    workspaces = await agentWorkspaceService.list()
    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id, third.id])
  })
  it('creates system workspaces under the isolated system subtree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })

    const workspace = await agentWorkspaceService.createSystemWorkspaceForSession(
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

  it('rejects system workspace paths outside the isolated system subtree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-guard-'))
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-outside-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })

    expect(() =>
      agentWorkspaceService.assertSystemWorkspacePath(path.join(root, 'system', '2026-05-25', 'valid'))
    ).not.toThrow()
    expect(() =>
      agentWorkspaceService.assertSystemWorkspacePath(path.join(outsideRoot, 'system', '2026-05-25'))
    ).toThrow()
    expect(() => agentWorkspaceService.assertSystemWorkspacePath(path.join(root, 'system', '..', 'escaped'))).toThrow()
  })

  it('does not recursively delete non-empty prepared system workspace directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-prepared-cleanup-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const workspacePath = path.join(root, 'system', '2026-05-25', 'prepared')
    const sentinelPath = path.join(workspacePath, 'keep.txt')
    await mkdir(workspacePath, { recursive: true })
    await writeFile(sentinelPath, 'keep')

    agentWorkspaceService.deletePreparedSystemWorkspaceDirectory({
      id: 'prepared-system-workspace',
      name: 'Prepared',
      path: workspacePath,
      type: 'system'
    })

    await expect(stat(sentinelPath)).resolves.toMatchObject({ isFile: expect.any(Function) })
  })

  it('deletes the backing directory for system workspaces only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-delete-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const workspace = await agentWorkspaceService.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    await agentWorkspaceWorkflowService.deleteWorkspace(workspace.id, { includeSystem: true })

    await expect(stat(workspace.path)).rejects.toThrow()
  })

  it('keeps the DataApi delete result consistent when post-commit system directory cleanup fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-delete-fail-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const workspace = await agentWorkspaceService.createSystemWorkspaceForSession('cleanup-failure-session')
    vi.spyOn(agentWorkspaceService, 'deleteSystemWorkspaceDirectory').mockImplementation(() => {
      throw new Error('rm failed')
    })

    await expect(
      agentWorkspaceWorkflowService.deleteWorkspace(workspace.id, { includeSystem: true })
    ).resolves.toBeUndefined()

    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })
})
