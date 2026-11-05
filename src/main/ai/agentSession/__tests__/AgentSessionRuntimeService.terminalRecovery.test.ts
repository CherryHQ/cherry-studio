import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable as modelTable } from '@data/db/schemas/userModel'
import { userProviderTable as providerTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { BaseService } from '@main/core/lifecycle/BaseService'

const wiring = vi.hoisted(() => ({
  manager: undefined as any,
  runtime: undefined as any,
  traceRoot: undefined as string | undefined,
  saveSpans: vi.fn<(topicId: string) => Promise<void>>(async () => {})
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const getPath = result.application.getPath.getMockImplementation()!
  result.application.getPath.mockImplementation((namespace, filename) =>
    namespace === 'feature.trace' && wiring.traceRoot ? wiring.traceRoot : getPath(namespace, filename)
  )
  const get = result.application.getContainer().get.bind(result.application.getContainer())
  result.application.get.mockImplementation((name: string) => {
    if (name === 'AiStreamManager') return wiring.manager
    if (name === 'AgentSessionRuntimeService') return wiring.runtime
    if (name === 'AiService')
      return {
        streamText: (request: any) =>
          wiring.runtime.openTurnStream({ ...request.runtime, signal: request.requestOptions.signal })
      }
    if (name === 'TraceStorageService') return { saveSpans: wiring.saveSpans }
    return get(name)
  })
  return result
})

const { AiStreamManager } = await import('@main/ai/streamManager/AiStreamManager')
const { AgentSessionRuntimeService } = await import('@main/ai/agentSession/AgentSessionRuntimeService')
const { aiHandlers } = await import('@main/ipc/handlers/ai')
const { SessionJournal } = await import('@main/services/remoteAccess/agentJournal')
const dbh = setupTestDatabase()
const sessionId = 'issue-23386'
const topicId = `agent-session:${sessionId}`
const modelId = 'test-provider::test-model' as any
const key = `topic.stream.statuses.${topicId}` as any

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((r, j) => {
    resolve = r
    reject = j
  })
  return { promise, resolve, reject }
}
async function until(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs
  let lastResult = predicate()
  while (!lastResult && performance.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2))
    lastResult = predicate()
  }
  if (!lastResult) {
    throw new Error(`condition did not settle within ${timeoutMs} ms; last predicate result: ${lastResult}`)
  }
}
function row() {
  const r = messages.getSessionMessage(sessionId, '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100')
  return { id: r.id, status: r.status, parts: r.data.parts }
}
function status() {
  return defaultServiceInstances.CacheService.getShared(key) as any
}

beforeEach(() => {
  BaseService.resetInstances()
  MockMainCacheServiceUtils.resetMocks()
  wiring.traceRoot = undefined
  wiring.saveSpans.mockReset().mockResolvedValue(undefined)
  dbh.db.insert(providerTable).values({ providerId: 'test-provider', name: 'Probe', orderKey: 'a0' }).run()
  dbh.db
    .insert(modelTable)
    .values({
      id: modelId,
      providerId: 'test-provider',
      name: 'Probe',
      modelId: 'test-model',
      presetModelId: 'probe',
      orderKey: 'a0'
    })
    .run()
  dbh.db
    .insert(agentTable)
    .values({
      id: 'agent-1',
      type: 'claude-code',
      name: 'Probe',
      instructions: 'Probe',
      model: modelId,
      orderKey: 'a0'
    })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace-1', name: 'Probe', path: '/tmp/issue-23386-probe', type: 'user', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: sessionId, agentId: 'agent-1', workspaceId: 'workspace-1', name: 'Probe', orderKey: 'a0' })
    .run()
  wiring.manager = new (AiStreamManager as any)({ gracePeriodMs: 5 })
  wiring.runtime = new AgentSessionRuntimeService()
  // Substitute the external SDK connection only; admission, stream, terminal state and DB remain real.
  vi.spyOn(wiring.runtime, 'ensureConnection').mockResolvedValue(true)
  vi.spyOn(wiring.runtime, 'admitTurn').mockImplementation(async (entry: any, turn: any) => {
    wiring.runtime.applyRuntimeStateEvent(entry, { type: 'turn-admitted', turn })
  })
})
afterEach(async () => {
  const executions = [...(wiring.manager.activeStreams.get(topicId)?.executions.values() ?? [])]
  await wiring.runtime.closeSession(sessionId)
  await Promise.allSettled(executions.map((execution: any) => execution.loopPromise))
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  if (wiring.traceRoot) await rm(wiring.traceRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})

async function start(ordinary = false) {
  const user = messages.saveMessage({
    sessionId,
    message: {
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101',
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Complete the task' }] }
    }
  })
  messages.saveMessage({
    sessionId,
    message: {
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100',
      role: 'assistant',
      status: 'pending',
      data: { parts: [] },
      modelId
    }
  })
  const handle = wiring.runtime.beginTurn({
    sessionId,
    topicId,
    agentId: 'agent-1',
    agentType: 'claude-code',
    modelId,
    assistantMessageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100',
    userMessage: user
  })
  const request = {
    conversation: { id: sessionId, topicId },
    trigger: 'submit-message',
    messageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100',
    messages: [
      { id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d101', role: 'user', parts: user.data.parts },
      { id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100', role: 'assistant', parts: [] }
    ],
    runtime: { kind: 'agent-session', sessionId, turnId: handle.turnId }
  }
  if (ordinary) {
    wiring.manager.send({
      topicId,
      models: [{ modelId, request, abortController: handle.abortController }],
      listeners: handle.listeners,
      isPersistentConversation: true
    })
  } else {
    wiring.manager.startRuntimeTurn({
      topicId,
      modelId,
      request,
      abortController: handle.abortController,
      listeners: handle.listeners
    })
  }
  await until(() => wiring.runtime.entries.get(sessionId).runtimeState.execution.admission === 'admitted')
  return handle
}

it('publishes a terminal topic after its held successor is cancelled during dispatch', async () => {
  const handle = await start()
  const events = observeTopic()
  const followup = messages.saveMessage({
    sessionId,
    message: {
      id: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d102',
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'Follow up' }] }
    }
  })
  wiring.runtime.enqueueUserMessage(sessionId, followup)
  const persistence = handle.listeners.find((l: any) => l.id.startsWith('persistence:'))
  const persist = persistence.onDone.bind(persistence)
  const gate = deferred()
  let persistenceEntered = false
  vi.spyOn(persistence, 'onDone').mockImplementation(async (result: any) => {
    persistenceEntered = true
    await gate.promise
    await persist(result)
  })
  const entry = wiring.runtime.entries.get(sessionId)
  wiring.runtime.applyRuntimeStateEvent(entry, { type: 'runtime-terminal', outcome: { status: 'success' } })
  await until(() => persistenceEntered)
  const generation = wiring.manager.getHeldPublicationTurnId(topicId)
  expect(generation).toBeDefined()
  expect(
    wiring.manager.settleHeldTopicStream({ topicId, expectedStreamTurnId: 'stale', outcome: { status: 'aborted' } })
  ).toBe(false)
  await wiring.runtime.closeSession(sessionId)
  expect(status().status).toBe('streaming')
  expect(row().status).toBe('pending')
  expect(events).toEqual([])
  gate.resolve()
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(events).toMatchObject([
    { status: 'success', isTopicDone: false },
    { status: 'paused', isTopicDone: true }
  ])
  expect(status().status).toBe('aborted')
  expect(
    wiring.manager.settleHeldTopicStream({ topicId, expectedStreamTurnId: generation, outcome: { status: 'aborted' } })
  ).toBe(false)
  expect(row()).toMatchObject({ status: 'success', parts: [] })
})

