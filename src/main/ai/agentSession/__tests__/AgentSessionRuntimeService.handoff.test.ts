import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { aiUsageRecordTable } from '@data/db/schemas/aiUsageRecord'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent } from '@main/ai/runtime/types'
import type { StartRuntimeTurnInput } from '@main/ai/streamManager/AiStreamManager'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import { createAiUsageCaptureContext } from '@main/ai/utils/usageCapture'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { MessageSnapshot } from '@shared/data/types/message'
import { AsyncEventQueue } from '@shared/utils/async'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'

const dbh = setupTestDatabase()
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
  MockApplicationUtils.resetServices()
})

const snapshot: MessageSnapshot = {
  id: 'agent',
  name: 'Original author',
  emoji: 'A',
  model: { id: 'model', name: 'Model', provider: 'test' }
}

async function fixture(opts: { headless?: boolean; redirect?: boolean } = {}) {
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
    .values({ id: 'agent', type: 'pi', name: 'Agent', instructions: '', model: 'test::model', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'root', agentId: 'agent', workspaceId: 'workspace', name: 'Root', orderKey: 'a0' })
    .run()
  const context = preparePiBranch('root')
  const user = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'User request B' }] } }
  })
  const replyB = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'assistant', status: 'pending', data: { parts: [] }, messageSnapshot: snapshot }
  })
  const suspended = Promise.withResolvers<void>()
  const starts: StartRuntimeTurnInput[] = []
  const failures: unknown[] = []
  const sent: string[] = []
  const closeGate = Promise.withResolvers<void>()
  let blockClose = false
  let blockTrace = false
  let blockPersistence = false
  const traceGate = Promise.withResolvers<void>()
  const traceEntered = Promise.withResolvers<void>()
  const persistenceGate = Promise.withResolvers<void>()
  const persistenceEntered = Promise.withResolvers<void>()
  const loops = new Map<string, { done: Promise<void>; listeners: StartRuntimeTurnInput['listeners'] }>()
  MockApplicationUtils.setService('AiStreamManager', {
    getInteractionWindow: () => undefined,
    drainRuntimeReply: async (_topic: string, id: string) => {
      await loops.get(id)?.done
    },
    suspendUnadmittedRuntimeTurn: async () => {
      for (const loop of loops.values()) loop.listeners = []
      await Promise.all([suspended.promise, ...[...loops.values()].map((loop) => loop.done)])
    },
    startRuntimeTurn: (input: StartRuntimeTurnInput) => starts.push(input),
    broadcastTopicError: (_topic: string, _model: string, error: unknown) => failures.push(error),
    terminateHeldTopicStream: (_topic: string, _model: string, error: unknown) => failures.push(error),
    abort: () => {}
  })
  const queue = new AsyncEventQueue<{ event: AgentRuntimeEvent; consumed: () => void }>()
  const emit = (event: AgentRuntimeEvent) => new Promise<void>((consumed) => queue.push({ event, consumed }))
  runtimeDriverRegistry.register({
    type: 'pi',
    validateSession: () => {},
    connect: async () => ({
      contextId: context.id,
      events: {
        async *[Symbol.asyncIterator]() {
          for await (const next of queue) {
            try {
              yield next.event
            } finally {
              next.consumed()
            }
          }
        }
      },
      send: async (input) => {
        sent.push(input.message.id)
      },
      redirect: () => opts.redirect === true,
      refreshTraceContext: async () => {
        if (blockTrace) {
          traceEntered.resolve()
          await traceGate.promise
        }
      },
      close: async () => {
        if (blockClose) await closeGate.promise
        queue.close()
      },
      reconcile: async () => 'current',
      retainWhileIdle: true
    })
  })
  const service = new AgentSessionRuntimeService()
  const handle = service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType: 'pi',
    modelId: 'test::model',
    assistantMessageId: replyB.id,
    traceId: 'a'.repeat(32),
    userMessage: user,
    headless: opts.headless,
    messageSnapshot: snapshot
  })
  await service.primeConnection('root')
  await emit({ type: 'supported-commands', commands: [] })
  onTestFinished(async () => {
    suspended.resolve()
    closeGate.resolve()
    traceGate.resolve()
    persistenceGate.resolve()
    dbh.sqlite.exec('DROP TRIGGER IF EXISTS fail_reply')
    await service.closeSession('root')
    runtimeDriverRegistry.clearForTest()
    MockApplicationUtils.resetServices()
  })
  function open(input: Pick<StartRuntimeTurnInput, 'request' | 'abortController' | 'listeners'>) {
    const runtime = input.request.runtime
    if (runtime?.kind !== 'agent-session' || !input.abortController) throw new Error('Expected agent reply')
    const source = service.openTurnStream({
      sessionId: 'root',
      turnId: runtime.turnId,
      signal: input.abortController.signal
    })
    if (source.kind !== 'messages') throw new Error('Expected message stream')
    const done = pipeMessageStream(
      source.stream,
      input.abortController.signal,
      { id: input.request.messageId!, role: 'assistant', parts: [] },
      () => {},
      () => {}
    )
    const loop = { done: Promise.resolve(), listeners: input.listeners }
    const settled = (async () => {
      const result = await done
      if (blockPersistence) {
        persistenceEntered.resolve()
        await persistenceGate.promise
      }
      if (result.threw) {
        const failed = {
          status: 'error' as const,
          finalMessage: result.finalMessage,
          error: { name: 'Error', message: 'Reply preparation failed', stack: '' }
        }
        for (const listener of loop.listeners) await listener.onError?.(failed)
      } else {
        for (const listener of loop.listeners)
          await listener.onDone({ status: 'success', finalMessage: result.finalMessage })
      }
      return result
    })()
    loop.done = settled.then(() => undefined)
    loops.set(input.request.messageId!, loop)
    return () => settled
  }

  const openB = () =>
    open({
      request: {
        conversation: { id: 'root', topicId: 'agent-session:root' },
        trigger: 'submit-message',
        messageId: replyB.id,
        runtime: { kind: 'agent-session', sessionId: 'root', turnId: handle.turnId }
      },
      abortController: handle.abortController,
      listeners: handle.listeners
    })
  const project = (id: string, text: string, calls: readonly string[] = []) =>
    emit({
      type: 'message-projection',
      projection: {
        contextId: context.id,
        messages: [
          {
            id,
            role: 'assistant',
            parts: [
              { type: 'text', text, state: 'done' },
              ...calls.map((toolCallId) => ({
                type: 'dynamic-tool' as const,
                toolName: 'Agent',
                toolCallId,
                state: 'input-available' as const,
                input: { run_in_background: true }
              }))
            ]
          }
        ],
        live: [id],
        removed: [],
        replaces: {}
      }
    })
  const record = (responseId: string) => {
    const capture = service.getActiveUsageContext('root', responseId)?.recordInvocation
    if (!capture) throw new Error('Expected usage capture')
    capture({
      requestId: responseId,
      context: createAiUsageCaptureContext({
        providerId: 'test',
        modelId: 'model',
        credentialReceipt: { attribution: 'explicit', id: 'test-key', masked: '****', label: 'Test' },
        pricing: { input: { perMillionTokens: 1, currency: 'USD' }, output: { perMillionTokens: 2, currency: 'USD' } },
        capturedAt: '2026-11-05T00:00:00Z'
      }),
      modality: 'language',
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      completedAt: 1234
    })
  }
  return {
    service,
    handle,
    replyB,
    context,
    user,
    emit,
    project,
    record,
    suspended,
    starts,
    failures,
    sent,
    open,
    openB,
    closeGate,
    traceGate,
    traceEntered: traceEntered.promise,
    blockTrace: () => {
      blockTrace = true
    },
    persistenceGate,
    persistenceEntered: persistenceEntered.promise,
    blockPersistence: () => {
      blockPersistence = true
    },
    blockClose: () => {
      blockClose = true
    }
  }
}

