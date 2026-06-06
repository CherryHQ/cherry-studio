import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { AgentWorkspaceService, agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { tmpdir } from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('AgentWorkspaceService', () => {
  const dbh = setupTestDatabase()

  function workspacePath(name: string): string {
    return path.join(tmpdir(), `cherry-workspace-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  }

  async function insertSystemWorkspace(id: string, workspacePath: string): Promise<void> {
    await dbh.db.insert(agentWorkspaceTable).values({
      id,
      name: 'System Workspace',
      path: workspacePath,
      type: 'system',
      orderKey: 'a0'
    })
  }

  it('should export a module-level singleton of AgentWorkspaceService', () => {
    expect(agentWorkspaceService).toBeInstanceOf(AgentWorkspaceService)
  })

  it('normalizes paths and dedupes user workspaces by path', async () => {
    const root = workspacePath('project-root')
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

    const rows = await dbh.db.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.path, normalizedPath))
    expect(rows).toHaveLength(1)
  })

  it('inserts newly created workspaces at the front of the list', async () => {
    const first = await agentWorkspaceService.findOrCreateByPath(workspacePath('first'))
    const second = await agentWorkspaceService.findOrCreateByPath(workspacePath('second'))

    const workspaces = await agentWorkspaceService.list()

    expect(workspaces.map((workspace) => workspace.id)).toEqual([second.id, first.id])
  })

  it('hides system workspaces from the default list and get APIs', async () => {
    const userWorkspace = await agentWorkspaceService.findOrCreateByPath(workspacePath('user-project'))
    const systemWorkspacePath = workspacePath('system-project')
    await insertSystemWorkspace('system-workspace-hidden', systemWorkspacePath)

    await expect(agentWorkspaceService.getById('system-workspace-hidden')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(
      agentWorkspaceService.getById('system-workspace-hidden', { includeSystem: true })
    ).resolves.toMatchObject({
      id: 'system-workspace-hidden',
      type: 'system'
    })
    expect((await agentWorkspaceService.list()).map((workspace) => workspace.id)).toEqual([userWorkspace.id])
  })

  it('creates system workspaces as hidden system rows', async () => {
    const systemWorkspacePath = workspacePath('prepared-system')

    const workspace = await agentWorkspaceService.createSystemWorkspace({
      path: systemWorkspacePath,
      name: 'No project 2026-05-25 14:30:12'
    })

    expect(workspace).toMatchObject({
      name: 'No project 2026-05-25 14:30:12',
      path: systemWorkspacePath,
      type: 'system'
    })
    await expect(agentWorkspaceService.getById(workspace.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).resolves.toMatchObject({
      id: workspace.id,
      type: 'system'
    })
  })

  it('maps transactional system workspace duplicate paths to conflict errors', async () => {
    const systemWorkspacePath = workspacePath('prepared-system-tx')
    await agentWorkspaceService.createSystemWorkspace({
      path: systemWorkspacePath,
      name: 'No project 2026-05-25 14:30:12'
    })

    await expect(
      dbh.db.transaction((tx) =>
        agentWorkspaceService.createSystemWorkspaceTx(tx, {
          path: systemWorkspacePath,
          name: 'No project 2026-05-25 14:30:13'
        })
      )
    ).rejects.toMatchObject({
      code: ErrorCode.CONFLICT
    })
  })

  it('deletes a workspace with its sessions and returns the system path when needed', async () => {
    const workspace = await agentWorkspaceService.createSystemWorkspace({
      path: workspacePath('system-delete'),
      name: 'No project 2026-05-25 14:30:12'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-for-system-workspace',
      name: 'System session',
      workspaceId: workspace.id,
      orderKey: 'a0'
    })

    await expect(
      agentWorkspaceService.deleteWorkspaceWithSessions(workspace.id, { includeSystem: true })
    ).resolves.toBe(workspace.path)

    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    const sessions = await dbh.db
      .select()
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, 'session-for-system-workspace'))
    expect(sessions).toHaveLength(0)
  })

  it('does not return a system workspace from findOrCreateByPath', async () => {
    const systemWorkspacePath = workspacePath('system-path')
    await insertSystemWorkspace('system-workspace-path', systemWorkspacePath)

    await expect(agentWorkspaceService.findOrCreateByPath(systemWorkspacePath)).rejects.toMatchObject({
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

  it('returns database workspace data without checking the backing directory', async () => {
    const missingDirectoryPath = workspacePath('not-created-on-disk')
    const workspace = await agentWorkspaceService.findOrCreateByPath(missingDirectoryPath)

    await expect(agentWorkspaceService.getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      path: missingDirectoryPath
    })
  })

  it('translates findOrCreateByPathTx unique races to conflict errors', async () => {
    const currentWorkspacePath = workspacePath('race')
    await agentWorkspaceService.findOrCreateByPath(currentWorkspacePath)

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
      agentWorkspaceService.findOrCreateByPathTx(racingTx as never, currentWorkspacePath)
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

  it('rejects system workspace targets and anchors in default reorder APIs', async () => {
    const userWorkspace = await agentWorkspaceService.findOrCreateByPath(workspacePath('user-order'))
    const otherUserWorkspace = await agentWorkspaceService.findOrCreateByPath(workspacePath('other-user-order'))
    await insertSystemWorkspace('system-workspace-order', workspacePath('system-order'))

    await expect(agentWorkspaceService.reorder('system-workspace-order', { position: 'first' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(
      agentWorkspaceService.reorder(userWorkspace.id, { before: 'system-workspace-order' })
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(
      agentWorkspaceService.reorderBatch([{ id: 'system-workspace-order', anchor: { position: 'last' } }])
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(
      agentWorkspaceService.reorderBatch([{ id: otherUserWorkspace.id, anchor: { after: 'system-workspace-order' } }])
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })
})
