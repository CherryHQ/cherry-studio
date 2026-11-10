import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { ClaudeCodeSessionStateService } from '@main/ai/runtime/claudeCode/ClaudeCodeSessionStateService'
import { surfaceExitPlanModeInput } from '@main/ai/runtime/claudeCode/hooks'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent, RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { StartRuntimeTurnInput } from '@main/ai/streamManager/AiStreamManager'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import type { StreamDoneResult } from '@main/ai/streamManager/types'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { AGENT_SESSION_APPROVALS_CACHE_KEY } from '@shared/ai/agentSessionApprovals'
import type { CherryUIMessage } from '@shared/data/types/message'
import { AsyncEventQueue } from '@shared/utils/async'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { RootMessageProjection } from '../RootMessageProjection'

const dbh = setupTestDatabase()
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
})

async function fixture() {
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
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Prompt' }] } }
  })
  const reply = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  let queue = new AsyncEventQueue<{ event: AgentRuntimeEvent; consumed: () => void }>()
  const closed = Promise.withResolvers<void>()
  const emit = (event: AgentRuntimeEvent) => new Promise<void>((consumed) => queue.push({ event, consumed }))
  runtimeDriverRegistry.register({
    type: 'pi',
    validateSession: () => {},
    connect: async () => {
      const activeQueue = queue
      return {
        contextId: context.id,
        events: {
          async *[Symbol.asyncIterator]() {
            for await (const next of activeQueue) {
              try {
                yield next.event
              } finally {
                next.consumed()
              }
            }
          }
        },
        send: async () => {},
        redirect: () => true,
        close: async () => {
          activeQueue.close()
          closed.resolve()
        },
        reconcile: async () => 'current',
        retainWhileIdle: true
      }
    }
  })
  const service = new AgentSessionRuntimeService()
  const approvalSubscription = toolApprovalRegistry.onAborted((event) => service['retireAbortedApprovalCard'](event))
  const handle = service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType: 'pi',
    modelId: 'test::model',
    assistantMessageId: reply.id,
    userMessage: user,
    shouldAutoName: true
  })
  const source = service.openTurnStream({
    sessionId: 'root',
    turnId: handle.turnId,
    signal: handle.abortController.signal
  })
  if (source.kind !== 'messages') throw new Error('Agent turns must expose messages')
  const views: CherryUIMessage[] = []
  const done = pipeMessageStream(
    source.stream,
    handle.abortController.signal,
    { id: reply.id, role: 'assistant', parts: [] },
    (message) => views.push(message),
    () => {}
  )
  const project = (native: CherryUIMessage[], extra: Partial<RuntimeMessageProjection> = {}) =>
    emit({
      type: 'message-projection',
      projection: {
        contextId: context.id,
        messages: native,
        live: native.map((message) => message.id),
        replaces: {},
        removed: [],
        ...extra
      }
    })
  await project([])
  onTestFinished(async () => {
    await service.closeSession('root')
    approvalSubscription.dispose()
    runtimeDriverRegistry.clearForTest()
    MockApplicationUtils.resetServices()
    vi.restoreAllMocks()
  })
  const reconnect = async () => {
    queue.close()
    await closed.promise
    queue = new AsyncEventQueue()
    await service.primeConnection('root')
  }
  return { service, handle, context, reply, emit, project, views, done, reconnect }
}
const text = (id: string, value: string): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: value, state: 'done' }]
})

it('continues a session after deleting a completed projected reply and reconnecting', async () => {
  const f = await fixture()
  await f.project([text('old', 'Deleted answer')])
  await f.emit({ type: 'turn-complete' })
  const completed: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(completed)
  await f.handle.listeners[1].onDone(completed)
  await f.service.closeSession('root')
  messages.deleteSessionMessage('root', f.reply.id)
  await f.reconnect()
  await f.project([text('old', 'Archive replay')], { live: [] })

  const user = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Next question' }] } }
  })
  const reply = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const handle = f.service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType: 'pi',
    modelId: 'test::model',
    assistantMessageId: reply.id,
    userMessage: user
  })
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: handle.turnId,
    signal: handle.abortController.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message projections')
  const done = pipeMessageStream(
    source.stream,
    handle.abortController.signal,
    { id: reply.id, role: 'assistant', parts: [] },
    () => {},
    () => {}
  )
  await f.project([text('old', 'Late replay'), text('new', 'Next answer')])
  await f.emit({ type: 'turn-complete' })
  const result = await done
  expect(result.threw).toBeUndefined()
  const outcome: StreamDoneResult = { status: 'success', finalMessage: result.finalMessage }
  await handle.listeners[0].onDone(outcome)
  await handle.listeners[1].onDone(outcome)
  expect(messages.getSessionMessage('root', reply.id)).toMatchObject({
    status: 'success',
    data: { parts: text('', 'Next answer').parts }
  })
  expect(messages.hasSessionMessage('root', f.reply.id)).toBe(false)
  expect(f.service.inspect('root')?.status).toBe('idle')
})