async function reserveContinuation(beforeBoundary?: (entry: any) => void | Promise<void>) {
  await start()
  const steer = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Follow up' }] } }
  })
  const gate = deferred()
  let turn: any
  vi.spyOn(wiring.runtime, 'refreshTurnTraceContext').mockImplementation(async (_entry: any, captured: any) => {
    turn = captured
    await gate.promise
  })
  const entry = wiring.runtime.entries.get(sessionId)
  await beforeBoundary?.(entry)
  wiring.runtime.applyRuntimeStateEvent(entry, {
    type: 'steer-boundary',
    inputs: [{ message: steer }],
    headless: false
  })
  await until(() => !!turn)
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  return { entry, turn, gate, launch: wiring.runtime.inFlightTurnStarts.get(sessionId) }
}

it('Stop settles a reserved steer before trace refresh returns and is repeatable', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  await wiring.manager.abortAndDrain(topicId, 'user-stop')
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(status().status).toBe('aborted')
  await wiring.manager.abortAndDrain(topicId, 'user-stop')
  gate.resolve()
  await launch
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(row().status).toBe('success')
})

it.each(['cancelled', 'launch-error'] as const)(
  'held %s leaves the predecessor projection complete across stream eviction',
  async (outcome) => {
    const { gate, launch } = await reserveContinuation(async (entry) => {
      wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-start', id: 'answer' })
      wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-delta', id: 'answer', delta: 'Saved predecessor' })
      wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-end', id: 'answer' })
      await until(() => wiring.manager.topicProjection(topicId).snapshot().messages[0]?.parts[0]?.state === 'done')
    })
    const projection = wiring.manager.topicProjection(topicId)
    const detach = projection.subscribe(() => {})
    const completed = projection.snapshot()
    expect(completed.executions).toEqual([
      expect.objectContaining({ executionId: modelId, anchorMessageId: row().id, status: 'done' })
    ])
    expect(completed.messages[0].parts).toEqual([{ type: 'text', text: 'Saved predecessor', state: 'done' }])
    if (outcome === 'cancelled') await stop()
    else {
      gate.reject(new Error('trace refresh failed'))
      await launch
      await wiring.manager.whenTerminalDispatchSettled(topicId)
    }
    await until(() => !wiring.manager.activeStreams.has(topicId))
    expect(projection.snapshot()).toEqual(completed)
    gate.resolve()
    await launch
    detach()
  }
)

it('trace refresh rejection settles the reservation with the actual error', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  gate.reject(new Error('trace refresh failed'))
  await launch
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  const failed = messages.getSessionMessage(sessionId, turn.assistantMessageId)
  expect(failed.status).toBe('error')
  expect(JSON.stringify(failed.data.parts)).toContain('trace refresh failed')
  expect(status().status).toBe('error')
  expect(wiring.manager.hasHeldPublication(topicId)).toBe(false)
})

it('queued synchronous launch failure settles only its reserved answer', async () => {
  await start()
  const entry = wiring.runtime.entries.get(sessionId)
  wiring.runtime.applyRuntimeStateEvent(entry, { type: 'runtime-terminal', outcome: { status: 'success' } })
  await until(() => row().status === 'success')
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  const followup = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: [] } }
  })
  vi.spyOn(wiring.manager, 'startRuntimeTurn').mockImplementation(() => {
    throw new Error('TOPIC_BUSY')
  })
  wiring.runtime.enqueueUserMessage(sessionId, followup)
  await until(() => messages.findOwnerlessPendingMessages(sessionId).length === 0 && entry.branchHead !== row().id)
  expect(messages.getSessionMessage(sessionId, entry.branchHead).status).toBe('error')
  expect(row().status).toBe('success')
})

async function reserveReceiveOnly(failLaunch = false) {
  await start()
  const entry = wiring.runtime.entries.get(sessionId)
  wiring.runtime.applyRuntimeStateEvent(entry, { type: 'runtime-terminal', outcome: { status: 'success' } })
  await until(() => row().status === 'success')
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  const gate = deferred()
  let turn: any
  vi.spyOn(wiring.runtime, 'refreshTurnTraceContext').mockImplementation(async (_entry: any, captured: any) => {
    turn = captured
    await gate.promise
  })
  if (failLaunch)
    vi.spyOn(wiring.manager, 'startRuntimeTurn').mockImplementation(() => {
      throw new Error('receive failed')
    })
  wiring.runtime.applyRuntimeStateEvent(entry, {
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' }
  })
  wiring.runtime.requestRuntimeLaunch(entry, 'receive-only')
  await until(() => !!turn)
  return { entry, turn, gate, launch: wiring.runtime.inFlightTurnStarts.get(sessionId) }
}