function failReplyWrites() {
  dbh.sqlite.exec(
    "CREATE TRIGGER fail_reply BEFORE INSERT ON agent_session_message WHEN NEW.role = 'assistant' AND NOT EXISTS (SELECT 1 FROM agent_session_message WHERE id = NEW.id) BEGIN SELECT RAISE(ABORT, 'reply insert rejected'); END"
  )
}

it.each([false, true])(
  'persists launch, progress and final background summaries in one reply (resident command: %s)',
  async (commandRemains) => {
    const f = await fixture()
    const finish = f.openB()
    await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
    await f.project('launch', 'Delegated review', ['spawn-a', 'spawn-b'])
    await f.emit({ type: 'response-start', responseId: 'launch-response' })
    f.record('launch-response')
    await f.emit({ type: 'background-work-state', active: true })
    await f.emit({ type: 'background-results', result: { status: 'confirmed', value: ['spawn-a', 'spawn-b'] } })
    await f.emit({ type: 'turn-complete' })
    expect(f.service.isSessionBusy('root')).toBe(true)
    for (const [index, call] of ['spawn-a', 'spawn-b'].entries()) {
      await f.emit({
        type: 'autonomous-turn-state',
        state: 'started',
        origin: { kind: 'background-work' },
        sourceToolCallIds: [call]
      })
      await f.project(`summary-${index}`, index === 0 ? 'First reviewer finished' : 'Final summary')
      await f.emit({ type: 'response-start', responseId: `summary-response-${index}` })
      f.record(`summary-response-${index}`)
      f.record(`summary-response-${index}`)
      await f.emit({ type: 'turn-complete' })
      expect(f.service.isSessionBusy('root')).toBe(true)
      await f.emit({ type: 'autonomous-turn-state', state: 'finished' })
      await f.emit({
        type: 'background-results',
        result: { status: 'confirmed', value: index === 0 ? ['spawn-b'] : [] }
      })
      if (index === 0) expect(f.service.isSessionBusy('root')).toBe(true)
    }
    await f.emit({ type: 'background-work-state', active: commandRemains })
    await finish()
    const replies = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .all()
      .filter((row) => row.role === 'assistant')
    expect(replies.map((row) => row.id)).toEqual([f.replyB.id])
    expect(
      messages
        .getSessionMessage('root', f.replyB.id)
        .data.parts?.filter((part) => part.type === 'text')
        .map((part) => part.text)
    ).toEqual(['Delegated review', 'First reviewer finished', 'Final summary'])
    const charges = dbh.db.select().from(aiUsageRecordTable).all()
    expect(charges.map((charge) => charge.requestId).sort()).toEqual([
      'launch-response',
      'summary-response-0',
      'summary-response-1'
    ])
    expect(charges.every((charge) => charge.messageId === f.replyB.id)).toBe(true)
    expect(f.starts).toEqual([])
    expect(f.failures).toEqual([])
    expect(f.service.isSessionBusy('root')).toBe(false)
  }
)

