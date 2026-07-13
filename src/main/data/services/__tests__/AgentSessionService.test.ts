import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { ErrorCode } from '@shared/data/api/errors'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, type Mock } from 'vitest'

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

    const result = agentSessionService.search({ q: 'Needle', limit: 5 })

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

  describe('listByCursor (flat sortBy profiles)', () => {
    // orderKey and updatedAt deliberately disagree so each profile's assertion
    // pins its own sort column. s2 is pinned; s3/s4 are unlinked (agentId NULL).
    async function seedFlat() {
      const workspace = await createWorkspace('flat')
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 's1',
          agentId: 'agent-session-test',
          name: 'Alpha',
          description: 'first session',
          workspaceId: workspace.id,
          orderKey: 'a3',
          createdAt: 1,
          updatedAt: 100
        },
        {
          id: 's2',
          agentId: 'agent-session-test',
          name: 'Beta',
          workspaceId: workspace.id,
          orderKey: 'a2',
          createdAt: 2,
          updatedAt: 200
        },
        {
          id: 's3',
          agentId: null,
          name: 'Gamma',
          workspaceId: workspace.id,
          orderKey: 'a1',
          createdAt: 3,
          updatedAt: 300
        },
        {
          id: 's4',
          agentId: null,
          name: 'Delta',
          workspaceId: workspace.id,
          orderKey: 'a0',
          createdAt: 4,
          updatedAt: 400
        }
      ])
      await dbh.db.insert(pinTable).values({
        id: '77777777-7777-4777-8777-777777777777',
        entityType: 'session',
        entityId: 's2',
        orderKey: 'a0'
      })
      return workspace
    }

    it('sortBy=updatedAt returns activity order with the workspace relation intact', async () => {
      await seedFlat()
      const result = agentSessionService.listByCursor({ sortBy: 'updatedAt' })
      expect(result.items.map((s) => s.id)).toEqual(['s4', 's3', 's2', 's1'])
      expect(result.items[0].workspace).toBeDefined()
      expect(result.items.find((session) => session.id === 's2')).toMatchObject({
        pinned: true,
        pinId: '77777777-7777-4777-8777-777777777777'
      })
      expect(result.items.find((session) => session.id === 's1')).toMatchObject({
        pinned: false,
        pinId: null
      })
      expect(result.nextCursor).toBeUndefined()
    })

    it('breaks createdAt ties by id ASC across page boundaries (no skip/dup)', async () => {
      const workspace = await createWorkspace('created-ties')
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'tie-a',
          agentId: 'agent-session-test',
          name: 'A',
          workspaceId: workspace.id,
          orderKey: 'a0',
          createdAt: 100
        },
        {
          id: 'tie-b',
          agentId: 'agent-session-test',
          name: 'B',
          workspaceId: workspace.id,
          orderKey: 'a1',
          createdAt: 100
        },
        {
          id: 'tie-c',
          agentId: 'agent-session-test',
          name: 'C',
          workspaceId: workspace.id,
          orderKey: 'a2',
          createdAt: 100
        }
      ])

      const first = agentSessionService.listByCursor({ sortBy: 'createdAt', limit: 2 })
      const second = agentSessionService.listByCursor({ sortBy: 'createdAt', limit: 2, cursor: first.nextCursor })

      expect(first.items.map((session) => session.id)).toEqual(['tie-a', 'tie-b'])
      expect(second.items.map((session) => session.id)).toEqual(['tie-c'])
      expect(second.nextCursor).toBeUndefined()
    })

    it('sortBy=orderKey returns manual order including pinned rows, and paginates via cursor', async () => {
      await seedFlat()
      const page1 = agentSessionService.listByCursor({ sortBy: 'orderKey', limit: 3 })
      expect(page1.items.map((s) => s.id)).toEqual(['s4', 's3', 's2'])
      const page2 = agentSessionService.listByCursor({ sortBy: 'orderKey', limit: 3, cursor: page1.nextCursor })
      expect(page2.items.map((s) => s.id)).toEqual(['s1'])
      expect(page2.nextCursor).toBeUndefined()
    })

    it('pages a pinned-only stream by pin order, independent of the session sort profile', async () => {
      await seedFlat()
      await dbh.db.insert(pinTable).values({
        id: '88888888-8888-4888-8888-888888888888',
        entityType: 'session',
        entityId: 's4',
        orderKey: 'a1'
      })

      const page1 = agentSessionService.listByCursor({ sortBy: 'createdAt', pinned: true, limit: 1 })
      const page2 = agentSessionService.listByCursor({
        sortBy: 'createdAt',
        pinned: true,
        limit: 1,
        cursor: page1.nextCursor
      })

      expect(page1.items.map((session) => session.id)).toEqual(['s2'])
      expect(page2.items.map((session) => session.id)).toEqual(['s4'])
      expect(page2.nextCursor).toBeUndefined()
      expect(agentSessionService.listByCursor({ pinned: true }).items.map((session) => session.id)).toEqual([
        's2',
        's4'
      ])
    })

    it('filters by concrete agentId and by unlinked', async () => {
      await seedFlat()
      const owned = agentSessionService.listByCursor({ sortBy: 'updatedAt', agentId: 'agent-session-test' })
      expect(owned.items.map((s) => s.id)).toEqual(['s2', 's1'])
      const unlinked = agentSessionService.listByCursor({ sortBy: 'updatedAt', agentId: 'unlinked' })
      expect(unlinked.items.map((s) => s.id)).toEqual(['s4', 's3'])
    })

    it('filters by pinned=true / pinned=false', async () => {
      await seedFlat()
      expect(agentSessionService.listByCursor({ sortBy: 'updatedAt', pinned: true }).items.map((s) => s.id)).toEqual([
        's2'
      ])
      expect(agentSessionService.listByCursor({ sortBy: 'updatedAt', pinned: false }).items.map((s) => s.id)).toEqual([
        's4',
        's3',
        's1'
      ])
    })

    it('searchScope=name matches session name only; full also matches description and agent name', async () => {
      await seedFlat()
      // 'first' appears only in s1's description.
      expect(agentSessionService.listByCursor({ sortBy: 'updatedAt', q: 'first' }).items).toEqual([])
      expect(
        agentSessionService
          .listByCursor({ sortBy: 'updatedAt', q: 'first', searchScope: 'full' })
          .items.map((s) => s.id)
      ).toEqual(['s1'])
      // 'Session Test Agent' matches via the owning agent's name — only linked sessions.
      expect(
        agentSessionService
          .listByCursor({ sortBy: 'updatedAt', q: 'Test Agent', searchScope: 'full' })
          .items.map((s) => s.id)
      ).toEqual(['s2', 's1'])
    })

    it('treats LIKE wildcards in q as literals', async () => {
      const workspace = await createWorkspace('literal')
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'lit-1',
          agentId: 'agent-session-test',
          name: '100% done',
          workspaceId: workspace.id,
          orderKey: 'a0',
          updatedAt: 100
        },
        {
          id: 'lit-2',
          agentId: 'agent-session-test',
          name: '100 percent done',
          workspaceId: workspace.id,
          orderKey: 'a1',
          updatedAt: 200
        }
      ])
      const result = agentSessionService.listByCursor({ sortBy: 'updatedAt', q: '100%' })
      expect(result.items.map((s) => s.id)).toEqual(['lit-1'])
    })

    it('filters by explicit ids', async () => {
      await seedFlat()
      expect(
        agentSessionService.listByCursor({ sortBy: 'updatedAt', ids: ['s1', 's4'] }).items.map((s) => s.id)
      ).toEqual(['s4', 's1'])
    })

    it('pages the unpinned creation stream by createdAt DESC with a stable cursor', async () => {
      await seedFlat()
      const first = agentSessionService.listByCursor({ sortBy: 'createdAt', pinned: false, limit: 2 })
      const second = agentSessionService.listByCursor({
        sortBy: 'createdAt',
        pinned: false,
        limit: 2,
        cursor: first.nextCursor
      })

      expect(first.items.map((session) => session.id)).toEqual(['s4', 's3'])
      expect(second.items.map((session) => session.id)).toEqual(['s1'])
      expect(second.nextCursor).toBeUndefined()
    })

    it('filters by stable user workspace id and explicit system scope', async () => {
      const workspace = await seedFlat()
      const systemSession = agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'System',
        workspace: { type: 'system' }
      })

      const userSessions = agentSessionService.listByCursor({
        sortBy: 'updatedAt',
        workspaceId: workspace.id
      })
      expect(userSessions.items.map((session) => session.id)).toEqual(['s4', 's3', 's2', 's1'])
      expect(
        agentSessionService.listByCursor({ sortBy: 'updatedAt', workspaceId: 'system' }).items.map((s) => s.id)
      ).toEqual([systemSession.id])
    })
  })

  describe('stats', () => {
    async function seedStats() {
      const workspace = await createWorkspace('stats')
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 's1',
          agentId: 'agent-session-test',
          name: 'Alpha',
          workspaceId: workspace.id,
          orderKey: 'a0',
          updatedAt: 100
        },
        {
          id: 's2',
          agentId: 'agent-session-test',
          name: 'Beta',
          workspaceId: workspace.id,
          orderKey: 'a1',
          updatedAt: 200
        },
        { id: 's3', agentId: null, name: 'Gamma', workspaceId: workspace.id, orderKey: 'a2', updatedAt: 300 }
      ])
      await dbh.db.insert(pinTable).values({
        id: '88888888-8888-4888-8888-888888888888',
        entityType: 'session',
        entityId: 's1',
        orderKey: 'a0'
      })
      return workspace
    }

    it('returns total, pinnedCount, and byAgent with an explicit unlinked (null) entry', async () => {
      const workspace = await seedStats()
      const stats = agentSessionService.stats()
      expect(stats.total).toBe(3)
      expect(stats.pinnedCount).toBe(1)
      const byAgent = [...stats.byAgent].sort((a, b) => String(a.agentId).localeCompare(String(b.agentId)))
      expect(byAgent).toEqual([
        { agentId: 'agent-session-test', count: 2, pinnedCount: 1 },
        { agentId: null, count: 1, pinnedCount: 0 }
      ])
      expect(stats.byWorkspace).toEqual([{ workspaceId: workspace.id, count: 3, pinnedCount: 1 }])
    })

    it('applies owner scope and name search filters', async () => {
      await seedStats()
      expect(agentSessionService.stats({ agentId: 'unlinked' })).toMatchObject({ total: 1, pinnedCount: 0 })
      expect(agentSessionService.stats({ q: 'Alpha' })).toMatchObject({
        total: 1,
        pinnedCount: 1
      })
    })

    it('aggregates stable workspace ids and the explicit system bucket', async () => {
      const workspace = await seedStats()
      agentSessionService.create({
        agentId: 'agent-session-test',
        name: 'System',
        workspace: { type: 'system' }
      })

      expect(
        [...agentSessionService.stats().byWorkspace].sort((left, right) =>
          left.workspaceId.localeCompare(right.workspaceId)
        )
      ).toEqual([
        { workspaceId: workspace.id, count: 3, pinnedCount: 1 },
        { workspaceId: 'system', count: 1, pinnedCount: 0 }
      ])
    })
  })

  describe('getLatestUpdated', () => {
    it('returns the globally most-recently-updated session, independent of orderKey ordering', async () => {
      const workspace = await createWorkspace('latest')
      // `active-latest` has the largest orderKey (oldest-created → last under `orderKey ASC` paging) yet
      // the highest updatedAt, so returning it proves the query ranks by updatedAt, not list position.
      await dbh.db.insert(agentSessionTable).values([
        {
          id: 'created-newest',
          agentId: 'agent-session-test',
          name: 'A',
          workspaceId: workspace.id,
          orderKey: 'a0',
          updatedAt: 100
        },
        {
          id: 'mid',
          agentId: 'agent-session-test',
          name: 'B',
          workspaceId: workspace.id,
          orderKey: 'a1',
          updatedAt: 200
        },
        {
          id: 'active-latest',
          agentId: 'agent-session-test',
          name: 'C',
          workspaceId: workspace.id,
          orderKey: 'a2',
          updatedAt: 300
        }
      ])

      const latest = agentSessionService.getLatestUpdated()
      expect(latest?.id).toBe('active-latest')
      // Fully hydrated (workspace joined), matching getById.
      expect(latest?.workspace.id).toBe(workspace.id)
    })

    it('returns null when there are no sessions', () => {
      expect(agentSessionService.getLatestUpdated()).toBeNull()
    })
  })

  it('binds a session to an explicit workspace', async () => {
    const workspace = await createWorkspace('explicit')

    const session = agentSessionService.create({
      agentId: 'agent-session-test',
      name: 'Explicit',
      workspace: { type: 'user', workspaceId: workspace.id }
    })

    expect(session.workspaceId).toBe(workspace.id)
    expect(session.workspace.path).toBe(workspace.path)
    expect(session.isNameManuallyEdited).toBe(false)
  })

  it('rejects a user workspace source that points at a system workspace row', async () => {
    const systemWorkspace = dbh.db.transaction((tx) =>
      agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: 'system-owned-session' })
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
    expect(session.workspace.path).toBe(path.join(application.getPath('feature.agents.workspaces'), session.id))
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

    const updated = agentSessionService.update(session.id, {
      name: 'After update',
      description: 'Updated description',
      isNameManuallyEdited: true
    })

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
    expect(updated.workspace.path).toBe(path.join(application.getPath('feature.agents.workspaces'), session.id))
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

    agentSessionService.delete(session.id)

    expect(captureError(() => agentSessionService.getById(session.id))).toMatchObject({
      code: ErrorCode.NOT_FOUND
    })
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
    expect(result.items.map(({ pinned, pinId }) => ({ pinned, pinId }))).toEqual([
      { pinned: true, pinId: 'pin-a' },
      { pinned: true, pinId: 'pin-b' },
      { pinned: false, pinId: null },
      { pinned: false, pinId: null }
    ])
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
