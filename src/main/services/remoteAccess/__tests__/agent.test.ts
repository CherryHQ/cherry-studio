import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AgentCheckpointPage,
  type AgentEventBatch,
  type AgentProjection,
  applyAgentEvents,
  installAgentCheckpoint
} from '@cherrystudio/remote-protocol/agent'
import type { SecureChannel } from '@cherrystudio/remote-transport'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { apiGatewayPairedDeviceService } from '@data/services/ApiGatewayPairedDeviceService'
import type { StreamListener } from '@main/ai/streamManager'
import type { CherryMessagePart } from '@shared/data/types/message'

import { RemoteAgentHub } from '../agentJournal'
import { sha256 } from '../agentQueries'
import { RemoteConnection } from '../RemoteConnection'
import { RemotePairing } from '../RemotePairing'
import { RemoteTokens } from '../RemoteTokens'

const fake = vi.hoisted(() => {
  const streams = new Map<string, StreamListener[]>()
  return {
    streams,
    manager: {
      hasLiveStream: (topicId: string) => streams.has(topicId),
      addListener: (topicId: string, listener: StreamListener) => {
        const listeners = streams.get(topicId)
        if (!listeners) return false
        listeners.push(listener)
        return true
      },
      abortAndDrain: vi.fn(async () => {})
    },
    runtime: { isSessionBusy: () => false, respondToolApproval: vi.fn(() => true) }
  }
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AiStreamManager: fake.manager, AgentSessionRuntimeService: fake.runtime } as never)
})

vi.mock('@main/ai/streamManager', () => ({
  startAgentSessionRun: vi.fn(
    async (input: { sessionId: string; userParts: CherryMessagePart[]; listeners: StreamListener[] }) => {
      const topicId = `agent-session:${input.sessionId}`
      if (fake.streams.has(topicId)) return { mode: 'not-started', reason: 'busy' }
      agentSessionMessageService.saveMessage({
        sessionId: input.sessionId,
        message: { role: 'user', data: { parts: input.userParts } }
      })
      fake.streams.set(topicId, [...input.listeners])
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
    agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: anchorMessageId, role: 'assistant', status, data: { parts } }
    })
    const listeners = fake.streams.get(`agent-session:${sessionId}`) ?? []
    fake.streams.delete(`agent-session:${sessionId}`)
    for (const listener of listeners) {
      if (status === 'success') void listener.onDone({ status: 'success', isTopicDone: true })
      else void listener.onPaused({ status: 'paused', isTopicDone: true })
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

  beforeEach(async () => {
    fake.streams.clear()
    notifications.length = 0
    fake.runtime.respondToolApproval.mockClear()
    await dbh.db
      .insert(agentTable)
      .values({ id: 'agent-1', type: 'claude-code', name: 'Agent', instructions: '', model: null, orderKey: 'a0' })
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
      items: [{ agentId: 'agent-1', name: 'Agent' }],
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
        output: 'x'.repeat(5000)
      }
    ])
    projection = await drain(projection)
    expect(projection.executions[receipt.executionId]).toMatchObject({ status: 'completed', durable: true })
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
    expect(fake.manager.abortAndDrain).toHaveBeenCalledWith(`agent-session:${sessionId}`, 'remote-cancel')
  })
})