// A foreign or partially attributed notification must not append to the currently waiting reply.
it.each([undefined, ['previous-call'], ['current-call', 'previous-call']])(
  'keeps a notification with sources %j separate from the waiting reply',
  async (sourceToolCallIds) => {
    const f = await fixture()
    f.openB()
    await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
    await f.project('current-launch', 'CURRENT_LAUNCH', ['current-call'])
    await f.emit({ type: 'background-results', result: { status: 'confirmed', value: ['current-call'] } })
    await f.emit({ type: 'turn-complete' })
    await f.emit({
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'background-work' },
      sourceToolCallIds
    })
    f.suspended.resolve()
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    const foreignId = f.starts[0].request.messageId!
    expect(foreignId).not.toBe(f.replyB.id)
    const finishForeign = f.open(f.starts[0])
    await f.project('foreign-summary', 'FOREIGN_SUMMARY')
    await f.emit({ type: 'background-results', result: { status: 'confirmed', value: ['current-call'] } })
    await f.emit({ type: 'turn-complete' })
    await f.emit({ type: 'autonomous-turn-state', state: 'finished' })
    await finishForeign()
    await vi.waitFor(() => expect(f.starts).toHaveLength(2))
    expect(f.starts[1].request.messageId).toBe(f.replyB.id)
    const finishCurrent = f.open(f.starts[1])
    await f.emit({
      type: 'autonomous-turn-state',
      state: 'started',
      origin: { kind: 'background-work' },
      sourceToolCallIds: ['current-call']
    })
    await f.project('current-summary', 'CURRENT_SUMMARY')
    await f.emit({ type: 'background-results', result: { status: 'confirmed', value: [] } })
    await f.emit({ type: 'turn-complete' })
    await f.emit({ type: 'autonomous-turn-state', state: 'finished' })
    await finishCurrent()
    const text = (id: string) =>
      messages
        .getSessionMessage('root', id)
        .data.parts?.filter((part) => part.type === 'text')
        .map((part) => part.text)
    expect(text(foreignId)).toEqual(['FOREIGN_SUMMARY'])
    expect(text(f.replyB.id)).toEqual(['CURRENT_LAUNCH', 'CURRENT_SUMMARY'])
    expect(f.sent).toEqual([f.user.id])
    expect(f.service.isSessionBusy('root')).toBe(false)
  }
)