// The native successor can publish before the preceding reply has committed and created its row.
it('retains a reserved steer reply until its stream takes ownership', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture()
  await f.project([text('first', 'Original answer')])
  const followup = messages.saveMessage({
    sessionId: 'root',
    parentId: f.reply.id,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Revised requirement' }] } }
  })
  f.service.enqueueUserMessage('root', followup)
  await f.emit({ type: 'steer-boundary', inputIds: [followup.id] })
  const first = await f.done
  await f.project([text('second', 'Continuation before handoff')])
  const result: StreamDoneResult = { status: 'success', finalMessage: first.finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  await expect.poll(() => next).toBeDefined()
  const runtime = next!.request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected continuation runtime')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: next!.abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const views: CherryUIMessage[] = []
  const done = pipeMessageStream(
    source.stream,
    next!.abortController!.signal,
    { id: next!.request.messageId!, role: 'assistant', parts: [] },
    (message) => views.push(message),
    () => {}
  )
  await vi.waitFor(() => expect(views.at(-1)?.parts).toEqual(text('', 'Continuation before handoff').parts))
  await f.emit({ type: 'turn-complete' })
  await next!.listeners[0].onDone({ status: 'success', finalMessage: (await done).finalMessage })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'Original answer').parts)
  expect(messages.getSessionMessage('root', next!.request.messageId!).data.parts).toEqual(
    text('', 'Continuation before handoff').parts
  )
})

// A closed stream's snapshot must not overwrite updates arriving before the synchronous DB commit.
it('hands late source changes from an open stream to terminal persistence and idle history', async () => {
  const naming = Promise.withResolvers<void>()
  const rename = vi.spyOn(topicNamingService, 'maybeRenameAgentSession').mockReturnValue(naming.promise)
  onTestFinished(() => naming.resolve())
  const f = await fixture()
  await f.project([text('a', 'A'), text('b', 'B')])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toHaveLength(2))
  await f.emit({ type: 'turn-complete' })
  const streamed = await f.done
  await f.project([text('b', 'B before commit')], { live: [], refresh: ['b'], removed: ['a'] })
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('pending')
  const result: StreamDoneResult = { status: 'success', finalMessage: streamed.finalMessage }
  const persistence = f.handle.listeners[0].onDone(result)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'B before commit').parts)
  await f.project([text('b', 'B after commit')], { live: [], refresh: ['b'] })
  await persistence
  expect(rename).toHaveBeenCalledOnce()
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'B after commit').parts)
  await f.handle.listeners[1].onDone(result)
  expect(f.service.inspect('root')?.status).toBe('idle')
  await f.reconnect()
  await f.project([text('b', 'B after reconnect')], { live: [], refresh: ['b'] })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'B after reconnect').parts)
  await f.project([], { removed: ['b'] })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([])
  const restored = new RootMessageProjection(f.context.id)
  expect(
    restored.accept(
      { contextId: f.context.id, messages: [text('b', 'stale')], live: ['b'], removed: [], replaces: {} },
      f.reply.id
    ).size
  ).toBe(0)
})

