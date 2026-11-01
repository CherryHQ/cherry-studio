import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionHandlers } from '@data/api/handlers/agentSessions'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BaseService } from '@main/core/lifecycle'
import { DataApiError, DataApiErrorFactory } from '@shared/data/api/errors'
import type { CherryMessagePart } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

import { toolApprovalRegistry, type DispatchDecision } from '../../toolApproval/ToolApprovalRegistry'
import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import type * as ForkResourcesModule from '../fork/resources'
import { buildAgentSessionTopicId } from '../topic'

vi.mock('../../runtime/registerDrivers', () => ({ registerRuntimeDrivers: vi.fn() }))
vi.mock('../fork/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof ForkResourcesModule>()),
  readForkResources: async () => []
}))

const sessionId = 'approval-session'
const topicId = buildAgentSessionTopicId(sessionId)
const pendingPart = (approvalId: string): CherryMessagePart => ({
  type: 'tool-install_skill',
  toolCallId: `tool-${approvalId}`,
  state: 'approval-requested',
  input: { install_source: 'fixture-source' },
  approval: { id: approvalId }
})

describe('Agent approval cancellation and historical settlement', () => {
  const dbh = setupTestDatabase()
  let runtime: AgentSessionRuntimeService

  beforeEach(async () => {
    toolApprovalRegistry.clear()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/tmp/approval-test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
    BaseService.resetInstances()
    const get = application.getContainer().get.bind(application.getContainer())
    vi.spyOn(application, 'get').mockImplementation((name) =>
      name === 'AiStreamManager' ? ({ abort: vi.fn() } as never) : get(name)
    )
    runtime = new AgentSessionRuntimeService()
    await runtime._doInit()
  })
  afterEach(async () => {
    await runtime._doStop()
    vi.restoreAllMocks()
  })

  function save(approvalId: string, parts = [pendingPart(approvalId)], role: 'assistant' | 'user' = 'assistant') {
    const id = randomUUID()
    agentSessionMessageService.saveMessage({
      sessionId,
      message: {
        id,
        role,
        status: 'success',
        data: { parts }
      }
    })
    return id
  }
  const row = (id: string) =>
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, id)).get()!
  function register(approvalId: string, presentation: 'message' | 'stream' = 'message', signal?: AbortSignal) {
    let resolve!: (decision: DispatchDecision) => void
    const result = new Promise<DispatchDecision>((done) => {
      resolve = done
    })
    toolApprovalRegistry.register({
      approvalId,
      sessionId,
      toolCallId: `tool-${approvalId}`,
      toolName: 'install_skill',
      originalInput: {},
      presentation,
      signal,
      resolve
    })
    return result
  }
  const respond = (approvalId: string, anchorId: string, approved = true, reason?: string) =>
    runtime.respondToolApproval(approvalId, { approved, reason }, { topicId, anchorId })

  const sessionRow = () => dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).get()!
  const latest = () =>
    agentSessionHandlers['/agent-sessions/latest'].GET({ query: { agentId: 'activity-agent' } } as never)

  function seedActivityFixture() {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    dbh.db
      .insert(agentTable)
      .values({
        id: 'activity-agent',
        type: 'pi',
        name: 'Agent',
        instructions: 'test',
        orderKey: 'a0',
        createdAt: 1_000,
        updatedAt: 1_000
      })
      .run()
    dbh.db
      .update(agentSessionTable)
      .set({
        agentId: 'activity-agent',
        createdAt: 1_000,
        updatedAt: 1_000,
        lastActivityAt: 1_000
      })
      .where(eq(agentSessionTable.id, sessionId))
      .run()
    const id = save('activity')
    dbh.db
      .update(agentSessionMessageTable)
      .set({ createdAt: 1_000, updatedAt: 1_000 })
      .where(eq(agentSessionMessageTable.id, id))
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'newer-session',
        agentId: 'activity-agent',
        workspaceId: 'workspace',
        name: 'Newer',
        orderKey: 'a1',
        createdAt: 2_000,
        updatedAt: 2_000,
        lastActivityAt: 2_000
      })
      .run()
    expect(row(id)).toMatchObject({ createdAt: 1_000, updatedAt: 1_000 })
    expect(sessionRow()).toMatchObject({ createdAt: 1_000, updatedAt: 1_000, lastActivityAt: 1_000 })
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'newer-session')).get()
    ).toMatchObject({ createdAt: 2_000, updatedAt: 2_000, lastActivityAt: 2_000 })
    return { id, now }
  }

  it.each([true, false])(
    'makes an older orphan session latest after approved=%s, but not after a repeat',
    async (approved) => {
      const { id, now } = seedActivityFixture()
      expect(await latest()).toMatchObject({ session: { id: 'newer-session' } })
      now.mockReturnValue(3_000)
      expect(respond('activity', id, approved, 'Please skip')).toBe('accepted')
      expect(row(id)).toMatchObject({
        updatedAt: 3_000,
        data: {
          parts: [
            {
              state: approved ? 'output-error' : 'output-denied',
              approval: { id: 'activity', approved, ...(!approved && { reason: 'Please skip' }) }
            }
          ]
        }
      })
      expect(sessionRow()).toMatchObject({ updatedAt: 3_000, lastActivityAt: 3_000 })
      expect(await latest()).toMatchObject({ session: { id: sessionId } })
      const settled = row(id)
      const settledSession = sessionRow()
      now.mockReturnValue(4_000)
      expect(respond('activity', id, !approved)).toBe('rejected')
      expect(row(id)).toEqual(settled)
      expect(sessionRow()).toEqual(settledSession)
    }
  )

  it('does not make an older session latest when a real cancellation cleans up its card', async () => {
    const { id, now } = seedActivityFixture()
    const result = register('activity')
    expect(await latest()).toMatchObject({ session: { id: 'newer-session' } })
    now.mockReturnValue(3_000)
    expect(toolApprovalRegistry.abort(sessionId, 'closed')).toBe(1)
    await expect(result).resolves.toEqual({ approved: false, reason: 'closed' })
    expect(row(id)).toMatchObject({
      updatedAt: 3_000,
      data: {
        parts: [
          {
            state: 'output-error',
            approval: { id: 'activity' }
          }
        ]
      }
    })
    expect(row(id).data.parts![0]).not.toHaveProperty('approval.approved')
    expect(sessionRow()).toMatchObject({ updatedAt: 1_000, lastActivityAt: 1_000 })
    expect(await latest()).toMatchObject({ session: { id: 'newer-session' } })
  })

  it.each([true, false])(
    'rolls back an orphan decision approved=%s for a soft-deleted session, but permits cleanup',
    async (approved) => {
      const { id, now } = seedActivityFixture()
      now.mockReturnValue(2_500)
      agentSessionService.delete(sessionId)
      const beforeMessage = row(id)
      const beforeSession = sessionRow()
      expect(beforeSession.deletedAt).toBe(2_500)
      expect(beforeMessage.data.parts![0]).toMatchObject({ state: 'approval-requested' })
      now.mockReturnValue(3_000)
      const settle = () => respond('activity', id, approved)
      expect(settle).toThrowError(
        expect.objectContaining({
          ...DataApiErrorFactory.notFound('Session', sessionId),
          constructor: DataApiError
        })
      )
      expect(row(id)).toEqual(beforeMessage)
      expect(sessionRow()).toEqual(beforeSession)
      expect(await latest()).toMatchObject({ session: { id: 'newer-session' } })
      now.mockReturnValue(4_000)
      expect(
        agentSessionMessageService.finalizeInterruptedToolApproval(sessionId, 'activity', { errorText: 'closed' })
      ).toBe(true)
      expect(row(id)).toMatchObject({
        updatedAt: 4_000,
        data: {
          parts: [
            {
              state: 'output-error',
              approval: { id: 'activity' }
            }
          ]
        }
      })
      expect(row(id).data.parts![0]).not.toHaveProperty('approval.approved')
      expect(sessionRow()).toEqual(beforeSession)
      expect(await latest()).toMatchObject({ session: { id: 'newer-session' } })
    }
  )

  it.each(['signal', 'session'] as const)(
    'terminalizes only the cancelled message part on %s cancellation',
    async (action) => {
      const controller = new AbortController()
      const result = register('a', 'message', controller.signal)
      const id = save('a', [{ type: 'text', text: 'preserve' }, pendingPart('a'), pendingPart('b')])
      const other = save('b')
      const before = row(id)
      const untouched = row(other)
      if (action === 'signal') controller.abort()
      else expect(toolApprovalRegistry.abort(sessionId, 'closed')).toBe(1)
      await expect(result).resolves.toEqual({ approved: false, reason: action === 'signal' ? 'aborted' : 'closed' })
      expect(row(id)).toEqual({
        ...before,
        updatedAt: expect.any(Number),
        data: {
          ...before.data,
          parts: [
            before.data.parts![0],
            expect.objectContaining({
              state: 'output-error',
              errorText: 'The turn was interrupted before this tool ran',
              approval: { id: 'a' }
            }),
            before.data.parts![2]
          ]
        }
      })
      expect(row(id).data.parts![1]).not.toHaveProperty('approval.approved')
      expect(row(other)).toEqual(untouched)
    }
  )

  it('leaves stream-owned persistence unchanged on cancellation', async () => {
    const result = register('a', 'stream')
    const id = save('a')
    const before = row(id)
    toolApprovalRegistry.cancel('a', 'closed')
    await expect(result).resolves.toEqual({ approved: false, reason: 'closed' })
    expect(row(id)).toEqual(before)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toHaveLength(1)
  })

  it.each([true, false])('settles an orphaned card with approved=%s without resuming its dead call', (approved) => {
    const id = save('a')
    expect(respond('a', id, approved, 'Please skip')).toBe('accepted')
    expect(row(id).status).toBe('success')
    expect(row(id).data.parts![0]).toMatchObject({
      state: approved ? 'output-error' : 'output-denied',
      approval: { id: 'a', approved, ...(!approved && { reason: 'Please skip' }) }
    })
    const settled = row(id)
    expect(respond('a', id, !approved)).toBe('rejected')
    expect(row(id)).toEqual(settled)
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  it.each([true, false])('preserves tool metadata and applies edited input on interrupted approved=%s', (approved) => {
    const part = {
      ...pendingPart('a'),
      callProviderMetadata: { fixture: { trace: 'preserve' } }
    }
    const id = save('a', [{ type: 'text', text: 'preserve' }, part, pendingPart('b')])
    const before = row(id)
    const updatedInput = { install_source: 'edited-source' }
    expect(runtime.respondToolApproval('a', { approved, updatedInput }, { topicId, anchorId: id })).toBe('accepted')
    expect(row(id)).toEqual({
      ...before,
      updatedAt: expect.any(Number),
      data: {
        ...before.data,
        parts: [
          before.data.parts![0],
          {
            ...part,
            input: updatedInput,
            state: approved ? 'output-error' : 'output-denied',
            approval: { id: 'a', approved },
            ...(approved && { errorText: 'The tool call was interrupted before approval could be applied' })
          },
          before.data.parts![2]
        ]
      }
    })
  })

  it('binds the approval ID as data and preserves the original input when no edit is supplied', () => {
    const approvalId = "approval' OR 1=1 --"
    const id = save(approvalId)
    const other = save('other')
    const before = row(id)
    const untouched = row(other)
    expect(
      agentSessionMessageService.finalizeInterruptedToolApproval(sessionId, approvalId, { errorText: 'closed' })
    ).toBe(true)
    expect(row(id).data.parts).toEqual([{ ...before.data.parts![0], state: 'output-error', errorText: 'closed' }])
    expect(row(other)).toEqual(untouched)
  })

  it.each([true, false])('delivers a live background decision (%s) even without a live turn', async (approved) => {
    const result = register('a')
    const id = save('a')
    expect(runtime.getLiveAssistantMessageId(sessionId)).toBeUndefined()
    expect(row(id).data.parts![0]).toMatchObject({ state: 'approval-requested' })
    expect(respond('a', id, approved, 'Skip this')).toBe('accepted')
    await expect(result).resolves.toEqual({ approved, reason: 'Skip this', ...(!approved && { reasonSource: 'user' }) })
    expect(row(id).data.parts![0]).toMatchObject({
      state: 'approval-responded',
      approval: { id: 'a', approved, reason: 'Skip this' }
    })
  })

  it.each(['session', 'anchor', 'approval', 'deleted', 'settled', 'missing-anchor'] as const)(
    'rejects a %s mismatch without resolving the live waiter or writing rows',
    (kind) => {
      void register('a')
      const id = save('a')
      if (kind === 'deleted') dbh.db.delete(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, id)).run()
      if (kind === 'settled')
        agentSessionMessageService.applyToolApprovalDecision(sessionId, id, { approvalId: 'a', approved: true })
      const before = dbh.db.select().from(agentSessionMessageTable).all()
      expect(
        runtime.respondToolApproval(
          kind === 'approval' ? 'wrong' : 'a',
          { approved: true },
          {
            topicId: kind === 'session' ? buildAgentSessionTopicId('other') : topicId,
            anchorId: kind === 'missing-anchor' ? undefined : kind === 'anchor' ? 'wrong' : id
          }
        )
      ).toBe('rejected')
      expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
      expect(toolApprovalRegistry.peek('a')).toBeDefined()
    }
  )

  it.each(['session', 'anchor', 'approval', 'deleted'] as const)(
    'rejects an orphan %s mismatch without changing history',
    (kind) => {
      const id = save('a')
      if (kind === 'deleted') dbh.db.delete(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, id)).run()
      const before = dbh.db.select().from(agentSessionMessageTable).all()
      expect(
        runtime.respondToolApproval(
          kind === 'approval' ? 'wrong' : 'a',
          { approved: true },
          {
            topicId: kind === 'session' ? buildAgentSessionTopicId('other') : topicId,
            anchorId: kind === 'anchor' ? 'wrong' : id
          }
        )
      ).toBe('rejected')
      expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
    }
  )

  it('protects the live anchor while allowing an older independent card in the same topic', () => {
    const old = save('old')
    const live = save('live')
    runtime.beginTurn({
      sessionId,
      topicId,
      agentId: 'agent',
      agentType: 'pi',
      modelId: createUniqueModelId('mock', 'model'),
      assistantMessageId: live
    })
    const before = row(live)
    expect(respond('live', live)).toBe('rejected')
    expect(row(live)).toEqual(before)
    expect(respond('old', old)).toBe('accepted')
    expect(row(old).data.parts![0]).toMatchObject({ state: 'output-error', approval: { approved: true } })
    runtime.markTurnTerminal(sessionId, 'success')
  })

  it('only finalizes the newest matching assistant row and preserves runtime metadata', () => {
    const older = save('a')
    const newest = save('a')
    dbh.db
      .update(agentSessionMessageTable)
      .set({
        createdAt: Date.now() + 1000,
        runtimeResumeToken: 'resume',
        data: { parts: [pendingPart('a')], runtimeAnchor: { checkpoint: 'preserve' }, nativeSessionId: 'native' }
      })
      .where(eq(agentSessionMessageTable.id, newest))
      .run()
    const before = row(newest)
    const beforeOlder = row(older)
    expect(agentSessionMessageService.finalizeInterruptedToolApproval(sessionId, 'a', { errorText: 'closed' })).toBe(
      true
    )
    expect(row(newest)).toEqual({
      ...before,
      updatedAt: expect.any(Number),
      data: { ...before.data, parts: [expect.objectContaining({ state: 'output-error', errorText: 'closed' })] }
    })
    expect(row(older)).toEqual(beforeOlder)
  })

  it('does not guess an orphan session from an anchor without topic context', () => {
    const id = save('a')
    const before = row(id)
    expect(runtime.respondToolApproval('a', { approved: true }, { anchorId: id })).toBe('not-agent')
    expect(row(id)).toEqual(before)
  })

  it('ignores a user row with an otherwise matching pending part', () => {
    const id = save('a', [pendingPart('a')], 'user')
    const before = row(id)
    expect(respond('a', id)).toBe('rejected')
    expect(row(id)).toEqual(before)
  })

  it('cancels A without disturbing B or a subsequent approval in the same session', async () => {
    const a = register('a')
    const b = register('b')
    const idA = save('a')
    const idB = save('b')
    const beforeB = row(idB)
    toolApprovalRegistry.cancel('a', 'closed')
    await expect(a).resolves.toMatchObject({ approved: false })
    expect(row(idA).data.parts![0]).toMatchObject({ state: 'output-error' })
    expect(row(idB)).toEqual(beforeB)
    expect(respond('b', idB)).toBe('accepted')
    await expect(b).resolves.toMatchObject({ approved: true })
    const c = register('c')
    const idC = save('c')
    expect(toolApprovalRegistry.cancel('a', 'late')).toBeUndefined()
    expect(respond('c', idC)).toBe('accepted')
    await expect(c).resolves.toMatchObject({ approved: true })
  })

  it('does not recreate a pending message when a queued request is consumed after cancellation', async () => {
    const result = register('a')
    const request = {
      approvalId: 'a',
      toolCallId: 'tool-a',
      toolName: 'install_skill',
      input: {},
      presentation: 'message' as const
    }
    toolApprovalRegistry.cancel('a', 'closed')
    await result
    runtime['handleToolApprovalRequest'](
      { sessionId } as Parameters<(typeof runtime)['handleToolApprovalRequest']>[0],
      request
    )
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
  })

  it('keeps cancellation cleanup subscribed across service stop and restart', async () => {
    const stopped = register('stopped')
    const id = save('stopped')
    await runtime._doStop()
    await expect(stopped).resolves.toMatchObject({ approved: false })
    expect(row(id).data.parts![0]).toMatchObject({ state: 'output-error' })
    await runtime._doInit()
    const restarted = register('restarted')
    const next = save('restarted')
    toolApprovalRegistry.cancel('restarted', 'closed')
    await restarted
    expect(row(next).data.parts![0]).toMatchObject({ state: 'output-error' })
  })

  it('releases the waiter despite a failed cancellation write, then permits historical settlement', async () => {
    const result = register('a')
    const id = save('a')
    vi.spyOn(application.get('DbService'), 'withWriteTx').mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })
    toolApprovalRegistry.cancel('a', 'closed')
    await expect(result).resolves.toEqual({ approved: false, reason: 'closed' })
    expect(row(id).data.parts![0]).toMatchObject({ state: 'approval-requested' })
    expect(respond('a', id)).toBe('accepted')
    expect(row(id).data.parts![0]).toMatchObject({ state: 'output-error' })
  })
})
