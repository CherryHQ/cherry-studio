import { application } from '@application'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentWorkspaceService, agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('AgentWorkspaceService', () => {
  const dbh = setupTestDatabase()

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function workspacePath(...segments: string[]) {
    return path.join('/tmp', 'cherry-workspace-service', ...segments)
  }

  async function findOrCreateWorkspace(rawPath: string, options: { name?: string } = {}) {
    return await dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, rawPath, options))
  }

  it('should export a module-level singleton of AgentWorkspaceService', () => {
    expect(agentWorkspaceService).toBeInstanceOf(AgentWorkspaceService)
  })

  it('normalizes paths and dedupes rows by path', async () => {
    const rawPath = workspacePath('project', '..', 'project')
    const normalizedPath = workspacePath('project')

    const first = await findOrCreateWorkspace(rawPath)
    const second = await findOrCreateWorkspace(normalizedPath)

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      name: 'project',
      path: normalizedPath,
      type: 'user'
    })

    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.path, normalizedPath))
    expect(rows).toHaveLength(1)
  })

  it('inserts newly created workspaces at the front of the list', async () => {
    const first = await findOrCreateWorkspace(workspacePath('first'))
    const second = await findOrCreateWorkspace(workspacePath('second'))

    const workspaces = await agentWorkspaceService.list()

    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id])
  })

  it('rejects relative workspace paths', async () => {
    await expect(findOrCreateWorkspace('relative/project')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_ERROR
    })
  })

  it('throws not found for missing workspaces', async () => {
    await expect(agentWorkspaceService.getById('missing-workspace')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('returns database workspace data without consulting the backing directory', async () => {
    const workspace = await findOrCreateWorkspace(workspacePath('db-only'))

    await expect(agentWorkspaceService.getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      path: workspace.path
    })
  })

  it('creates system workspace rows without creating the backing directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-system-workspace-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, 'Agents', filename) : path.join(root, 'Agents')
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })

    const workspace = await dbh.db.transaction((tx) =>
      agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: 'session-system' })
    )

    expect(workspace).toMatchObject({
      path: path.join(root, 'Agents', 'session-system'),
      type: 'system'
    })
    await expect(stat(workspace.path)).rejects.toThrow()
  })

  it('translates findOrCreateByPathTx unique races to conflict errors', async () => {
    const workspacePathValue = workspacePath('race')
    await findOrCreateWorkspace(workspacePathValue)

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

    await expect(
      agentWorkspaceService.findOrCreateByPathTx(racingTx as never, workspacePathValue)
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('rejects findOrCreateByPathTx when the existing path belongs to a system workspace', async () => {
    const workspace = await dbh.db.transaction((tx) =>
      agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: 'session-system-collision' })
    )

    await expect(
      dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, workspace.path))
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('rejects workspace rows whose type violates the database CHECK constraint', async () => {
    const invalidPath = workspacePath('invalid-type')

    await expect(
      dbh.db.insert(agentWorkspaceTable).values({
        id: 'workspace-invalid-type',
        name: 'Invalid Type',
        path: invalidPath,
        type: 'invalid' as never,
        orderKey: 'a0'
      })
    ).rejects.toThrow(/Failed query/)

    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.path, invalidPath))
    expect(rows).toHaveLength(0)
  })

  it('reorders workspaces with single and batch moves', async () => {
    const first = await findOrCreateWorkspace(workspacePath('first'))
    const second = await findOrCreateWorkspace(workspacePath('second'))
    const third = await findOrCreateWorkspace(workspacePath('third'))

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
})
