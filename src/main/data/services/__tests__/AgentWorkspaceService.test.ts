import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AgentWorkspaceService, agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, rm, stat, writeFile } from 'fs/promises'
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
      path: normalizedPath
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
    const session = await agentSessionService.createSession({
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

  it('creates default workspaces under the agents workspace root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'cherry-workspace-default-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, filename) : root
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })

    const workspace = await agentWorkspaceService.createDefaultWorkspace()

    expect(workspace.path.startsWith(root)).toBe(true)
    const stats = await stat(workspace.path)
    expect(stats.isDirectory()).toBe(true)
  })
})