// ExitPlanMode can supply display input before native content; a completed native card must stay withdrawn.
it.each(['output-available', 'output-denied'] as const)(
  'does not resurrect a withdrawn %s plan card',
  async (state) => {
    const f = await fixture()
    const sessionState = new ClaudeCodeSessionStateService()
    MockApplicationUtils.setService('ClaudeCodeSessionStateService', sessionState)
    const input = { plan: 'Inspect the module, then implement the fix.' }
    const holder = sessionState.getToolApprovalEmitterHolder('root')
    let inputDelivered = Promise.resolve()
    holder.emitInput = (value) => {
      inputDelivered = f.emit({ type: 'chunk', chunk: { type: 'tool-input-available', ...value, dynamic: true } })
    }
    surfaceExitPlanModeInput('root', 'ExitPlanMode', input, 'plan')
    await inputDelivered
    await f.emit({
      type: 'chunk',
      chunk: { type: 'tool-approval-request', toolCallId: 'plan', approvalId: 'approval' }
    })
    await vi.waitFor(() =>
      expect(f.views.at(-1)?.parts).toContainEqual(
        expect.objectContaining({ toolCallId: 'plan', input, state: 'approval-requested' })
      )
    )
    const call = { type: 'dynamic-tool' as const, toolCallId: 'plan', toolName: 'ExitPlanMode', input }
    const settled: CherryUIMessage['parts'][number] =
      state === 'output-available'
        ? { ...call, state, output: 'Plan accepted' }
        : { ...call, state, approval: { id: 'approval', approved: false } }
    await f.project([{ id: 'native', role: 'assistant', parts: [settled] }])
    await f.project([], { removed: ['native'] })
    await f.emit({ type: 'turn-complete' })
    expect((await f.done).finalMessage?.parts).toEqual([])
  }
)

// Native terminal messages omit host approvals; replay must not erase the user's decision.
it.each([false, true])('retains approval=%s through native results, persistence and reconnect', async (approved) => {
  const f = await fixture()
  const toolCallId = 'write-result'
  const approvalId = 'host-write-approval'
  const input = { path: '/test/result.txt', content: 'owned' }
  const call = { type: 'dynamic-tool' as const, toolCallId, toolName: 'write', input }
  await f.project([{ id: 'native-write', role: 'assistant', parts: [{ ...call, state: 'input-available' }] }])

  MockApplicationUtils.setService('AiStreamManager', { resolveToolApproval: () => {} })
  const decision = Promise.withResolvers<{ approved: boolean }>()
  const registrationId = toolApprovalRegistry.register({
    sessionId: 'root',
    toolCallId,
    toolName: 'write',
    originalInput: input,
    approvalId,
    resolve: decision.resolve
  })
  onTestFinished(() => {
    toolApprovalRegistry.clear()
  })
  await f.emit({
    type: 'tool-approval-request',
    request: {
      approvalId,
      registrationId: registrationId!,
      toolCallId,
      toolName: 'write',
      input,
      origin: { kind: 'root', messageId: f.reply.id }
    }
  })
  expect(
    f.service.respondToolApproval(approvalId, { approved }, f.reply.id, 'agent-session:root', registrationId)
  ).toEqual({
    ok: true
  })
  expect(await decision.promise).toMatchObject({ approved })
  const native: CherryUIMessage = {
    id: 'native-write',
    role: 'assistant',
    parts: [{ ...call, state: 'output-error', errorText: approved ? 'Disk full' : 'Tool blocked' }]
  }
  await f.project([native])
  const expected = approved
    ? {
        ...call,
        state: 'output-error',
        errorText: 'Disk full',
        approval: { id: approvalId, approved },
        callProviderMetadata: { cherry: { approvalRegistrationId: registrationId } }
      }
    : {
        ...call,
        state: 'output-denied',
        approval: { id: approvalId, approved },
        callProviderMetadata: { cherry: { approvalRegistrationId: registrationId } }
      }
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual([expected]))
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([expected])
  const restored = new RootMessageProjection(f.context.id)
  restored.accept({
    contextId: f.context.id,
    messages: [native],
    live: [],
    refresh: [native.id],
    replaces: {},
    removed: []
  })
  expect(restored.parts(f.reply.id)).toEqual([expected])
})

