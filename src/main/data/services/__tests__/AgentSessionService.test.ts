import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
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

  async function createWorkspace(name: string): Promise<AgentWorkspaceEntity> {
    return await dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, workspacePath(name)))
  }

  async function createSession(name: string, workspaceId?: string) {
    const workspace = workspaceId ? null : await createWorkspace(`${name}-workspace`)
    return await agentSessionService.create({
      agentId: 'agent-session-test',
      name,
      workspace: { type: 'user', workspaceId: workspaceId ?? workspace!.id }
    })
  }

  it('searches sessions as lean navigation items with agent names resolved inline', async () => {
    const workspace = await createWorkspace('search')
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-search-old',
        agentId: 'agent-session-test',
        name: 'Needle Old Session',
        workspaceId: workspace.id,
        orderKey: 'a0',
        updatedAt: 100
      },
      {
        id: 'session-search-new',
        agentId: 'agent-session-test',
        name: 'Needle New Session',
        workspaceId: workspace.id,
        orderKey: 'a1',
        updatedAt: 200
      },
      {
        id: 'session-search-miss',
        agentId: 'agent-session-test',
        name: 'Other Session',
        workspaceId: workspace.id,
        orderKey: 'a2',
        updatedAt: 300
      }
    ])

    const result = await agentSessionService.search({ q: 'Needle', limit: 5 })

    expect(result).toEqual([
      {
        type: 'session',
        id: 'session-search-new',
        title: 'Needle New Session',
        subtitle: 'Session Test Agent',
        updatedAt: '1970-01-01T00:00:00.200Z',
        target: { sessionId: 'session-search-new', agentId: 'agent-session-test' }
      },
      {
        type: 'session',
        id: 'session-search-old',
        title: 'Needle Old Session',
        subtitle: 'Session Test Agent',
        updatedAt: '1970-01-01T00:00:00.100Z',
        target: { sessionId: 'session-search-old', agentId: 'agent-session-test' }
      }
    ])
    expect(result[0]).not.toHaveProperty('workspace')
  })

  it('binds a session to an explicit workspace', async () => {
    const workspace = await createWorkspace('explicit')

    const session = await agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace.path).toBe(workspace.path)
  })

  it('rejects a user workspace source that points at a system workspace row', async () => {
    const systemWorkspace = await dbh.db.transaction((tx) =>
      agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: 'system-owned-session' })
    )

    await expect(
      agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Invalid user source',
        workspace: { type: 'user', workspaceId: systemWorkspace.id }
      })
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
  })

  it('requires an explicit workspace source', async () => {
    await expect(
      agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Missing workspace'
      } as never)
    ).rejects.toThrow()
  })

  it('does not inherit the latest sibling workspace', async () => {
    const firstWorkspace = await createWorkspace('first')
    const secondWorkspace = await createWorkspace('second')

    await agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'First',
      workspace: { type: 'user', workspaceId: firstWorkspace.id }
    })
    await agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Second',
      workspace: { type: 'user', workspaceId: secondWorkspace.id }
    })

    await expect(
      agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Inherited'
      } as never)
    ).rejects.toThrow()
  })

  it('creates and binds a system workspace row without creating a directory', async () => {
    const session = await agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'System',
      workspace: { type: 'system' }
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace.type).toBe('system')
    expect(session.workspace.path).toBe(path.join(application.getPath('feature.agents.workspaces'), session.id))
    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
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
    expect(updated.workspace.path).toBe(firstWorkspace.path)
  })

  it('deletes a session', async () => {
    const session = await createSession('Delete me')

    await agentSessionService.delete(session.id)

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('leaves a user workspace and sibling sessions intact when deleting one session', async () => {
    const workspace = await createWorkspace('shared-user')
    const first = await createSession('Shared first', workspace.id)
    const second = await createSession('Shared second', workspace.id)

    await agentSessionService.delete(first.id)

    await expect(agentWorkspaceService.getById(workspace.id)).resolves.toMatchObject({
      id: workspace.id,
      type: 'user'
    })
    await expect(agentSessionService.getById(first.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    await expect(agentSessionService.getById(second.id)).resolves.toMatchObject({
      id: second.id,
      workspaceId: workspace.id
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

  it('deletes sessions when a user workspace row is deleted', async () => {
    const workspace = await createWorkspace('transient')
    const session = await createSession('Workspace delete', workspace.id)

    await dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id))

    await expect(agentSessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('treats a corrupt session that references a missing workspace as not found', async () => {
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

    await expect(agentSessionService.getById('corrupt-session')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes a one-to-one system workspace row when deleting its session', async () => {
    const session = await agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'System delete',
      workspace: { type: 'system' }
    })

    await agentSessionService.delete(session.id)

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
  })
})
