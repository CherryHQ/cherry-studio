import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { agentWorkspaceWorkflowService } from '@main/services/agentWorkspace/AgentWorkspaceWorkflowService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

describe('AgentSessionService', () => {
  const dbh = setupTestDatabase()
  let root: string
  let sessionCounter = 0

  beforeEach(async () => {
    root = path.join(tmpdir(), `cherry-session-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    sessionCounter = 0
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

  async function createSession(name: string, workspaceId?: string | null) {
    const id = `session-${++sessionCounter}`
    await application.get('DbService').withWriteTx((tx) =>
      agentSessionService.createTx(tx, {
        id,
        agentId: 'agent-session-test',
        name,
        workspaceId
      })
    )
    return await agentSessionService.getById(id)
  }

  it('signals when a default workspace directory must be prepared', async () => {
    const result = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Needs default'
      },
      { id: 'session-needs-default' }
    )

    expect(result).toEqual({
      needsDefaultWorkspace: true,
      usedDefaultWorkspace: false,
      session: null
    })
    await expect(agentSessionService.getById('session-needs-default')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('creates a session with a prepared default workspace path', async () => {
    const defaultWorkspacePath = path.join(root, 'prepared-default')

    const result = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Default'
      },
      { id: 'session-with-default', defaultWorkspacePath }
    )

    expect(result).toMatchObject({
      needsDefaultWorkspace: false,
      usedDefaultWorkspace: true,
      session: {
        id: 'session-with-default',
        workspace: {
          path: defaultWorkspacePath,
          type: 'user'
        }
      }
    })
  })

  it('finds only the latest user workspace path for an agent', async () => {
    const systemWorkspace = await agentWorkspaceWorkflowService.createSystemWorkspaceForSession('system-session')
    await createSession('No project', systemWorkspace.id)

    await expect(agentSessionService.findAgentWorkspacePath('agent-session-test')).resolves.toBeNull()

    const userWorkspace = await agentWorkspaceService.findOrCreateByPath(path.join(root, 'runtime-user-workspace'))
    await createSession('User workspace', userWorkspace.id)

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

  it('delete wrapper returns a deleted system workspace path', async () => {
    const workspace = await agentWorkspaceService.createPreparedSystemWorkspace({
      path: path.join(root, 'system-workspace-for-delete'),
      label: '2026-05-25 14:30:12'
    })
    const session = await createSession('System delete', workspace.id)

    await expect(agentSessionService.delete(session.id)).resolves.toBe(workspace.path)

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(agentWorkspaceService.getById(workspace.id, { includeSystem: true })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })
})