// A failed autonomous placeholder must neither discard its facts nor lend them to the waiting user.
it.each([
  ['before-failure', false],
  ['after-failure', false],
  ['before-failure', true],
  ['after-failure', true]
] as const)(
  'retains content and usage arriving %s until the autonomous reply drains (admitted: %s)',
  async (arrival, admitted) => {
    const f = await fixture({ headless: true })
    if (admitted) {
      f.openB()
      await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
    }
    await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    const facts = async () => {
      await f.project('native-A', 'AUTONOMOUS_A_ONLY')
      f.record('response-A')
      await f.emit({ type: 'response-start', responseId: 'response-A' })
    }
    if (arrival === 'before-failure') await facts()
    failReplyWrites()
    f.suspended.resolve()
    await vi.waitFor(() => expect(f.failures).toHaveLength(1))
    if (arrival === 'after-failure') await facts()
    expect(f.starts).toHaveLength(0)
    expect(f.sent).toEqual(admitted ? [f.user.id] : [])
    expect(
      dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'response-A')).get()
    ).toMatchObject({ messageId: null, totalTokens: 120 })
    dbh.sqlite.exec('DROP TRIGGER fail_reply')
    await f.emit({ type: 'turn-complete' })
    expect(f.starts).toHaveLength(0)
    await f.emit({ type: 'autonomous-turn-state', state: 'finished' })
    await vi.waitFor(() => expect(f.starts).toHaveLength(1))
    const replyA = f.starts[0].request.messageId!
    expect(replyA).not.toBe(f.replyB.id)
    await f.open(f.starts[0])()
    await vi.waitFor(() => expect(f.starts).toHaveLength(2))
    expect(f.starts[1].request.messageId).toBe(f.replyB.id)
    expect(f.service.getInteractionState('root').currentTurn).toBe('headless')
    expect(messages.getSessionMessage('root', replyA).messageSnapshot).toEqual(snapshot)
    expect(messages.getSessionMessage('root', f.replyB.id).messageSnapshot).toEqual(snapshot)
    const finishB = f.open(f.starts[1])
    await f.project('native-B', 'USER_B_ONLY')
    await f.emit({ type: 'turn-complete' })
    await finishB()
    expect(JSON.stringify(messages.getSessionMessage('root', replyA).data.parts)).toContain('AUTONOMOUS_A_ONLY')
    expect(messages.getSessionMessage('root', replyA).status).toBe('error')
    expect(JSON.stringify(messages.getSessionMessage('root', f.replyB.id).data.parts)).not.toContain(
      'AUTONOMOUS_A_ONLY'
    )
    expect(JSON.stringify(messages.getSessionMessage('root', f.replyB.id).data.parts)).toContain('USER_B_ONLY')
    expect(
      dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'response-A')).get()
    ).toMatchObject({ messageId: replyA, totalTokens: 120 })
    expect(f.sent).toEqual([f.user.id])
  }
)

it('keeps ordinary content and usage attached to the original reply', async () => {
  const f = await fixture()
  const finish = f.openB()
  f.record('response-B')
  await f.emit({ type: 'response-start', responseId: 'response-B' })
  await f.project('native-B', 'USER_B_ONLY')
  await f.emit({ type: 'turn-complete' })
  await finish()
  expect(JSON.stringify(messages.getSessionMessage('root', f.replyB.id).data.parts)).toContain('USER_B_ONLY')
  expect(
    dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'response-B')).get()
  ).toMatchObject({ messageId: f.replyB.id, totalTokens: 120 })
})

it.each([false, true])(
  'persists compaction-only replies when completion precedes stream opening: %s',
  async (early) => {
    const f = await fixture()
    const anchor = {
      status: 'done' as const,
      phase: 'agent-session' as const,
      trigger: 'manual' as const,
      completedAt: '2026-11-06T00:00:00.000Z'
    }
    let finish = early ? undefined : f.openB()
    await f.emit({ type: 'compaction-start', trigger: 'manual' })
    await f.emit({ type: 'compaction-complete', anchor })
    finish ??= f.openB()
    await f.emit({ type: 'turn-complete' })
    await finish()
    expect(messages.getSessionMessage('root', f.replyB.id)).toMatchObject({
      status: 'success',
      data: { parts: [{ type: 'data-compaction-anchor', data: anchor }] }
    })
  }
)