it('receive-only cancellation settles before its trace latch releases', async () => {
  const { turn, gate, launch } = await reserveReceiveOnly()
  await wiring.runtime.closeSession(sessionId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  gate.resolve()
  await launch
  expect(row().status).toBe('success')
})

it('receive-only launch failure terminalizes its saved placeholder', async () => {
  const { turn, gate, launch } = await reserveReceiveOnly(true)
  gate.resolve()
  await launch
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('error')
  expect(row().status).toBe('success')
})

it('close cancels a deferred unopened reservation without sending it', async () => {
  const { entry, turn, gate, launch } = await reserveContinuation()
  entry.runtimeState.execution = { kind: 'turn', turn, stream: 'unopened', admission: 'admitted' }
  await wiring.runtime.closeSession(sessionId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  gate.resolve()
  await launch
  expect(wiring.runtime.inspect(sessionId)).toBeUndefined()
})

it('Stop repairs a seeded ordinary orphan and cache-only live publication', async () => {
  const orphan = messages.saveMessage({
    sessionId,
    message: { role: 'assistant', status: 'pending', data: { parts: [] }, modelId }
  })
  defaultServiceInstances.CacheService.setShared(key, {
    status: 'streaming',
    turnId: 'orphan-generation',
    activeExecutions: [],
    awaitingApprovalAnchors: []
  })
  await wiring.manager.abortAndDrain(topicId, 'user-stop')
  expect(messages.getSessionMessage(sessionId, orphan.id).status).toBe('error')
  expect(status()).toMatchObject({ status: 'aborted', turnId: 'orphan-generation', activeExecutions: [] })
  await wiring.manager.abortAndDrain(topicId, 'user-stop')
  expect(messages.getSessionMessage(sessionId, orphan.id).status).toBe('error')
})

it('late cleanup cannot change a replacement generation', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  await wiring.runtime.closeSession(sessionId)
  const user = messages.saveMessage({ sessionId, message: { role: 'user', status: 'success', data: { parts: [] } } })
  const answer = messages.saveMessage({
    sessionId,
    message: { role: 'assistant', status: 'pending', data: { parts: [] }, modelId }
  })
  const replacement = wiring.runtime.beginTurn({
    sessionId,
    topicId,
    agentId: 'agent-1',
    agentType: 'claude-code',
    modelId,
    assistantMessageId: answer.id,
    userMessage: user
  })
  wiring.manager.startRuntimeTurn({
    topicId,
    modelId,
    abortController: replacement.abortController,
    request: {
      conversation: { id: sessionId, topicId },
      trigger: 'submit-message',
      messageId: answer.id,
      messages: [{ id: answer.id, role: 'assistant', parts: [] }],
      runtime: { kind: 'agent-session', sessionId, turnId: replacement.turnId }
    },
    listeners: replacement.listeners
  })
  await until(() => wiring.runtime.entries.get(sessionId).runtimeState.execution.admission === 'admitted')
  const replacementGeneration = status().turnId

  gate.resolve()
  await launch
  expect(status()).toMatchObject({ status: 'streaming', turnId: replacementGeneration })
  expect(messages.getSessionMessage(sessionId, answer.id).status).toBe('pending')
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
})

it('reconciliation protects runtime deferred and suppressed owners and approval waits', async () => {
  const { entry, turn, gate, launch } = await reserveContinuation()
  entry.runtimeState.launch = { kind: 'suppressed', target: 'deferred-turn' }
  wiring.manager.reconcileStoppedSession(topicId, status().turnId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
  await wiring.runtime.closeSession(sessionId)
  const approval = messages.saveMessage({
    sessionId,
    message: {
      role: 'assistant',
      status: 'pending',
      data: {
        parts: [
          {
            type: 'tool-test',
            toolCallId: 'approval',
            state: 'approval-requested',
            input: {},
            approval: { id: 'approval' }
          }
        ]
      }
    }
  })
  defaultServiceInstances.CacheService.setShared(key, {
    status: 'awaiting-approval',
    turnId: 'approval',
    activeExecutions: [],
    awaitingApprovalAnchors: []
  })
  wiring.manager.reconcileStoppedSession(topicId, 'approval')
  expect(messages.getSessionMessage(sessionId, approval.id).status).toBe('pending')
  expect(status().status).toBe('awaiting-approval')
  gate.resolve()
  await launch
})

async function stop() {
  await aiHandlers['ai.stream.abort']({ topicId }, {} as any)
}

function observeTopic() {
  const events: any[] = []
  wiring.manager.addListener(topicId, {
    id: 'recovery-observer',
    isAlive: () => true,
    onChunk() {},
    onDone: (result: any) => {
      events.push(result)
    },
    onPaused: (result: any) => {
      events.push(result)
    },
    onError: (result: any) => {
      events.push(result)
    }
  })
  return events
}

function publishOrphan() {
  defaultServiceInstances.CacheService.setShared(key, {
    status: 'streaming',
    turnId: 'orphan-generation',
    activeExecutions: [],
    awaitingApprovalAnchors: []
  })
}

function rawData(messageId: string) {
  const stored = dbh.sqlite.prepare('SELECT data FROM agent_session_message WHERE id = ?').get(messageId) as {
    data: string
  }
  return JSON.parse(stored.data)
}

function seedPrivateData(messageId: string) {
  const data = {
    ...rawData(messageId),
    runtimeAnchor: { checkpoint: 'retained-checkpoint' },
    nativeSessionId: 'retained-session',
    deliveryReplyAnchor: { messageId: 'retained-reply' }
  }
  dbh.sqlite.prepare('UPDATE agent_session_message SET data = ? WHERE id = ?').run(JSON.stringify(data), messageId)
  return data
}

it('ordinary send leaves live Stop persistence to the installed listener', async () => {
  const handle = await start(true)
  const events = observeTopic()
  const entry = wiring.runtime.entries.get(sessionId)
  wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-start', id: 'answer' })
  wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-delta', id: 'answer', delta: 'Partial answer' })
  await until(() =>
    wiring.manager.activeStreams
      .get(topicId)
      .executions.get(modelId)
      .finalMessage?.parts.some((p: any) => p.text === 'Partial answer')
  )
  const persistence = handle.listeners.find((l: any) => l.terminalPhase === 'persistence')
  const persist = persistence.onPaused.bind(persistence)
  const gate = deferred()
  let writing = false
  vi.spyOn(persistence, 'onPaused').mockImplementation(async (result: any) => {
    writing = true
    await gate.promise
    await persist(result)
  })
  const stopping = stop()
  await until(() => writing)
  expect(row().status).toBe('pending')
  expect(events).toEqual([])
  gate.resolve()
  await stopping
  expect(row()).toMatchObject({ status: 'paused', parts: [{ type: 'text', text: 'Partial answer', state: 'done' }] })
  expect(events).toMatchObject([{ status: 'paused', isTopicDone: true }])
  expect(status().status).toBe('aborted')
})

it('direct abort settles an unopened live continuation without waiting for trace refresh', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  const events = observeTopic()
  wiring.manager.abort(topicId, 'user-stop')
  await until(() => status().status === 'aborted')
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(events).toMatchObject([{ status: 'paused', isTopicDone: true }])
  const open = vi.spyOn(wiring.runtime, 'openTurnStream')
  gate.resolve()
  await launch
  expect(open).not.toHaveBeenCalled()
  expect(row().status).toBe('success')
})

it.each(['missing', 'success'] as const)(
  'settles runtime and held ownership when the reserved row is %s',
  async (existing) => {
    const { entry, turn, gate, launch } = await reserveContinuation()
    if (existing === 'missing') {
      dbh.sqlite.prepare('DELETE FROM agent_session_message WHERE id = ?').run(turn.assistantMessageId)
    } else {
      dbh.sqlite
        .prepare("UPDATE agent_session_message SET status = 'success' WHERE id = ?")
        .run(turn.assistantMessageId)
    }
    wiring.runtime.abortPendingTurn(sessionId, 'user-stop')
    await until(() => status().status === 'aborted')
    expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(false)
    expect(entry.runtimeState.lastTerminal).toBe('paused')
    if (existing === 'success')
      expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('success')
    else
      expect(
        dbh.sqlite.prepare('SELECT id FROM agent_session_message WHERE id = ?').get(turn.assistantMessageId)
      ).toBeUndefined()
    gate.resolve()
    await launch
  }
)

it('same-id beginTurn fences the replacement row before old entry teardown', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  const replacement = wiring.runtime.beginTurn({
    sessionId,
    topicId,
    agentId: 'agent-1',
    agentType: 'claude-code',
    modelId,
    assistantMessageId: turn.assistantMessageId,
    userMessage: turn.userMessage
  })
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
  gate.resolve()
  await launch
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
  expect(wiring.runtime.inspect(sessionId).assistantMessageId).toBe(turn.assistantMessageId)
  expect(replacement.abortController.signal.aborted).toBe(false)
})

it('failure inside send after predecessor eviction ends the topic and settles the new reservation', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  const events = observeTopic()
  vi.spyOn(wiring.manager, 'createAndLaunchExecution').mockImplementationOnce(() => {
    expect(wiring.manager.activeStreams.has(topicId)).toBe(false)
    throw new Error('construction failed after eviction')
  })
  gate.resolve()
  await launch
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId)).toMatchObject({ status: 'error' })
  expect(JSON.stringify(messages.getSessionMessage(sessionId, turn.assistantMessageId).data.parts)).toContain(
    'construction failed after eviction'
  )
  expect(status().status).toBe('error')
  expect(events).toMatchObject([
    { status: 'error', isTopicDone: true, error: { message: 'construction failed after eviction' } }
  ])
  expect(events[0].topicAttemptWatermark).toBeGreaterThan(0)
  expect(row().status).toBe('success')
})

