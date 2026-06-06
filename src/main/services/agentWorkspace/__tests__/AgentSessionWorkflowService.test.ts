import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { setupTestDatabase } from '@test-helpers/db'
import { mkdtemp, readdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { agentSessionWorkflowService } from '../AgentSessionWorkflowService'
import { agentWorkspaceDirectoryService } from '../AgentWorkspaceDirectoryService'

describe('AgentSessionWorkflowService', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-session-flow-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.agents.workspaces') {
        return filename ? path.join(root, 'Agents', filename) : path.join(root, 'Agents')
      }
      return filename ? path.join('/mock', key, filename) : path.join('/mock', key)
    })
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation(async (fn) =>
      dbh.db.transaction(fn as never)
    )
    await dbh.db.insert(agentTable).values({
      id: 'agent-session-flow-test',
      type: 'claude-code',
      name: 'Session Flow Test Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  afterEach(() => {
    ;(application.get('DbService').withWriteTx as Mock).mockReset()
    vi.restoreAllMocks()
  })

  async function createWorkspace(rawPath: string) {
    const workspacePath = agentWorkspaceDirectoryService.ensureWorkspaceDirectory(rawPath)
    return await agentWorkspaceService.findOrCreateByPath(workspacePath)
  }

  it('binds a session to an explicit workspace', async () => {
    const workspace = await createWorkspace(path.join(root, 'explicit'))

    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-flow-test',
      name: 'Explicit',
      workspaceId: workspace.id
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)
  })

  it('inherits a sibling workspace without preparing a default workspace directory', async () => {
    const firstWorkspace = await createWorkspace(path.join(root, 'first'))
    const secondWorkspace = await createWorkspace(path.join(root, 'second'))

    await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-flow-test',
      name: 'First',
      workspaceId: firstWorkspace.id
    })
    await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-flow-test',
      name: 'Second',
      workspaceId: secondWorkspace.id
    })

    const inherited = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-flow-test',
      name: 'Inherited'
    })

    expect(inherited.workspaceId).toBe(secondWorkspace.id)
    expect(inherited.workspace?.path).toBe(secondWorkspace.path)
    await expect(stat(path.join(root, 'Agents'))).rejects.toThrow()
  })

  it('creates and binds a default workspace when none can be inherited', async () => {
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-flow-test',
      name: 'Default'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace?.path.startsWith(path.join(root, 'Agents'))).toBe(true)
    await expect(stat(session.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
  })

  it('keeps a bound default workspace directory when session hydration fails', async () => {
    vi.spyOn(agentSessionService, 'getById').mockRejectedValueOnce(new Error('hydrate failed'))

    await expect(
      agentSessionWorkflowService.createSession({
        agentId: 'agent-session-flow-test',
        name: 'Hydrate failure'
      })
    ).rejects.toThrow('hydrate failed')

    const workspaces = await dbh.db.select().from(agentWorkspaceTable)
    expect(workspaces).toHaveLength(1)
    const sessions = await dbh.db.select().from(agentSessionTable)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].workspaceId).toBe(workspaces[0].id)
    await expect(stat(workspaces[0].path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('cleans a prepared default directory when session creation fails', async () => {
    await expect(
      agentSessionWorkflowService.createSession({
        agentId: 'agent-session-flow-test',
        name: null as never
      })
    ).rejects.toThrow()

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
    await expect(readdir(path.join(root, 'Agents'))).resolves.toEqual([])
  })

  it('keeps session deletion in the data service because no directory cleanup is needed on main', async () => {
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-flow-test',
      name: 'Delete me'
    })

    await agentSessionService.delete(session.id)

    await expect(agentSessionService.getById(session.id)).rejects.toThrow()
    await expect(stat(session.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })
})
