import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionMessageHandlers } from '@data/api/handlers/agentSessionMessages'
import { agentSessionHandlers } from '@data/api/handlers/agentSessions'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { pinTable } from '@data/db/schemas/pin'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import '@data/services/AgentTaskService'
import { ErrorCode } from '@shared/data/api/errors'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notify }))

describe('background session isolation', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    notify.mockClear()
  })

  function create(name: string, type: 'conversation' | 'background' = 'conversation') {
    return agentSessionService.create({ agentId: 'agent', name, workspace: { type: 'system' } }, type)
  }

  it('archives only conversations when a session type scope is supplied', () => {
    const first = create('first')
    const second = create('second')
    const backgrounds = [create('heartbeat', 'background'), create('sticky task', 'background')]

    const result = agentSessionService.deleteByAgentIdWithImpact('agent', {
      permanent: false,
      sessionTypes: ['conversation']
    })

    expect(result.deletedIds.sort()).toEqual([first.id, second.id].sort())
    for (const session of [first, second]) {
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id)).get()?.deletedAt
      ).toEqual(expect.any(Number))
    }
    for (const background of backgrounds) {
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, background.id)).get()?.deletedAt
      ).toBeNull()
    }
  })

  it.each([undefined, []] as const)('archives all session types with scope %j', (sessionTypes) => {
    const conversation = create('conversation')
    const background = create('heartbeat', 'background')

    const result = agentSessionService.deleteByAgentIdWithImpact('agent', { permanent: false, sessionTypes })

    expect(result.deletedIds.sort()).toEqual([conversation.id, background.id].sort())
    for (const session of [conversation, background]) {
      expect(
        dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, session.id)).get()?.deletedAt
      ).toEqual(expect.any(Number))
    }
  })

  it('filters active IDs by session type while retaining the unfiltered default', () => {
    const conversation = create('conversation')
    const background = create('heartbeat', 'background')
    const trashed = create('already archived')
    agentSessionService.delete(trashed.id)

    expect(agentSessionService.listActiveIdsByAgent('agent', { sessionTypes: ['conversation'] })).toEqual([
      conversation.id
    ])
    expect(agentSessionService.listActiveIdsByAgent('agent')).toEqual([conversation.id, background.id].sort())
    expect(agentSessionService.listActiveIdsByAgent('agent', { sessionTypes: [] })).toEqual(
      [conversation.id, background.id].sort()
    )
  })

  it('keeps permanent agent-session deletion unfiltered even when a session type scope is supplied', () => {
    const conversation = create('conversation')
    const background = create('heartbeat', 'background')

    const result = agentSessionService.deleteByAgentIdWithImpact('agent', {
      permanent: true,
      sessionTypes: ['conversation']
    })

    expect(result.deletedIds.sort()).toEqual([conversation.id, background.id].sort())
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
  })

  it('excludes background rows before DataApi pin pagination and latest selection, including orphaned sessions', async () => {
    const first = create('first')
    const second = create('second')
    const background = create('background', 'background')
    const unpinnedBackground = create('unpinned background', 'background')
    dbh.db
      .insert(pinTable)
      .values([
        { id: 'pin-background', entityType: 'session', entityId: background.id, orderKey: 'a0' },
        { id: 'pin-conversation', entityType: 'session', entityId: first.id, orderKey: 'a1' }
      ])
      .run()
    dbh.db
      .update(agentSessionTable)
      .set({ lastActivityAt: Date.now() + 60_000 })
      .where(eq(agentSessionTable.type, 'background'))
      .run()
    dbh.db
      .update(agentSessionTable)
      .set({ lastActivityAt: Date.now() + 1_000 })
      .where(eq(agentSessionTable.id, second.id))
      .run()

    const ids: string[] = []
    let cursor: string | undefined
    do {
      const response = await agentSessionHandlers['/agent-sessions'].GET({ query: { limit: '1', cursor } })
      const page = 'data' in response ? response.data : response
      expect(page.items).toHaveLength(1)
      ids.push(...page.items.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toEqual([first.id, second.id])
    expect(agentSessionService.getLatestActive()?.id).toBe(second.id)
    expect(
      agentSessionService.listByCursor({ scope: 'ordinary', agentId: 'agent' }).items.map((row) => row.id)
    ).toEqual(ids)

    dbh.db.update(agentSessionTable).set({ agentId: null }).run()
    expect(agentSessionService.getLatestActive({ agentId: 'unlinked' })?.id).toBe(second.id)
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
    expect(agentSessionService.getById(unpinnedBackground.id).id).toBe(unpinnedBackground.id)
  })

  it('excludes task conversations from DataApi pagination and latest restore, but keeps remote discovery and reads', async () => {
    const ordinary = create('ordinary')
    const sticky = create('sticky task')
    const perRun = create('per-run task')
    const legacy = create('legacy task')
    dbh.db
      .insert(jobScheduleTable)
      .values({
        id: 'task',
        type: 'agent.task',
        name: 'task',
        trigger: { kind: 'interval', ms: 60_000 },
        jobInputTemplate: {},
        catchUpPolicy: { kind: 'skip-missed' }
      })
      .run()
    dbh.db
      .update(agentSessionTable)
      .set({ isTaskReuseTarget: true, taskId: 'task' })
      .where(eq(agentSessionTable.id, sticky.id))
      .run()
    for (const [session, metadata, output] of [
      [perRun, { sessionId: perRun.id }, null],
      [legacy, {}, { sessionId: legacy.id }]
    ] as const) {
      dbh.db
        .insert(jobTable)
        .values({
          id: `job-${session.id}`,
          scheduleId: 'task',
          type: 'agent.task',
          status: 'completed',
          queue: 'agent',
          input: {},
          scheduledAt: Date.now(),
          metadata,
          output
        })
        .run()
    }
    for (const session of [sticky, perRun, legacy]) {
      dbh.db
        .update(agentSessionTable)
        .set({ taskId: 'task', lastActivityAt: Date.now() + 60_000 })
        .where(eq(agentSessionTable.id, session.id))
        .run()
    }
    dbh.db.insert(pinTable).values({ id: 'task-pin', entityType: 'session', entityId: perRun.id, orderKey: 'a0' }).run()
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const response = await agentSessionHandlers['/agent-sessions'].GET({
        query: { agentId: 'agent', limit: '1', cursor }
      })
      const page = 'data' in response ? response.data : response
      ids.push(...page.items.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toEqual([ordinary.id])
    const discovered: string[] = []
    cursor = undefined
    do {
      const page = agentSessionService.listByCursor({ scope: 'all-conversations', agentId: 'agent', limit: 1, cursor })
      discovered.push(...page.items.map((row) => row.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(discovered[0]).toBe(perRun.id)
    expect(new Set(discovered)).toEqual(new Set([ordinary.id, sticky.id, perRun.id, legacy.id]))
    expect(agentSessionService.getLatestActive()?.id).toBe(ordinary.id)
    expect(agentSessionService.getLatestActive({ agentId: 'agent' })?.id).toBe(ordinary.id)
    for (const session of [sticky, perRun, legacy]) {
      expect(agentSessionService.getConversationById(session.id).id).toBe(session.id)
      await expect(
        agentSessionHandlers['/agent-sessions/:sessionId'].GET({
          params: { sessionId: session.id },
          query: { excludeTaskSessions: true }
        })
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
      await expect(
        agentSessionHandlers['/agent-sessions/:sessionId'].GET({
          params: { sessionId: session.id }
        })
      ).resolves.toMatchObject({ id: session.id })
      expect(
        agentSessionService.listByCursor({ scope: 'ordinary', ids: [session.id] }).items.map((row) => row.id)
      ).toEqual([session.id])
    }
    await expect(
      agentSessionHandlers['/agent-sessions/:sessionId'].GET({
        params: { sessionId: ordinary.id },
        query: { excludeTaskSessions: true }
      })
    ).resolves.toMatchObject({ id: ordinary.id })
    agentSessionService.delete(perRun.id)
    expect(agentSessionService.listByCursor({ scope: 'ordinary', inTrash: true }).items.map((row) => row.id)).toEqual([
      perRun.id
    ])
  })

  it('keeps background sessions out of both active and trash conversation lists', () => {
    const active = create('needle active')
    const trashed = create('needle trash')
    const background = create('needle background', 'background')
    const trashedBackground = create('needle background trash', 'background')
    for (const session of [trashed, trashedBackground]) {
      dbh.db.update(agentSessionTable).set({ deletedAt: Date.now() }).where(eq(agentSessionTable.id, session.id)).run()
    }

    expect(agentSessionService.listByCursor({ scope: 'ordinary' }).items.map((row) => row.id)).toEqual([active.id])
    expect(agentSessionService.listByCursor({ scope: 'all-conversations' }).items.map((row) => row.id)).toEqual([
      active.id
    ])
    expect(agentSessionService.listByCursor({ scope: 'ordinary', inTrash: true }).items.map((row) => row.id)).toEqual([
      trashed.id
    ])
    expect(agentSessionService.search({ q: 'needle', limit: 10 }).map((row) => row.id)).toEqual([active.id])
    expect(agentSessionService.listAddressableByCursor({}).items.map((row) => row.sessionId)).toEqual([active.id])
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
  })

  it('rejects a background ID at the conversation API while retaining internal execution access', async () => {
    const background = create('heartbeat', 'background')
    await expect(
      agentSessionHandlers['/agent-sessions/:sessionId'].GET({ params: { sessionId: background.id } })
    ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
    expect(agentSessionService.getLatestActive()).toBeNull()
    const conversation = create('conversation')
    await expect(
      agentSessionHandlers['/agent-sessions/:sessionId'].GET({ params: { sessionId: conversation.id } })
    ).resolves.toMatchObject({ id: conversation.id })
  })

  it('rejects background IDs on session mutations and message routes while retaining internal access', async () => {
    const background = create('heartbeat', 'background')
    const expectNotFound = (call: Promise<unknown>) => expect(call).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND })
    const sessionRoutes = agentSessionHandlers
    const messageRoutes = agentSessionMessageHandlers

    await expectNotFound(
      sessionRoutes['/agent-sessions/:sessionId'].PATCH({ params: { sessionId: background.id }, body: { name: 'x' } })
    )
    await expectNotFound(
      sessionRoutes['/agent-sessions/:sessionId/workspace'].PUT({
        params: { sessionId: background.id },
        body: { type: 'system' }
      })
    )
    await expectNotFound(
      messageRoutes['/agent-sessions/:sessionId/messages'].GET({ params: { sessionId: background.id } })
    )
    await expectNotFound(
      messageRoutes['/agent-sessions/:sessionId/messages/:messageId'].DELETE({
        params: { sessionId: background.id, messageId: crypto.randomUUID() }
      })
    )
    // The runtime retains access: the row stays intact for internal reads.
    expect(agentSessionService.getById(background.id).name).toBe('heartbeat')
  })

  it('does not reuse or delete an empty background session as an interactive placeholder', () => {
    const background = create('', 'background')
    const placeholder = agentSessionService.reuseOrCreatePlaceholderWithImpact({
      agentId: 'agent',
      workspace: { type: 'system' }
    })
    expect(placeholder.created).toBe(true)
    expect(placeholder.session.id).not.toBe(background.id)
    expect(agentSessionService.getById(background.id).id).toBe(background.id)
    expect(agentSessionService.listByCursor({ scope: 'ordinary' }).items.map((row) => row.id)).toEqual([
      placeholder.session.id
    ])
  })

  it('excludes background metadata and message results from discovery, including short-term search', () => {
    const conversation = create('needle 项目')
    const background = create('needle 项目', 'background')
    for (const session of [conversation, background]) {
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          id: crypto.randomUUID(),
          sessionId: session.id,
          role: 'user',
          data: { parts: [{ type: 'text', text: 'needle 项目' }] },
          searchableText: 'needle 项目',
          status: 'success'
        })
        .run()
    }
    expect(agentSessionService.search({ q: 'needle', limit: 10 }).map((row) => row.id)).toEqual([conversation.id])
    expect(agentSessionService.listAddressableByCursor({}).items.map((row) => row.sessionId)).toEqual([conversation.id])
    for (const q of ['needle', '项']) {
      expect(agentSessionMessageService.search({ q }).items.map((row) => row.sessionId)).toEqual([conversation.id])
      expect(agentSessionMessageService.searchRanked({ q }).map((row) => row.sessionId)).toEqual([conversation.id])
    }
  })

  it('does not invalidate conversation navigation when a background session is created or receives a message', () => {
    const background = create('background', 'background')
    agentSessionMessageService.saveMessage(
      {
        sessionId: background.id,
        message: {
          id: crypto.randomUUID(),
          role: 'user',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'check' }] }
        }
      },
      { publishDataChange: true }
    )
    const effects = notify.mock.calls.flatMap(([effects]) => effects)
    expect(effects.some((effect) => effect.endpoint === '/agent-sessions/:sessionId/messages')).toBe(true)
    expect(effects.filter((effect) => ['/agent-sessions', '/agent-sessions/latest'].includes(effect.endpoint))).toEqual(
      []
    )
  })
})