it('both orphan and explicit reservation settlement retain raw private metadata', async () => {
  const orphan = messages.saveMessage({
    sessionId,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const original = seedPrivateData(orphan.id)
  publishOrphan()
  await stop()
  expect(messages.getSessionMessage(sessionId, orphan.id).status).toBe('error')
  expect(rawData(orphan.id)).toEqual(original)

  const { turn, gate, launch } = await reserveContinuation()
  const reserved = seedPrivateData(turn.assistantMessageId)
  await stop()
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(rawData(turn.assistantMessageId)).toEqual(reserved)
  gate.resolve()
  await launch
})

it('Stop leaves a native-owned pending row untouched', async () => {
  const { preparePiBranch } = await import('@main/ai/runtime/pi/piContext')
  const { agentSessionContextService: contexts } = await import('@data/services/AgentSessionContextService')
  const { prepareNativeSubmission } = await import('@main/ai/agentSession/nativeSubmission')
  const user = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Native input' }] } }
  })
  const context = preparePiBranch(sessionId, undefined, 'native-session')
  contexts.bindContext(context.id, 'native-session')
  prepareNativeSubmission(sessionId, user.id, context.id, 'reject')
  const native = messages.saveMessage({
    sessionId,
    parentId: user.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  publishOrphan()
  await stop()
  expect(messages.getSessionMessage(sessionId, native.id).status).toBe('pending')
})

it('Stop excludes approval-requested parts independently of the cache status', async () => {
  const approval = messages.saveMessage({
    sessionId,
    message: {
      role: 'assistant',
      status: 'pending',
      data: {
        parts: [
          {
            type: 'tool-test',
            toolCallId: 'approval',
            state: 'approval-requested',
            input: {},
            approval: { id: 'approval' }
          }
        ]
      }
    }
  })
  publishOrphan()
  const published = {
    ...status(),
    activeExecutions: [{ modelId, attemptId: 7, anchorMessageId: approval.id }],
    awaitingApprovalAnchors: [{ modelId, anchorMessageId: approval.id }]
  }
  defaultServiceInstances.CacheService.setShared(key, published)
  const original = messages.getSessionMessage(sessionId, approval.id)
  const cache = defaultServiceInstances.CacheService
  const publicationStart = cache.setShared.mock.calls.length
  await stop()
  expect(messages.getSessionMessage(sessionId, approval.id).status).toBe('pending')
  expect(messages.getSessionMessage(sessionId, approval.id).data.parts?.[0]).toMatchObject({
    state: 'approval-requested'
  })
  expect(messages.getSessionMessage(sessionId, approval.id)).toEqual(original)
  expect(status()).toEqual(published)
  expect(cache.setShared.mock.calls.slice(publicationStart).filter(([cacheKey]) => cacheKey === key)).toEqual([])
})

it('a delayed duplicate Stop cannot abort the newer admitted generation', async () => {
  const turnA = await start(true)
  const persistence = turnA.listeners.find((listener: any) => listener.terminalPhase === 'persistence')
  const persist = persistence.onPaused.bind(persistence)
  const gate = deferred()
  let writing = false
  vi.spyOn(persistence, 'onPaused').mockImplementation(async (result: any) => {
    writing = true
    await gate.promise
    await persist(result)
  })
  const firstStop = stop()
  await until(() => writing)
  const admission = wiring.manager.withDispatchLock(topicId, async () => {
    await start(true)
  })
  const staleStop = stop()
  gate.resolve()
  await firstStop
  await admission
  const generation = status().turnId
  await staleStop
  expect(turnA.abortController.signal.aborted).toBe(true)
  expect(status()).toMatchObject({ status: 'streaming', turnId: generation })
  expect(row().status).toBe('pending')
  expect(wiring.runtime.inspect(sessionId).status).toBe('active')
  expect(wiring.runtime.entries.get(sessionId).runtimeState.execution.turn.abortController.signal.aborted).toBe(false)
})

it('an idle prewarm installed during close does not block orphan convergence', async () => {
  const orphan = messages.saveMessage({
    sessionId,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  publishOrphan()
  const original = wiring.runtime.closeSession.bind(wiring.runtime)
  vi.spyOn(wiring.runtime, 'closeSession').mockImplementation(async (id: any) => {
    await original(id)
    const { createAgentSessionRuntimeState } = await import('../agentSessionRuntimeState')
    wiring.runtime.entries.set(id, {
      sessionId: id,
      topicId,
      agentId: 'agent-1',
      agentType: 'claude-code',
      modelId,
      runtimeState: createAgentSessionRuntimeState()
    })
  })
  await stop()
  expect(wiring.runtime.inspect(sessionId)).toMatchObject({
    status: 'idle',
    pendingMessageCount: 0,
    activeToolCount: 0
  })
  expect(messages.getSessionMessage(sessionId, orphan.id).status).toBe('error')
  expect(status().status).toBe('aborted')
})

it('an aborted trace wait cannot launch even while the entry is still current', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  const open = vi.spyOn(wiring.runtime, 'openTurnStream')
  turn.abortController.abort('cancel-before-handoff')
  gate.resolve()
  await launch
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(status().status).toBe('aborted')
  expect(open).not.toHaveBeenCalled()
})

it('genuine reservation write failures propagate and keep ownership retryable', async () => {
  const { entry, turn, gate, launch } = await reserveContinuation()
  vi.spyOn(messages, 'settlePendingAssistant').mockImplementationOnce(() => {
    throw new Error('database unavailable')
  })
  await expect(wiring.runtime.settleUnhandedTurn(entry, turn, { status: 'paused' })).rejects.toThrow(
    'database unavailable'
  )
  expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
  await stop()
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  gate.resolve()
  await launch
})

it('failed reservation writes through Stop and close keep publication held until a later Stop retries', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  const predecessor = messages.getSessionMessage(sessionId, row().id)
  const events = observeTopic()
  const published = structuredClone(status())
  const cache = defaultServiceInstances.CacheService
  const publicationStart = cache.setShared.mock.calls.length
  const publications = () =>
    cache.setShared.mock.calls
      .slice(publicationStart)
      .filter(([cacheKey]) => cacheKey === key)
      .map(([, value]) => value as any)
  const write = vi.spyOn(messages, 'settlePendingAssistant').mockImplementation(() => {
    throw new Error('database unavailable through close')
  })
  await expect(stop()).rejects.toThrow('reservation')
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
  expect(wiring.runtime.inspect(sessionId)).toBeUndefined()
  expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
  expect(status()).toEqual(published)
  expect(events).toEqual([])
  expect(publications()).toEqual([])
  expect(
    wiring.manager.settleHeldTopicStream({
      topicId,
      expectedStreamTurnId: published.turnId,
      outcome: { status: 'aborted' }
    })
  ).toBe(false)

  write.mockRestore()
  await stop()
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(false)
  expect(status()).toMatchObject({ status: 'aborted', turnId: published.turnId })
  expect(events).toMatchObject([{ status: 'paused', isTopicDone: true }])
  expect(publications().map((value) => value.status)).toEqual(['aborted'])
  expect(messages.getSessionMessage(sessionId, predecessor.id)).toEqual(predecessor)
  gate.resolve()
  await launch
  await stop()
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(status().status).toBe('aborted')
  expect(events).toHaveLength(1)
  expect(messages.getSessionMessage(sessionId, predecessor.id)).toEqual(predecessor)
})

it('held Stop and its terminal barrier await real trace cleanup and isolate throwing listeners', async () => {
  const { gate, launch } = await reserveContinuation()
  const { TraceStorageService } = await import('@main/ai/observability/storage/TraceStorageService')
  wiring.traceRoot = await mkdtemp(join(tmpdir(), 'issue23386-held-trace-'))
  MockMainPreferenceServiceUtils.setPreferenceValue('app.developer_mode.enabled', true)
  const storage = new TraceStorageService()
  await storage._doInit()
  storage.saveEntity({
    id: 'held-span',
    name: 'held-cleanup',
    traceId: 'held-trace',
    topicId,
    parentId: '',
    kind: 'internal',
    status: 'OK',
    isEnd: true,
    startTime: 1,
    endTime: 2,
    attributes: undefined,
    events: undefined,
    links: undefined
  })
  const trace = deferred()
  const saved: string[] = []
  let flushing = false
  wiring.saveSpans.mockImplementation(async (id) => {
    flushing = true
    await trace.promise
    await storage.saveSpans(id)
    saved.push(id)
  })
  wiring.manager.addListener(topicId, {
    id: 'throwing-held-notification',
    isAlive: () => true,
    onChunk() {},
    onDone() {},
    async onPaused() {
      throw new Error('notification failed')
    },
    onError() {}
  })
  wiring.manager.addListener(topicId, {
    id: 'throwing-held-liveness',
    terminalPhase: 'cleanup',
    isAlive() {
      throw new Error('liveness failed')
    },
    onChunk() {},
    onDone() {},
    onPaused() {},
    onError() {}
  })
  let stopped = false
  const stopping = stop().then(() => {
    stopped = true
  })
  await until(() => flushing)
  let settled = false
  const barrier = wiring.manager.whenTerminalDispatchSettled(topicId).then(() => {
    settled = true
  })
  expect(
    wiring.manager.settleHeldTopicStream({
      topicId,
      expectedStreamTurnId: status().turnId,
      outcome: { status: 'aborted' }
    })
  ).toBe(true)
  await new Promise((resolve) => setImmediate(resolve))
  expect(stopped).toBe(false)
  expect(settled).toBe(false)
  expect(saved).toEqual([])
  expect(await readdir(wiring.traceRoot)).toEqual([])
  expect(status().status).toBe('streaming')
  trace.resolve()
  await Promise.all([stopping, barrier])
  expect(saved).toEqual([topicId])
  const [folder] = await readdir(wiring.traceRoot)
  const [file] = await readdir(join(wiring.traceRoot, folder))
  expect(JSON.parse((await readFile(join(wiring.traceRoot, folder, file), 'utf8')).trim())).toMatchObject({
    id: 'held-span',
    traceId: 'held-trace',
    topicId,
    isEnd: true
  })
  expect(status().status).toBe('aborted')
  gate.resolve()
  await launch
})

it('queued held settlement joins the predecessor dispatch without joining itself', async () => {
  const handle = await start()
  const followup = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Follow up' }] } }
  })
  wiring.runtime.enqueueUserMessage(sessionId, followup)
  const persistence = handle.listeners.find((listener: any) => listener.terminalPhase === 'persistence')
  const persist = persistence.onDone.bind(persistence)
  const predecessor = deferred()
  const trace = deferred()
  let writing = false
  let flushing = false
  const saved: string[] = []
  vi.spyOn(persistence, 'onDone').mockImplementation(async (result: any) => {
    writing = true
    await predecessor.promise
    await persist(result)
  })
  wiring.saveSpans.mockImplementation(async (id) => {
    flushing = true
    await trace.promise
    saved.push(id)
  })
  wiring.runtime.applyRuntimeStateEvent(wiring.runtime.entries.get(sessionId), {
    type: 'runtime-terminal',
    outcome: { status: 'success' }
  })
  await until(() => writing)
  await wiring.runtime.closeSession(sessionId)
  let settled = false
  const barrier = wiring.manager.whenTerminalDispatchSettled(topicId).then(() => {
    settled = true
  })
  predecessor.resolve()
  await until(() => flushing)
  expect(settled).toBe(false)
  expect(status().status).toBe('streaming')
  expect(row().status).toBe('success')
  trace.resolve()
  await barrier
  expect(saved).toEqual([topicId])
  expect(status().status).toBe('aborted')
})

