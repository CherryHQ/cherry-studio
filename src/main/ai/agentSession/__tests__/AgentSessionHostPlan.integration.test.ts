import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentPlanHandlers } from '@data/api/handlers/agentPlans'
import { agentTable } from '@data/db/schemas/agent'
import { agentPlanHistoryTable, agentPlanStepIdentityTable, agentPlanTable } from '@data/db/schemas/agentPlan'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentPlanService } from '@data/services/AgentPlanService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AiStreamManager } from '@main/ai/streamManager/AiStreamManager'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import {
  AgentPlanEntitySchema,
  AgentPlanHistoryEntitySchema,
  type ReplaceAgentPlanDto
} from '@shared/data/api/schemas/agentPlans'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

describe('Main host plan storage and idle edits', () => {
  const dbh = setupTestDatabase()
  const sessionId = 'plan-session'
  const topicId = `agent-session:${sessionId}`
  const firstId = randomUUID()
  const secondId = randomUUID()
  let runtime: AgentSessionRuntimeService
  let streams: AiStreamManager

  beforeEach(() => {
    BaseService.resetInstances()
    runtime = new AgentSessionRuntimeService()
    streams = new AiStreamManager()
    MockApplicationUtils.setService('AgentSessionRuntimeService', runtime)
    MockApplicationUtils.setService('AiStreamManager', streams)
    dbh.db.insert(agentTable).values({ id: 'agent', type: 'pi', name: 'Plan', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Work', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, agentId: 'agent', workspaceId: 'workspace', name: 'Plan', orderKey: 'a0' })
      .run()
    vi.mocked(application.get('WindowManager').broadcast).mockClear()
  })

  afterEach(() => {
    MockApplicationUtils.resetServices()
    BaseService.resetInstances()
    vi.restoreAllMocks()
  })

  function input(expectedRevision = 0): ReplaceAgentPlanDto {
    return {
      expectedRevision,
      objective: 'Ship a verified change',
      steps: [
        { id: firstId, title: 'Research', dependencyIds: [] },
        { id: secondId, title: 'Implement', dependencyIds: [firstId] }
      ]
    }
  }
  async function put(body = input(), id = sessionId) {
    return AgentPlanEntitySchema.parse(
      await agentPlanHandlers['/agent-sessions/:sessionId/plan'].PUT({ params: { sessionId: id }, body })
    )
  }
  function rows() {
    return {
      plans: dbh.db.select().from(agentPlanTable).all(),
      history: dbh.db.select().from(agentPlanHistoryTable).all(),
      identities: dbh.db.select().from(agentPlanStepIdentityTable).all()
    }
  }
  function beginTurn() {
    runtime.beginTurn({
      sessionId,
      topicId,
      agentId: 'agent',
      agentType: 'pi',
      modelId: 'test::model',
      assistantMessageId: 'reply'
    })
  }

  it('starts empty, creates one root-owned plan and reads durable state from a fresh connection', async () => {
    expect(await agentPlanHandlers['/agent-sessions/:sessionId/plan'].GET({ params: { sessionId } })).toEqual({
      plan: null
    })
    expect(agentPlanService.history(sessionId)).toEqual({ items: [] })
    const saved = await put()
    expect(AgentPlanEntitySchema.parse(saved)).toEqual(saved)
    expect(saved).toMatchObject({ sessionId, revision: 1, delivery: 'unsupported' })
    expect(saved.state.steps.map((step) => step.status)).toEqual(['pending', 'pending'])
    expect(runtime.isSessionBusy(sessionId)).toBe(false)
    expect(streams.hasUnsettledTopicWork(topicId)).toBe(false)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    const reopened = new Database(dbh.sqlite.name)
    try {
      const persisted = reopened
        .prepare('SELECT state, revision FROM agent_plan WHERE session_id = ?')
        .get(sessionId) as { state: string; revision: number }
      expect(JSON.parse(persisted.state)).toEqual(saved.state)
      expect(persisted.revision).toBe(1)
    } finally {
      reopened.close()
    }
    expect(rows().identities).toHaveLength(2)
    const history = agentPlanService.history(sessionId).items
    expect(history).toHaveLength(1)
    expect(AgentPlanHistoryEntitySchema.parse(history[0])).toEqual(history[0])
    expect(history[0]).toMatchObject({ origin: 'user-edit', revision: 1, state: saved.state })
  })

  it('edits/adds/removes/reorders pending work, keeps identity and appends immutable history', async () => {
    const before = await put()
    const oldHistory = agentPlanService.history(sessionId).items[0]
    const added = randomUUID()
    const saved = await put({
      expectedRevision: 1,
      objective: 'Updated objective',
      steps: [
        { id: secondId, title: 'Implement carefully', dependencyIds: [] },
        { id: added, title: 'Verify', dependencyIds: [secondId] }
      ]
    })
    expect(saved.id).toBe(before.id)
    expect(saved.createdAt).toBe(before.createdAt)
    expect(saved.revision).toBe(2)
    expect(saved.state.steps.map((step) => step.id)).toEqual([secondId, added])
    expect(agentPlanService.history(sessionId).items[1]).toEqual(oldHistory)
    expect(rows().identities).toHaveLength(3)
    await expect(put({ ...input(2), steps: input().steps })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(agentPlanService.get(sessionId)?.revision).toBe(2)
  })

  it('does not create revisions, history or notifications for an unchanged snapshot', async () => {
    await put()
    const before = rows()
    vi.mocked(application.get('WindowManager').broadcast).mockClear()
    expect((await put(input(1))).revision).toBe(1)
    expect(rows()).toEqual(before)
    expect(application.get('WindowManager').broadcast).not.toHaveBeenCalled()
  })

  it('serializes competing windows and refuses a stale revision without lost edits', async () => {
    const results = await Promise.allSettled([put(), put({ ...input(), objective: 'Other window' })])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(results[1]).toMatchObject({ reason: { code: 'CONFLICT' } })
    expect(rows().plans).toHaveLength(1)
    expect(rows().history).toHaveLength(1)
    expect(agentPlanService.get(sessionId)?.state.objective).toBe(input().objective)
  })

  it.each(['duplicate', 'missing', 'self', 'cycle', 'order', 'duplicate-dependency'] as const)(
    'rejects %s dependencies atomically',
    async (kind) => {
      await put()
      const before = rows()
      const dto = input(1)
      if (kind === 'duplicate') dto.steps[1].id = firstId
      if (kind === 'missing') dto.steps[1].dependencyIds = [randomUUID()]
      if (kind === 'self') dto.steps[1].dependencyIds = [secondId]
      if (kind === 'cycle') dto.steps[0].dependencyIds = [secondId]
      if (kind === 'order') dto.steps.reverse()
      if (kind === 'duplicate-dependency') dto.steps[1].dependencyIds.push(firstId)
      await expect(put(dto)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(rows()).toEqual(before)
    }
  )

  it.each(['in-progress', 'completed', 'error'] as const)(
    'preserves %s work and rejects its rewrite/removal',
    async (status) => {
      const initial = await put()
      const state = {
        ...initial.state,
        steps: initial.state.steps.map((step, index) => (index === 0 ? { ...step, status } : step))
      }
      dbh.db.update(agentPlanTable).set({ state }).where(eq(agentPlanTable.id, initial.id)).run()
      const valid = input(1)
      valid.steps[1].title = 'Pending edit'
      expect((await put(valid)).state.steps[0].status).toBe(status)
      const before = rows()
      const rewrite = input(2)
      rewrite.steps[0].title = 'Rewrite protected work'
      await expect(put(rewrite)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      await expect(put({ ...input(2), steps: [] })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(rows()).toEqual(before)
    }
  )

  it('protects the relative order of recorded steps', async () => {
    const saved = await put({ ...input(), steps: input().steps.map((step) => ({ ...step, dependencyIds: [] })) })
    dbh.db
      .update(agentPlanTable)
      .set({ state: { ...saved.state, steps: saved.state.steps.map((step) => ({ ...step, status: 'completed' })) } })
      .where(eq(agentPlanTable.id, saved.id))
      .run()
    await expect(
      put({
        ...input(1),
        steps: input()
          .steps.map((step) => ({ ...step, dependencyIds: [] }))
          .reverse()
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(agentPlanService.get(sessionId)?.revision).toBe(1)
  })

  it('keeps the host record through agent/runtime metadata changes', async () => {
    const saved = await put()
    dbh.db
      .insert(agentTable)
      .values({ id: 'other-agent', type: 'claude-code', name: 'Other runtime', instructions: '', orderKey: 'a1' })
      .run()
    agentSessionService.update(sessionId, { agentId: 'other-agent' })
    expect(agentPlanService.get(sessionId)).toEqual(saved)
    expect(agentPlanService.history(sessionId).items).toHaveLength(1)
    BaseService.resetInstances()
    runtime = new AgentSessionRuntimeService()
    MockApplicationUtils.setService('AgentSessionRuntimeService', runtime)
    expect(agentPlanService.get(sessionId)).toEqual(saved)
  })

  it('does not accept renderer-authored progress, provenance or delivery claims', async () => {
    const dto = { ...input(), steps: [{ ...input().steps[0], status: 'completed' }] }
    await expect(put(dto)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(put({ ...input(), delivery: 'delivered' } as ReplaceAgentPlanDto)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    await expect(put({ ...input(), origin: 'runtime' } as ReplaceAgentPlanDto)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    expect(rows().plans).toHaveLength(0)
  })

  it('blocks an actual admitted runtime turn without calling a native driver', async () => {
    beginTurn()
    expect(runtime.isSessionBusy(sessionId)).toBe(true)
    await expect(put()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(rows().plans).toHaveLength(0)
  })

  it('shares the dispatch gate: a launch admitted first wins and the edit refuses', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const admission = streams.withDispatchLock(topicId, async () => {
      entered.resolve()
      await release.promise
      beginTurn()
    })
    await entered.promise
    const edit = put()
    expect(rows().plans).toHaveLength(0)
    release.resolve()
    await admission
    await expect(edit).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(rows().history).toHaveLength(0)
  })

  it('commits an earlier edit before a later run can enter the shared gate', async () => {
    const edit = put()
    const admission = streams.withDispatchLock(topicId, async () => {
      expect(agentPlanService.get(sessionId)?.revision).toBe(1)
      beginTurn()
    })
    expect((await edit).revision).toBe(1)
    await admission
    await expect(put(input(1))).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(rows().history).toHaveLength(1)
  })

  it('refuses terminal persistence, pauses, pending approvals and failed closures', async () => {
    streams['terminalPersistenceCounts'].set(topicId, 1)
    await expect(put()).rejects.toMatchObject({ code: 'CONFLICT' })
    streams['terminalPersistenceCounts'].clear()
    const streamPause = streams.pause('test')
    await expect(put()).rejects.toMatchObject({ code: 'CONFLICT' })
    streamPause.dispose()
    const runtimePause = runtime.pause('test')
    await expect(put()).rejects.toMatchObject({ code: 'CONFLICT' })
    runtimePause.dispose()
    const approval = vi.spyOn(toolApprovalRegistry, 'hasSession').mockReturnValue(true)
    await expect(put()).rejects.toMatchObject({ code: 'CONFLICT' })
    approval.mockRestore()
    runtime['failedClosures'].set(sessionId, new Set())
    await expect(put()).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(rows().plans).toHaveLength(0)
  })

  it('rolls back the current plan and identities if history cannot be committed', async () => {
    await put()
    const before = rows()
    dbh.sqlite.exec(
      "CREATE TRIGGER reject_plan_history BEFORE INSERT ON agent_plan_history BEGIN SELECT RAISE(ABORT, 'test history failure'); END"
    )
    try {
      await expect(
        put({ ...input(1), steps: [...input().steps, { id: randomUUID(), title: 'New', dependencyIds: [] }] })
      ).rejects.toThrow()
      expect(rows()).toEqual(before)
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_plan_history')
    }
  })

  it('scopes reads, history and edits to active root conversations', async () => {
    await put()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'child',
        ownerSessionId: sessionId,
        type: 'background',
        agentId: 'agent',
        workspaceId: 'workspace',
        name: 'Child',
        orderKey: 'a1'
      })
      .run()
    for (const id of ['missing', 'child']) {
      expect(() => agentPlanService.get(id)).toThrow()
      expect(() => agentPlanService.history(id)).toThrow()
      await expect(put(input(), id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    dbh.db.update(agentSessionTable).set({ deletedAt: Date.now() }).where(eq(agentSessionTable.id, sessionId)).run()
    expect(() => agentPlanService.get(sessionId)).toThrow()
    await expect(put(input(1))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(rows().plans).toHaveLength(1)
  })

  it('hard-deletes owned plan/history/identities, leaving another session untouched', async () => {
    await put()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'other', workspaceId: 'workspace', name: 'Other', orderKey: 'a1' })
      .run()
    const other = await put(input(), 'other')
    agentSessionService.delete(sessionId)
    expect(() => agentPlanService.get(sessionId)).toThrow()
    expect(rows().plans).toHaveLength(2)
    agentSessionService.delete(sessionId, { permanent: true })
    expect(rows().plans.map((row) => row.id)).toEqual([other.id])
    expect(rows().history.every((row) => row.planId === other.id)).toBe(true)
    expect(rows().identities.every((row) => row.planId === other.id)).toBe(true)
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('pages history by revision and broadcasts only endpoint/scoped invalidations', async () => {
    await put()
    await put({ ...input(1), objective: 'Second revision' })
    await put({ ...input(2), objective: 'Third revision' })
    const page = agentPlanService.history(sessionId, { limit: 2 })
    expect(page.items.map((item) => item.revision)).toEqual([3, 2])
    expect(page.nextCursor).toMatch(/^2:/)
    expect(
      agentPlanService.history(sessionId, { limit: 2, cursor: page.nextCursor }).items.map((item) => item.revision)
    ).toEqual([1])
    const broadcast = application.get('WindowManager').broadcast
    expect(JSON.stringify(vi.mocked(broadcast).mock.calls)).not.toContain(input().objective)
    expect(
      vi
        .mocked(broadcast)
        .mock.calls.some((call) => JSON.stringify(call).includes('/agent-sessions/:sessionId/plan/history'))
    ).toBe(true)
    vi.mocked(broadcast).mockClear()
    agentSessionService.notifyPurged([sessionId])
    expect(JSON.stringify(vi.mocked(broadcast).mock.calls)).toContain('/agent-sessions/:sessionId/plan')
  })
})
