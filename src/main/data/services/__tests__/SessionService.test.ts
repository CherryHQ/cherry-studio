import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { pinTable } from '@data/db/schemas/pin'
import { workspaceTable } from '@data/db/schemas/workspace'
import { sessionService } from '@data/services/SessionService'
import { workspaceService } from '@data/services/WorkspaceService'
import { ErrorCode } from '@shared/data/api'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { mkdtemp, stat } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('SessionService', () => {
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
    const dbService = application.get('DbService') as any
    dbService.withWriteTx.mockImplementation((fn: never) => dbh.db.transaction(fn))
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
    const dbService = application.get('DbService') as any
    dbService.withWriteTx.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(dbService.getDb()))
    vi.restoreAllMocks()
  })

  async function createSession(name: string, workspaceId?: string) {
    return await sessionService.createSession({
      agentId: 'agent-session-test',
      name,
      workspaceId
    })
  }

  it('binds a session to an explicit workspace', async () => {
    const workspace = await workspaceService.findOrCreateByPath(path.join(root, 'explicit'))

    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspaceId: workspace.id
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace?.path).toBe(workspace.path)
  })

  it('inherits the latest sibling workspace when no workspace is provided', async () => {
    const firstWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'first'))
    const secondWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'second'))

    await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'First',
      workspaceId: firstWorkspace.id
    })
    await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Second',
      workspaceId: secondWorkspace.id
    })

    const inherited = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Inherited'
    })

    expect(inherited.workspaceId).toBe(secondWorkspace.id)
    expect(inherited.workspace?.path).toBe(secondWorkspace.path)
  })

  it('creates and binds a default workspace when none can be inherited', async () => {
    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Default'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace?.path).toBeTruthy()
    const rows = await dbh.db.select().from(workspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
  })

  it('creates and binds a system workspace for explicit no-project sessions', async () => {
    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace).toMatchObject({ type: 'system' })
    expect(session.workspace?.path).toContain(path.join('Agents', 'system'))
    await expect(stat(session.workspace!.path)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(workspaceService.list()).resolves.toEqual([])
  })

  it('rejects system workspace mode combined with an explicit workspace id', async () => {
    const workspace = await workspaceService.findOrCreateByPath(path.join(root, 'explicit'))

    await expect(
      sessionService.createSession({
        agentId: 'agent-session-test',
        name: 'Invalid',
        workspaceId: workspace.id,
        workspaceMode: 'system'
      })
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR })
  })

  it('does not inherit a system workspace when legacy callers omit workspace options', async () => {
    const systemSession = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'No project',
      workspaceMode: 'system'
    })

    const inherited = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Legacy default'
    })

    expect(inherited.workspaceId).not.toBe(systemSession.workspaceId)
    expect(inherited.workspace).toMatchObject({ type: 'user' })
  })

  it('returns migrated sessions without a workspace binding', async () => {
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-without-workspace',
      agentId: 'agent-session-test',
      name: 'Migrated',
      orderKey: 'a0'
    })

    const session = await sessionService.getById('session-without-workspace')

    expect(session.workspaceId).toBeNull()
    expect(session.workspace).toBeNull()
  })

  it('throws not found for missing sessions', async () => {
    await expect(sessionService.getById('missing-session')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('updates a session and returns the updated entity', async () => {
    const session = await createSession('Before update')

    const updated = await sessionService.update(session.id, {
      name: 'After update',
      description: 'Updated description'
    })

    expect(updated).toMatchObject({
      id: session.id,
      name: 'After update',
      description: 'Updated description'
    })
  })

  it('updates a session workspace', async () => {
    const firstWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'before-switch'))
    const secondWorkspace = await workspaceService.findOrCreateByPath(path.join(root, 'after-switch'))
    const session = await createSession('Workspace switch', firstWorkspace.id)

    const updated = await sessionService.update(session.id, {
      workspaceId: secondWorkspace.id
    })

    expect(updated.workspaceId).toBe(secondWorkspace.id)
    expect(updated.workspace?.path).toBe(secondWorkspace.path)
  })

  it('rejects missing workspace updates', async () => {
    const session = await createSession('Missing workspace update')

    await expect(sessionService.update(session.id, { workspaceId: 'missing-workspace' })).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes a session', async () => {
    const session = await createSession('Delete me')

    await sessionService.delete(session.id)

    await expect(sessionService.getById(session.id)).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes the system workspace directory when deleting a no-project session', async () => {
    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Delete system workspace',
      workspaceMode: 'system'
    })
    const workspacePath = session.workspace!.path

    await sessionService.delete(session.id)

    await expect(sessionService.getById(session.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('keeps the session delete result consistent when post-commit system directory cleanup fails', async () => {
    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Cleanup failure',
      workspaceMode: 'system'
    })
    const workspacePath = session.workspace!.path
    vi.spyOn(workspaceService, 'deleteSystemWorkspaceDirectory').mockImplementation(() => {
      throw new Error('rm failed')
    })

    await expect(sessionService.delete(session.id)).resolves.toBeUndefined()

    await expect(sessionService.getById(session.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    const rows = await dbh.db.select().from(workspaceTable)
    expect(rows).toHaveLength(0)
    await expect(stat(workspacePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
  })

  it('deletes sessions for one agent without deleting the agent', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'other-agent',
      type: 'claude-code',
      name: 'Other Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'a1'
    })
    const first = await createSession('First')
    const second = await createSession('Second')
    const other = await sessionService.createSession({
      agentId: 'other-agent',
      name: 'Other'
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-first',
      entityType: 'session',
      entityId: first.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    const result = await sessionService.deleteByAgentId('agent-session-test')

    expect(result).toEqual({ deletedIds: expect.arrayContaining([first.id, second.id]), deletedCount: 2 })
    await expect(sessionService.getById(first.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(sessionService.getById(second.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(sessionService.getById(other.id)).resolves.toMatchObject({ id: other.id })
    expect(await dbh.db.select().from(agentTable)).toHaveLength(2)
    expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
  })

  it('returns an empty result for an active agent with no sessions', async () => {
    await expect(sessionService.deleteByAgentId('agent-session-test')).resolves.toEqual({
      deletedIds: [],
      deletedCount: 0
    })
  })

  it('throws not found when deleting sessions for a missing agent', async () => {
    await expect(sessionService.deleteByAgentId('missing-agent')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('throws not found when deleting sessions for a soft-deleted agent', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'soft-deleted-agent',
      type: 'claude-code',
      name: 'Soft Deleted Agent',
      instructions: 'Test instructions',
      model: null,
      orderKey: 'z0',
      deletedAt: 1
    })
    await dbh.db.insert(agentSessionTable).values({
      id: 'soft-deleted-agent-session',
      agentId: 'soft-deleted-agent',
      name: 'Should remain',
      orderKey: 'a0'
    })

    await expect(sessionService.deleteByAgentId('soft-deleted-agent')).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })

    const [session] = await dbh.db
      .select({ id: agentSessionTable.id })
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, 'soft-deleted-agent-session'))
    expect(session).toEqual({ id: 'soft-deleted-agent-session' })
  })

  it('deletes selected sessions by ids', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')
    await dbh.db.insert(pinTable).values({
      id: 'pin-second',
      entityType: 'session',
      entityId: second.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    const result = await sessionService.deleteByIds([first.id, second.id])

    expect(result).toEqual({ deletedIds: expect.arrayContaining([first.id, second.id]), deletedCount: 2 })
    await expect(sessionService.getById(first.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(sessionService.getById(second.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(sessionService.getById(third.id)).resolves.toMatchObject({ id: third.id })
    expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
  })

  it('throws not found when deleting selected sessions with a missing id', async () => {
    const first = await createSession('First')

    await expect(sessionService.deleteByIds([first.id, 'missing-session'])).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })

    await expect(sessionService.getById(first.id)).resolves.toMatchObject({ id: first.id })
  })

  it('deletes selected system workspace sessions and their workspace directories by ids', async () => {
    const systemSession = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Bulk system workspace',
      workspaceMode: 'system'
    })
    const normalSession = await createSession('Normal session')
    const workspacePath = systemSession.workspace!.path

    const result = await sessionService.deleteByIds([systemSession.id])

    expect(result).toEqual({ deletedIds: [systemSession.id], deletedCount: 1 })
    await expect(sessionService.getById(systemSession.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    await expect(sessionService.getById(normalSession.id)).resolves.toMatchObject({ id: normalSession.id })
    expect(await dbh.db.select().from(workspaceTable)).toHaveLength(1)
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('deletes system workspace directories when deleting agent sessions', async () => {
    const session = await sessionService.createSession({
      agentId: 'agent-session-test',
      name: 'Agent system workspace',
      workspaceMode: 'system'
    })
    const workspacePath = session.workspace!.path

    const result = await sessionService.deleteByAgentId('agent-session-test')

    expect(result).toEqual({ deletedIds: [session.id], deletedCount: 1 })
    await expect(sessionService.getById(session.id)).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(await dbh.db.select().from(workspaceTable)).toHaveLength(0)
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('reorders sessions with single and batch moves', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')

    await sessionService.reorder(first.id, { position: 'first' })
    let list = await sessionService.listByCursor()
    expect(list.items.map((item) => item.id)).toEqual([first.id, third.id, second.id])

    await sessionService.reorderBatch([
      { id: second.id, anchor: { before: first.id } },
      { id: third.id, anchor: { position: 'last' } }
    ])
    list = await sessionService.listByCursor()
    expect(list.items.map((item) => item.id)).toEqual([second.id, first.id, third.id])
  })

  it('paginates sessions with a cursor', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')

    const page1 = await sessionService.listByCursor({ limit: 2 })
    expect(page1.items.map((item) => item.id)).toEqual([third.id, second.id])
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await sessionService.listByCursor({ limit: 2, cursor: page1.nextCursor })
    expect(page2.items.map((item) => item.id)).toEqual([first.id])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('searches sessions by name and description', async () => {
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-name-hit',
        agentId: 'agent-session-test',
        name: 'Deploy checklist',
        description: '',
        orderKey: 'a0'
      },
      {
        id: 'session-description-hit',
        agentId: 'agent-session-test',
        name: 'Notes',
        description: 'Incident response drill',
        orderKey: 'a1'
      },
      {
        id: 'session-miss',
        agentId: 'agent-session-test',
        name: 'Backlog',
        description: '',
        orderKey: 'a2'
      }
    ])

    await expect(sessionService.listByCursor({ search: 'Deploy' })).resolves.toMatchObject({
      items: [{ id: 'session-name-hit' }]
    })
    await expect(sessionService.listByCursor({ search: 'response' })).resolves.toMatchObject({
      items: [{ id: 'session-description-hit' }]
    })
  })

  it('treats % and _ in session search as literal characters', async () => {
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-wildcard-literal',
        agentId: 'agent-session-test',
        name: 'Deploy 100%_done',
        description: '',
        orderKey: 'a0'
      },
      {
        id: 'session-wildcard-expanded',
        agentId: 'agent-session-test',
        name: 'Deploy 100xxdone',
        description: '',
        orderKey: 'a1'
      }
    ])

    const result = await sessionService.listByCursor({ search: '100%_' })

    expect(result.items.map((item) => item.id)).toEqual(['session-wildcard-literal'])
  })

  it('lists recent search matches with updatedAtFrom applied in the session service', async () => {
    const cutoff = Date.parse('2026-05-01T00:00:00.000Z')
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-old',
        agentId: 'agent-session-test',
        name: 'Research old',
        orderKey: 'a0',
        updatedAt: cutoff - 1
      },
      {
        id: 'session-newer',
        agentId: 'agent-session-test',
        name: 'Research newer',
        orderKey: 'a1',
        updatedAt: cutoff + 2000
      },
      {
        id: 'session-newest',
        agentId: 'agent-session-test',
        name: 'Research newest',
        orderKey: 'a2',
        updatedAt: cutoff + 3000
      },
      {
        id: 'session-other',
        agentId: 'agent-session-test',
        name: 'Other',
        orderKey: 'a3',
        updatedAt: cutoff + 4000
      }
    ])

    const result = await sessionService.listRecentSearchMatches({
      search: 'Research',
      limit: 10,
      updatedAtFrom: cutoff
    })

    expect(result.map((session) => session.id)).toEqual(['session-newest', 'session-newer'])
  })

  it('clears workspace bindings when the workspace row is deleted', async () => {
    const workspace = await workspaceService.findOrCreateByPath(path.join(root, 'transient'))
    const session = await createSession('Workspace delete', workspace.id)

    await dbh.db.delete(workspaceTable).where(eq(workspaceTable.id, workspace.id))

    const refetched = await sessionService.getById(session.id)
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

    await expect(sessionService.listByCursor()).rejects.toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('does not leave an orphan default workspace row when session creation fails', async () => {
    await expect(
      sessionService.createSession({
        agentId: 'agent-session-test',
        name: null as never
      })
    ).rejects.toThrow()

    const rows = await dbh.db.select().from(workspaceTable)
    expect(rows).toHaveLength(0)
  })
})
