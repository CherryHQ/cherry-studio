import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { workspaceTable } from '@data/db/schemas/workspace'
import { sessionService } from '@data/services/SessionService'
import { WorkspaceService, workspaceService } from '@data/services/WorkspaceService'
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
      path: normalizedPath
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
})