it.each([
  ['cancelled', false],
  ['cancelled', true],
  ['launch-error', false],
  ['launch-error', true]
] as const)(
  'remote journal retains the saved predecessor receipt after %s (empty output: %s)',
  async (outcome, empty) => {
    let journal: InstanceType<typeof SessionJournal>
    let events: any[]
    const { turn, gate, launch } = await reserveContinuation(async (entry) => {
      journal = new SessionJournal(sessionId)
      journal.poll()
      events = observeTopic()
      if (!empty) {
        wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-start', id: 'answer' })
        wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-delta', id: 'answer', delta: 'Saved predecessor' })
        await until(
          () => wiring.manager.activeStreams.get(topicId).executions.get(modelId).finalMessage?.parts.length > 0
        )
      }
    })
    const predecessor = messages.getSessionMessage(sessionId, row().id)
    expect(events![0]).toMatchObject({ isTopicDone: false, persistence: { status: 'saved' } })
    const receipt = events![0].persistence.message
    expect(receipt.messageId).toBe(predecessor.id)
    if (empty) expect(events![0].finalMessage).toBeUndefined()
    if (outcome === 'cancelled') await stop()
    else {
      vi.spyOn(wiring.manager, 'startRuntimeTurn').mockImplementationOnce(() => {
        throw new Error('launch failed')
      })
      gate.resolve()
      await launch
      await wiring.manager.whenTerminalDispatchSettled(topicId)
    }
    const executionEvents = journal!
      .eventsAfter(0, Number.MAX_SAFE_INTEGER)
      .filter((event) => event.kind === 'execution.updated')
    const terminal = executionEvents.at(-1)!
    expect(terminal.payload).toMatchObject({
      status: outcome === 'cancelled' ? 'cancelled' : 'failed',
      messageId: predecessor.id,
      durable: true,
      history: { messageRevision: receipt.messageRevision, historyRevision: receipt.historyRevision }
    })
    expect(terminal.payload).not.toHaveProperty('persistenceFailure')
    expect(events!.at(-1)).toMatchObject({
      isTopicDone: true,
      persistence: events![0].persistence,
      modelId: events![0].modelId,
      attemptId: events![0].attemptId,
      anchorMessageId: events![0].anchorMessageId,
      userMessageId: events![0].userMessageId
    })
    expect(messages.getSessionMessage(sessionId, predecessor.id)).toEqual(predecessor)
    expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe(
      outcome === 'cancelled' ? 'paused' : 'error'
    )
    gate.resolve()
    await launch
    journal!.dispose()
  }
)

