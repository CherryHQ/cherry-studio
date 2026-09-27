import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import type { UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type * as RemoteProtocol from '@cherrystudio/remote-protocol'
import { remoteLimits } from '@cherrystudio/remote-protocol'
import {
  type AgentCheckpointPage,
  type AgentEventBatch,
  type AgentProjection,
  applyAgentEvents,
  installAgentCheckpoint
} from '@cherrystudio/remote-protocol/agent'
import type { SecureChannel } from '@cherrystudio/remote-transport'
import { agentTable } from '@data/db/schemas/agent'
import { pinTable } from '@data/db/schemas/pin'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import type { DbOrTx } from '@data/db/types'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import { remoteCommandService } from '@data/services/RemoteCommandService'
import { AgentSessionMessageBackend } from '@main/ai/agentSession/persistence/AgentSessionMessageBackend'
import { startAgentSessionRun, type StreamListener } from '@main/ai/streamManager'
import type { StreamErrorResult } from '@main/ai/streamManager'
import {
  agentChatContextProvider,
  AgentChatContextProvider
} from '@main/ai/streamManager/context/AgentChatContextProvider'
import { PersistenceListener } from '@main/ai/streamManager/listeners/PersistenceListener'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import type { CherryMessagePart } from '@shared/data/types/message'

import { RemoteAgentHub } from '../agentJournal'
import { sha256, sliceContent, toMessageModel } from '../agentQueries'
import { RemoteConnection } from '../RemoteConnection'
import { RemotePairing } from '../RemotePairing'
import { RemoteTokens } from '../RemoteTokens'

const fake = vi.hoisted(() => {
  const streams = new Map<string, StreamListener[]>()
  return {
    streams,
    replayBudget: undefined as number | undefined,
    onStarted: undefined as undefined | ((listeners: StreamListener[]) => Promise<void>),
    manager: {
      withDispatchLock: vi.fn(async (_topic: string, run: () => Promise<unknown>) => run()),
      whenTerminalDispatchSettled: async () => {},
      isWriteQuiesced: false,
      send: vi.fn(),
      hasLiveStream: (topicId: string) => streams.has(topicId),
      addListener: (topicId: string, listener: StreamListener) => {
        const listeners = streams.get(topicId)
        if (!listeners) return false
        listeners.push(listener)
        return true
      },
      abortAndDrain: vi.fn(async (_topicId: string, _reason: string, beforeAbort?: () => void) => {
        beforeAbort?.()
      })
    },
    runtime: { assertSessionWritable() {}, isSessionBusy: () => false, respondToolApproval: vi.fn(() => true) }
  }
})

vi.mock('@cherrystudio/remote-protocol', async (importOriginal) => {
  const original = await importOriginal<typeof RemoteProtocol>()
  return {
    ...original,
    remoteLimits: {
      ...original.remoteLimits,
      get globalReplayBytes() {
        return fake.replayBudget ?? original.remoteLimits.globalReplayBytes
      }
    }
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiStreamManager: fake.manager, AgentSessionRuntimeService: fake.runtime } as never)
})

vi.mock('@main/ai/streamManager', () => ({
  startAgentSessionRun: vi.fn(
    async (input: {
      sessionId: string
      userParts: CherryMessagePart[]
      listeners: StreamListener[]
      beforePersist?: () => void
      onPersist?: (tx: DbOrTx, messages: { assistantMessageId: string; userMessageId: string }) => void
    }) => {
      const topicId = `agent-session:${input.sessionId}`
      if (fake.streams.has(topicId)) return { mode: 'not-started', reason: 'busy' }
      const { application } = await import('@application')
      application.get('DbService').withWriteTx((tx) => {
        input.beforePersist?.()
        const userMessageId = randomUUID()
        agentSessionMessageService.saveMessagesTx(tx, {
          sessionId: input.sessionId,
          messages: [{ id: userMessageId, role: 'user', data: { parts: input.userParts } }]
        })
        input.onPersist?.(tx, { assistantMessageId: randomUUID(), userMessageId })
      })
      fake.streams.set(topicId, [...input.listeners])
      await fake.onStarted?.(input.listeners)
      return { mode: 'started' }
    }
  )
}))

const integrity = { sha256 }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 3))

function makeChannel(remoteIdentity: string, notifications: unknown[]): SecureChannel {
  return {
    remoteIdentity,
    protocolVersion: 1,
    offeredVersions: [1],
    async read() {
      throw new Error('Unused')
    },
    async write(value) {
      notifications.push(value)
    },
    async close() {},
    abort() {}
  }
}

