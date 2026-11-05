import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { ClaudeCodeSessionStateService } from '@main/ai/runtime/claudeCode/ClaudeCodeSessionStateService'
import { surfaceExitPlanModeInput } from '@main/ai/runtime/claudeCode/hooks'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent, RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { StartRuntimeTurnInput } from '@main/ai/streamManager/AiStreamManager'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import type { StreamDoneResult } from '@main/ai/streamManager/types'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { topicNamingService } from '@main/services/TopicNamingService'
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
    capabilities: ['agent-session'],
    validateSession: () => {},
    listAvailableTools: async () => [],
    connect: async () => {
      const activeQueue = queue
      return {
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
