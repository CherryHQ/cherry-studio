import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService } from '@data/services/AgentTaskService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { jobScheduleService } from '@data/services/JobScheduleService'
import { pinService } from '@data/services/PinService'
import { ErrorCode } from '@shared/data/api/errors'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { notifyDataApiDataChangeMock } = vi.hoisted(() => ({ notifyDataApiDataChangeMock: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

function buildSystemWorkspacePath(systemWorkspacesRoot: string, sessionId: string, createdAt: number): string {
  return path.join(systemWorkspacesRoot, new Date(createdAt).toISOString().slice(0, 10), sessionId)
}

// The data-service layer is synchronous under better-sqlite3: failing calls
// throw inline instead of rejecting a promise. Capture the thrown error so we
// can assert on its shape.
function captureError(fn: () => unknown): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('Expected the call to throw, but it returned normally')
}

describe('AgentSessionService', () => {
  const dbh = setupTestDatabase()
  const root = path.join('/tmp', 'cherry-session-service')

  beforeEach(async () => {
    ;(application.get('DbService').withWriteTx as Mock).mockImplementation((fn) => dbh.db.transaction(fn as never))
    notifyDataApiDataChangeMock.mockClear()
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
    return dbh.db.transaction((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, workspacePath(name)))
  }

  async function createSession(name: string, workspaceId?: string) {
    const workspace = workspaceId ? null : await createWorkspace(`${name}-workspace`)
    return agentSessionService.create({
      agentId: 'agent-session-test',
      name,
      workspace: { type: 'user', workspaceId: workspaceId ?? workspace!.id }
    })
  }

  async function insertSessionMessage(sessionId: string, id: string) {
    await dbh.db.insert(agentSessionMessageTable).values({
      id,
      sessionId,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'hello' }] },
      searchableText: 'hello',
      status: 'success'
    })
  }

  function createTaskSchedule(agentId = 'agent-session-test') {
    return jobScheduleService.create({
      type: 'agent.task',
      name: `task-${crypto.randomUUID()}`,
      trigger: { kind: 'interval', ms: 60_000 },
      jobInputTemplate: { agentId, prompt: 'test', timeoutMinutes: 0, workspace: { type: 'system' } },
      catchUpPolicy: { kind: 'skip-missed' },
      metadata: { reuse: { enabled: true, revision: 0 } }
    })
  }

  function bindTaskSession(sessionId: string, taskScheduleId: string, agentId = 'agent-session-test'): void {
    dbh.db.transaction((tx) => {
      expect(agentSessionService.bindTaskScheduleTx(tx, { sessionId, taskScheduleId, expectedAgentId: agentId })).toBe(
        true
      )
    })
  }

  it('orders matching sessions and exposes timestamps by conversation activity', async () => {
    const workspace = await createWorkspace('search')
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-search-old',
        agentId: 'agent-session-test',
        name: 'Needle Old Session',
        workspaceId: workspace.id,
        orderKey: 'a0',
        lastActivityAt: 100,
        updatedAt: 300
      },
      {
        id: 'session-search-new',
        agentId: 'agent-session-test',
        name: 'Needle New Session',
        workspaceId: workspace.id,
        orderKey: 'a1',
        lastActivityAt: 200,
        updatedAt: 100
      },
      {
        id: 'session-search-miss',
        agentId: 'agent-session-test',
        name: 'Other Session',
        workspaceId: workspace.id,
        orderKey: 'a2',
        lastActivityAt: 300,
        updatedAt: 300
      }
    ])

    const result = agentSessionService.search({ q: 'Needle', limit: 5 })

    expect(result).toEqual([
      {
        type: 'session',
        id: 'session-search-new',
        title: 'Needle New Session',
        subtitle: 'Session Test Agent',
        lastActivityAt: '1970-01-01T00:00:00.200Z',
        target: { sessionId: 'session-search-new', agentId: 'agent-session-test' }
      },
      {
        type: 'session',
        id: 'session-search-old',
        title: 'Needle Old Session',
        subtitle: 'Session Test Agent',
        lastActivityAt: '1970-01-01T00:00:00.100Z',
        target: { sessionId: 'session-search-old', agentId: 'agent-session-test' }
      }
    ])
    expect(result[0]).not.toHaveProperty('workspace')
  })

  describe('getLatestActive', () => {
    it('returns the globally most-recently-active session, independent of orderKey and updatedAt', async () => {
      const workspace = await createWorkspace('latest')
      // `active-latest` has the largest orderKey (oldest-created → last under `orderKey ASC` paging) yet
      // the highest lastActivityAt despite an older updatedAt, proving activity drives this query.
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'created-newest',
          agentId: 'agent-session-test',
          name: 'A',
          workspaceId: workspace.id,
          orderKey: 'a0',
          lastActivityAt: 100,
          updatedAt: 300
        },
        {
          id: 'mid',
          agentId: 'agent-session-test',
          name: 'B',
          workspaceId: workspace.id,
          orderKey: 'a1',
          lastActivityAt: 200,
          updatedAt: 200
        },
        {
          id: 'active-latest',
          agentId: 'agent-session-test',
          name: 'C',
          workspaceId: workspace.id,
          orderKey: 'a2',
          lastActivityAt: 300,
          updatedAt: 100
        }
      ])

      const latest = agentSessionService.getLatestActive()
      expect(latest?.id).toBe('active-latest')
      // Fully hydrated (workspace joined), matching getById.
      expect(latest?.workspace.id).toBe(workspace.id)
    })

    it('returns latest activity within a live or unlinked agent scope', async () => {
      const workspace = await createWorkspace('latest-owner-scope')
      await dbh.db.insert(agentTable).values([
        {
          id: 'agent-other-scope',
          type: 'claude-code',
          name: 'Other Agent',
          instructions: 'Other instructions',
          model: null,
          orderKey: 'a1'
        },
        {
          id: 'agent-deleted-scope',
          type: 'claude-code',
          name: 'Deleted Agent',
          instructions: 'Deleted instructions',
          model: null,
          orderKey: 'a2',
          deletedAt: 100
        }
      ])
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'session-scoped',
          agentId: 'agent-session-test',
          name: 'Scoped',
          workspaceId: workspace.id,
          orderKey: 'a0',
          lastActivityAt: 100
        },
        {
          id: 'session-other',
          agentId: 'agent-other-scope',
          name: 'Other',
          workspaceId: workspace.id,
          orderKey: 'a1',
          lastActivityAt: 500
        },
        {
          id: 'session-unassigned',
          agentId: null,
          name: 'Unassigned',
          workspaceId: workspace.id,
          orderKey: 'a2',
          lastActivityAt: 200
        },
        {
          id: 'session-deleted-owner',
          agentId: 'agent-deleted-scope',
          name: 'Deleted owner',
          workspaceId: workspace.id,
          orderKey: 'a3',
          lastActivityAt: 300
        }
      ])

      expect(agentSessionService.getLatestActive({ agentId: 'agent-session-test' })?.id).toBe('session-scoped')
      expect(agentSessionService.getLatestActive({ agentId: 'unlinked' })?.id).toBe('session-deleted-owner')
    })

    it('does not treat task relation changes as session activity', async () => {
      const workspace = await createWorkspace('relation-recency')
      const task = createTaskSchedule()
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'bound-older',
          agentId: 'agent-session-test',
          name: 'Bound older',
          workspaceId: workspace.id,
          orderKey: 'a0',
          lastActivityAt: 100,
          updatedAt: 100
        },
        {
          id: 'actually-latest',
          agentId: 'agent-session-test',
          name: 'Actually latest',
          workspaceId: workspace.id,
          orderKey: 'a1',
          lastActivityAt: 200,
          updatedAt: 200
        }
      ])

      bindTaskSession('bound-older', task.id)

      expect(agentSessionService.getById('bound-older').updatedAt).toBe('1970-01-01T00:00:00.100Z')
      expect(agentSessionService.getLatestActive()?.id).toBe('actually-latest')

      dbh.db.transaction((tx) => agentSessionService.clearTaskScheduleTx(tx, task.id))

      expect(agentSessionService.getById('bound-older').updatedAt).toBe('1970-01-01T00:00:00.100Z')
      expect(agentSessionService.getLatestActive()?.id).toBe('actually-latest')
    })

    it('returns null when there are no sessions', () => {
      expect(agentSessionService.getLatestActive()).toBeNull()
    })
  })

  describe('reuseOrCreatePlaceholder', () => {
    it('filters by exact workspace and message emptiness, ordered by updatedAt', async () => {
      const userWorkspace = await createWorkspace('reusable-user')
      await dbh.db.insert(agentWorkspaceTable).values({
        id: 'reusable-system-workspace',
        name: 'System',
        path: workspacePath('reusable-system'),
        type: 'system',
        orderKey: 'a1'
      })
      await dbh.db.insert(agentWorkspaceTable).values({
        id: 'reusable-system-workspace-old',
        name: 'System old',
        path: workspacePath('reusable-system-old'),
        type: 'system',
        orderKey: 'a2'
      })
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'user-created-later',
          agentId: 'agent-session-test',
          name: '',
          workspaceId: userWorkspace.id,
          orderKey: 'a0',
          createdAt: 300,
          updatedAt: 200
        },
        {
          id: 'user-updated-later',
          agentId: 'agent-session-test',
          name: '  ',
          workspaceId: userWorkspace.id,
          orderKey: 'a1',
          createdAt: 100,
          updatedAt: 400
        },
        {
          id: 'user-with-message',
          agentId: 'agent-session-test',
          name: '',
          workspaceId: userWorkspace.id,
          orderKey: 'a2',
          updatedAt: 900
        },
        {
          id: 'system-empty',
          agentId: 'agent-session-test',
          name: '',
          workspaceId: 'reusable-system-workspace',
          orderKey: 'a3',
          updatedAt: 800
        },
        {
          id: 'system-empty-old',
          agentId: 'agent-session-test',
          name: '',
          workspaceId: 'reusable-system-workspace-old',
          orderKey: 'a4',
          updatedAt: 600
        },
        {
          id: 'manually-named',
          agentId: 'agent-session-test',
          name: '',
          isNameManuallyEdited: true,
          workspaceId: userWorkspace.id,
          orderKey: 'a5',
          updatedAt: 700
        }
      ])
      await insertSessionMessage('user-with-message', 'message-prevents-reuse')

      expect(
        agentSessionService.reuseOrCreatePlaceholder({
          agentId: 'agent-session-test',
          workspace: { type: 'user', workspaceId: userWorkspace.id }
        })
      ).toMatchObject({ session: { id: 'user-updated-later' }, created: false, deletedDuplicateSessionIds: [] })
      expect(
        agentSessionService.reuseOrCreatePlaceholder({
          agentId: 'agent-session-test',
          workspace: { type: 'system' }
        })
      ).toMatchObject({
        session: { id: 'system-empty' },
        created: false,
        deletedDuplicateSessionIds: ['system-empty-old']
      })
      expect(() => agentSessionService.getById('system-empty-old')).toThrow()
    })

    it('creates at most one reusable placeholder for repeated exact targets', async () => {
      const userWorkspace = await createWorkspace('create-reusable-user')

      const first = agentSessionService.reuseOrCreatePlaceholder({
        agentId: 'agent-session-test',
        workspace: { type: 'user', workspaceId: userWorkspace.id }
      })
      const second = agentSessionService.reuseOrCreatePlaceholder({
        agentId: 'agent-session-test',
        workspace: { type: 'user', workspaceId: userWorkspace.id }
      })

      expect(first.created).toBe(true)
      expect(second).toMatchObject({
        session: { id: first.session.id },
        created: false,
        deletedDuplicateSessionIds: []
      })
    })

    it('publishes pin membership after deleting a pinned system placeholder duplicate', async () => {
      const retained = agentSessionService.create({
        agentId: 'agent-session-test',
        name: '',
        workspace: { type: 'system' }
      })
      const duplicate = agentSessionService.create({
        agentId: 'agent-session-test',
        name: '',
        workspace: { type: 'system' }
      })
      await dbh.db.update(agentSessionTable).set({ updatedAt: 200 }).where(eq(agentSessionTable.id, retained.id))
      await dbh.db.update(agentSessionTable).set({ updatedAt: 100 }).where(eq(agentSessionTable.id, duplicate.id))
      pinService.pin({ entityType: 'session', entityId: duplicate.id })
      notifyDataApiDataChangeMock.mockClear()

      const result = agentSessionService.reuseOrCreatePlaceholder({
        agentId: 'agent-session-test',
        workspace: { type: 'system' }
      })

      expect(result).toMatchObject({
        session: { id: retained.id },
        created: false,
        deletedDuplicateSessionIds: [duplicate.id]
      })
      expect(await dbh.db.select().from(pinTable).where(eq(pinTable.entityId, duplicate.id))).toHaveLength(0)
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(1, [
        { endpoint: '/agent-sessions', kind: 'membership', entityIds: [duplicate.id] },
        { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [duplicate.id] },
        { endpoint: '/agent-sessions/:sessionId', entityIds: [duplicate.id] },
        { endpoint: '/agent-sessions/latest' }
      ])
      expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(2, [{ endpoint: '/pins', kind: 'membership' }])
      expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('touchUpdatedAtTx', () => {
    it('bumps only the target session updatedAt', async () => {
      const workspace = await createWorkspace('touch')
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'touched',
          agentId: 'agent-session-test',
          name: 'A',
          workspaceId: workspace.id,
          orderKey: 'a0',
          updatedAt: 100
        },
        {
          id: 'untouched',
          agentId: 'agent-session-test',
          name: 'B',
          workspaceId: workspace.id,
          orderKey: 'a1',
          updatedAt: 100
        }
      ])

      dbh.db.transaction((tx) => agentSessionService.touchUpdatedAtTx(tx, 'touched', 999))

      const rows = await dbh.db.select().from(agentSessionTable)
      const byId = new Map(rows.map((row) => [row.id, row.updatedAt]))
      expect(byId.get('touched')).toBe(999)
      expect(byId.get('untouched')).toBe(100)
    })
  })

  it('keeps audit and activity timestamps unchanged for an older activity signal', async () => {
    const workspace = await createWorkspace('stale-activity')
    await dbh.db.insert(agentSessionTable).values({
      id: 'session-stale-activity',
      agentId: 'agent-session-test',
      name: 'Stale activity',
      workspaceId: workspace.id,
      orderKey: 'a0',
      lastActivityAt: 500,
      createdAt: 100,
      updatedAt: 700
    })

    dbh.db.transaction((tx) => agentSessionService.advanceLastActivityAtTx(tx, 'session-stale-activity', 400))

    const [row] = await dbh.db
      .select()
      .from(agentSessionTable)
      .where(eq(agentSessionTable.id, 'session-stale-activity'))
    expect(row).toMatchObject({ lastActivityAt: 500, updatedAt: 700 })
  })

  it('binds a session to an explicit workspace', async () => {
    const workspace = await createWorkspace('explicit')
    notifyDataApiDataChangeMock.mockClear()

    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/agent-sessions', kind: 'membership', entityIds: [session.id] },
      { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [session.id] },
      { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] },
      { endpoint: '/agent-sessions/latest' }
    ])
    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace.path).toBe(workspace.path)
    expect(session.isNameManuallyEdited).toBe(false)
  })

  it('rejects a user workspace source that points at a system workspace row', async () => {
    const systemWorkspace = dbh.db.transaction((tx) =>
      agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, {
        sessionId: 'system-owned-session',
        createdAt: Date.parse('2026-07-27T10:00:00Z')
      })
    )

    expect(
      captureError(() =>
        agentSessionService.create({
          agentId: 'agent-session-test',
          name: 'Invalid user source',
          workspace: { type: 'user', workspaceId: systemWorkspace.id }
        })
      )
    ).toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })
  })

  it('requires an explicit workspace source', async () => {
    expect(() =>
      agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Missing workspace'
      } as never)
    ).toThrow()
  })

  it('does not inherit the latest sibling workspace', async () => {
    const firstWorkspace = await createWorkspace('first')
    const secondWorkspace = await createWorkspace('second')

    agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'First',
      workspace: { type: 'user', workspaceId: firstWorkspace.id }
    })
    agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Second',
      workspace: { type: 'user', workspaceId: secondWorkspace.id }
    })

    expect(() =>
      agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Inherited'
      } as never)
    ).toThrow()
  })

  it('creates and binds a system workspace row without creating a directory', async () => {
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'System',
      workspace: { type: 'system' }
    })

    expect(session.workspaceId).toBeTruthy()
    expect(session.workspace.type).toBe('system')
    expect(session.workspace.path).toBe(
      buildSystemWorkspacePath(
        application.getPath('feature.agents.system_workspaces'),
        session.id,
        Date.parse(session.createdAt)
      )
    )
    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(session.workspaceId)
  })

  it('throws not found for missing sessions', async () => {
    expect(captureError(() => agentSessionService.getById('missing-session'))).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('creates and reuses a session-level trace id', async () => {
    const session = await createSession('Trace')
    expect(session.traceId ?? null).toBeNull()

    const traceId = agentSessionService.ensureTraceId(session.id)

    expect(traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(agentSessionService.ensureTraceId(session.id)).toBe(traceId)
    expect(agentSessionService.getById(session.id).traceId).toBe(traceId)
  })

  it('updates a session and returns the updated entity', async () => {
    const session = await createSession('Before update')
    notifyDataApiDataChangeMock.mockClear()

    const updated = agentSessionService.update(session.id, {
      name: 'After update',
      description: 'Updated description',
      isNameManuallyEdited: true
    })
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/agent-sessions', kind: 'projection', entityIds: [session.id] },
      { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [session.id] },
      { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] },
      { endpoint: '/agent-sessions/latest' }
    ])

    expect(updated).toMatchObject({
      id: session.id,
      name: 'After update',
      description: 'Updated description',
      isNameManuallyEdited: true
    })
  })

  it('treats name-only updates as manual session renames', async () => {
    const session = await createSession('Before name-only update')

    const updated = agentSessionService.update(session.id, {
      name: 'Manual name'
    })

    expect(updated).toMatchObject({
      id: session.id,
      name: 'Manual name',
      isNameManuallyEdited: true
    })
  })

  it('preserves explicit automatic session renames', async () => {
    const session = await createSession('Before automatic update')

    const updated = agentSessionService.update(session.id, {
      name: 'Automatic name',
      isNameManuallyEdited: false
    })

    expect(updated).toMatchObject({
      id: session.id,
      name: 'Automatic name',
      isNameManuallyEdited: false
    })
  })

  it('updates an empty session workspace', async () => {
    const firstWorkspace = await createWorkspace('before-switch')
    const secondWorkspace = await createWorkspace('after-switch')
    const session = await createSession('Workspace switch', firstWorkspace.id)

    const updated = agentSessionService.setWorkspace(session.id, {
      type: 'user',
      workspaceId: secondWorkspace.id
    })

    expect(updated.workspaceId).toBe(secondWorkspace.id)
    expect(updated.workspace.path).toBe(secondWorkspace.path)
  })

  it('deletes the previous system workspace row when switching to a user workspace', async () => {
    const userWorkspace = await createWorkspace('system-to-user')
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'System to user',
      workspace: { type: 'system' }
    })
    const previousSystemWorkspaceId = session.workspaceId

    const updated = agentSessionService.setWorkspace(session.id, {
      type: 'user',
      workspaceId: userWorkspace.id
    })

    expect(updated.workspaceId).toBe(userWorkspace.id)
    expect(updated.workspace.type).toBe('user')
    const previousSystemRows = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, previousSystemWorkspaceId))
    expect(previousSystemRows).toHaveLength(0)
  })

  it('creates a new system workspace row when switching from a user workspace', async () => {
    const userWorkspace = await createWorkspace('user-to-system')
    const session = await createSession('User to system', userWorkspace.id)

    const updated = agentSessionService.setWorkspace(session.id, { type: 'system' })

    expect(updated.workspaceId).not.toBe(userWorkspace.id)
    expect(updated.workspace.type).toBe('system')
    expect(updated.workspace.path).toBe(
      buildSystemWorkspacePath(
        application.getPath('feature.agents.system_workspaces'),
        session.id,
        Date.parse(session.createdAt)
      )
    )
    const [systemWorkspaceRow] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, updated.workspaceId))
    expect(systemWorkspaceRow).toMatchObject({
      id: updated.workspaceId,
      type: 'system'
    })
    expect(agentWorkspaceService.getById(userWorkspace.id)).toMatchObject({
      id: userWorkspace.id,
      type: 'user'
    })
  })

  it('keeps the system workspace path stable across a cross-day system to user to system switch', async () => {
    const firstDay = Date.parse('2026-07-27T10:00:00Z')
    const secondDay = Date.parse('2026-07-28T10:00:00Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(firstDay)

    try {
      const userWorkspace = await createWorkspace('cross-day-system-roundtrip')
      const session = agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Cross-day system roundtrip',
        workspace: { type: 'system' }
      })
      const originalSystemPath = session.workspace.path

      agentSessionService.setWorkspace(session.id, {
        type: 'user',
        workspaceId: userWorkspace.id
      })
      now.mockReturnValue(secondDay)
      const restored = agentSessionService.setWorkspace(session.id, { type: 'system' })

      expect(restored.workspace.path).toBe(originalSystemPath)
      expect(restored.workspace.path).toBe(
        buildSystemWorkspacePath(application.getPath('feature.agents.system_workspaces'), session.id, firstDay)
      )
    } finally {
      now.mockRestore()
    }
  })

  it('keeps the system workspace path stable across a timezone change', async () => {
    const createdAt = Date.parse('2026-07-27T00:30:00Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(createdAt)
    const originalTimezone = process.env.TZ

    try {
      process.env.TZ = 'UTC'
      const userWorkspace = await createWorkspace('cross-timezone-system-roundtrip')
      const session = agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'Cross-timezone system roundtrip',
        workspace: { type: 'system' }
      })
      const originalSystemPath = session.workspace.path

      agentSessionService.setWorkspace(session.id, {
        type: 'user',
        workspaceId: userWorkspace.id
      })
      process.env.TZ = 'America/Los_Angeles'
      const restored = agentSessionService.setWorkspace(session.id, { type: 'system' })

      expect(restored.workspace.path).toBe(originalSystemPath)
      expect(restored.workspace.path).toBe(
        path.join(application.getPath('feature.agents.system_workspaces'), '2026-07-27', session.id)
      )
    } finally {
      now.mockRestore()
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
    }
  })

  it('is a no-op when re-setting an empty system session to a system workspace', async () => {
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'System to system',
      workspace: { type: 'system' }
    })
    const originalSystemWorkspaceId = session.workspaceId

    const updated = agentSessionService.setWorkspace(session.id, { type: 'system' })

    // Idempotent: the existing system workspace is already correct, so the binding must not change
    // and no second system workspace row may be created (which would repoint the session and leak
    // the original row + its directory).
    expect(updated.workspaceId).toBe(originalSystemWorkspaceId)
    expect(updated.workspace.type).toBe('system')
    const allWorkspaceRows = await dbh.db.select().from(agentWorkspaceTable)
    expect(allWorkspaceRows).toHaveLength(1)
    expect(allWorkspaceRows[0]?.id).toBe(originalSystemWorkspaceId)
  })

  it('rejects workspace updates after messages are sent', async () => {
    const firstWorkspace = await createWorkspace('before-locked-switch')
    const secondWorkspace = await createWorkspace('after-locked-switch')
    const session = await createSession('Locked workspace switch', firstWorkspace.id)
    await insertSessionMessage(session.id, 'message-locks-workspace')

    expect(
      captureError(() =>
        agentSessionService.setWorkspace(session.id, {
          type: 'user',
          workspaceId: secondWorkspace.id
        })
      )
    ).toMatchObject({ code: ErrorCode.INVALID_OPERATION })

    expect(agentSessionService.getById(session.id)).toMatchObject({
      workspaceId: firstWorkspace.id
    })
  })

  it('rejects switching a messaged system workspace session to a user workspace', async () => {
    const userWorkspace = await createWorkspace('locked-system-to-user')
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Locked system workspace',
      workspace: { type: 'system' }
    })
    await insertSessionMessage(session.id, 'message-locks-system-to-user')

    expect(
      captureError(() =>
        agentSessionService.setWorkspace(session.id, {
          type: 'user',
          workspaceId: userWorkspace.id
        })
      )
    ).toMatchObject({ code: ErrorCode.INVALID_OPERATION })

    expect(agentSessionService.getById(session.id)).toMatchObject({
      workspaceId: session.workspaceId,
      workspace: { type: 'system' }
    })
    const [systemWorkspaceRow] = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, session.workspaceId))
    expect(systemWorkspaceRow).toMatchObject({
      id: session.workspaceId,
      type: 'system'
    })
  })

  it('rejects switching a messaged user workspace session to a system workspace', async () => {
    const userWorkspace = await createWorkspace('locked-user-to-system')
    const session = await createSession('Locked user workspace', userWorkspace.id)
    await insertSessionMessage(session.id, 'message-locks-user-to-system')

    expect(captureError(() => agentSessionService.setWorkspace(session.id, { type: 'system' }))).toMatchObject({
      code: ErrorCode.INVALID_OPERATION
    })

    expect(agentSessionService.getById(session.id)).toMatchObject({
      workspaceId: userWorkspace.id,
      workspace: { type: 'user' }
    })
    const systemWorkspaceRows = await dbh.db
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.type, 'system'))
    expect(systemWorkspaceRows).toHaveLength(0)
  })

  it('deletes a session', async () => {
    const session = await createSession('Delete me')
    notifyDataApiDataChangeMock.mockClear()

    agentSessionService.delete(session.id)

    expect(captureError(() => agentSessionService.getById(session.id))).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(1, [
      { endpoint: '/agent-sessions', kind: 'membership', entityIds: [session.id] },
      { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [session.id] },
      { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] },
      { endpoint: '/agent-sessions/latest' }
    ])
    expect(notifyDataApiDataChangeMock).toHaveBeenNthCalledWith(2, [{ endpoint: '/pins', kind: 'membership' }])
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledTimes(2)
  })

  it('clears a paused task projection immediately when its bound session is deleted', async () => {
    const task = createTaskSchedule()
    jobScheduleService.setEnabled(task.id, false)
    const session = await createSession('Bound paused task')
    bindTaskSession(session.id, task.id)

    expect(agentTaskService.getTaskById(task.id)).toMatchObject({
      reuseSessionId: session.id,
      status: 'paused',
      nextRun: null
    })

    agentSessionService.delete(session.id)

    expect(agentTaskService.getTaskById(task.id)).toMatchObject({
      reuseSessionId: null,
      status: 'paused',
      nextRun: null
    })
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      { endpoint: '/agent-tasks', kind: 'projection', entityIds: [task.id] },
      { endpoint: '/agents/:agentId/tasks', kind: 'projection', entityIds: [task.id] },
      { endpoint: '/agent-tasks/:taskId', entityIds: [task.id] },
      { endpoint: '/agents/:agentId/tasks/:taskId', entityIds: [task.id] }
    ])
  })

  it('binds only an existing session owned by the expected agent and keeps the internal column private', async () => {
    const task = createTaskSchedule()
    const session = await createSession('Validated task binding')

    expect(
      dbh.db.transaction((tx) =>
        agentSessionService.bindTaskScheduleTx(tx, {
          sessionId: session.id,
          taskScheduleId: task.id,
          expectedAgentId: 'other-agent'
        })
      )
    ).toBe(false)
    expect(
      captureError(() =>
        dbh.db.transaction((tx) =>
          agentSessionService.bindTaskScheduleTx(tx, {
            sessionId: 'missing-session',
            taskScheduleId: task.id,
            expectedAgentId: 'agent-session-test'
          })
        )
      )
    ).toMatchObject({ code: ErrorCode.NOT_FOUND })

    bindTaskSession(session.id, task.id)
    expect(
      dbh.db.transaction((tx) =>
        agentSessionService.bindTaskScheduleTx(tx, {
          sessionId: session.id,
          taskScheduleId: task.id,
          expectedAgentId: 'agent-session-test'
        })
      )
    ).toBe(false)
    expect(agentSessionService.getById(session.id)).not.toHaveProperty('taskScheduleId')
  })

  it('clears the task relation atomically when a session is reassigned', async () => {
    await dbh.db.insert(agentTable).values({
      id: 'agent-session-reassigned',
      type: 'claude-code',
      name: 'Reassigned Agent',
      instructions: '',
      orderKey: 'z0'
    })
    const task = createTaskSchedule()
    const session = await createSession('Bound reassigned task')
    bindTaskSession(session.id, task.id)
    notifyDataApiDataChangeMock.mockClear()

    agentSessionService.update(session.id, { agentId: 'agent-session-reassigned' })

    expect(agentTaskService.getTaskById(task.id)?.reuseSessionId).toBeNull()
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledWith([
      { endpoint: '/agent-sessions', kind: 'projection', entityIds: [session.id] },
      { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: [session.id] },
      { endpoint: '/agent-sessions/:sessionId', entityIds: [session.id] },
      { endpoint: '/agent-sessions/latest' }
    ])
  })

  it('keeps a binding and emits nothing when an outer transaction rolls back session deletion', async () => {
    const task = createTaskSchedule()
    const session = await createSession('Rollback bound task')
    bindTaskSession(session.id, task.id)
    notifyDataApiDataChangeMock.mockClear()

    expect(() =>
      dbh.db.transaction((tx) => {
        agentSessionService.deleteTx(tx, session.id)
        throw new Error('rollback')
      })
    ).toThrow('rollback')

    expect(agentTaskService.getTaskById(task.id)?.reuseSessionId).toBe(session.id)
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('clears bindings for bulk, workspace, and agent session deletion paths', async () => {
    const bulkTask = createTaskSchedule()
    const bulkSession = await createSession('Bulk bound task')
    bindTaskSession(bulkSession.id, bulkTask.id)
    agentSessionService.deleteByIds([bulkSession.id])

    const workspace = await createWorkspace('workspace-bound-task')
    const workspaceTask = createTaskSchedule()
    const workspaceSession = await createSession('Workspace bound task', workspace.id)
    bindTaskSession(workspaceSession.id, workspaceTask.id)
    agentSessionService.deleteWorkspaceCascade(workspace.id)

    const agentTask = createTaskSchedule()
    const agentSession = await createSession('Agent bound task')
    bindTaskSession(agentSession.id, agentTask.id)
    agentSessionService.deleteByAgentId('agent-session-test')

    expect(agentTaskService.getTaskById(bulkTask.id)?.reuseSessionId).toBeNull()
    expect(agentTaskService.getTaskById(workspaceTask.id)?.reuseSessionId).toBeNull()
    expect(agentTaskService.getTaskById(agentTask.id)?.reuseSessionId).toBeNull()
  })

  it('sets the internal relation null when its task schedule is deleted', async () => {
    const task = createTaskSchedule()
    const session = await createSession('Task deletion FK')
    bindTaskSession(session.id, task.id)

    jobScheduleService.delete(task.id)

    expect(agentSessionService.getByTaskScheduleId(task.id)).toBeNull()
    expect(agentSessionService.getById(session.id)).toMatchObject({ id: session.id })
  })

  it('leaves a user workspace and sibling sessions intact when deleting one session', async () => {
    const workspace = await createWorkspace('shared-user')
    const first = await createSession('Shared first', workspace.id)
    const second = await createSession('Shared second', workspace.id)

    agentSessionService.delete(first.id)

    expect(agentWorkspaceService.getById(workspace.id)).toMatchObject({
      id: workspace.id,
      type: 'user'
    })
    expect(captureError(() => agentSessionService.getById(first.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(agentSessionService.getById(second.id)).toMatchObject({
      id: second.id,
      workspaceId: workspace.id
    })
  })

  it('deletes the system workspace row when deleting a no-project session', async () => {
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Delete system workspace',
      workspace: { type: 'system' }
    })

    agentSessionService.delete(session.id)

    expect(captureError(() => agentSessionService.getById(session.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(await dbh.db.select().from(agentWorkspaceTable)).toHaveLength(0)
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
    const otherWorkspace = await createWorkspace('other-agent-workspace')
    const other = agentSessionService.create({
      agentId: 'other-agent',
      name: 'Other',
      workspace: { type: 'user', workspaceId: otherWorkspace.id }
    })
    await dbh.db.insert(pinTable).values({
      id: 'pin-first',
      entityType: 'session',
      entityId: first.id,
      orderKey: 'a0',
      createdAt: 1,
      updatedAt: 1
    })

    const result = agentSessionService.deleteByAgentId('agent-session-test')

    expect(result).toEqual({ deletedIds: expect.arrayContaining([first.id, second.id]) })
    expect(captureError(() => agentSessionService.getById(first.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(captureError(() => agentSessionService.getById(second.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(agentSessionService.getById(other.id)).toMatchObject({ id: other.id })
    expect(await dbh.db.select().from(agentTable)).toHaveLength(2)
    expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
  })

  it('returns an empty result for an active agent with no sessions', async () => {
    expect(agentSessionService.deleteByAgentId('agent-session-test')).toEqual({ deletedIds: [] })
  })

  it('throws not found when deleting sessions for a missing agent', async () => {
    expect(captureError(() => agentSessionService.deleteByAgentId('missing-agent'))).toMatchObject({
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
    const workspace = await createWorkspace('soft-deleted-agent-workspace')
    await dbh.db.insert(agentSessionTable).values({
      id: 'soft-deleted-agent-session',
      agentId: 'soft-deleted-agent',
      name: 'Should remain',
      workspaceId: workspace.id,
      orderKey: 'a0'
    })

    expect(captureError(() => agentSessionService.deleteByAgentId('soft-deleted-agent'))).toMatchObject({
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

    const result = agentSessionService.deleteByIds([first.id, second.id])

    expect(result).toEqual({ deletedIds: expect.arrayContaining([first.id, second.id]) })
    expect(captureError(() => agentSessionService.getById(first.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(captureError(() => agentSessionService.getById(second.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(agentSessionService.getById(third.id)).toMatchObject({ id: third.id })
    expect(await dbh.db.select().from(pinTable)).toHaveLength(0)
  })

  it('ignores missing ids when deleting selected sessions', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')

    agentSessionService.deleteByIds([first.id])

    const result = agentSessionService.deleteByIds([first.id, second.id, 'missing-session'])

    expect(result).toEqual({ deletedIds: [second.id] })
    expect(captureError(() => agentSessionService.getById(first.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(captureError(() => agentSessionService.getById(second.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
  })

  it('deletes selected system workspace sessions and their workspace rows by ids', async () => {
    const systemSession = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Bulk system workspace',
      workspace: { type: 'system' }
    })
    const normalSession = await createSession('Normal session')

    const result = agentSessionService.deleteByIds([systemSession.id])

    expect(result).toEqual({ deletedIds: [systemSession.id] })
    expect(captureError(() => agentSessionService.getById(systemSession.id))).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
    expect(agentSessionService.getById(normalSession.id)).toMatchObject({ id: normalSession.id })
    expect(await dbh.db.select().from(agentWorkspaceTable)).toHaveLength(1)
  })

  it('deletes system workspace rows when deleting agent sessions', async () => {
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Agent system workspace',
      workspace: { type: 'system' }
    })

    const result = agentSessionService.deleteByAgentId('agent-session-test')

    expect(result).toEqual({ deletedIds: [session.id] })
    expect(captureError(() => agentSessionService.getById(session.id))).toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(await dbh.db.select().from(agentWorkspaceTable)).toHaveLength(0)
  })

  it('reorders sessions with single and batch moves', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')

    agentSessionService.reorder(first.id, { position: 'first' })
    let list = agentSessionService.listByCursor()
    expect(list.items.map((item) => item.id)).toEqual([first.id, third.id, second.id])

    agentSessionService.reorderBatch([
      { id: second.id, anchor: { before: first.id } },
      { id: third.id, anchor: { position: 'last' } }
    ])
    list = agentSessionService.listByCursor()
    expect(list.items.map((item) => item.id)).toEqual([second.id, first.id, third.id])
  })

  it('paginates sessions with a cursor', async () => {
    const first = await createSession('First')
    const second = await createSession('Second')
    const third = await createSession('Third')

    const page1 = agentSessionService.listByCursor({ limit: 2 })
    expect(page1.items.map((item) => item.id)).toEqual([third.id, second.id])
    expect(page1.nextCursor).toBeTruthy()

    const page2 = agentSessionService.listByCursor({ limit: 2, cursor: page1.nextCursor })
    expect(page2.items.map((item) => item.id)).toEqual([first.id])
    expect(page2.nextCursor).toBeUndefined()
  })

  it('returns pinned sessions first ordered by pin.orderKey, then unpinned by orderKey', async () => {
    // Pinned sessions float to the top ordered by pin.orderKey (user drag),
    // independent of their own orderKey; unpinned follow session.orderKey ASC.
    // s1/s2 are created first (largest orderKey → last under orderKey ASC) yet
    // pinning floats them ahead of the unpinned s3/s4, proving pin precedence.
    const s1 = await createSession('S1')
    const s2 = await createSession('S2')
    const s3 = await createSession('S3')
    const s4 = await createSession('S4')
    await dbh.db.insert(pinTable).values([
      { id: 'pin-a', entityType: 'session', entityId: s1.id, orderKey: 'a0', createdAt: 1, updatedAt: 1 },
      { id: 'pin-b', entityType: 'session', entityId: s2.id, orderKey: 'a1', createdAt: 1, updatedAt: 1 }
    ])

    const result = agentSessionService.listByCursor()
    // pinned by pin.orderKey → [s1, s2]; unpinned by orderKey ASC → [s4, s3].
    expect(result.items.map((item) => item.id)).toEqual([s1.id, s2.id, s4.id, s3.id])
    expect(result.nextCursor).toBeUndefined()
  })

  it('paginates the session pin section then unpinned section via cursor', async () => {
    const s1 = await createSession('S1')
    const s2 = await createSession('S2')
    const s3 = await createSession('S3')
    await dbh.db.insert(pinTable).values([
      { id: 'pin-a', entityType: 'session', entityId: s1.id, orderKey: 'a0', createdAt: 1, updatedAt: 1 },
      { id: 'pin-b', entityType: 'session', entityId: s2.id, orderKey: 'a1', createdAt: 1, updatedAt: 1 }
    ])

    // limit=1: page1 = first pinned, page2 = second pinned (spills to entity start),
    // page3 = the single unpinned session.
    const page1 = agentSessionService.listByCursor({ limit: 1 })
    expect(page1.items.map((item) => item.id)).toEqual([s1.id])
    expect(page1.nextCursor).toBeDefined()

    const page2 = agentSessionService.listByCursor({ limit: 1, cursor: page1.nextCursor })
    expect(page2.items.map((item) => item.id)).toEqual([s2.id])
    expect(page2.nextCursor).toBeDefined()

    const page3 = agentSessionService.listByCursor({ limit: 1, cursor: page2.nextCursor })
    expect(page3.items.map((item) => item.id)).toEqual([s3.id])
    expect(page3.nextCursor).toBeUndefined()
  })

  it('does not skip pinned sessions with the same orderKey across pages', async () => {
    const workspace = await createWorkspace('duplicate-pin-order-key')
    await dbh.db.insert(agentSessionTable).values([
      {
        id: 'session-pinned-1',
        agentId: 'agent-session-test',
        name: 'Pinned 1',
        workspaceId: workspace.id,
        orderKey: 'a0'
      },
      {
        id: 'session-pinned-2',
        agentId: 'agent-session-test',
        name: 'Pinned 2',
        workspaceId: workspace.id,
        orderKey: 'a1'
      }
    ])
    await dbh.db.insert(pinTable).values([
      {
        id: 'pin-a',
        entityType: 'session',
        entityId: 'session-pinned-1',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      },
      {
        id: 'pin-b',
        entityType: 'session',
        entityId: 'session-pinned-2',
        orderKey: 'a0',
        createdAt: 1,
        updatedAt: 1
      }
    ])

    const page1 = agentSessionService.listByCursor({ limit: 1 })
    const page2 = agentSessionService.listByCursor({ limit: 1, cursor: page1.nextCursor })

    expect(page1.items.map((session) => session.id)).toEqual(['session-pinned-1'])
    expect(page2.items.map((session) => session.id)).toEqual(['session-pinned-2'])
  })

  it('deletes sessions when the workspace row is deleted', async () => {
    const workspace = await createWorkspace('transient')
    const session = await createSession('Workspace delete', workspace.id)

    await dbh.db.delete(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, workspace.id))

    expect(captureError(() => agentSessionService.getById(session.id))).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('treats a corrupt session that references a missing workspace as not found', async () => {
    dbh.sqlite.pragma('foreign_keys = OFF')
    try {
      await dbh.db.insert(agentSessionTable).values({
        id: 'corrupt-session',
        agentId: 'agent-session-test',
        name: 'Corrupt',
        workspaceId: 'missing-workspace',
        orderKey: 'a0'
      })
    } finally {
      dbh.sqlite.pragma('foreign_keys = ON')
    }

    expect(captureError(() => agentSessionService.getById('corrupt-session'))).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
  })

  it('deletes a backing system workspace row when deleting its session', async () => {
    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'System delete',
      workspace: { type: 'system' }
    })

    agentSessionService.delete(session.id)

    const rows = await dbh.db.select().from(agentWorkspaceTable)
    expect(rows).toHaveLength(0)
  })
})