it('held settlement preserves a genuine failed persistence outcome for the real journal', async () => {
  const handle = await start()
  const journal = new SessionJournal(sessionId)
  journal.poll()
  const events = observeTopic()
  const followup = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Follow up' }] } }
  })
  wiring.runtime.enqueueUserMessage(sessionId, followup)
  const persistence = handle.listeners.find((listener: any) => listener.terminalPhase === 'persistence')
  vi.spyOn(persistence.opts, 'onPersistFailed').mockImplementation(() => {})
  vi.spyOn(persistence.opts.backend, 'persistAssistant').mockImplementation(() => {
    throw new Error('predecessor persistence failed')
  })
  wiring.runtime.applyRuntimeStateEvent(wiring.runtime.entries.get(sessionId), {
    type: 'runtime-terminal',
    outcome: { status: 'success' }
  })
  await until(() => wiring.manager.hasHeldPublication(topicId))
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  await stop()
  const terminal = events.at(-1)
  expect(terminal).toMatchObject({
    status: 'paused',
    isTopicDone: true,
    persistence: { status: 'failed', failure: { message: 'predecessor persistence failed' } }
  })
  const executionEvents = journal
    .eventsAfter(0, Number.MAX_SAFE_INTEGER)
    .filter((event) => event.kind === 'execution.updated')
  expect(executionEvents.at(-1)?.payload).toMatchObject({
    status: 'cancelled',
    durable: false,
    messageId: row().id,
    persistenceFailure: { message: 'predecessor persistence failed' }
  })
  expect(executionEvents.at(-1)?.payload).not.toHaveProperty('history')
  expect(row().status).toBe('error')
  journal.dispose()
})

it('failed persistence stays unresolved in the projection when the held topic stops', async () => {
  const handle = await start()
  const events = observeTopic()
  const projection = wiring.manager.topicProjection(topicId)
  const detach = projection.subscribe(() => {})
  const followup = messages.saveMessage({
    sessionId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Follow up' }] } }
  })
  wiring.runtime.enqueueUserMessage(sessionId, followup)
  const persistence = handle.listeners.find((listener: any) => listener.terminalPhase === 'persistence')
  const gate = deferred()
  let writing = false
  vi.spyOn(persistence.opts.backend, 'persistAssistant').mockImplementation(async () => {
    writing = true
    await gate.promise
    throw new Error('predecessor persistence failed')
  })
  wiring.runtime.applyRuntimeStateEvent(wiring.runtime.entries.get(sessionId), {
    type: 'runtime-terminal',
    outcome: { status: 'success' }
  })
  await until(() => writing)
  expect(wiring.manager.hasHeldPublication(topicId)).toBe(true)
  await wiring.runtime.closeSession(sessionId)
  gate.resolve()
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    status: 'error',
    isTopicDone: true,
    error: { message: 'predecessor persistence failed' },
    persistence: { status: 'failed' }
  })
  const failed = projection.snapshot()
  expect(failed.executions).toEqual([
    expect.objectContaining({ executionId: modelId, anchorMessageId: row().id, status: 'unresolved' })
  ])
  expect(failed.messages[0].parts).toMatchObject([
    { type: 'data-error', data: { message: 'predecessor persistence failed' } }
  ])
  await stop()
  await until(() => !wiring.manager.activeStreams.has(topicId))
  expect(projection.snapshot()).toEqual(failed)
  expect(events).toHaveLength(1)
  detach()
})

async function liveReceiveOnlyWithDeferredTurn() {
  await start()
  const entry = wiring.runtime.entries.get(sessionId)
  const deferredTurn = wiring.runtime.currentTurn(entry)
  wiring.runtime.applyRuntimeStateEvent(entry, {
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    deferCurrentTurn: true,
    contextTurn: deferredTurn
  })
  wiring.runtime.deferTurnForReceiveOnly(entry, deferredTurn)
  expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
  expect(wiring.manager.getHeldPublicationTurnId(topicId)).toBeUndefined()
  await until(() => entry.runtimeState.execution.turn?.controller !== undefined)
  const liveTurn = entry.runtimeState.execution.turn
  wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-start', id: 'live-answer' })
  wiring.runtime.deliverRuntimeChunk(entry, { type: 'text-delta', id: 'live-answer', delta: 'Live output' })
  await until(() => status().status === 'streaming' && !wiring.runtime.inFlightTurnStarts.has(sessionId))
  return { entry, deferredTurn, liveTurn }
}

it('live receive-only pause persists once and holds the topic until its deferred reservation retries', async () => {
  const { deferredTurn, liveTurn } = await liveReceiveOnlyWithDeferredTurn()
  const events = observeTopic()
  const stream = wiring.manager.activeStreams.get(topicId)
  const persistence = [...stream.listeners.values()].find((listener: any) => listener.terminalPhase === 'persistence')
  const persist = vi.spyOn(persistence.opts.backend, 'persistAssistant')
  const settle = messages.settlePendingAssistant.bind(messages)
  vi.spyOn(messages, 'settlePendingAssistant').mockImplementationOnce(() => {
    throw new Error('deferred storage unavailable')
  })

  wiring.manager.abort(topicId, 'user-requested')
  await Promise.all([...stream.executions.values()].map((execution: any) => execution.loopPromise))
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(messages.getSessionMessage(sessionId, liveTurn.assistantMessageId)).toMatchObject({ status: 'paused' })
  expect(persist.mock.calls.map(([input]) => (input as any).status)).toEqual(['paused'])
  expect(row().status).toBe('pending')
  expect(events).toEqual([])
  expect(status()).toMatchObject({ status: 'streaming', turnId: stream.turnId })

  await stop()
  expect(row().status).toBe('paused')
  expect(status()).toMatchObject({ status: 'aborted', turnId: stream.turnId })
  expect(events).toMatchObject([{ status: 'paused', isTopicDone: true }])
  expect(events).toHaveLength(1)
  expect(persist.mock.calls.map(([input]) => (input as any).status)).toEqual(['paused'])
  expect(settle(sessionId, deferredTurn.assistantMessageId, 'paused', (parts) => parts)).toBe(false)
})

it('a deferred settlement retry cannot terminalize a replacement receive-only generation', async () => {
  const { entry, deferredTurn } = await liveReceiveOnlyWithDeferredTurn()
  const events = observeTopic()
  vi.spyOn(messages, 'settlePendingAssistant').mockImplementationOnce(() => {
    throw new Error('deferred storage unavailable')
  })
  const stream = wiring.manager.activeStreams.get(topicId)
  wiring.manager.abort(topicId, 'user-requested')
  await Promise.all([...stream.executions.values()].map((execution: any) => execution.loopPromise))
  expect(row().status).toBe('pending')
  expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
  const answer = messages.saveMessage({
    sessionId,
    message: { role: 'assistant', status: 'pending', data: { parts: [] }, modelId }
  })
  const handle = wiring.runtime.beginTurn({
    sessionId,
    topicId,
    agentId: 'agent-1',
    agentType: 'claude-code',
    modelId,
    assistantMessageId: answer.id
  })
  await wiring.manager.startRuntimeTurn({
    topicId,
    modelId,
    abortController: handle.abortController,
    request: {
      conversation: { id: sessionId, topicId },
      trigger: 'submit-message',
      messageId: answer.id,
      messages: [],
      runtime: { kind: 'agent-session', sessionId, turnId: handle.turnId }
    },
    listeners: handle.listeners
  })
  await until(() => wiring.runtime.entries.get(sessionId).runtimeState.execution.admission === 'admitted')
  const replacementEntry = wiring.runtime.entries.get(sessionId)
  wiring.runtime.deliverRuntimeChunk(replacementEntry, { type: 'text-start', id: 'replacement' })
  wiring.runtime.deliverRuntimeChunk(replacementEntry, { type: 'text-delta', id: 'replacement', delta: 'Still live' })
  await until(() => status().status === 'streaming')
  const generation = status().turnId
  await wiring.runtime.settleUnhandedTurn(entry, deferredTurn, { status: 'paused' })
  wiring.runtime.flushHeldSettlement(entry)
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(row().status).toBe('paused')
  expect(status()).toMatchObject({ status: 'streaming', turnId: generation })
  expect(events).toEqual([])
  expect(messages.getSessionMessage(sessionId, answer.id).status).toBe('pending')
})