// Catches a child waiting forever because its tool input exists only in the child transcript.
it('presents child approval independently and dispatches edited input only from its bound card', async () => {
  const f = await fixture()
  const result = Promise.withResolvers<DispatchDecision>()
  const input = { path: '/tmp/child.txt', content: 'original' }
  const registrationId = toolApprovalRegistry.register({
    approvalId: 'child',
    sessionId: 'root',
    toolCallId: 'child-write',
    toolName: 'write',
    originalInput: input,
    resolve: result.resolve
  })!
  const request = {
    approvalId: 'child',
    registrationId,
    toolCallId: 'child-write',
    toolName: 'write',
    input,
    origin: { kind: 'child' as const, threadId: 'native-child' }
  }
  await f.emit({ type: 'tool-approval-request', request })
  await f.emit({ type: 'tool-approval-request', request })
  const cards = messages.listApprovalMessages('root')
  expect(cards).toHaveLength(1)
  expect(cards[0].id).not.toBe(f.reply.id)
  expect(cards[0].data.parts).toContainEqual(
    expect.objectContaining({
      input,
      state: 'approval-requested',
      callProviderMetadata: {
        cherry: {
          approvalRecord: true,
          approvalRegistrationId: registrationId,
          approvalSource: { contextId: f.context.id, threadId: 'native-child' }
        }
      }
    })
  )
  expect(
    f.service.respondToolApproval('child', { approved: true }, f.reply.id, 'agent-session:root', registrationId)
  ).toEqual({
    ok: false,
    reason: 'rejected'
  })
  const updatedInput = { ...input, content: 'edited' }
  expect(
    f.service.respondToolApproval(
      'child',
      { approved: true, updatedInput },
      cards[0].id,
      'agent-session:root',
      registrationId
    )
  ).toEqual({ ok: true })
  await expect(result.promise).resolves.toEqual({ approved: true, updatedInput })
  expect(
    f.service.respondToolApproval('child', { approved: true }, cards[0].id, 'agent-session:root', registrationId)
  ).toEqual({
    ok: false,
    reason: 'rejected'
  })
  expect(messages.getSessionMessage('root', cards[0].id).data.parts).toContainEqual(
    expect.objectContaining({ input: updatedInput, state: 'approval-responded' })
  )
})

// Catches approval-before-input disappearing, and a late snapshot overwriting the approved edit.
it('presents early root approval and retains its decision through later native input', async () => {
  const f = await fixture()
  const result = Promise.withResolvers<unknown>()
  const input = { path: '/tmp/root.txt', content: 'original' }
  const registrationId = toolApprovalRegistry.register({
    approvalId: 'early',
    sessionId: 'root',
    toolCallId: 'early-write',
    toolName: 'write',
    originalInput: input,
    resolve: result.resolve
  })!
  await f.emit({
    type: 'tool-approval-request',
    request: {
      approvalId: 'early',
      registrationId,
      toolCallId: 'early-write',
      toolName: 'write',
      input,
      origin: { kind: 'root', messageId: f.reply.id }
    }
  })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toContainEqual(
    expect.objectContaining({ input, state: 'approval-requested' })
  )
  const updatedInput = { ...input, content: 'edited' }
  expect(
    f.service.respondToolApproval(
      'early',
      { approved: true, updatedInput },
      f.reply.id,
      'agent-session:root',
      registrationId
    )
  ).toEqual({ ok: true })
  await expect(result.promise).resolves.toEqual({ approved: true, updatedInput })
  await f.project([
    {
      id: 'late',
      role: 'assistant',
      parts: [{ type: 'dynamic-tool', toolName: 'write', toolCallId: 'early-write', input, state: 'input-available' }]
    }
  ])
  await vi.waitFor(() =>
    expect(f.views.at(-1)?.parts).toEqual([
      expect.objectContaining({ input: updatedInput, state: 'approval-responded' })
    ])
  )
})

// Catches old Durable message anchors answering a newly registered callback with the same approval ID.
it('retires cancellation and rejects the old card after the native approval ID is reused', async () => {
  const f = await fixture()
  const register = async (signal: AbortSignal) => {
    const result = Promise.withResolvers<unknown>()
    const registrationId = toolApprovalRegistry.register({
      approvalId: 'recovered',
      sessionId: 'root',
      toolCallId: 'write',
      toolName: 'write',
      originalInput: {},
      signal,
      resolve: result.resolve
    })!
    await f.emit({
      type: 'tool-approval-request',
      request: {
        approvalId: 'recovered',
        registrationId,
        toolCallId: 'write',
        toolName: 'write',
        input: {},
        origin: { kind: 'child', threadId: 'child' }
      }
    })
    return { result, registrationId, anchor: toolApprovalRegistry.peek('recovered')!.anchor! }
  }
  const stopped = new AbortController()
  const old = await register(stopped.signal)
  stopped.abort()
  await expect(old.result.promise).resolves.toMatchObject({ approved: false })
  expect(messages.getSessionMessage('root', old.anchor.messageId).data.parts).toContainEqual(
    expect.objectContaining({ state: 'output-error' })
  )
  const retiredParts = messages.getSessionMessage('root', old.anchor.messageId).data.parts
  for (const registrationId of [old.registrationId, undefined]) {
    expect(
      f.service.respondToolApproval(
        'recovered',
        { approved: true },
        old.anchor.messageId,
        'agent-session:root',
        registrationId
      )
    ).toEqual({ ok: false, reason: 'rejected' })
    expect(messages.getSessionMessage('root', old.anchor.messageId).data.parts).toEqual(retiredParts)
  }
  const active = await register(new AbortController().signal)
  expect(active.anchor.messageId).not.toBe(old.anchor.messageId)
  expect(
    f.service.respondToolApproval(
      'recovered',
      { approved: true },
      old.anchor.messageId,
      'agent-session:root',
      old.registrationId
    )
  ).toEqual({ ok: false, reason: 'rejected' })
  expect(
    f.service.respondToolApproval(
      'recovered',
      { approved: true },
      active.anchor.messageId,
      'agent-session:root',
      active.registrationId
    )
  ).toEqual({ ok: true })
  await expect(active.result.promise).resolves.toEqual({ approved: true })
})

