import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionContextUsageSnapshot } from '@shared/ai/agentSessionContextUsage'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { createAgentSessionRuntimeState } from '../agentSessionRuntimeState'

const freshService = () => {
  BaseService.resetInstances()
  return new AgentSessionRuntimeService()
}

const KEY = AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session')
describe('root context snapshot restoration', () => {
  const dbh = setupTestDatabase()
  let snapshot: AgentSessionContextUsageSnapshot
  const cache = () => application.get('CacheService')
  const read = () => agentSessionService.getContextUsageSnapshot('session')
  const write = (value: AgentSessionContextUsageSnapshot | null) =>
    agentSessionService.setContextUsageSnapshot('session', value)
  beforeEach(() => {
    cache().deleteShared(KEY)
    dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'test::model',
        providerId: 'test',
        modelId: 'model',
        name: 'Model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        type: 'missing-driver',
        name: 'Agent',
        instructions: '',
        model: 'test::model',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Work', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
    const head = messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'success', data: { parts: [] } }
    })
    const backend = contexts.ensureBackendTx(dbh.db, { version: 1, kind: 'pi' }, 'bound')
    const context = contexts.reserveBranchTx(dbh.db, {
      sessionId: 'session',
      backendId: backend.id,
      nativeThreadId: 'native',
      anchorMessageId: head.id
    })
    contexts.bindContext(context.id, 'native')
    const service = freshService()
    const identity = service['captureContextUsageIdentity']('session')!
    expect(identity).toBeDefined()
    snapshot = {
      ...identity,
      measuredAt: '2026-11-12T00:00:00.000Z',
      usage: {
        model: 'native-model',
        revision: 'r1',
        contextWindow: 100,
        used: { tokens: 40, precision: 'reported' },
        basis: 'current-context'
      }
    }
    write(snapshot)
  })

  it('preserves updatedAt and skips identical snapshot writes', () => {
    const before = dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'session')).get()!.updatedAt
    dbh.sqlite.exec(`CREATE TEMP TABLE snapshot_updates (id TEXT);
      CREATE TEMP TRIGGER count_snapshot_updates AFTER UPDATE ON agent_session
      BEGIN INSERT INTO snapshot_updates VALUES (NEW.id); END`)
    write({ ...snapshot, measuredAt: 'later' })
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'session')).get()!.updatedAt).toBe(
      before
    )
    write({ ...snapshot, measuredAt: 'later' })
    expect(dbh.sqlite.prepare('SELECT count(*) AS count FROM snapshot_updates').get()).toEqual({ count: 1 })
    dbh.sqlite.exec('DROP TRIGGER count_snapshot_updates; DROP TABLE snapshot_updates')
  })

  it.each([null, '', 1, []])('clears invalid snapshot usage %s', (usage) => {
    write({ ...snapshot, usage } as unknown as AgentSessionContextUsageSnapshot)
    freshService()['restoreContextUsageSnapshot']('session')
    expect(read()).toBeNull()
    expect(cache().getShared(KEY)).toBeUndefined()
  })

  it.each(['modelId', 'contextId', 'headMessageId', 'headUpdatedAt', 'measuredAt'] as const)(
    'clears a snapshot with an empty %s',
    (key) => {
      write({ ...snapshot, [key]: '' })
      freshService()['restoreContextUsageSnapshot']('session')
      expect(read()).toBeNull()
    }
  )

  it('updates only sessions with snapshots on agent edits', async () => {
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: 'session-2', agentId: 'agent', workspaceId: 'workspace', name: 'Two', orderKey: 'a1' },
        { id: 'session-3', agentId: 'agent', workspaceId: 'workspace', name: 'Three', orderKey: 'a2' }
      ])
      .run()
    write(null)
    dbh.sqlite.exec(`CREATE TEMP TABLE snapshot_updates (id TEXT);
      CREATE TEMP TRIGGER count_snapshot_updates AFTER UPDATE ON agent_session
      BEGIN INSERT INTO snapshot_updates VALUES (NEW.id); END`)
    const service = freshService()
    await service['handleAgentUpdated']('agent', { model: null }, agentService.getAgent('agent')!)
    expect(dbh.sqlite.prepare('SELECT id FROM snapshot_updates').all()).toEqual([])
    write(snapshot)
    agentSessionService.setContextUsageSnapshot('session-3', snapshot)
    dbh.sqlite.exec('DELETE FROM snapshot_updates')
    await service['handleAgentUpdated']('agent', { model: null }, agentService.getAgent('agent')!)
    expect(dbh.sqlite.prepare('SELECT id FROM snapshot_updates ORDER BY id').all()).toEqual([
      { id: 'session' },
      { id: 'session-3' }
    ])
    dbh.sqlite.exec('DROP TRIGGER count_snapshot_updates; DROP TABLE snapshot_updates')
  })

  it('restores in a fresh instance without a driver or connection', async () => {
    await freshService().primeConnection('session')
    expect(cache().getShared(KEY)).toEqual({
      modelId: snapshot.modelId,
      result: { status: 'confirmed', value: snapshot.usage },
      snapshot: { restored: true, measuredAt: snapshot.measuredAt }
    })
  })

  it('restores before an existing entry fails to connect', async () => {
    const service = freshService()
    service['entries'].set('session', {} as never)
    vi.spyOn(service as unknown as { ensureConnection: () => Promise<boolean> }, 'ensureConnection').mockRejectedValue(
      new Error('connect failed')
    )
    await service.primeConnection('session')
    expect(cache().getShared(KEY)?.snapshot?.restored).toBe(true)
  })

  it.each(['modelId', 'contextId', 'headMessageId', 'headUpdatedAt'] as const)(
    'rejects a reading with a mismatched %s',
    (key) => {
      write({ ...snapshot, [key]: 'different' })
      freshService()['restoreContextUsageSnapshot']('session')
      expect(cache().getShared(KEY)).toBeUndefined()
      expect(read()).toBeNull()
    }
  )

  it('rejects an unbound context', () => {
    dbh.db
      .update(agentSessionContextTable)
      .set({ bindingState: 'pending' })
      .where(eq(agentSessionContextTable.id, snapshot.contextId))
      .run()
    freshService()['restoreContextUsageSnapshot']('session')
    expect(cache().getShared(KEY)).toBeUndefined()
    expect(read()).toBeNull()
  })

  it('preserves a newer live publication', () => {
    const live = {
      modelId: snapshot.modelId,
      result: { status: 'confirmed' as const, value: { ...snapshot.usage, revision: 'r2' } }
    }
    cache().setShared(KEY, live)
    freshService()['restoreContextUsageSnapshot']('session')
    expect(cache().getShared(KEY)).toEqual(live)
  })

  const attach = (service: AgentSessionRuntimeService, getContextUsage = vi.fn()) => {
    const connection = { contextId: snapshot.contextId, getContextUsage }
    const runtimeState = createAgentSessionRuntimeState()
    runtimeState.execution = { kind: 'idle', lastTurn: turnFor(snapshot.headMessageId) }
    runtimeState.connection = { kind: 'connected', connection: connection as never, occupancy: {} }
    const entry = {
      sessionId: 'session',
      agentId: 'agent',
      modelId: snapshot.modelId,
      contextUsageModel: snapshot.modelId,
      contextUsageReading: undefined as Parameters<
        AgentSessionRuntimeService['settleContextUsageSnapshot']
      >[0]['contextUsageReading'],
      runtimeState,
      connection
    }
    service['entries'].set('session', entry as never)
    return entry
  }

  const turnFor = (assistantMessageId: string, turnId = `turn:${assistantMessageId}`) => ({
    assistantMessageId,
    turnId,
    modelId: snapshot.modelId,
    userMessage: { id: 'user', role: 'user', parts: [] }
  })

  const persistAssistant = async (
    service: AgentSessionRuntimeService,
    entry: ReturnType<typeof attach>,
    id: string,
    turn = turnFor(id)
  ) => {
    const listener = service['createPersistenceListener'](entry as never, turn as never)
    await listener.onDone({
      modelId: snapshot.modelId,
      finalMessage: { id, role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] }
    } as never)
  }

  it('publishes, saves and restores when the read resolves after assistant persistence', async () => {
    const service = freshService()
    const deferred = Promise.withResolvers<unknown>()
    const entry = attach(
      service,
      vi.fn(() => deferred.promise)
    )
    const n = messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    entry.runtimeState.execution = createAgentSessionRuntimeState(turnFor(n.id)).execution
    write(null)
    const before = service['captureContextUsageIdentity']('session')!
    service['refreshContextUsage'](entry as never)
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await persistAssistant(service, entry, n.id)
    now.mockRestore()
    const settled = service['captureContextUsageIdentity']('session')!
    expect(settled.headMessageId).toBe(before.headMessageId)
    expect(settled.headUpdatedAt).not.toBe(before.headUpdatedAt)
    deferred.resolve({ status: 'confirmed', value: snapshot.usage })
    await vi.waitFor(() =>
      expect((entry as unknown as { contextUsageRefresh?: unknown }).contextUsageRefresh).toBeUndefined()
    )
    expect(cache().getShared(KEY)?.result).toEqual({ status: 'confirmed', value: snapshot.usage })
    expect(read()).toMatchObject({
      ...settled,
      usage: snapshot.usage
    })
    cache().deleteShared(KEY)
    await freshService().primeConnection('session')
    expect(cache().getShared(KEY)).toMatchObject({
      result: { status: 'confirmed', value: snapshot.usage },
      snapshot: { restored: true }
    })
  })

  it('captures producing turn A before awaiting while the runtime moves to turn B', async () => {
    const service = freshService()
    const deferred = Promise.withResolvers<unknown>()
    const entry = attach(
      service,
      vi.fn(() => deferred.promise)
    )
    const a = turnFor(crypto.randomUUID())
    const b = turnFor(crypto.randomUUID())
    entry.runtimeState = createAgentSessionRuntimeState(a)
    entry.runtimeState.connection = { kind: 'connected', connection: entry.connection as never, occupancy: {} }
    write(null)
    const writes = vi.spyOn(agentSessionService, 'setContextUsageSnapshot')
    service['refreshContextUsage'](entry as never)
    service['applyRuntimeStateEvent'](entry as never, { type: 'steer-boundary', turn: b as never })
    expect(service['currentTurn'](entry as never)?.assistantMessageId).toBe(b.assistantMessageId)
    deferred.resolve({ status: 'confirmed', value: snapshot.usage })
    await vi.waitFor(() =>
      expect((entry as unknown as { contextUsageRefresh?: unknown }).contextUsageRefresh).toBeUndefined()
    )
    expect.soft(entry.contextUsageReading?.turnAssistantMessageId).toBe(a.assistantMessageId)
    await persistAssistant(service, entry, a.assistantMessageId, a)
    expect.soft(read()).toMatchObject({
      headMessageId: a.assistantMessageId,
      usage: snapshot.usage
    })
    await persistAssistant(service, entry, b.assistantMessageId, b)
    for (const [, value] of writes.mock.calls) {
      expect(value).not.toMatchObject({ headMessageId: b.assistantMessageId, usage: snapshot.usage })
    }
    expect(entry.connection.getContextUsage).toHaveBeenCalledTimes(1)
  })

  it('does not settle attempt 1 usage through attempt 2 with the same assistant message id', async () => {
    const service = freshService()
    const entry = attach(
      service,
      vi.fn(async () => ({ status: 'confirmed', value: snapshot.usage }))
    )
    const n = messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    const first = turnFor(n.id, 'attempt-1')
    entry.runtimeState.execution = createAgentSessionRuntimeState(first).execution
    write(null)
    service['refreshContextUsage'](entry as never)
    await vi.waitFor(() => expect(entry.contextUsageReading).toBeDefined())
    const second = turnFor(n.id, 'attempt-2')
    entry.runtimeState.execution = createAgentSessionRuntimeState(second).execution
    await persistAssistant(service, entry, n.id, second)
    expect(read()).toBeNull()
  })

  it('settles a reading under its producing turn through the production persistence callback and restores it', async () => {
    const service = freshService()
    const getContextUsage = vi.fn(async () => ({ status: 'confirmed', value: snapshot.usage }))
    const entry = attach(service, getContextUsage)
    const n = messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    entry.runtimeState.execution = createAgentSessionRuntimeState(turnFor(n.id)).execution
    write(null)
    service['refreshContextUsage'](entry as never)
    await vi.waitFor(() => expect(entry.contextUsageReading).toBeDefined())
    const measuredAt = entry.contextUsageReading!.measuredAt
    expect(read()).toBeNull()
    const live = cache().getShared(KEY)
    const calls = getContextUsage.mock.calls.length
    const epoch = (entry as unknown as { contextUsageEpoch?: number }).contextUsageEpoch
    const publications = vi.spyOn(cache(), 'setShared')
    publications.mockClear()
    await persistAssistant(service, entry, n.id)
    expect(getContextUsage).toHaveBeenCalledTimes(calls)
    expect(publications).not.toHaveBeenCalled()
    expect((entry as unknown as { contextUsageEpoch?: number }).contextUsageEpoch).toBe(epoch)
    expect(cache().getShared(KEY)).toEqual(live)
    expect(read()).toMatchObject({
      usage: snapshot.usage,
      measuredAt,
      headMessageId: n.id,
      headUpdatedAt: messages.getSessionMessage('session', n.id).updatedAt
    })
    expect(entry.contextUsageReading).toBeUndefined()
    cache().deleteShared(KEY)
    freshService()['restoreContextUsageSnapshot']('session')
    expect(cache().getShared(KEY)).toMatchObject({
      result: { status: 'confirmed', value: snapshot.usage },
      snapshot: { restored: true, measuredAt }
    })
  })

  it('the producing message gate alone rejects a pending A reading under another head', async () => {
    const service = freshService()
    const entry = attach(service)
    const a = snapshot.headMessageId
    const b = messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'success', data: { parts: [] } }
    })
    write(null)
    // Even an otherwise matching identity cannot move an A-tagged reading to B.
    entry.contextUsageReading = {
      usage: snapshot.usage,
      measuredAt: snapshot.measuredAt,
      turnAssistantMessageId: a,
      turnId: turnFor(b.id).turnId,
      identity: service['captureContextUsageIdentity']('session')!
    }
    await persistAssistant(service, entry, b.id)
    await persistAssistant(service, entry, a)
    await persistAssistant(service, entry, a)
    expect(read()).toBeNull()
    expect(entry.connection.getContextUsage).not.toHaveBeenCalled()
  })

  it.each(['modelId', 'contextId'] as const)('does not settle across a changed %s', async (key) => {
    const service = freshService()
    const entry = attach(service)
    entry.contextUsageReading = {
      usage: snapshot.usage,
      measuredAt: snapshot.measuredAt,
      turnAssistantMessageId: snapshot.headMessageId,
      turnId: turnFor(snapshot.headMessageId).turnId,
      identity: { ...service['captureContextUsageIdentity']('session')!, [key]: 'changed' }
    }
    write(null)
    await persistAssistant(service, entry, snapshot.headMessageId)
    expect(read()).toBeNull()
    expect(entry.connection.getContextUsage).not.toHaveBeenCalled()
  })

  it.each(['invalidate', 'reset'] as const)('clears pending readings on %s', (action) => {
    const service = freshService()
    const entry = attach(service)
    service['persistContextUsage'](entry as never, { status: 'confirmed', value: snapshot.usage })
    expect(entry.contextUsageReading).toBeDefined()
    if (action === 'invalidate') service['invalidateContextUsage'](entry as never)
    else service['resetConnectionRuntimeState'](entry as never, entry.connection as never)
    expect(entry.contextUsageReading).toBeUndefined()
  })

  it.each(['close', 'terminal'] as const)('clears another turn’s pending reading on %s cleanup', async (action) => {
    const service = freshService()
    const entry = attach(
      service,
      vi.fn(async () => ({ status: 'confirmed', value: snapshot.usage }))
    )
    write(null)
    service['refreshContextUsage'](entry as never)
    await vi.waitFor(() => expect(entry.contextUsageReading).toBeDefined())
    if (action === 'close') service['closeConnection'](entry as never, false)
    else {
      const other = turnFor(crypto.randomUUID())
      entry.runtimeState.execution = createAgentSessionRuntimeState(other).execution
      vi.spyOn(service as unknown as { refreshIdleTimer: () => void }, 'refreshIdleTimer').mockImplementation(() => {})
      service.markTurnTerminal('session', 'success', other.turnId)
    }
    expect(entry.contextUsageReading).toBeUndefined()
  })

  it('publishes head drift without saving under the newer head', async () => {
    const service = freshService()
    const deferred = Promise.withResolvers<unknown>()
    const entry = attach(
      service,
      vi.fn(() => deferred.promise)
    )
    write(null)
    service['refreshContextUsage'](entry as never)
    messages.saveMessage({ sessionId: 'session', message: { role: 'user', data: { parts: [] } } })
    deferred.resolve({ status: 'confirmed', value: snapshot.usage })
    await vi.waitFor(() =>
      expect((entry as unknown as { contextUsageRefresh?: unknown }).contextUsageRefresh).toBeUndefined()
    )
    expect(cache().getShared(KEY)?.result).toEqual({ status: 'confirmed', value: snapshot.usage })
    expect(read()).toBeNull()
  })

  it('cannot restore a published pending reading after the service is lost before persistence', async () => {
    const service = freshService()
    const entry = attach(
      service,
      vi.fn(async () => ({ status: 'confirmed', value: snapshot.usage }))
    )
    const n = messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    entry.runtimeState.execution = createAgentSessionRuntimeState(turnFor(n.id)).execution
    write(null)
    service['refreshContextUsage'](entry as never)
    await vi.waitFor(() => expect(entry.contextUsageReading).toBeDefined())
    expect(cache().getShared(KEY)?.result.status).toBe('confirmed')
    cache().deleteShared(KEY)
    await freshService().primeConnection('session')
    expect(cache().getShared(KEY)).toBeUndefined()
    expect(read()).toBeNull()
  })

  it('publishes without saving a reading that has no producing turn', () => {
    const service = freshService()
    const entry = attach(service)
    entry.runtimeState.execution = { kind: 'idle' }
    write(null)
    service['persistContextUsage'](entry as never, { status: 'confirmed', value: snapshot.usage })
    expect(cache().getShared(KEY)?.result).toEqual({ status: 'confirmed', value: snapshot.usage })
    expect(read()).toBeNull()
    expect(entry.contextUsageReading).toBeUndefined()
  })

  it('keeps both tiers on transport reset and removes both on semantic invalidation', () => {
    const service = freshService()
    service['restoreContextUsageSnapshot']('session')
    const entry = attach(service)
    service['resetConnectionRuntimeState'](entry as never, entry.connection as never)
    expect(cache().getShared(KEY)?.snapshot?.restored).toBe(true)
    expect(read()).toEqual(snapshot)
    service.invalidateSessionContextUsage('session')
    expect(cache().getShared(KEY)).toBeUndefined()
    expect(read()).toBeNull()
  })

  it.each(['epoch', 'model', 'connection'] as const)('rejects a late read after %s changes', async (change) => {
    const service = freshService()
    let resolve!: (value: unknown) => void
    const entry = attach(
      service,
      vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    )
    service['refreshContextUsage'](entry as never)
    if (change === 'epoch') service.invalidateSessionContextUsage('session')
    if (change === 'model') entry.modelId = 'test::other'
    if (change === 'connection') entry.runtimeState.connection = { kind: 'disconnected' }
    resolve({ status: 'confirmed', value: { ...snapshot.usage, revision: 'late' } })
    await vi.waitFor(() =>
      expect((entry as unknown as { contextUsageRefresh?: unknown }).contextUsageRefresh).toBeUndefined()
    )
    expect(cache().getShared(KEY)).toBeUndefined()
    expect(read()?.usage.revision).not.toBe('late')
  })

  it('publishes and saves a settled live reading without restored metadata', () => {
    const service = freshService()
    const entry = attach(service)
    const usage = { ...snapshot.usage, revision: 'r2' }
    service['persistContextUsage'](entry as never, { status: 'confirmed', value: usage })
    expect(cache().getShared(KEY)).toEqual({ modelId: snapshot.modelId, result: { status: 'confirmed', value: usage } })
    expect(read()).toMatchObject({
      usage,
      headMessageId: snapshot.headMessageId
    })
  })

  it('removes the saved fallback after an authoritative unavailable result', () => {
    const service = freshService()
    const entry = attach(service)
    service['persistContextUsage'](entry as never, {
      status: 'unknown',
      error: { operation: 'contextUsage', code: 'reset', message: 'Reset' }
    })
    expect(cache().getShared(KEY)?.result.status).toBe('unknown')
    expect(read()).toBeNull()
    freshService()['restoreContextUsageSnapshot']('session')
    expect(cache().getShared(KEY)?.result.status).toBe('unknown')
  })

  it('does not restore an ancestor after a newer saved output', () => {
    messages.saveMessage({
      sessionId: 'session',
      message: { role: 'assistant', status: 'success', data: { parts: [] } }
    })
    freshService()['restoreContextUsageSnapshot']('session')
    expect(cache().getShared(KEY)).toBeUndefined()
    expect(read()).toBeNull()
  })

  it('hydrates during a warm-lease acquisition that cancels teardown', () => {
    const service = freshService()
    service['pendingWarmTeardowns'].set(
      'session',
      setTimeout(() => {}, 10000)
    )
    const prime = vi.spyOn(service, 'primeConnection').mockRejectedValue(new Error('Must skip connection'))
    service.acquireWarmLease('session', undefined)
    expect(cache().getShared(KEY)?.snapshot?.restored).toBe(true)
    expect(prime).not.toHaveBeenCalled()
  })
  it('model clear and restoration cannot resurrect an inactive session reading', async () => {
    const service = freshService()
    service['restoreContextUsageSnapshot']('session')
    dbh.db.update(agentTable).set({ model: null }).where(eq(agentTable.id, 'agent')).run()
    await service['handleAgentUpdated']('agent', { model: null }, agentService.getAgent('agent')!)
    expect(cache().getShared(KEY)).toBeUndefined()
    expect(read()).toBeNull()
    dbh.db.update(agentTable).set({ model: 'test::model' }).where(eq(agentTable.id, 'agent')).run()
    service['restoreContextUsageSnapshot']('session')
    expect(cache().getShared(KEY)).toBeUndefined()
  })

  it('model edits also remove a shared-only reading after its runtime entry is gone', async () => {
    const service = freshService()
    write(null)
    cache().setShared(KEY, { modelId: snapshot.modelId, result: { status: 'confirmed', value: snapshot.usage } })
    await service['handleAgentUpdated']('agent', { model: null }, agentService.getAgent('agent')!)
    expect(cache().getShared(KEY)).toBeUndefined()
  })
})