it.each(['continuation', 'receive-only'] as const)(
  '%s cancellation write failure stays paused on retry instead of becoming a launch error',
  async (kind) => {
    const { entry, turn, gate, launch } =
      kind === 'continuation' ? await reserveContinuation() : await reserveReceiveOnly()
    turn.abortController.abort('cancel-during-trace')
    vi.spyOn(messages, 'settlePendingAssistant').mockImplementationOnce(() => {
      throw new Error('paused write unavailable')
    })
    gate.resolve()
    await launch
    expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
    expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
    expect(wiring.runtime.inspect(sessionId).lastTerminalStatus).not.toBe('error')
    await wiring.runtime.settleUnhandedTurn(entry, turn, { status: 'paused' })
    expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
    if (kind === 'receive-only') {
      expect(entry.runtimeState.execution.settled).toBe('paused')
      wiring.runtime.applyRuntimeStateEvent(entry, { type: 'autonomous-turn-state', state: 'finished' })
    }
    expect(wiring.runtime.inspect(sessionId).lastTerminalStatus).toBe('paused')
  }
)

it('a refused held publication remains retryable through close after its row has settled', async () => {
  const { turn, gate, launch } = await reserveContinuation()
  const settle = vi.spyOn(wiring.manager, 'settleHeldTopicStream').mockReturnValue(false)
  await wiring.runtime.closeSession(sessionId)
  expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('paused')
  expect(wiring.runtime.inspect(sessionId)).toBeUndefined()
  expect(status().status).toBe('streaming')
  settle.mockRestore()
  await wiring.runtime.closeSession(sessionId)
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  expect(status().status).toBe('aborted')
  gate.resolve()
  await launch
})

it('held dispatch completes when its listener awaits replacement and fences the carried listener', async () => {
  const { gate, launch } = await reserveContinuation()
  const order: string[] = []
  const callback = deferred()
  const requested = deferred()
  const generation = status().turnId
  let replacement: Promise<any> | undefined
  let replacementMessageId: string | undefined
  let acceptance: any
  let generationInCallback: string | undefined
  let orderInCallback: string[] = []
  const send = wiring.manager.send.bind(wiring.manager)
  vi.spyOn(wiring.manager, 'send').mockImplementation((input: any) => {
    const result = send(input)
    if (input.models[0].request.messageId === replacementMessageId) order.push('replacement-admitted')
    return result
  })
  let entered = false
  wiring.manager.addListener(topicId, {
    id: 'replacement-launcher',
    terminalPhase: 'cleanup',
    isAlive: () => true,
    onChunk() {},
    onDone() {},
    onError() {},
    async onPaused() {
      entered = true
      await callback.promise
      const answer = messages.saveMessage({
        sessionId,
        message: { role: 'assistant', status: 'pending', data: { parts: [] }, modelId }
      })
      const handle = wiring.runtime.beginTurn({
        sessionId,
        topicId,
        agentId: 'agent-1',
        agentType: 'claude-code',
        modelId,
        assistantMessageId: answer.id
      })
      replacementMessageId = answer.id
      replacement = wiring.manager.startRuntimeTurn({
        topicId,
        modelId,
        abortController: handle.abortController,
        request: {
          conversation: { id: sessionId, topicId },
          trigger: 'submit-message',
          messageId: answer.id,
          messages: [],
          runtime: { kind: 'agent-session', sessionId, turnId: handle.turnId }
        },
        listeners: handle.listeners
      })
      acceptance = await replacement
      orderInCallback = [...order]
      generationInCallback = status().turnId
      requested.resolve()
    }
  })
  const chunks: any[] = []
  wiring.manager.addListener(topicId, {
    id: 'carried-observer',
    terminalPhase: 'cleanup',
    isAlive: () => true,
    onChunk(chunk: any) {
      chunks.push(chunk)
    },
    onDone() {},
    onError() {},
    onPaused() {
      order.push('terminal')
    }
  })
  const closing = wiring.runtime.closeSession(sessionId)
  await until(() => entered)
  expect(order).toEqual([])
  expect(status().turnId).toBe(generation)
  callback.resolve()
  await requested.promise
  expect(acceptance.mode).toBe('deferred')
  expect(orderInCallback).toEqual([])
  expect(generationInCallback).toBe(generation)
  await closing
  await wiring.manager.whenTerminalDispatchSettled(topicId)
  await replacement
  await until(() => order.includes('replacement-admitted'))
  expect(order).toEqual(['replacement-admitted'])
  wiring.manager.onChunk(topicId, modelId, { type: 'text-delta', id: 'new', delta: 'Replacement output' })
  expect(chunks).toContainEqual({ type: 'text-delta', id: 'new', delta: 'Replacement output' })
  expect(status().status).toBe('streaming')
  gate.resolve()
  await launch
})

it('settlement advances the journal history revision and activity atomically, with rollback on failure', async () => {
  await start()
  const journal = new SessionJournal(sessionId)
  journal.poll()
  const readSession = () =>
    dbh.sqlite.prepare('SELECT updated_at, last_activity_at FROM agent_session WHERE id = ?').get(sessionId) as {
      updated_at: number
      last_activity_at: number
    }
  const before = readSession()
  const notifications = defaultServiceInstances.WindowManager.broadcast
  notifications.mockClear()
  const original = row()
  const future = before.updated_at + 1
  vi.spyOn(Date, 'now').mockReturnValue(before.updated_at)
  // A real trigger aborts after the message update when settlement touches the session.
  dbh.sqlite.exec(`CREATE TEMP TRIGGER fail_settlement_revision BEFORE UPDATE ON agent_session
    BEGIN SELECT RAISE(ABORT, 'session revision unavailable'); END`)
  expect(() => messages.settlePendingAssistant(sessionId, original.id, 'paused', (parts) => parts)).toThrow(
    'session revision unavailable'
  )
  expect(row()).toEqual(original)
  expect(readSession()).toEqual(before)
  expect(notifications).not.toHaveBeenCalled()
  dbh.sqlite.exec('DROP TRIGGER fail_settlement_revision')
  expect(messages.settlePendingAssistant(sessionId, original.id, 'paused', (parts) => parts)).toBe(true)
  expect(row().status).toBe('paused')
  expect(readSession()).toEqual({ updated_at: future, last_activity_at: future })
  expect(notifications.mock.calls.flatMap(([, effects]) => effects)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ endpoint: '/agent-sessions', kind: 'projection' }),
      expect.objectContaining({
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId }
      })
    ])
  )
  ;(journal as any).commitHistory()
  const committed = journal
    .eventsAfter(0, Number.MAX_SAFE_INTEGER)
    .filter((event) => event.kind === 'history.committed')
  expect(committed.at(-1)?.payload).toMatchObject({ historyRevision: String(future) })
  expect(JSON.stringify(committed.at(-1)?.payload)).toContain(original.id)
  journal.dispose()
})