describe('remote agent access', () => {
  const dbh = setupTestDatabase()
  const hub = new RemoteAgentHub()
  function seedModel(providerId: string, modelId: string, name: string) {
    dbh.db.insert(userProviderTable).values({ providerId, name: 'Desktop provider', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: `${providerId}::${modelId}`,
        providerId,
        modelId,
        name,
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
  }
  const notifications: unknown[] = []
  let connection: RemoteConnection
  let sessionId: string

  const call = async (method: string, params: unknown): Promise<any> => {
    const response = (await connection.rpc.receive(
      { jsonrpc: '2.0', id: randomUUID(), method, params },
      undefined
    )) as { result?: unknown; error?: unknown }
    if (response.error) throw response.error
    return response.result
  }
  it('returns a durable target rejection with the admission reason and never resends it', async () => {
    const start = vi.mocked(startAgentSessionRun)
    start.mockRejectedValueOnce(
      new AgentSessionDeliveryRoutingError('TARGET_UNAVAILABLE', 'Agent has no model configured')
    )
    const { session } = await call('agent.sessions.get', { sessionId })
    const params = { commandId: randomUUID(), sessionId, text: 'hello', expectedIdleRevision: session.idleRevision }
    const result = await call('agent.messages.send', params)
    expect(result).toMatchObject({
      status: 'rejected',
      error: { reason: 'TARGET_UNAVAILABLE', message: 'Agent has no model configured' }
    })
    const calls = start.mock.calls.length
    expect(await call('agent.messages.send', params)).toEqual(result)
    expect(start.mock.calls.length).toBe(calls)
    expect(await call('agent.commands.get', { commandId: params.commandId })).toEqual(result)
  })
  const emit = (chunk: UIMessageChunk, anchorMessageId: string) => {
    for (const listener of fake.streams.get(`agent-session:${sessionId}`) ?? [])
      listener.onChunk(chunk, undefined, anchorMessageId)
  }
  const finish = async (
    anchorMessageId: string,
    parts: CherryMessagePart[],
    status: 'success' | 'paused' = 'success'
  ) => {
    await tick()
    const saved = agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: anchorMessageId, role: 'assistant', status, data: { parts } }
    })
    const persistence = {
      status: 'saved' as const,
      message: {
        messageId: saved.id,
        messageRevision: String(Date.parse(saved.updatedAt)),
        historyRevision: String(Date.parse(agentSessionService.getConversationById(sessionId).updatedAt))
      }
    }
    const listeners = fake.streams.get(`agent-session:${sessionId}`) ?? []
    fake.streams.delete(`agent-session:${sessionId}`)
    for (const listener of listeners) {
      if (status === 'success') void listener.onDone({ status: 'success', isTopicDone: true, persistence })
      else void listener.onPaused({ status: 'paused', isTopicDone: true, persistence })
    }
  }
  const drain = async (projection: AgentProjection): Promise<AgentProjection> => {
    for (let i = 0; i < 5; i++) await tick()
    for (const notification of notifications.splice(0) as Array<{ method: string; params: AgentEventBatch }>) {
      expect(notification.method).toBe('agent.events')
      const applied = applyAgentEvents(projection, notification.params, {}, integrity)
      if (!applied.ok) throw new Error(`Reducer rejected batch: ${applied.reason}`)
      projection = applied.projection
      await call('agent.subscriptions.ack', {
        subscriptionId: notification.params.subscriptionId,
        cursor: applied.cursor
      })
    }
    return projection
  }
  const installCheckpoint = async (subscriptionId: string, descriptor: { checkpointId: string; pageCount: number }) => {
    const pages: AgentCheckpointPage[] = []
    for (let cursor: string | undefined; pages.length < descriptor.pageCount;) {
      const page: AgentCheckpointPage = await call('agent.checkpoints.read', {
        subscriptionId,
        checkpointId: descriptor.checkpointId,
        ...(cursor ? { pageCursor: cursor } : {})
      })
      pages.push(page)
      cursor = page.nextCursor ?? undefined
    }
    const installed = installAgentCheckpoint(descriptor as never, pages, {}, integrity)
    if (!installed.ok) throw new Error(`Checkpoint rejected: ${installed.reason}`)
    return installed
  }

  afterEach(() => {
    connection.dispose()
    hub.dispose()
    vi.useRealTimers()
  })

  beforeEach(async () => {
    fake.streams.clear()
    fake.replayBudget = undefined
    fake.onStarted = undefined
    notifications.length = 0
    fake.runtime.respondToolApproval.mockClear()
    await dbh.db.insert(agentTable).values({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Agent',
      instructions: '',
      model: null,
      orderKey: 'a0',
      configuration: { avatar: '🧑🏽‍💻' }
    })
    const workspace = dbh.db.transaction((tx) =>
      agentWorkspaceService.findOrCreateByPathTx(tx, path.join('/tmp', 'remote-agent-test'))
    )
    sessionId = agentSessionService.create({
      agentId: 'agent-1',
      name: 'Chat',
      workspace: { type: 'user', workspaceId: workspace.id }
    }).id
    const { device } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Phone',
      platform: 'ios',
      peerIdentity: 'phone',
      capabilities: ['agent']
    })
    connection = new RemoteConnection(
      makeChannel('phone', notifications),
      new RemotePairing(),
      new RemoteTokens(),
      () => {},
      hub
    )
    await call('connection.hello', { protocolVersions: [1] })
    await call('connection.authenticate', { deviceId: device.id })
  })

  it.each([false, true])(
    'preserves a provider rejection through events and durable history (partial=%s)',
    async (partial) => {
      const { session } = await call('agent.sessions.get', { sessionId })
      const prepared = await call('agent.sessions.subscribe', { sessionId })
      let projection = (await installCheckpoint(prepared.subscriptionId, prepared.checkpoint)).projection
      await call('agent.subscriptions.activate', {
        subscriptionId: prepared.subscriptionId,
        appliedCursor: projection.cursor
      })
      const commandId = randomUUID()
      const receipt = await call('agent.messages.send', {
        commandId,
        sessionId,
        text: 'hello',
        expectedIdleRevision: session.idleRevision
      })
      const anchor = randomUUID()
      if (partial) {
        emit({ type: 'text-start', id: 'text' }, anchor)
        emit({ type: 'text-delta', id: 'text', delta: 'Partial answer' }, anchor)
      }
      const result: StreamErrorResult = {
        status: 'error',
        isTopicDone: true,
        anchorMessageId: anchor,
        error: {
          name: 'Error',
          stack: 'private stack',
          message:
            '403: {"type":"server_error","message":"An active OpenCode Go subscription is required to use Go models."}'
        },
        ...(partial
          ? { finalMessage: { id: anchor, role: 'assistant', parts: [{ type: 'text', text: 'Partial answer' }] } }
          : {})
      }
      const persistence = new PersistenceListener({
        topicId: `agent-session:${sessionId}`,
        backend: new AgentSessionMessageBackend({ sessionId, assistantMessageId: anchor }),
        onPersistFailed: () => {
          throw new Error('Unexpected persistence failure')
        }
      })
      await tick()
      await persistence.onError(result)
      for (const listener of fake.streams.get(`agent-session:${sessionId}`) ?? []) await listener.onError(result)
      fake.streams.delete(`agent-session:${sessionId}`)
      projection = await drain(projection)
      expect(projection.executions[receipt.executionId]).toMatchObject({
        status: 'failed',
        messageId: anchor,
        durable: true,
        failure: { failure: { reasonCode: 'permission', source: { layer: 'provider' }, context: { statusCode: 403 } } }
      })
      expect(projection.messages[anchor]).toBeUndefined()
      const history = await call('agent.messages.list', {
        sessionId,
        historyRevision: projection.session.historyRevision
      })
      const message = history.items.find((item: { messageId: string }) => item.messageId === anchor)
      expect(message).toMatchObject({ status: 'error', failure: projection.executions[receipt.executionId].failure })
      expect(message.failure.message).toContain('OpenCode Go subscription')
      const stored = agentSessionMessageService.getSessionMessage(sessionId, anchor)
      expect(stored.data.parts?.filter((part) => part.type === 'text')).toHaveLength(partial ? 1 : 0)
      expect(await call('agent.commands.get', { commandId })).toMatchObject({ status: 'applied' })
      expect(await call('connection.ping', { nonce: 'still-connected' })).toMatchObject({ nonce: 'still-connected' })
      await call('agent.subscriptions.close', { subscriptionId: prepared.subscriptionId })
      const checkpoint = await call('agent.sessions.subscribe', { sessionId })
      const restored = await installCheckpoint(checkpoint.subscriptionId, checkpoint.checkpoint)
      expect(restored.projection.executions[receipt.executionId]).toEqual(projection.executions[receipt.executionId])
      const restarted = new RemoteAgentHub().journal(sessionId).capture()
      const baseline = installAgentCheckpoint(restarted.descriptor, restarted.pages, {}, integrity)
      expect(baseline.ok).toBe(true)
      if (!baseline.ok) throw new Error(baseline.reason)
      expect(Object.keys(baseline.projection.executions)).toHaveLength(0)
      const reopened = await call('agent.messages.list', {
        sessionId,
        historyRevision: baseline.projection.session.historyRevision
      })
      expect(reopened.items.find((item: { messageId: string }) => item.messageId === anchor)).toMatchObject({
        status: 'error',
        failure: message.failure
      })
    }
  )

  it('does not replace a fast failed execution with running when send admission returns', async () => {
    const anchor = randomUUID()
    fake.onStarted = async (listeners) => {
      const result: StreamErrorResult = {
        status: 'error',
        anchorMessageId: anchor,
        isTopicDone: true,
        error: { name: 'Error', message: '403 forbidden', stack: null }
      }
      const persistence = new PersistenceListener({
        topicId: `agent-session:${sessionId}`,
        backend: new AgentSessionMessageBackend({ sessionId, assistantMessageId: anchor }),
        onPersistFailed: () => {}
      })
      await persistence.onError(result)
      for (const listener of listeners) await listener.onError(result)
      fake.streams.delete(`agent-session:${sessionId}`)
    }
    const { session } = await call('agent.sessions.get', { sessionId })
    const receipt = await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      text: 'hello',
      expectedIdleRevision: session.idleRevision
    })
    const checkpoint = await call('agent.sessions.subscribe', { sessionId })
    const restored = await installCheckpoint(checkpoint.subscriptionId, checkpoint.checkpoint)
    expect(restored.projection.executions[receipt.executionId]).toMatchObject({
      status: 'failed',
      durable: true,
      messageId: anchor
    })
    expect(restored.projection.session.activeExecutionId).toBeUndefined()
    expect(restored.projection.messages[anchor]).toBeUndefined()
  })

  it('does not claim durable history or remove the live answer when persistence fails', async () => {
    const { session } = await call('agent.sessions.get', { sessionId })
    const prepared = await call('agent.sessions.subscribe', { sessionId })
    let projection = (await installCheckpoint(prepared.subscriptionId, prepared.checkpoint)).projection
    await call('agent.subscriptions.activate', {
      subscriptionId: prepared.subscriptionId,
      appliedCursor: projection.cursor
    })
    const receipt = await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      text: 'hello',
      expectedIdleRevision: session.idleRevision
    })
    const anchor = randomUUID()
    emit({ type: 'text-start', id: 'text' }, anchor)
    emit({ type: 'text-delta', id: 'text', delta: 'Unsaved answer' }, anchor)
    projection = await drain(projection)
    const revision = projection.session.historyRevision
    const failure = {
      message: 'Disk full',
      retryable: false,
      failure: { version: 1 as const, reasonCode: 'internal' as const, source: { layer: 'host' as const } }
    }
    for (const listener of fake.streams.get(`agent-session:${sessionId}`) ?? [])
      await listener.onDone({
        status: 'success',
        anchorMessageId: anchor,
        isTopicDone: true,
        modelId: 'provider::unsaved-model',
        runtimeTiming: { startedAt: 100, completedAt: 400, spans: [] },
        persistence: { status: 'failed', failure }
      })
    fake.streams.delete(`agent-session:${sessionId}`)
    projection = await drain(projection)
    expect(projection.session.historyRevision).toBe(revision)
    expect(projection.executions[receipt.executionId]).toMatchObject({
      status: 'completed',
      durable: false,
      persistenceFailure: failure
    })
    expect(projection.executions[receipt.executionId].history).toBeUndefined()
    expect(projection.messages[anchor]).toMatchObject({ status: 'success', usage: { durationMs: 300 } })
    await call('agent.subscriptions.close', { subscriptionId: prepared.subscriptionId })
    const preparedAgain = await call('agent.sessions.subscribe', { sessionId })
    const restored = await installCheckpoint(preparedAgain.subscriptionId, preparedAgain.checkpoint)
    expect(restored.projection.messages[anchor].usage).toMatchObject({ durationMs: 300 })
    expect(restored.projection.messages[anchor].model).toEqual({
      modelId: 'unsaved-model',
      providerId: 'provider',
      name: 'unsaved-model'
    })
    expect(projection.parts[`${anchor}:text:text`]).toMatchObject({ content: { text: 'Unsaved answer' } })
  })

  it('loads persisted usage through history and includes it in the terminal message event', async () => {
    seedModel('provider', 'model', 'Current name')
    const { session } = await call('agent.sessions.get', { sessionId })
    const prepared = await call('agent.sessions.subscribe', { sessionId })
    const initial = (await installCheckpoint(prepared.subscriptionId, prepared.checkpoint)).projection
    await call('agent.subscriptions.activate', {
      subscriptionId: prepared.subscriptionId,
      appliedCursor: initial.cursor
    })
    await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      text: 'hello',
      expectedIdleRevision: session.idleRevision
    })
    const anchor = randomUUID()
    emit({ type: 'text-start', id: 'text' }, anchor)
    agentSessionMessageService.saveMessage({
      sessionId,
      message: {
        id: anchor,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: 'provider::model',
        messageSnapshot: {
          id: 'agent-1',
          name: 'Agent',
          model: { id: 'model', provider: 'provider', name: 'Historical model' }
        }
      }
    })
    aiUsageRecordService.recordInvocation({
      requestId: randomUUID(),
      context: createAiUsageCaptureContext({
        providerId: 'provider',
        modelId: 'model',
        messageRef: { kind: 'agent-session', id: anchor }
      }),
      modality: 'language',
      usage: { inputTokens: 40, outputTokens: 0, totalTokens: 40, cacheReadTokens: 12 },
      completedAt: Date.now()
    })
    await finish(anchor, [{ type: 'text', text: 'done', state: 'done' }])
    await tick()
    const events = (notifications as Array<{ params: AgentEventBatch }>).flatMap((n) => n.params.events)
    expect(
      events.find((event) => event.kind === 'message.updated' && event.payload.message.status === 'success')
    ).toMatchObject({ payload: { message: { usage: { totalTokens: 40, outputTokens: 0, cacheReadTokens: 12 } } } })
    expect(
      events.find((event) => event.kind === 'message.updated' && event.payload.message.status === 'success')
    ).toMatchObject({
      payload: { message: { model: { modelId: 'model', providerId: 'provider', name: 'Historical model' } } }
    })
    const projection = await drain(initial)
    const history = await call('agent.messages.list', {
      sessionId,
      historyRevision: projection.session.historyRevision
    })
    expect(history.items.find((message: { messageId: string }) => message.messageId === anchor).usage).toMatchObject({
      totalTokens: 40,
      outputTokens: 0,
      cacheReadTokens: 12
    })
  })

  it('keeps message model identity independent from the current agent model', async () => {
    seedModel('provider', 'current', 'Current model')
    const snapshot = {
      id: 'agent-1',
      name: 'Agent',
      model: { id: 'old', provider: 'provider', name: 'Original display name' }
    }
    expect(toMessageModel({ messageSnapshot: snapshot })).toEqual({
      modelId: 'old',
      providerId: 'provider',
      name: 'Original display name'
    })
    expect(toMessageModel({ modelId: 'provider::actual', messageSnapshot: snapshot })).toEqual({
      modelId: 'actual',
      providerId: 'provider',
      name: 'actual'
    })
    expect(toMessageModel({ modelId: 'invalid' })).toBeUndefined()
    const message = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'assistant', data: { parts: [] }, messageSnapshot: snapshot }
    })
    dbh.db.update(agentTable).set({ model: 'provider::current' }).where(eq(agentTable.id, 'agent-1')).run()
    const { session } = await call('agent.sessions.get', { sessionId })
    const history = await call('agent.messages.list', { sessionId, historyRevision: session.historyRevision })
    expect(history.items.find((item: { messageId: string }) => item.messageId === message.id).model).toEqual({
      modelId: 'old',
      providerId: 'provider',
      name: 'Original display name'
    })
  })

  it('lists the current agent model display name and represents no configured model explicitly', async () => {
    expect((await call('agent.agents.list', {})).items[0].model).toBeNull()
    seedModel('remote-model-provider', 'model', 'Configured model')
    dbh.db.update(agentTable).set({ model: 'remote-model-provider::model' }).where(eq(agentTable.id, 'agent-1')).run()
    expect((await call('agent.agents.list', {})).items[0].model).toEqual({
      modelId: 'model',
      providerId: 'remote-model-provider',
      name: 'Configured model'
    })
  })

  it('creates a system workspace exactly once and returns its actual identity', async () => {
    const catalog = await call('agent.workspaces.list', { agentId: 'agent-1' })
    expect(catalog.systemWorkspace).toBe(true)
    const params = { commandId: randomUUID(), agentId: 'agent-1', workspace: { kind: 'system' } }
    const receipt = await call('agent.sessions.create', params)
    expect(receipt.status).toBe('applied')
    expect(await call('agent.sessions.create', params)).toEqual(receipt)
    const { session } = await call('agent.sessions.get', { sessionId: receipt.sessionId })
    expect(session.workspaceKind).toBe('system')
    expect(agentSessionService.getConversationById(receipt.sessionId).workspace).toMatchObject({
      id: session.workspaceId,
      type: 'system'
    })
    expect(catalog.items.some((item: { workspaceId: string }) => item.workspaceId === session.workspaceId)).toBe(false)
    await expect(
      call('agent.sessions.create', { ...params, workspace: { kind: 'registered', id: 'different' } })
    ).rejects.toMatchObject({ data: { reason: 'IDEMPOTENCY_CONFLICT' } })
  })

  it('rejects negative content offsets before dispatch and in direct helper calls', async () => {
    await expect(
      call('agent.content.read', { sessionId, contentId: 'content', revision: '0', offset: '-1', maxBytes: 1 })
    ).rejects.toMatchObject({ code: -32602 })
    expect(() => sliceContent(new Uint8Array([1, 2, 3]), '-1', 1)).toThrow()
  })

  it.each(['-1', 'NaN', 'Infinity', '1e309', '1.5'])(
    'rejects invalid interaction cursor %s at the RPC boundary',
    async (cursor) => {
      await expect(call('agent.interactions.list', { sessionId, cursor })).rejects.toMatchObject({
        data: { reason: 'NOT_FOUND' }
      })
    }
  )

  it('finds approval history beyond the newest fifty messages and pages every interaction once', async () => {
    const expected: string[] = []
    for (let i = 0; i < 61; i++) {
      expected.push(`approval-${i}`)
      agentSessionMessageService.saveMessage({
        sessionId,
        message: {
          role: 'assistant',
          data: {
            parts: [
              {
                type: 'tool-read',
                toolCallId: `call-${i}`,
                state: 'approval-responded',
                input: { path: `${i}.txt` },
                approval: { id: `approval-${i}`, approved: true }
              }
            ]
          }
        }
      })
    }
    for (let i = 0; i < 55; i++)
      agentSessionMessageService.saveMessage({
        sessionId,
        message: { role: 'user', data: { parts: [{ type: 'text', text: 'later' }] } }
      })
    const found: string[] = []
    let cursor: string | undefined
    do {
      const page = await call('agent.interactions.list', { sessionId, limit: 17, ...(cursor ? { cursor } : {}) })
      found.push(...page.items.map((item: { interactionId: string }) => item.interactionId))
      cursor = page.nextCursor ?? undefined
      expect(found.length).toBeLessThanOrEqual(61)
    } while (cursor)
    expect(found.sort()).toEqual(expected.sort())
    expect(
      (await call('agent.interactions.get', { sessionId, interactionId: 'approval-0' })).interaction.input
    ).toEqual({ text: '{"path":"0.txt"}' })
  })

  it('filters workspaces before both pinned and unpinned session pagination', async () => {
    const other = application
      .get('DbService')
      .withWriteTx((tx) => agentWorkspaceService.findOrCreateByPathTx(tx, '/tmp/remote-agent-other'))
    const wanted: string[] = []
    for (let i = 0; i < 4; i++) {
      const id = agentSessionService.create({
        agentId: 'agent-1',
        name: `Other ${i}`,
        workspace: { type: 'user', workspaceId: other.id }
      }).id
      wanted.push(id)
    }
    dbh.db
      .insert(pinTable)
      .values([
        { entityType: 'session', entityId: sessionId, orderKey: 'a0' },
        { entityType: 'session', entityId: wanted[0], orderKey: 'a1' }
      ])
      .run()
    const first = await call('agent.sessions.list', { workspaceId: other.id, limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.items[0].sessionId).toBe(wanted[0])
    const second = await call('agent.sessions.list', { workspaceId: other.id, limit: 2, cursor: first.nextCursor })
    expect([...first.items, ...second.items].map((item: { sessionId: string }) => item.sessionId).sort()).toEqual(
      wanted.sort()
    )
    expect(second.nextCursor).toBeNull()
  })

  it('rolls back a created session when its receipt cannot commit', async () => {
    const before = agentSessionService.listByCursor().items.map((session) => session.id)
    const settle = vi.spyOn(remoteCommandService, 'settle').mockImplementationOnce(() => {
      throw new Error('Disk failure')
    })
    try {
      const receipt = await call('agent.sessions.create', {
        commandId: randomUUID(),
        agentId: 'agent-1',
        workspace: { kind: 'system' }
      })
      expect(receipt.status).toBe('interrupted')
      expect(agentSessionService.listByCursor().items.map((session) => session.id)).toEqual(before)
    } finally {
      settle.mockRestore()
    }
  })

  it.each(['lock', 'preparation'])(
    'rejects an idle revision changed during %s without reserving messages',
    async (phase) => {
      seedModel('revision-provider', 'model', 'Model')
      const { startAgentSessionRun: realStart } = await vi.importActual<{
        startAgentSessionRun: typeof startAgentSessionRun
      }>('@main/ai/streamManager')
      vi.mocked(startAgentSessionRun).mockImplementationOnce(realStart)
      const { session } = await call('agent.sessions.get', { sessionId })
      const params = {
        commandId: randomUUID(),
        sessionId,
        text: 'stale send',
        expectedIdleRevision: session.idleRevision
      }
      let release!: () => void
      let entered!: () => void
      const waiting = new Promise<void>((resolve) => {
        entered = resolve
      })
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      if (phase === 'lock')
        fake.manager.withDispatchLock.mockImplementationOnce(async (_topic, run) => {
          entered()
          await gate
          return run()
        })
      const validate = vi.spyOn(agentChatContextProvider, 'validateDispatch').mockImplementation(async () => {
        if (phase === 'preparation') {
          entered()
          await gate
        }
        return {
          sessionId,
          topicId: `agent-session:${sessionId}`,
          agentId: 'agent-1',
          agentUpdatedAt: new Date().toISOString(),
          agentType: 'claude-code',
          agentName: 'Agent',
          uniqueModelId: 'revision-provider::model',
          reasoningEffort: 'default',
          serviceTier: 'standard',
          headless: false,
          messageSnapshot: {
            id: 'agent-1',
            name: 'Agent',
            model: { id: 'model', name: 'Model', provider: 'revision-provider' }
          },
          userMessageId: randomUUID(),
          userMessageParts: [{ type: 'text', text: params.text }],
          shouldAutoNameInitialTurn: false
        }
      })
      let activated = false
      const activate = vi.spyOn(agentChatContextProvider, 'activateDispatch').mockImplementation(() => {
        activated = true
        throw new Error('Stale send reached runtime activation')
      })
      try {
        const sending = call('agent.messages.send', params)
        await waiting
        await tick()
        agentSessionMessageService.saveMessage({
          sessionId,
          message: {
            id: randomUUID(),
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'intervening local turn' }] }
          }
        })
        const history = agentSessionMessageService.listSessionMessages(sessionId).items
        release()
        const receipt = await sending
        expect(receipt).toMatchObject({ status: 'rejected', error: { reason: 'CONFLICT' } })
        expect(receipt.executionId).toBeUndefined()
        expect(activated).toBe(false)
        expect(agentSessionMessageService.listSessionMessages(sessionId).items).toEqual(history)
        expect(await call('agent.messages.send', params)).toEqual(receipt)
        expect(await call('agent.commands.get', { commandId: params.commandId })).toEqual(receipt)
      } finally {
        release()
        validate.mockRestore()
        activate.mockRestore()
      }
    }
  )

  it('preserves committed message identities when activation is interrupted and never retries the send', async () => {
    fake.onStarted = async () => {
      throw new Error('Activation interrupted')
    }
    const { session } = await call('agent.sessions.get', { sessionId })
    const params = { commandId: randomUUID(), sessionId, text: 'once', expectedIdleRevision: session.idleRevision }
    const receipt = await call('agent.messages.send', params)
    expect(receipt).toMatchObject({
      status: 'interrupted',
      executionId: expect.any(String),
      result: { executionId: expect.any(String), messageId: expect.any(String), userMessageId: expect.any(String) }
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, receipt.result.userMessageId).data.parts).toEqual([
      { type: 'text', text: 'once' }
    ])
    expect(await call('agent.messages.send', params)).toEqual(receipt)
    expect(agentSessionMessageService.listSessionMessages(sessionId).items).toHaveLength(1)
  })

  it.each([false, true])(
    'commits receipt reservation and messages together before activation (abort=%s)',
    async (abort) => {
      seedModel('reservation-provider', 'model', 'Model')
      const device = apiGatewayPairedDeviceService.approveRemote({
        name: 'Test',
        platform: 'ios',
        peerIdentity: 'reservation',
        capabilities: ['agent']
      })
      const key = {
        deviceId: device.device.id,
        grantId: device.authorization.grants[0].grantId,
        commandId: randomUUID()
      }
      remoteCommandService.admit(key, { method: 'agent.messages.send', identityDigest: 'digest', sessionId })
      const provider = new AgentChatContextProvider()
      const userMessageId = randomUUID()
      vi.spyOn(provider, 'validateDispatch').mockResolvedValue({
        sessionId,
        topicId: `agent-session:${sessionId}`,
        agentId: 'agent-1',
        agentUpdatedAt: new Date().toISOString(),
        agentType: 'claude-code',
        agentName: 'Agent',
        uniqueModelId: 'reservation-provider::model',
        reasoningEffort: 'default',
        serviceTier: 'standard',
        headless: false,
        messageSnapshot: {
          id: 'agent-1',
          name: 'Agent',
          model: { id: 'model', name: 'Model', provider: 'reservation-provider' }
        },
        userMessageId,
        userMessageParts: [{ type: 'text', text: 'reserved' }],
        shouldAutoNameInitialTurn: false
      })
      let activated = false
      vi.spyOn(provider, 'activateDispatch').mockImplementation(() => {
        activated = true
        const receipt = remoteCommandService.get(key)!
        expect(receipt).toMatchObject({ status: 'accepted', executionId: 'execution', result: { userMessageId } })
        const reservation = receipt.result as { messageId: string }
        expect(agentSessionMessageService.getSessionMessage(sessionId, reservation.messageId).status).toBe('pending')
        throw new Error('Stopped before external execution')
      })
      const subscriber: StreamListener = {
        id: 'test',
        onChunk() {},
        onDone() {},
        onPaused() {},
        onError() {},
        isAlive: () => true
      }
      await expect(
        provider.prepareAgentSessionDispatch(
          subscriber,
          {
            topicId: `agent-session:${sessionId}`,
            trigger: 'submit-message',
            userMessageParts: [{ type: 'text', text: 'reserved' }]
          },
          {},
          { hasLiveStream: false, requireIdle: true, expectedAgentId: 'agent-1' },
          (tx, messages) => {
            remoteCommandService.reserveExecutionTx(tx, key, {
              executionId: 'execution',
              messageId: messages.assistantMessageId,
              userMessageId: messages.userMessageId
            })
            if (abort) throw new Error('Abort reservation transaction')
          }
        )
      ).rejects.toThrow(abort ? 'Abort reservation transaction' : 'Stopped before external execution')
      expect(activated).toBe(!abort)
      expect(agentSessionMessageService.listSessionMessages(sessionId).items).toHaveLength(abort ? 0 : 2)
      if (abort) expect(remoteCommandService.get(key)?.executionId).toBeUndefined()
      remoteCommandService.interruptPending()
      expect(remoteCommandService.get(key)?.status).toBe('interrupted')
      if (!abort)
        expect(remoteCommandService.get(key)).toMatchObject({ executionId: 'execution', result: { userMessageId } })
    }
  )

  it('retains terminal live interaction input when history has no approval metadata', async () => {
    const { session } = await call('agent.sessions.get', { sessionId })
    await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      text: 'read',
      expectedIdleRevision: session.idleRevision
    })
    const messageId = randomUUID()
    emit({ type: 'start' }, messageId)
    emit(
      { type: 'tool-input-available', toolCallId: 'input-call', toolName: 'read', input: { path: 'preserved.txt' } },
      messageId
    )
    emit({ type: 'tool-approval-request', approvalId: 'input-approval', toolCallId: 'input-call' }, messageId)
    emit({ type: 'tool-output-available', toolCallId: 'input-call', output: 'ok' }, messageId)
    await finish(messageId, [{ type: 'text', text: 'done' }])
    const { interaction } = await call('agent.interactions.get', { sessionId, interactionId: 'input-approval' })
    expect(interaction).toMatchObject({ status: 'approved', input: { text: '{"path":"preserved.txt"}' } })
  })

  it('requires complete answers for the current question and replays its receipt without dispatching twice', async () => {
    const { session } = await call('agent.sessions.get', { sessionId })
    await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      expectedIdleRevision: session.idleRevision,
      text: 'ask'
    })
    const anchor = randomUUID()
    const input = {
      questions: [
        { question: '目录？', header: '目录', options: [{ label: 'src' }, { label: 'docs' }], multiSelect: false }
      ],
      metadata: { keep: 'x'.repeat(5000) }
    }
    emit({ type: 'tool-input-available', toolCallId: 'question-call', toolName: 'AskUserQuestion', input }, anchor)
    emit({ type: 'tool-approval-request', toolCallId: 'question-call', approvalId: 'question' }, anchor)
    const { interaction } = await call('agent.interactions.get', { sessionId, interactionId: 'question' })
    expect(interaction.kind).toBe('question')
    expect(interaction.input).toHaveProperty('ref')
    const first = await call('agent.sessions.subscribe', { sessionId })
    const restored = await installCheckpoint(first.subscriptionId, first.checkpoint)
    expect(restored.projection.interactions.question.kind).toBe('question')
    const target = {
      sessionId,
      interactionId: 'question',
      expectedRevision: interaction.revision,
      expectedExecutionId: interaction.executionId,
      inputDigest: interaction.inputDigest
    }
    for (const response of [
      { decision: 'approve' },
      { response: { kind: 'answer', answers: { other: 'src' } } },
      { response: { kind: 'answer', answers: { '目录？': ' ' } } }
    ]) {
      expect(
        await call('agent.interactions.respond', { ...target, commandId: randomUUID(), ...response })
      ).toMatchObject({ status: 'rejected', error: { reason: 'CONFLICT' } })
    }
    const params = { ...target, commandId: randomUUID(), response: { kind: 'answer', answers: { '目录？': 'src 🌍' } } }
    expect(
      await call('agent.interactions.respond', { ...params, commandId: randomUUID(), expectedRevision: '0' })
    ).toMatchObject({ status: 'rejected', error: { reason: 'CONFLICT' } })
    expect(fake.runtime.respondToolApproval).not.toHaveBeenCalled()
    const receipt = await call('agent.interactions.respond', params)
    expect(receipt.status).toBe('applied')
    expect(fake.runtime.respondToolApproval).toHaveBeenCalledWith(
      'question',
      { approved: true, updatedInput: { ...input, answers: params.response.answers } },
      anchor
    )
    expect(await call('agent.interactions.respond', params)).toEqual(receipt)
    expect(fake.runtime.respondToolApproval).toHaveBeenCalledTimes(1)
    await expect(
      call('agent.interactions.respond', { ...params, response: { kind: 'answer', answers: { '目录？': 'docs' } } })
    ).rejects.toMatchObject({ data: { reason: 'IDEMPOTENCY_CONFLICT' } })
  })

  it('forwards a denial reason without treating it as updated tool input', async () => {
    const { session } = await call('agent.sessions.get', { sessionId })
    await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      expectedIdleRevision: session.idleRevision,
      text: 'read'
    })
    const anchor = randomUUID()
    emit({ type: 'tool-input-available', toolCallId: 'read-call', toolName: 'read', input: { path: 'a' } }, anchor)
    emit({ type: 'tool-approval-request', toolCallId: 'read-call', approvalId: 'read-approval' }, anchor)
    const { interaction } = await call('agent.interactions.get', { sessionId, interactionId: 'read-approval' })
    const receipt = await call('agent.interactions.respond', {
      commandId: randomUUID(),
      sessionId,
      interactionId: interaction.interactionId,
      expectedRevision: interaction.revision,
      expectedExecutionId: interaction.executionId,
      inputDigest: interaction.inputDigest,
      response: { kind: 'deny', reason: '请勿读取' }
    })
    expect(receipt.status).toBe('applied')
    expect(fake.runtime.respondToolApproval).toHaveBeenCalledWith(
      'read-approval',
      { approved: false, reason: '请勿读取' },
      anchor
    )
  })

  it('refuses agent methods to a device paired without the agent capability', async () => {
    const { device } = apiGatewayPairedDeviceService.approveRemote({
      name: 'Config only',
      platform: 'ios',
      peerIdentity: 'config-phone',
      capabilities: ['configuration']
    })
    const other = new RemoteConnection(
      makeChannel('config-phone', []),
      new RemotePairing(),
      new RemoteTokens(),
      () => {},
      hub
    )
    await other.rpc.receive(
      { jsonrpc: '2.0', id: 1, method: 'connection.hello', params: { protocolVersions: [1] } },
      undefined
    )
    await other.rpc.receive(
      { jsonrpc: '2.0', id: 2, method: 'connection.authenticate', params: { deviceId: device.id } },
      undefined
    )
    expect(
      await other.rpc.receive({ jsonrpc: '2.0', id: 3, method: 'agent.sessions.list', params: {} }, undefined)
    ).toMatchObject({ error: { data: { reason: 'FORBIDDEN' } } })
  })

  it('streams a remote send through checkpoint, live events, approval and durable history without gaps', async () => {
    expect(await call('agent.agents.list', {})).toMatchObject({
      items: [{ agentId: 'agent-1', name: 'Agent', emoji: '🧑🏽‍💻' }],
      nextCursor: null
    })
    const { session } = await call('agent.sessions.get', { sessionId })
    expect(session.idleRevision).toBe(session.historyRevision)

    const subscribed = await call('agent.sessions.subscribe', { sessionId })
    expect(subscribed.mode).toBe('checkpoint')
    let projection = (await installCheckpoint(subscribed.subscriptionId, subscribed.checkpoint)).projection
    expect(projection.session.sessionId).toBe(sessionId)
    await call('agent.subscriptions.activate', {
      subscriptionId: subscribed.subscriptionId,
      appliedCursor: subscribed.checkpoint.cursor
    })

    const commandId = randomUUID()
    const receipt = await call('agent.messages.send', {
      commandId,
      sessionId,
      text: 'hi',
      expectedIdleRevision: session.idleRevision
    })
    expect(receipt).toMatchObject({ status: 'applied', commandId, executionId: expect.any(String) })
    expect(
      await call('agent.messages.send', {
        commandId,
        sessionId,
        text: 'hi',
        expectedIdleRevision: session.idleRevision
      })
    ).toEqual(receipt)
    await expect(
      call('agent.messages.send', { commandId, sessionId, text: 'changed', expectedIdleRevision: session.idleRevision })
    ).rejects.toMatchObject({ data: { reason: 'IDEMPOTENCY_CONFLICT' } })
    expect(
      await call('agent.messages.send', {
        commandId: randomUUID(),
        sessionId,
        text: 'again',
        expectedIdleRevision: session.idleRevision
      })
    ).toMatchObject({ status: 'rejected', error: { reason: 'CONFLICT' } })

    const assistantId = randomUUID()
    emit({ type: 'start' }, assistantId)
    emit({ type: 'text-start', id: 't1' }, assistantId)
    emit({ type: 'text-delta', id: 't1', delta: 'Hello ' }, assistantId)
    emit({ type: 'text-delta', id: 't1', delta: '世界🌍' }, assistantId)
    emit({ type: 'text-end', id: 't1' }, assistantId)
    emit(
      { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'read', input: { path: 'a.txt' } },
      assistantId
    )
    emit({ type: 'tool-approval-request', approvalId: 'approval-1', toolCallId: 'call-1' }, assistantId)
    projection = await drain(projection)

    const live = projection.messages[assistantId]
    expect(live.partIds).toEqual([`${assistantId}:text:t1`, `${assistantId}:tool:call-1:in`])
    expect(projection.parts[`${assistantId}:text:t1`]).toMatchObject({
      kind: 'text',
      state: 'completed',
      content: { text: 'Hello 世界🌍' }
    })
    expect(projection.executions[receipt.executionId]).toMatchObject({
      status: 'awaiting-approval',
      messageId: assistantId
    })
    const interaction = projection.interactions['approval-1']
    expect(interaction).toMatchObject({ status: 'pending', executionId: receipt.executionId, toolCallId: 'call-1' })
    expect(
      (await call('agent.interactions.get', { sessionId, interactionId: 'approval-1' })).interaction.input
    ).toEqual({ text: '{"path":"a.txt"}' })

    const respond = await call('agent.interactions.respond', {
      commandId: randomUUID(),
      sessionId,
      interactionId: 'approval-1',
      expectedRevision: interaction.revision,
      expectedExecutionId: receipt.executionId,
      inputDigest: interaction.inputDigest,
      decision: 'approve'
    })
    expect(respond.status).toBe('applied')
    expect(fake.runtime.respondToolApproval).toHaveBeenCalledWith('approval-1', { approved: true }, assistantId)
    emit({ type: 'tool-output-available', toolCallId: 'call-1', output: 'x'.repeat(5000) }, assistantId)
    projection = await drain(projection)
    expect(projection.interactions['approval-1'].status).toBe('approved')
    const output = projection.parts[`${assistantId}:tool:call-1:out`]
    expect(output).toMatchObject({
      kind: 'tool-output',
      state: 'completed',
      content: { ref: { contentId: `${assistantId}:tool:call-1:out` } }
    })
    const ref = (output.content as { ref: { revision: string; byteLength: string; sha256: string } }).ref
    const read = await call('agent.content.read', {
      sessionId,
      contentId: `${assistantId}:tool:call-1:out`,
      revision: ref.revision,
      offset: '0',
      maxBytes: 24_576
    })
    expect(Buffer.from(read.dataBase64, 'base64').toString()).toBe(JSON.stringify('x'.repeat(5000)))
    expect(read).toMatchObject({ eof: true, nextOffset: ref.byteLength, sha256: ref.sha256 })

    await finish(assistantId, [
      { type: 'text', text: 'Hello 世界🌍', state: 'done' },
      {
        type: 'tool-read',
        toolCallId: 'call-1',
        state: 'output-available',
        input: { path: 'a.txt' },
        output: 'x'.repeat(5000),
        approval: { id: 'approval-1', approved: true }
      }
    ])
    projection = await drain(projection)
    expect(projection.executions[receipt.executionId]).toMatchObject({ status: 'completed', durable: true })
    const interactions = await call('agent.interactions.list', { sessionId })
    expect(interactions.items).toHaveLength(1)
    expect(interactions.items[0]).toMatchObject({
      interactionId: 'approval-1',
      status: 'approved',
      executionId: assistantId,
      input: { text: '{"path":"a.txt"}' }
    })
    expect((await call('agent.interactions.get', { sessionId, interactionId: 'approval-1' })).interaction).toEqual(
      interactions.items[0]
    )
    expect(projection.messages[assistantId]).toBeUndefined()
    expect(projection.session.idleRevision).toBe(projection.session.historyRevision)
    expect(Number(projection.session.historyRevision)).toBeGreaterThan(Number(session.historyRevision))

    const history = await call('agent.messages.list', {
      sessionId,
      historyRevision: projection.session.historyRevision
    })
    expect(history.items.map((item: { role: string }) => item.role)).toEqual(['assistant', 'user'])
    const [assistant] = history.items
    const parts = await call('agent.parts.list', {
      sessionId,
      messageId: assistant.messageId,
      messageRevision: assistant.revision
    })
    expect(parts.items.map((part: { kind: string }) => part.kind)).toEqual(['text', 'tool-input', 'tool-output'])
    await expect(
      call('agent.messages.list', { sessionId, historyRevision: session.historyRevision })
    ).rejects.toMatchObject({ data: { reason: 'REVISION_EXPIRED' } })
    expect(await call('agent.commands.get', { commandId })).toEqual(receipt)
  })

  it('replays retained events to a reconnecting cursor and demands a checkpoint after an epoch change', async () => {
    const first = await call('agent.sessions.subscribe', { sessionId })
    let projection = (await installCheckpoint(first.subscriptionId, first.checkpoint)).projection
    await call('agent.subscriptions.activate', {
      subscriptionId: first.subscriptionId,
      appliedCursor: first.checkpoint.cursor
    })
    const { session } = await call('agent.sessions.get', { sessionId })
    const receipt = await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      text: 'hi',
      expectedIdleRevision: session.idleRevision
    })
    const assistantId = randomUUID()
    emit({ type: 'text-start', id: 't1' }, assistantId)
    emit({ type: 'text-delta', id: 't1', delta: 'partial' }, assistantId)
    projection = await drain(projection)
    await call('agent.subscriptions.close', { subscriptionId: first.subscriptionId })
    emit({ type: 'text-delta', id: 't1', delta: ' text' }, assistantId)

    const other: unknown[] = []
    const reconnect = new RemoteConnection(
      makeChannel('phone', other),
      new RemotePairing(),
      new RemoteTokens(),
      () => {},
      hub
    )
    const { device } = { device: apiGatewayPairedDeviceService.list()[0] }
    await reconnect.rpc.receive(
      { jsonrpc: '2.0', id: 1, method: 'connection.hello', params: { protocolVersions: [1] } },
      undefined
    )
    await reconnect.rpc.receive(
      { jsonrpc: '2.0', id: 2, method: 'connection.authenticate', params: { deviceId: device.id } },
      undefined
    )
    const resumed = (await reconnect.rpc.receive(
      { jsonrpc: '2.0', id: 3, method: 'agent.sessions.subscribe', params: { sessionId, cursor: projection.cursor } },
      undefined
    )) as { result: { subscriptionId: string; mode: string; fromCursor: unknown } }
    expect(resumed.result).toMatchObject({ mode: 'replay', fromCursor: projection.cursor })
    await reconnect.rpc.receive(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'agent.subscriptions.activate',
        params: { subscriptionId: resumed.result.subscriptionId, appliedCursor: projection.cursor }
      },
      undefined
    )
    for (let i = 0; i < 5; i++) await tick()
    const batch = (other[0] as { params: AgentEventBatch }).params
    expect(Number(batch.events[0].seq)).toBe(Number(projection.cursor.seq) + 1)
    const applied = applyAgentEvents(projection, batch, {}, integrity)
    expect(applied.ok && applied.projection.parts[`${assistantId}:text:t1`]).toMatchObject({
      content: { text: 'partial text' }
    })

    const stale = await call('agent.sessions.subscribe', {
      sessionId,
      cursor: { ...projection.cursor, streamEpoch: 'old-epoch' }
    })
    expect(stale).toMatchObject({ mode: 'checkpoint', reason: 'epoch changed' })
    expect(projection.executions[receipt.executionId]).toBeDefined()
  })

  it('rejects cancellation if another execution wins admission before the dispatch lock', async () => {
    const journal = hub.journal(sessionId)
    journal.ensureExecution('old')
    fake.manager.abortAndDrain.mockImplementationOnce(async (_topic, _reason, beforeAbort) => {
      journal.ensureExecution('new')
      beforeAbort?.()
    })
    const result = await call('agent.executions.cancel', {
      commandId: randomUUID(),
      sessionId,
      expectedExecutionId: 'old'
    })
    expect(result).toMatchObject({ status: 'rejected', error: { reason: 'CONFLICT' } })
    expect(journal.activeExecutionId).toBe('new')
    expect(await call('agent.commands.get', { commandId: result.commandId })).toEqual(result)
  })

  it.each([false, true])('retains leased journals (active=%s) until disconnect', async (active) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const journal = hub.journal(sessionId)
    const pending = await call('agent.sessions.subscribe', { sessionId })
    if (active)
      await call('agent.subscriptions.activate', {
        subscriptionId: pending.subscriptionId,
        appliedCursor: pending.checkpoint.cursor
      })
    if (active) await tick()
    vi.setSystemTime(Date.now() + remoteLimits.replayMs + 1)
    hub.sweep()
    expect(hub.journal(sessionId).epoch).toBe(journal.epoch)
    const auth = connection.requireCapability('agent')
    connection.dispose()
    vi.setSystemTime(Date.now() + remoteLimits.replayMs + 1)
    hub.sweep()
    await call('connection.authenticate', { deviceId: auth.deviceId })
    const resumed = await call('agent.sessions.subscribe', { sessionId, cursor: pending.checkpoint.cursor })
    expect(resumed).toMatchObject({ mode: 'checkpoint', reason: 'epoch changed' })
  })

  it('enforces the aggregate replay budget and makes an evicted cursor recover through a checkpoint', async () => {
    fake.replayBudget = 8000
    const first = hub.journal(sessionId)
    const cursor = first.cursor
    const other = agentSessionService.create({ agentId: 'agent-1', name: 'Other', workspace: { type: 'system' } })
    const second = hub.journal(other.id)
    for (const journal of [first, second]) {
      await journal.startRun('hi', 'agent-1', () => {})
      const listener = fake.streams.get(`agent-session:${journal.sessionId}`)![0]
      listener.onChunk({ type: 'text-start', id: 'text' }, undefined, 'message')
      listener.onChunk({ type: 'text-delta', id: 'text', delta: 'a'.repeat(6000) }, undefined, 'message')
    }
    expect(first.replayBytes + second.replayBytes).toBeLessThanOrEqual(remoteLimits.globalReplayBytes)
    expect(first.activeExecutionId).toBeDefined()
    expect(second.activeExecutionId).toBeDefined()
    expect(await call('agent.sessions.subscribe', { sessionId, cursor })).toMatchObject({
      mode: 'checkpoint',
      reason: 'replay window evicted'
    })
  })

  it('caps idle journal count without evicting a subscribed session', async () => {
    const pinned = hub.journal(sessionId)
    await call('agent.sessions.subscribe', { sessionId })
    let first: ReturnType<typeof hub.journal> | undefined
    for (let i = 0; i < 130; i++) {
      const session = agentSessionService.create({
        agentId: 'agent-1',
        name: `Chat ${i}`,
        workspace: { type: 'system' }
      })
      const journal = hub.journal(session.id)
      first ??= journal
    }
    expect(hub.journal(sessionId).epoch).toBe(pinned.epoch)
    expect(hub.journal(first!.sessionId).epoch).not.toBe(first!.epoch)
  })

  it('preserves receipts at device capacity and refuses new commands even after grant rotation', async () => {
    const auth = connection.requireCapability('agent')
    dbh.sqlite
      .prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10000)
      INSERT INTO remote_command (device_id, grant_id, command_id, method, identity_digest, status, admitted_at, created_at, updated_at)
      SELECT ?, ?, CAST(x AS TEXT), 'agent.executions.cancel', 'digest', 'applied', 1000, 1000, 1000 FROM n`)
      .run(auth.deviceId, auth.grantId)
    const key = { ...auth, commandId: '1' }
    const input = { method: 'agent.executions.cancel', identityDigest: 'digest' }
    expect(remoteCommandService.admit(key, input)).toMatchObject({ kind: 'existing', receipt: { status: 'applied' } })
    expect(remoteCommandService.admit(key, { ...input, identityDigest: 'changed' })).toEqual({ kind: 'conflict' })
    expect(remoteCommandService.admit({ ...key, grantId: 'rotated' }, input)).toEqual({ kind: 'exhausted' })
    await expect(
      call('agent.executions.cancel', { commandId: randomUUID(), sessionId, expectedExecutionId: 'old' })
    ).rejects.toMatchObject({ data: { reason: 'RESOURCE_EXHAUSTED' } })
    const before = agentSessionService.listIdsByAgent('agent-1')
    await expect(
      call('agent.sessions.create', { commandId: randomUUID(), agentId: 'agent-1', workspace: { kind: 'system' } })
    ).rejects.toMatchObject({ data: { reason: 'RESOURCE_EXHAUSTED' } })
    expect(agentSessionService.listIdsByAgent('agent-1')).toEqual(before)
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM remote_command').get()).toEqual({ n: 10000 })
  })

  it('enforces desktop receipt capacity across devices while keeping existing receipts readable', async () => {
    const insert = dbh.sqlite.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10000)
      INSERT INTO remote_command (device_id, grant_id, command_id, method, identity_digest, status, admitted_at, created_at, updated_at)
      SELECT ?, 'grant', CAST(x AS TEXT), 'agent.executions.cancel', 'digest', 'applied', 1000, 1000, 1000 FROM n`)
    for (let i = 0; i < 10; i++) {
      const { device } = apiGatewayPairedDeviceService.approveRemote({
        name: `Phone ${i}`,
        platform: 'ios',
        peerIdentity: `phone-${i}`,
        capabilities: ['agent']
      })
      insert.run(device.id)
      expect(remoteCommandService.get({ deviceId: device.id, grantId: 'grant', commandId: '1' })).toMatchObject({
        status: 'applied'
      })
    }
    const key = { ...connection.requireCapability('agent'), commandId: 'new' }
    const input = { method: 'agent.executions.cancel', identityDigest: 'digest' }
    expect(remoteCommandService.admit(key, input)).toEqual({ kind: 'exhausted' })
    const device = apiGatewayPairedDeviceService.list().find((value) => value.name === 'Phone 0')!
    dbh.sqlite.prepare('DELETE FROM api_gateway_paired_device WHERE id = ?').run(device.id)
    expect(remoteCommandService.admit(key, input)).toMatchObject({ kind: 'accepted' })
    expect(dbh.sqlite.prepare('SELECT count(*) AS n FROM remote_command').get()).toEqual({ n: 90001 })
  })

  it('cancels only the execution the phone expects', async () => {
    const { session } = await call('agent.sessions.get', { sessionId })
    const receipt = await call('agent.messages.send', {
      commandId: randomUUID(),
      sessionId,
      text: 'hi',
      expectedIdleRevision: session.idleRevision
    })
    expect(
      await call('agent.executions.cancel', { commandId: randomUUID(), sessionId, expectedExecutionId: 'stale' })
    ).toMatchObject({ status: 'rejected', error: { reason: 'CONFLICT' } })
    expect(
      await call('agent.executions.cancel', {
        commandId: randomUUID(),
        sessionId,
        expectedExecutionId: receipt.executionId
      })
    ).toMatchObject({ status: 'applied', result: { disposition: 'cancelled' } })
  })
})
