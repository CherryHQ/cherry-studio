import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp } from 'fs/promises'
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

  it('searches sessions as lean navigation items with agent names resolved inline', async () => {
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-search-old',
        agentId: 'agent-session-test',
        name: 'Needle Old Session',
        orderKey: 'a0',
        updatedAt: 100
      },
      {
        id: 'session-search-new',
        agentId: 'agent-session-test',
        name: 'Needle New Session',
        orderKey: 'a1',
        updatedAt: 200
      },
      {
        id: 'session-search-miss',
        agentId: 'agent-session-test',
        name: 'Other Session',
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
  })
})
