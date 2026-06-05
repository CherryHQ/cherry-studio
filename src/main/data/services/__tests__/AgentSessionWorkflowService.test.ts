import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentSessionWorkflowService } from '@data/services/AgentSessionWorkflowService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { mkdtemp, readdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

describe('AgentSessionWorkflowService', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-session-workflow-'))
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
      id: 'agent-session-test',
      type: 'claude-code',
      name: 'Session Test Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a0'
    })
  })

  afterEach(() => {
    ;(application.get('DbService').withWriteTx as Mock).mockReset()
    vi.restoreAllMocks()
  })

  it('binds a session to an explicit workspace', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'explicit'))

    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspaceId: workspace.id
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)
  })

  it('inherits the latest sibling workspace without preparing a default workspace', async () => {
    const firstWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'first'))
    const secondWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'second'))

    await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'First',
      workspaceId: firstWorkspace.id
    })
    await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'Second',
      workspaceId: secondWorkspace.id
    })

    const inherited = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'Inherited'
    })

    expect(inherited.workspaceId).toBe(secondWorkspace.id)
    expect(inherited.workspace?.path).toBe(secondWorkspace.path)
    await expect(stat(path.join(root, 'Agents'))).rejects.toThrow()
  })

  it('creates and binds a default workspace when none can be inherited', async () => {
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'Default'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace?.path).toBeTruthy()
    await expect(stat(session.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
  })

  it('creates and binds a system workspace for explicit no-project sessions', async () => {
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace).toMatchObject({ type: 'system' })
    expect(session.workspace?.path).toContain(path.join('Agents', 'system'))
    await expect(stat(session.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(agentWorkspaceService.list()).resolves.toEqual([])
  })

  it('rejects system workspace mode combined with an explicit workspace id', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'explicit'))

    await expect(
      agentSessionWorkflowService.createSession({
        agentId: 'agent-session-test',
        name: 'Invalid',
        workspaceId: workspace.id,
        workspaceMode: 'system'
      })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  })

  it('rejects binding a system workspace through workspaceId', async () => {
    const systemWorkspace = await agentWorkspaceService.createSystemWorkspaceForSession('system-workspace-id')

    await expect(
      agentSessionWorkflowService.createSession({
        agentId: 'agent-session-test',
        name: 'Invalid system id',
        workspaceId: systemWorkspace.id
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('does not inherit a system workspace when workspaceId is omitted', async () => {
    const systemSession = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })

    const inherited = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'Default workspace'
    })

    expect(inherited.workspaceId).not.toBe(systemSession.workspaceId)
    expect(inherited.workspace).toMatchObject({ type: 'user' })
  })

  it('does not prepare a default workspace when the agent is missing', async () => {
    await expect(
      agentSessionWorkflowService.createSession({
        agentId: 'missing-agent',
        name: 'Missing'
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })

    await expect(stat(path.join(root, 'Agents'))).rejects.toThrow()
  })

  it('deletes a session', async () => {
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'Delete me'
    })

    await agentSessionWorkflowService.deleteSession(session.id)

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes the system workspace when deleting its last session reference', async () => {
    const session = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })
    const workspaceId = session.workspaceId!
    const workspacePath = session.workspace!.path

    await agentSessionWorkflowService.deleteSession(session.id)

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(agentWorkspaceService.getById(workspaceId, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('keeps a shared system workspace until the last session reference is deleted', async () => {
    const first = await agentSessionWorkflowService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })
    const workspaceId = first.workspaceId!
    const workspacePath = first.workspace!.path
    await dbh.db.insert(agentSessionTable).values({
      id: 'second-system-reference',
      agentId: 'agent-session-test',
      name: 'Second system reference',
      workspaceId,
      orderKey: 'a1'
    })

    await agentSessionWorkflowService.deleteSession(first.id)

    await expect(agentWorkspaceService.getById(workspaceId, { includeSystem: true })).resolves.toMatchObject({
      id: workspaceId
    })
    await expect(stat(workspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })

    await agentSessionWorkflowService.deleteSession('second-system-reference')

    await expect(agentWorkspaceService.getById(workspaceId, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('does not leave an orphan default workspace row when session creation fails', async () => {
    await expect(
      agentSessionWorkflowService.createSession({
        agentId: 'agent-session-test',
        name: null as never
      })
    ).rejects.toThrow()

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
    await expect(readdir(path.join(root, 'Agents'))).resolves.toEqual([])
  })
})
