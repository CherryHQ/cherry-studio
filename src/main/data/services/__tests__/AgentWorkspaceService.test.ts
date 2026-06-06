import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentWorkspaceService, agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('AgentWorkspaceService', () => {
  const dbh = setupTestDatabase()

  function workspacePath(...segments: string[]) {
    return path.join('/tmp', 'cherry-workspace-service', ...segments)
  }

  it('should export a module-level singleton of AgentWorkspaceService', () => {
    expect(agentWorkspaceService).toBeInstanceOf(AgentWorkspaceService)
  })

  it('normalizes paths and dedupes rows by path', async () => {
    const rawPath = workspacePath('project', '..', 'project')
    const normalizedPath = workspacePath('project')

    const first = await agentWorkspaceService.findOrCreateByPath(rawPath)
    const second = await agentWorkspaceService.findOrCreateByPath(normalizedPath)

    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({
      name: 'project',
      path: normalizedPath
    })

    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.path, normalizedPath))
    expect(rows).toHaveLength(1)
  })

  it('inserts newly created workspaces at the front of the list', async () => {
    const first = await agentWorkspaceService.findOrCreateByPath(workspacePath('first'))
    const second = await agentWorkspaceService.findOrCreateByPath(workspacePath('second'))

    const workspaces = await agentWorkspaceService.list()

    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id])
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

  it('returns database workspace data without consulting the backing directory', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(workspacePath('db-only'))

    await expect(agentWorkspaceService.getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      path: workspace.path
    })
  })

  it('translates findOrCreateByPathTx unique races to conflict errors', async () => {
    const workspacePathValue = workspacePath('race')
    await agentWorkspaceService.findOrCreateByPath(workspacePathValue)

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

  it('reorders workspaces with single and batch moves', async () => {
    const first = await agentWorkspaceService.findOrCreateByPath(workspacePath('first'))
    const second = await agentWorkspaceService.findOrCreateByPath(workspacePath('second'))
    const third = await agentWorkspaceService.findOrCreateByPath(workspacePath('third'))

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