// Catches an inaccessible card leaving the native tool waiting forever.
it.each(['write-failed', 'cancel-during-write', 'response-failed'] as const)(
  'settles safely when %s',
  async (failure) => {
    const f = await fixture()
    const controller = new AbortController()
    const result = Promise.withResolvers<unknown>()
    const registrationId = toolApprovalRegistry.register({
      approvalId: 'failure',
      sessionId: 'root',
      toolCallId: 'write',
      toolName: 'write',
      originalInput: {},
      signal: controller.signal,
      resolve: result.resolve
    })!
    const save = messages.saveMessage.bind(messages)
    if (failure !== 'response-failed')
      vi.spyOn(messages, 'saveMessage').mockImplementationOnce((...args) => {
        if (failure === 'write-failed') throw new Error('disk full')
        controller.abort()
        return save(...args)
      })
    await f.emit({
      type: 'tool-approval-request',
      request: {
        approvalId: 'failure',
        registrationId,
        toolCallId: 'write',
        toolName: 'write',
        input: {},
        origin: { kind: 'child', threadId: 'child' }
      }
    })
    if (failure === 'response-failed') {
      const anchor = toolApprovalRegistry.peek('failure')!.anchor!
      vi.spyOn(messages, 'applyToolApprovalDecision').mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      expect(
        f.service.respondToolApproval(
          'failure',
          { approved: true },
          anchor.messageId,
          'agent-session:root',
          registrationId
        )
      ).toEqual({ ok: false, reason: 'rejected' })
      expect(toolApprovalRegistry.peek('failure')?.registrationId).toBe(registrationId)
      expect(
        f.service.respondToolApproval(
          'failure',
          { approved: false },
          anchor.messageId,
          'agent-session:root',
          registrationId
        )
      ).toEqual({ ok: true })
    }
    await expect(result.promise).resolves.toMatchObject({ approved: false })
    expect(toolApprovalRegistry.peek('failure')).toBeUndefined()
    expect(
      messages
        .listApprovalMessages('root')
        .flatMap((row) => row.data.parts ?? [])
        .some((part) => 'state' in part && part.state === 'approval-requested')
    ).toBe(false)
  }
)