it('waits for final observations before close persists a failed reply, and retries a failed close', async () => {
  const f = await fixture()
  await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
  failReplyWrites()
  f.suspended.resolve()
  await vi.waitFor(() => expect(f.failures).toHaveLength(1))
  f.blockClose()
  let closed = false
  const closing = f.service.closeSession('root').then(() => {
    closed = true
  })
  await f.project('native-A', 'FINAL_A_ONLY')
  expect(closed).toBe(false)
  f.closeGate.resolve()
  await closing
  expect(f.service.isSessionBusy('root')).toBe(true)
  const hold = f.service.pause('backup')
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: ['root'] })
  dbh.sqlite.exec('DROP TRIGGER fail_reply')
  await f.service.closeSession('root')
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  hold.dispose()
  const replies = dbh.db
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.role, 'assistant'))
    .all()
  const a = replies.find((row) => row.id !== f.replyB.id)
  expect(a?.data.parts).toEqual([{ type: 'text', text: 'FINAL_A_ONLY', state: 'done' }])
  expect(JSON.stringify(replies.find((row) => row.id === f.replyB.id)?.data.parts)).not.toContain('FINAL_A_ONLY')
  expect(contexts.context(f.context.id).checkpointMapping?.root?.sources['native-A']?.messageId).toBe(a?.id)
})

it('retains a steer reply and early approval across preparation failure without contaminating its predecessor', async () => {
  const f = await fixture({ redirect: true })
  const finishB = f.openB()
  await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
  await f.project('native-B', 'BEFORE_STEER')
  const steer = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Steer S' }] } }
  })
  const authored = { ...snapshot, name: 'Steer author' }
  f.service.enqueueUserMessage('root', steer, { messageSnapshot: authored })
  authored.name = 'Changed after submission'
  f.blockPersistence()
  failReplyWrites()
  await f.emit({ type: 'steer-boundary', inputIds: [steer.id] })
  await f.persistenceEntered
  await f.emit({
    type: 'chunk',
    chunk: { type: 'tool-input-available', toolCallId: 's-tool', toolName: 'Bash', input: { command: 'pwd' } }
  })
  await f.emit({
    type: 'chunk',
    chunk: { type: 'tool-approval-request', toolCallId: 's-tool', approvalId: 's-approval' }
  })
  f.record('response-S')
  await f.emit({ type: 'response-start', responseId: 'response-S' })
  await f.project('native-S', 'AFTER_STEER')
  f.persistenceGate.resolve()
  await finishB()
  await vi.waitFor(() => expect(f.failures).toHaveLength(1))
  expect(JSON.stringify(messages.getSessionMessage('root', f.replyB.id).data.parts)).toContain('BEFORE_STEER')
  expect(JSON.stringify(messages.getSessionMessage('root', f.replyB.id).data.parts)).not.toContain('AFTER_STEER')
  expect(contexts.context(f.context.id).checkpointMapping?.root?.sources['native-S']).toBeUndefined()
  expect(f.starts).toHaveLength(0)

  dbh.sqlite.exec('DROP TRIGGER fail_reply')
  await f.emit({ type: 'turn-complete' })
  await vi.waitFor(() => expect(f.starts).toHaveLength(1))
  const replyS = f.starts[0].request.messageId!
  f.service.markTurnTerminal('root', 'success', f.handle.turnId)
  expect(f.service.isSessionBusy('root')).toBe(true)
  expect(f.service.getInteractionState('root').currentTurn).toBe('interactive')
  await f.open(f.starts[0])()
  const saved = messages.getSessionMessage('root', replyS)
  expect(saved.messageSnapshot?.name).toBe('Steer author')
  expect(saved.status).toBe('error')
  expect(saved.data.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'AFTER_STEER' }))
  expect(saved.data.parts).toContainEqual(expect.objectContaining({ toolCallId: 's-tool' }))
  expect(contexts.context(f.context.id).checkpointMapping?.root?.sources['native-S']?.messageId).toBe(replyS)
  expect(
    dbh.db.select().from(aiUsageRecordTable).where(eq(aiUsageRecordTable.requestId, 'response-S')).get()
  ).toMatchObject({ messageId: replyS, totalTokens: 120 })
  expect(f.sent).toEqual([f.user.id])
})

