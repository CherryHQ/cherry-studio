import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest'

describe('AgentSessionService', () => {
  const dbh = setupTestDatabase()
  const root = path.join('/tmp', 'cherry-session-service')

  beforeEach(async () => {
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
  })

  function workspacePath(...segments: string[]) {
    return path.join(root, ...segments)
  }

  async function createWorkspace(name: string) {
    return await agentWorkspaceService.findOrCreateByPath(workspacePath(name))
  }

  async function createSession(name: string, workspaceId?: string) {
    const workspace = workspaceId ? null : await createWorkspace(`${name}-workspace`)
    const result = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name,
        workspaceId: workspaceId ?? workspace?.id
      },
      { id: uuidv4() }
    )
    if (result.needsDefaultWorkspace) {
      throw new Error('Expected session creation to resolve a workspace')
    }
    return await agentSessionService.getById(result.sessionId)
  }

  it('binds a session to an explicit workspace', async () => {
    const workspace = await createWorkspace('explicit')

    const result = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Explicit',
        workspaceId: workspace.id
      },
      { id: 'explicit-session' }
    )

    if (result.needsDefaultWorkspace) {
      throw new Error('Expected explicit workspace creation to resolve a workspace')
    }
    const session = await agentSessionService.getById(result.sessionId)
    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)
  })

  it('inherits the latest sibling workspace when no workspace is provided', async () => {
    const firstWorkspace = await createWorkspace('first')
    const secondWorkspace = await createWorkspace('second')

    await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'First',
        workspaceId: firstWorkspace.id
      },
      { id: 'first-session' }
    )
    await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Second',
        workspaceId: secondWorkspace.id
      },
      { id: 'second-session' }
    )

    const inherited = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Inherited'
      },
      { id: 'inherited-session' }
    )

    if (inherited.needsDefaultWorkspace) {
      throw new Error('Expected sibling workspace to be inherited')
    }
    const session = await agentSessionService.getById(inherited.sessionId)
    expect(session.workspaceId).toBe(secondWorkspace.id)
    expect(session.workspace?.path).toBe(secondWorkspace.path)
  })

  it('signals when a default workspace directory is needed', async () => {
    const result = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Default'
      },
      { id: 'needs-default-session' }
    )

    expect(result).toEqual({
      needsDefaultWorkspace: true,
      usedDefaultWorkspace: false,
      session: null
    })
    const rows = await dbh.db.select().from(agentSessionTable)
    expect(rows).toHaveLength(0)
  })

  it('creates and binds a default workspace row when a prepared path is supplied', async () => {
    const defaultWorkspacePath = workspacePath('prepared-default')

    const result = await agentSessionService.createWithWorkspaceResolution(
      {
        agentId: 'agent-session-test',
        name: 'Default'
      },
      { id: 'default-session', defaultWorkspacePath }
    )

    if (result.needsDefaultWorkspace) {
      throw new Error('Expected prepared default workspace to be consumed')
    }
    const session = await agentSessionService.getById(result.sessionId)
    expect(result.usedDefaultWorkspace).toBe(true)
    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace?.path).toBe(defaultWorkspacePath)
    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
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
    const firstWorkspace = await createWorkspace('before-switch')
    const secondWorkspace = await createWorkspace('after-switch')
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
    const workspace = await createWorkspace('transient')
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
      agentSessionService.createWithWorkspaceResolution(
        {
          agentId: 'agent-session-test',
          name: null as never
        },
        { id: 'invalid-session', defaultWorkspacePath: workspacePath('invalid-default') }
      )
    ).rejects.toThrow()

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
  })
})