// A late child mapping must move only the display, preserving both the canonical anchor and accepted edit.
it('projects a late nested child onto its parent task and retires both entry points', async () => {
  const f = await fixture()
  const result = Promise.withResolvers<DispatchDecision>()
  const registrationId = toolApprovalRegistry.register({
    approvalId: 'nested',
    sessionId: 'root',
    toolCallId: 'write',
    toolName: 'write',
    originalInput: { content: 'old' },
    resolve: result.resolve
  })!
  await f.project([
    {
      id: 'parent-native',
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'Agent',
          toolCallId: 'spawn',
          state: 'input-available',
          input: { prompt: 'work' }
        }
      ]
    }
  ])
  await f.emit({
    type: 'tool-approval-request',
    request: {
      approvalId: 'nested',
      registrationId,
      toolCallId: 'write',
      toolName: 'write',
      input: { content: 'old' },
      origin: { kind: 'child', threadId: 'nested-native' }
    }
  })
  const read = () => application.get('CacheService').getShared(AGENT_SESSION_APPROVALS_CACHE_KEY('root'))!
  const anchor = read()[0].messageId
  expect(read()[0]).toMatchObject({ status: 'pending', taskPath: [] })
  const child = contexts.child(f.context.id, 'child-native', 'spawn', 'Child')
  const nested = contexts.child(child.id, 'nested-native', 'nested-spawn', 'Nested')
  f.service['refreshApprovalViews']('root')
  expect(read()[0]).toMatchObject({
    messageId: anchor,
    registrationId,
    parentMessageId: f.reply.id,
    taskPath: [
      { contextId: child.id, toolCallId: 'spawn' },
      { contextId: nested.id, toolCallId: 'nested-spawn' }
    ]
  })
  expect(
    f.service.respondToolApproval(
      'nested',
      { approved: true, updatedInput: { content: 'edited' } },
      anchor,
      'agent-session:root',
      registrationId
    )
  ).toEqual({ ok: true })
  await expect(result.promise).resolves.toMatchObject({ approved: true, updatedInput: { content: 'edited' } })
  expect(read()[0]).toMatchObject({ messageId: anchor, status: 'approved', part: { input: { content: 'edited' } } })
  expect(
    f.service.respondToolApproval('nested', { approved: false }, anchor, 'agent-session:root', registrationId)
  ).toEqual({ ok: false, reason: 'rejected' })
})

// A recovered request can reuse an inline reply and native approval ID; the old registration must still fail.
it('rejects an old registration even when an inline approval reuses its message anchor', async () => {
  const f = await fixture()
  const register = async () => {
    const controller = new AbortController()
    const result = Promise.withResolvers<DispatchDecision>()
    const id = toolApprovalRegistry.register({
      approvalId: 'repeat',
      sessionId: 'root',
      toolCallId: 'write',
      toolName: 'write',
      originalInput: {},
      signal: controller.signal,
      resolve: result.resolve
    })!
    await f.emit({
      type: 'tool-approval-request',
      request: {
        approvalId: 'repeat',
        registrationId: id,
        toolCallId: 'write',
        toolName: 'write',
        input: {},
        origin: { kind: 'root', messageId: f.reply.id }
      }
    })
    return { id, controller, result }
  }
  const old = await register()
  old.controller.abort()
  const current = await register()
  expect(f.service.respondToolApproval('repeat', { approved: true }, f.reply.id, 'agent-session:root', old.id)).toEqual(
    { ok: false, reason: 'rejected' }
  )
  expect(toolApprovalRegistry.peek('repeat')?.registrationId).toBe(current.id)
  expect(
    f.service.respondToolApproval('repeat', { approved: false }, f.reply.id, 'agent-session:root', current.id)
  ).toEqual({ ok: true })
  await expect(current.result.promise).resolves.toMatchObject({ approved: false })
})

// Cancellation after the decision write but before native settlement must not leave an approved actionable card.
it('reconciles cancellation during response publication before releasing the native callback', async () => {
  const f = await fixture()
  const controller = new AbortController()
  const result = Promise.withResolvers<DispatchDecision>()
  const registrationId = toolApprovalRegistry.register({
    approvalId: 'race',
    sessionId: 'root',
    toolCallId: 'write',
    toolName: 'write',
    originalInput: {},
    signal: controller.signal,
    resolve: result.resolve
  })!
  await f.emit({
    type: 'tool-approval-request',
    request: {
      approvalId: 'race',
      registrationId,
      toolCallId: 'write',
      toolName: 'write',
      input: {},
      origin: { kind: 'child', threadId: 'child' }
    }
  })
  const anchor = toolApprovalRegistry.peek('race')!.anchor!
  const apply = messages.applyToolApprovalDecision.bind(messages)
  vi.spyOn(messages, 'applyToolApprovalDecision').mockImplementationOnce((...args) => {
    const accepted = apply(...args)
    controller.abort()
    return accepted
  })
  expect(
    f.service.respondToolApproval('race', { approved: true }, anchor.messageId, 'agent-session:root', registrationId)
  ).toEqual({ ok: false, reason: 'rejected' })
  await expect(result.promise).resolves.toMatchObject({ approved: false })
  expect(application.get('CacheService').getShared(AGENT_SESSION_APPROVALS_CACHE_KEY('root'))).toContainEqual(
    expect.objectContaining({ registrationId, status: 'cancelled' })
  )
})