it('keeps queued input unwritten through nested pause holds, then sends it once with its frozen author', async () => {
  const f = await fixture()
  const finishB = f.openB()
  await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
  const user = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Follow-up' }] } }
  })
  f.service.enqueueUserMessage('root', user, { messageSnapshot: snapshot })
  const first = f.service.pause('first')
  const last = f.service.pause('backup')
  await f.emit({ type: 'turn-complete' })
  await finishB()
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  expect(f.starts).toHaveLength(0)
  expect(
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.role, 'assistant')).all()
  ).toHaveLength(1)
  expect(f.service.isSessionBusy('root')).toBe(true)
  first.dispose()
  first.dispose()
  await Promise.resolve()
  expect(f.starts).toHaveLength(0)
  last.dispose()
  await vi.waitFor(() => expect(f.starts).toHaveLength(1))
  const reply = f.starts[0].request.messageId!
  expect(messages.getSessionMessage('root', reply).messageSnapshot).toEqual(snapshot)
  expect(
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, reply)).get()?.parentId
  ).toBe(user.id)
  const finish = f.open(f.starts[0])
  await vi.waitFor(() => expect(f.sent).toEqual([f.user.id, user.id]))
  await f.project('native-follow-up', 'FOLLOW_UP_ONLY')
  await f.emit({ type: 'turn-complete' })
  await finish()
  expect(messages.getSessionMessage('root', reply).status).toBe('success')
  expect(f.service.isSessionBusy('root')).toBe(false)
})

it('terminalizes a queued placeholder when preparation fails before native submission', async () => {
  const f = await fixture()
  const finishB = f.openB()
  await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
  const user = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Follow-up' }] } }
  })
  f.service.enqueueUserMessage('root', user, { messageSnapshot: snapshot })
  f.blockTrace()
  await f.emit({ type: 'turn-complete' })
  await finishB()
  await f.traceEntered
  const reply = dbh.db
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.role, 'assistant'))
    .all()
    .find((row) => row.id !== f.replyB.id)!
  expect(reply.status).toBe('pending')
  f.traceGate.reject(new Error('Trace setup failed'))
  await vi.waitFor(() => expect(f.failures).toHaveLength(1))
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  expect(messages.getSessionMessage('root', reply.id).status).toBe('error')
  expect(messages.getSessionMessage('root', user.id).data.parts).toEqual([{ type: 'text', text: 'Follow-up' }])
  expect(f.sent).toEqual([f.user.id])
  expect(f.starts).toHaveLength(0)
  expect(f.service.isSessionBusy('root')).toBe(false)
})

it('suppresses an autonomous reply before writing its placeholder and drops the suppressed launch on close', async () => {
  const f = await fixture()
  const hold = f.service.pause('backup')
  await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
  f.suspended.resolve()
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  expect(f.starts).toHaveLength(0)
  expect(
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.role, 'assistant')).all()
  ).toHaveLength(1)
  await f.project('native-A', 'CLOSED_DURING_PAUSE')
  await f.service.closeSession('root')
  hold.dispose()
  await Promise.resolve()
  expect(f.starts).toHaveLength(0)
  expect(f.sent).toEqual([])
  expect(f.service.hasBusySessions()).toBe(false)
  const replies = dbh.db
    .select()
    .from(agentSessionMessageTable)
    .where(eq(agentSessionMessageTable.role, 'assistant'))
    .all()
  expect(replies.some((row) => JSON.stringify(row.data.parts).includes('CLOSED_DURING_PAUSE'))).toBe(true)
})

it('reports a blocked preparation as a straggler without aborting it, and fences its completion after close', async () => {
  const f = await fixture()
  f.blockTrace()
  await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
  f.suspended.resolve()
  await f.traceEntered
  const hold = f.service.pause('backup')
  await expect(f.service.drainInFlight({ timeoutMs: 20 })).resolves.toEqual({ stragglerIds: ['root'] })
  expect(f.service.isSessionBusy('root')).toBe(true)
  await f.service.closeSession('root')
  expect(
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.status, 'pending')).all()
  ).toEqual([])
  f.traceGate.resolve()
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  hold.dispose()
  expect(f.starts).toHaveLength(0)
  expect(f.sent).toEqual([])
})

it('closes a reserved user reply before its stream opens without admitting the input', async () => {
  const f = await fixture()
  f.blockClose()
  const closing = f.service.closeSession('root')
  expect(() => f.openB()).toThrow('No active agent runtime turn')
  f.closeGate.resolve()
  await closing
  expect(messages.getSessionMessage('root', f.replyB.id).status).toBe('paused')
  expect(f.sent).toEqual([])
  expect(f.service.hasBusySessions()).toBe(false)
})

