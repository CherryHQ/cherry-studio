import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, readdir, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

describe('AgentSessionService', () => {
  const dbh = setupTestDatabase()
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cherry-session-'))
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

  async function createSession(name: string, workspaceId?: string) {
    return await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name,
      workspaceId
    })
  }

  it('binds a session to an explicit workspace', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'explicit'))

    const session = await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspaceId: workspace.id
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)
  })

  it('inherits the latest sibling workspace when no workspace is provided', async () => {
    const firstWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'first'))
    const secondWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'second'))

    await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'First',
      workspaceId: firstWorkspace.id
    })
    await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Second',
      workspaceId: secondWorkspace.id
    })

    const inherited = await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Inherited'
    })

    expect(inherited.workspaceId).toBe(secondWorkspace.id)
    expect(inherited.workspace?.path).toBe(secondWorkspace.path)
    await expect(readdir(path.join(root, 'Agents'))).resolves.toEqual([])
  })

  it('creates and binds a default workspace when none can be inherited', async () => {
    const session = await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Default'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace?.path).toBeTruthy()
    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
  })

  it('creates and binds a system workspace for explicit no-project sessions', async () => {
    const session = await agentSessionService.createSession({
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
      agentSessionService.createSession({
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
      agentSessionService.createSession({
        agentId: 'agent-session-test',
        name: 'Invalid system id',
        workspaceId: systemWorkspace.id
      })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('does not inherit a system workspace when workspaceId is omitted', async () => {
    const systemSession = await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })

    const inherited = await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Default workspace'
    })

    expect(inherited.workspaceId).not.toBe(systemSession.workspaceId)
    expect(inherited.workspace).toMatchObject({ type: 'user' })
  })

  it('finds only the latest user workspace path for an agent', async () => {
    await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })

    await expect(agentSessionService.findAgentWorkspacePath('agent-session-test')).resolves.toBeNull()

    const userWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'runtime-user-workspace'))
    await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'User workspace',
      workspaceId: userWorkspace.id
    })

    await expect(agentSessionService.findAgentWorkspacePath('agent-session-test')).resolves.toBe(userWorkspace.path)
  })

  it('returns migrated sessions without a workspace binding', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-without-workspace',
      agentId: 'agent-session-test',
      name: 'Migrated',
      orderKey: 'a0'
    })

    const session = await agentSessionService.getById('session-without-workspace')

    expect(session.workspaceId).toBeNull()
    expect(session.workspace).toBeNull()
  })

  it('throws not found for missing sessions', async () => {
    await expect(agentSessionService.getById('missing-session')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('updates a session and returns the updated entity', async () => {
    const session = await createSession('Before update')

    const updated = await agentSessionService.update(session.id, {
      name: 'After update',
      description: 'Updated description'
    })

    expect(updated).toMatchObject({
      id: session.id,
      name: 'After update',
      description: 'Updated description'
    })
  })

  it('ignores workspace updates even if callers bypass the schema', async () => {
    const firstWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'before-switch'))
    const secondWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'after-switch'))
    const session = await createSession('Workspace switch', firstWorkspace.id)

    const updated = await agentSessionService.update(session.id, {
      workspaceId: secondWorkspace.id
    } as never)

    expect(updated.workspaceId).toBe(firstWorkspace.id)
    expect(updated.workspace?.path).toBe(firstWorkspace.path)
  })

  it('deletes a session', async () => {
    const session = await createSession('Delete me')

    await agentSessionService.delete(session.id)

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes the system workspace when deleting its last session reference', async () => {
    const session = await agentSessionService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })
    const workspaceId = session.workspaceId!
    const workspacePath = session.workspace!.path

    await agentSessionService.delete(session.id)

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(agentWorkspaceService.getById(workspaceId, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('keeps a shared system workspace until the last session reference is deleted', async () => {
    const first = await agentSessionService.createSession({
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

    await agentSessionService.delete(first.id)

    await expect(agentWorkspaceService.getById(workspaceId, { includeSystem: true })).resolves.toMatchObject({
      id: workspaceId
    })
    await expect(stat(workspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })

    await agentSessionService.delete('second-system-reference')

    await expect(agentWorkspaceService.getById(workspaceId, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('reorders sessions with single and batch moves', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')

    await agentSessionService.reorder(first.id, { position: 'first' })
    let list = await agentSessionService.listByCursor()
    expect(list.items.map((item) => item.id)).toEqual([first.id, third.id, second.id])

    await agentSessionService.reorderBatch([
      { id: second.id, anchor: { before: first.id } },
      { id: third.id, anchor: { position: 'last' } }
    ])
    list = await agentSessionService.listByCursor()
    expect(list.items.map((item) => item.id)).toEqual([second.id, first.id, third.id])
  })

  it('paginates sessions with a cursor', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')

    const page1 = await agentSessionService.listByCursor({ limit: 2 })
    expect(page1.items.map((item) => item.id)).toEqual([third.id, second.id])
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await agentSessionService.listByCursor({ limit: 2, cursor: page1.nextCursor })
    expect(page2.items.map((item) => item.id)).toEqual([first.id])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('clears workspace bindings when the workspace row is deleted', async () => {
    const workspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'transient'))
    const session = await createSession('Workspace delete', workspace.id)

    await dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id))

    const refetched = await agentSessionService.getById(session.id)
    expect(refetched.workspaceId).toBeNull()
    expect(refetched.workspace).toBeNull()
  })

  it('throws when a corrupt session references a missing workspace', async () => {
    await dbh.client.execute('PRAGMA foreign_keys = OFF')
    try {
      await dbh.db.insert(agentSessionTable).values({
        id: 'corrupt-session',
        agentId: 'agent-session-test',
        name: 'Corrupt',
        workspaceId: 'missing-workspace',
        orderKey: 'a0'
      })
    } finally {
      await dbh.client.execute('PRAGMA foreign_keys = ON')
    }

    await expect(agentSessionService.listByCursor()).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('does not leave an orphan default workspace row when session creation fails', async () => {
    await expect(
      agentSessionService.createSession({
        agentId: 'agent-session-test',
        name: null as never
      })
    ).rejects.toThrow()

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
    await expect(readdir(path.join(root, 'Agents'))).resolves.toEqual([])
  })
})