it.each([false, true])(
  'live error holds ordinary publication until its reservation settles (persistence failure: %s)',
  async (failPersistence) => {
    const { entry, deferredTurn, liveTurn } = await liveReceiveOnlyWithDeferredTurn()
    expect(row().status).toBe('pending')
    const events = observeTopic()
    const stream = wiring.manager.activeStreams.get(topicId)
    const projection = wiring.manager.topicProjection(topicId)
    const detach = projection.subscribe(() => {})
    const persistence = [...stream.listeners.values()].find((listener: any) => listener.terminalPhase === 'persistence')
    const persist = vi.spyOn(persistence.opts.backend, 'persistAssistant')
    if (failPersistence) persist.mockRejectedValueOnce(new Error('live persistence failed'))
    vi.spyOn(messages, 'settlePendingAssistant').mockImplementationOnce(() => {
      throw new Error('deferred write unavailable')
    })
    wiring.runtime.errorTurn(liveTurn, new Error('live execution failed'))
    await Promise.all([...stream.executions.values()].map((execution: any) => execution.loopPromise))
    await wiring.manager.whenTerminalDispatchSettled(topicId)
    expect(messages.getSessionMessage(sessionId, liveTurn.assistantMessageId).status).toBe('error')
    expect(persist.mock.calls.map(([input]) => (input as any).status)).toEqual(['error'])
    expect(projection.snapshot().executions).toMatchObject([{ status: failPersistence ? 'unresolved' : 'error' }])
    await expect(wiring.runtime.settleUnhandedTurn(entry, deferredTurn, { status: 'paused' })).rejects.toThrow(
      'deferred write unavailable'
    )
    expect(row().status).toBe('pending')
    expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
    expect(events).toEqual([])
    expect(status()).toMatchObject({ status: 'streaming', turnId: stream.turnId })
    await stop()
    expect(messages.getSessionMessage(sessionId, deferredTurn.assistantMessageId).status).toBe('paused')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      status: 'error',
      isTopicDone: true,
      error: { message: failPersistence ? 'live persistence failed' : 'live execution failed' }
    })
    expect(status()).toMatchObject({ status: 'error', turnId: stream.turnId })
    expect(persist.mock.calls.map(([input]) => (input as any).status)).toEqual(['error'])
    detach()
  }
)

it.each(['close', 'settlement'] as const)(
  '%s cancels a receive-only launch waiting for held dispatch without installing or erroring it',
  async (cancellation) => {
    const { entry, gate, launch } = await reserveContinuation()
    const events = observeTopic()
    const generation = status().turnId
    const callback = deferred()
    let entered = false
    wiring.manager.addListener(topicId, {
      id: 'held-io',
      terminalPhase: 'cleanup',
      isAlive: () => true,
      onChunk() {},
      onDone() {},
      onError() {},
      async onPaused() {
        entered = true
        await callback.promise
      }
    })
    await wiring.runtime.closeSession(sessionId)
    await until(() => entered)
    // Begin a new entry while the old generation's callback is awaiting I/O.
    const answer = messages.saveMessage({
      sessionId,
      message: { role: 'assistant', status: 'pending', data: { parts: [] }, modelId }
    })
    wiring.runtime.beginTurn({
      sessionId,
      topicId,
      agentId: 'agent-1',
      agentType: 'claude-code',
      modelId,
      assistantMessageId: answer.id
    })
    const replacementEntry = wiring.runtime.entries.get(sessionId)
    const prior = wiring.runtime.currentTurn(replacementEntry)
    wiring.runtime.applyRuntimeStateEvent(replacementEntry, {
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'background-work' },
      deferCurrentTurn: true,
      contextTurn: prior
    })
    const trace = vi.spyOn(wiring.runtime, 'refreshTurnTraceContext').mockClear().mockResolvedValue(undefined)
    const admission = vi.spyOn(wiring.runtime, 'createTurnAdmissionGuard')
    const receiveLaunch = wiring.runtime.startReceiveOnlyTurn(replacementEntry)
    await until(() => trace.mock.calls.length > 0 && admission.mock.calls.length > 0)
    const waitingTurn = trace.mock.calls[0][1] as any
    expect(replacementEntry.runtimeState.execution.turn).toBe(waitingTurn)
    expect(messages.getSessionMessage(sessionId, waitingTurn.assistantMessageId).status).toBe('pending')
    await new Promise((resolve) => setImmediate(resolve))
    expect(wiring.manager.activeStreams.get(topicId).turnId).toBe(generation)
    const send = vi.spyOn(wiring.manager, 'send')
    if (cancellation === 'close') {
      await wiring.runtime.closeSession(sessionId)
      expect(wiring.runtime.inspect(sessionId)).toBeUndefined()
    } else {
      await wiring.runtime.settleUnhandedTurn(replacementEntry, waitingTurn, { status: 'paused' })
      await wiring.runtime.settleUnhandedTurn(replacementEntry, prior, { status: 'paused' })
      expect(waitingTurn.abortController.signal.aborted).toBe(false)
    }
    expect(messages.getSessionMessage(sessionId, waitingTurn.assistantMessageId).status).toBe('paused')
    callback.resolve()
    await receiveLaunch
    await wiring.manager.whenTerminalDispatchSettled(topicId)
    expect(
      send.mock.calls.some(([input]: any[]) =>
        input.models.some((model: any) => model.request.messageId === waitingTurn.assistantMessageId)
      )
    ).toBe(false)
    const saved = messages.getSessionMessage(sessionId, waitingTurn.assistantMessageId)
    expect(saved.status).toBe('paused')
    expect(saved.data.parts!.some((part: any) => part.type === 'data-error')).toBe(false)
    expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(false)
    expect(events.some((event) => event.anchorMessageId === waitingTurn.assistantMessageId)).toBe(false)
    gate.resolve()
    await launch
    expect(entry).not.toBe(replacementEntry)
  }
)

it.each(['error', 'paused'] as const)(
  'close retries a failed %s reservation settlement with its original outcome',
  async (outcome) => {
    const { turn, gate, launch } = await reserveContinuation()
    vi.spyOn(messages, 'settlePendingAssistant').mockImplementationOnce(() => {
      throw new Error('settlement write failed once')
    })
    if (outcome === 'error') gate.reject(new Error('original trace failure'))
    else {
      turn.abortController.abort('cancel-trace')
      gate.resolve()
    }
    await launch
    expect(messages.getSessionMessage(sessionId, turn.assistantMessageId).status).toBe('pending')
    expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(true)
    await wiring.runtime.closeSession(sessionId)
    await wiring.manager.whenTerminalDispatchSettled(topicId)
    const saved = messages.getSessionMessage(sessionId, turn.assistantMessageId)
    expect(saved.status).toBe(outcome)
    const errors = saved.data.parts!.filter((part: any) => part.type === 'data-error')
    if (outcome === 'error') expect(errors).toMatchObject([{ data: { message: 'original trace failure' } }])
    else expect(errors).toEqual([])
    expect(wiring.runtime.hasUnhandedTurnReservation(sessionId)).toBe(false)
  }
)