it('waits for both final native observations and blocked stream persistence before completing close', async () => {
  const f = await fixture()
  f.openB()
  await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
  f.blockClose()
  f.blockPersistence()
  const hold = f.service.pause('backup')
  let closed = false
  const closing = f.service.closeSession('root').then(() => {
    closed = true
  })
  await f.persistenceEntered
  await f.project('native-final', 'FINAL_OBSERVED_BODY')
  f.closeGate.resolve()
  await expect(f.service.drainInFlight({ timeoutMs: 20 })).resolves.toEqual({ stragglerIds: ['root'] })
  expect(closed).toBe(false)
  expect(f.service.hasBusySessions()).toBe(true)
  f.persistenceGate.resolve()
  await closing
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  expect(messages.getSessionMessage('root', f.replyB.id).data.parts).toEqual([
    { type: 'text', text: 'FINAL_OBSERVED_BODY', state: 'done' }
  ])
  expect(contexts.context(f.context.id).checkpointMapping?.root?.sources['native-final']?.messageId).toBe(f.replyB.id)
  expect(f.service.hasBusySessions()).toBe(false)
  hold.dispose()
})

it('retains a failed terminal write for retry and reports it to backup without resending input', async () => {
  const f = await fixture()
  const finish = f.openB()
  await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
  await f.project('native-B', 'RECOVERABLE_FINAL_BODY')
  dbh.sqlite.exec(
    "CREATE TRIGGER fail_reply BEFORE UPDATE ON agent_session_message WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'terminal write rejected'); END"
  )
  const rejected = expect(finish()).rejects.toThrow('Terminal persistence failed')
  await f.emit({ type: 'turn-complete' })
  await rejected
  const hold = f.service.pause('backup')
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: ['root'] })
  expect(f.service.isSessionBusy('root')).toBe(true)
  dbh.sqlite.exec('DROP TRIGGER fail_reply')
  await f.service.closeSession('root')
  await expect(f.service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
  expect(messages.getSessionMessage('root', f.replyB.id)).toMatchObject({
    status: 'error',
    data: { parts: [{ type: 'text', text: 'RECOVERABLE_FINAL_BODY', state: 'done' }] }
  })
  expect(f.sent).toEqual([f.user.id])
  hold.dispose()
})

it.each([false, true])(
  'retains a predecessor still persisting when autonomous work starts (write fails: %s)',
  async (fail) => {
    const f = await fixture()
    const finishB = f.openB()
    await vi.waitFor(() => expect(f.sent).toEqual([f.user.id]))
    await f.project('native-B', 'PREDECESSOR_BODY')
    f.blockPersistence()
    const result = fail ? expect(finishB()).rejects.toThrow('Terminal persistence failed') : finishB()
    await f.emit({ type: 'turn-complete' })
    await f.persistenceEntered
    await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
    await f.project('native-A', 'AUTONOMOUS_BODY')
    expect(f.starts).toHaveLength(0)
    if (fail)
      dbh.sqlite.exec(
        "CREATE TRIGGER fail_reply BEFORE UPDATE ON agent_session_message WHEN NEW.role = 'assistant' BEGIN SELECT RAISE(ABORT, 'terminal write rejected'); END"
      )
    f.persistenceGate.resolve()
    await result
    await f.emit({ type: 'turn-complete' })
    await f.emit({ type: 'autonomous-turn-state', state: 'finished' })
    if (fail) {
      expect(f.starts).toHaveLength(0)
      dbh.sqlite.exec('DROP TRIGGER fail_reply')
      await f.service.closeSession('root')
    } else {
      await vi.waitFor(() => expect(f.starts).toHaveLength(1))
      await f.open(f.starts[0])()
      expect(f.starts).toHaveLength(1)
    }
    expect(messages.getSessionMessage('root', f.replyB.id).data.parts).toEqual([
      { type: 'text', text: 'PREDECESSOR_BODY', state: 'done' }
    ])
    const a = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .all()
      .find((row) => row.role === 'assistant' && row.id !== f.replyB.id)
    expect(a?.data.parts).toEqual([{ type: 'text', text: 'AUTONOMOUS_BODY', state: 'done' }])
    expect(f.sent).toEqual([f.user.id])
    expect(f.service.isSessionBusy('root')).toBe(false)
  }
)
