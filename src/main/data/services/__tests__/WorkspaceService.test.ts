import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { workspaceTable } from '@data/db/schemas/workspace'
import { pinService } from '@data/services/PinService'
import { sessionService } from '@data/services/SessionService'
import { WorkspaceService, workspaceService } from '@data/services/WorkspaceService'
import { workspaceWorkflowService } from '@data/services/WorkspaceWorkflowService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('WorkspaceService', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should export a module-level singleton of WorkspaceService', () => {
    expect(workspaceService).toBeInstanceOf(WorkspaceService)
  })

  it('normalizes paths, creates the directory, and dedupes by path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const rawPath = path.join(root, 'project', '..', 'project')
    const normalizedPath = path.join(root, 'project')

    const first = await workspaceService.findOrCreateByPath(rawPath)
    const second = await workspaceService.findOrCreateByPath(normalizedPath)

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      name: 'project',
      path: normalizedPath,
      type: 'user'
    })
    const stats = await stat(normalizedPath)
    expect(stats.isDirectory()).toBe(true)

    const rows = await dbh.db.select().from(workspaceTable).where(eq(workspaceTable.path, normalizedPath))
    expect(rows).toHaveLength(1)
  })

  it('inserts newly created workspaces at the front of the list', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const first = await workspaceService.findOrCreateByPath(path.join(root, 'first'))
    const second = await workspaceService.findOrCreateByPath(path.join(root, 'second'))

    const workspaces = await workspaceService.list()

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
    const userWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'user-project'))
    const systemWorkspace = await workspaceService.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    await expect(workspaceService.getById(systemWorkspace.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(workspaceService.getById(systemWorkspace.id, { includeSystem: true })).resolves.toMatchObject({
      id: systemWorkspace.id,
      type: 'system'
    })
    expect((await workspaceService.list()).map((workspace) => workspace.id)).toEqual([userWorkspace.id])
  })

  it('does not return a system workspace from findOrCreateByPath', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-path-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const systemWorkspace = await workspaceService.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    await expect(workspaceService.findOrCreateByPath(systemWorkspace.path)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('rejects relative workspace paths', async () => {
    await expect(workspaceService.findOrCreateByPath('relative/project')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
  })

  it('throws not found for missing workspaces', async () => {
    await expect(workspaceService.getById('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes the workspace row and associated sessions without removing the directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'db-only-delete')
    const workspace = await workspaceService.findOrCreateByPath(workspacePath)
    const otherWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'kept-workspace'))
    await dbh.db.insert(agentTable).values({
      id: 'agent-with-deleted-workspace',
      type: 'claude-code',
      name: 'Deleted Workspace Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
    const session = await sessionService.createSession({
      agentId: 'agent-with-deleted-workspace',
      name: 'Workspace binding clears',
      workspaceId: workspace.id
    })
    const otherSession = await sessionService.createSession({
      agentId: 'agent-with-deleted-workspace',
      name: 'Other workspace session remains',
      workspaceId: otherWorkspace.id
    })
    await pinService.pin({ entityType: 'session', entityId: session.id })
    await pinService.pin({ entityType: 'session', entityId: otherSession.id })

    await workspaceWorkflowService.deleteWorkspace(workspace.id)

    await expect(workspaceService.getById(workspace.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    const stats = await stat(workspacePath)
    expect(stats.isDirectory()).toBe(true)
    await expect(sessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(sessionService.getById(otherSession.id)).resolves.toMatchObject({
      id: otherSession.id,
      workspaceId: otherWorkspace.id
    })
    expect((await pinService.listByEntityType('session')).map((pin) => pin.entityId)).toEqual([otherSession.id])
  })

  it('throws not found when deleting a missing workspace', async () => {
    await expect(workspaceWorkflowService.deleteWorkspace('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('returns database workspace data when the backing directory is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'deleted-on-disk')
    const workspace = await workspaceService.findOrCreateByPath(workspacePath)
    await dbh.db.insert(agentTable).values({
      id: 'agent-with-missing-workspace-dir',
      type: 'claude-code',
      name: 'Missing Workspace Dir Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
    const session = await sessionService.createSession({
      agentId: 'agent-with-missing-workspace-dir',
      name: 'Session keeps DB workspace',
      workspaceId: workspace.id
    })

    await rm(workspacePath, { recursive: true, force: true })

    await expect(stat(workspacePath)).rejects.toThrow()
    await expect(workspaceService.getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      path: workspacePath
    })
    await expect(sessionService.getById(session.id)).resolves.toMatchObject({
      id: session.id,
      workspaceId: workspace.id,
      workspace: {
        id: workspace.id,
        path: workspacePath
      }
    })
  })

  it('renames a workspace without changing its directory path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'project')
    const workspace = await workspaceService.findOrCreateByPath(workspacePath)

    const updated = await workspaceService.update(workspace.id, { name: ' Renamed Project ' })

    expect(updated).toMatchObject({
      id: workspace.id,
      name: 'Renamed Project',
      path: workspacePath
    })
    await expect(stat(workspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('surfaces directory creation failures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const filePath = path.join(root, 'not-a-directory')
    await writeFile(filePath, 'file blocks recursive mkdir')

    await expect(workspaceService.findOrCreateByPath(path.join(filePath, 'child'))).rejects.toThrow()
  })

  it('translates findOrCreateByPathTx unique races to conflict errors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const workspacePath = path.join(root, 'race')
    await workspaceService.findOrCreateByPath(workspacePath)

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

    await expect(workspaceService.findOrCreateByPathTx(racingTx as never, workspacePath)).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('reorders workspaces with single and batch moves', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-'))
    const first = await workspaceService.findOrCreateByPath(path.join(root, 'first'))
    const second = await workspaceService.findOrCreateByPath(path.join(root, 'second'))
    const third = await workspaceService.findOrCreateByPath(path.join(root, 'third'))

    await workspaceService.reorder(first.id, { position: 'first' })
    let workspaces = await workspaceService.list()
    expect(workspaces.map((workspace) => workspace.id)).toEqual([first.id, third.id, second.id])

    await workspaceService.reorderBatch([
      { id: second.id, anchor: { before: first.id } },
      { id: third.id, anchor: { position: 'last' } }
    ])
    workspaces = await workspaceService.list()
    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id, third.id])
  })

  it('does not reorder hidden system workspaces as user workspace targets or anchors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-reorder-system-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const first = await workspaceService.findOrCreateByPath(path.join(root, 'first'))
    const second = await workspaceService.findOrCreateByPath(path.join(root, 'second'))
    const systemWorkspace = await workspaceService.createSystemWorkspaceForSession('system-anchor-session')

    await expect(workspaceService.reorder(first.id, { before: systemWorkspace.id })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(
      workspaceService.reorderBatch([{ id: systemWorkspace.id, anchor: { before: first.id } }])
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    const workspaces = await workspaceService.list()
    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id])
  })

  it('creates default workspaces under the agents workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-default-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })

    const workspace = await workspaceService.createDefaultWorkspace()

    expect(workspace.path.startsWith(root)).toBe(true)
    const stats = await stat(workspace.path)
    expect(stats.isDirectory()).toBe(true)
  })

  it('creates system workspaces under the isolated system subtree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })

    const workspace = await workspaceService.createSystemWorkspaceForSession(
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

  it('deletes the backing directory for system workspaces only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-system-delete-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    const workspace = await workspaceService.createSystemWorkspaceForSession(
      '12345678-1234-4000-8000-123456789abc',
      new Date(2026, 4, 25, 14, 30, 12)
    )

    await workspaceWorkflowService.deleteWorkspace(workspace.id)

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
    const workspace = await workspaceService.createSystemWorkspaceForSession('cleanup-failure-session')
    vi.spyOn(workspaceService, 'deleteSystemWorkspaceDirectory').mockImplementation(() => {
      throw new Error('rm failed')
    })

    await expect(workspaceWorkflowService.deleteWorkspace(workspace.id)).resolves.toBeUndefined()

    await expect(workspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspace.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })
})
