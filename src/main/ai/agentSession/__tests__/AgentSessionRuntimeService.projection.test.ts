import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'

import { application } from '@application'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessagePartTable, agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { prepareNativeSubmission } from '@main/ai/agentSession/nativeSubmission'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode'
import { ClaudeCodeSessionStateService } from '@main/ai/runtime/claudeCode/ClaudeCodeSessionStateService'
import { surfaceExitPlanModeInput } from '@main/ai/runtime/claudeCode/hooks'
import { preparePiBranch } from '@main/ai/runtime/pi/piContext'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeEvent, RuntimeMessageProjection } from '@main/ai/runtime/types'
import type { StartRuntimeTurnInput } from '@main/ai/streamManager/AiStreamManager'
import { pipeMessageStream } from '@main/ai/streamManager/pipeMessageStream'
import type { AgentPartChange, StreamDoneResult, StreamPausedResult } from '@main/ai/streamManager/types'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { topicNamingService } from '@main/services/TopicNamingService'
import { AGENT_SESSION_API_RETRY_CACHE_KEY } from '@shared/ai/agentSessionApiRetry'
import type { CherryUIMessage } from '@shared/data/types/message'
import { AsyncEventQueue } from '@shared/utils/async'

import { AgentSessionRuntimeService } from '../AgentSessionRuntimeService'
import { RootMessageProjection } from '../RootMessageProjection'

const dbh = setupTestDatabase()
beforeEach(() => {
  BaseService.resetInstances()
  runtimeDriverRegistry.clearForTest()
})

async function fixture(
  interrupt?: (emit: (event: AgentRuntimeEvent) => Promise<void>) => Promise<void>,
  retainOnStop = false,
  agentType: 'pi' | 'pi-durable' | 'claude-code' = 'pi',
  lastPos = 0,
  onPartAppend: Parameters<typeof pipeMessageStream>[5] = () => {}
) {
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
    .values({ id: 'agent', type: agentType, name: 'Agent', instructions: '', model: 'test::model', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: 'workspace', name: 'Workspace', path: '/test', type: 'user', orderKey: 'a0' })
    .run()
  dbh.db
    .insert(agentSessionTable)
    .values({ id: 'root', agentId: 'agent', workspaceId: 'workspace', name: 'Root', orderKey: 'a0', lastPos })
    .run()
  const context = agentType === 'claude-code' ? prepareClaudeBranch('root', '/test/claude') : preparePiBranch('root')
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
  // Durable's record of every input state the test reports.
  const recorded = new Map<string, Extract<AgentRuntimeEvent, { type: 'input-state' }>['input']>()
  const emit = (event: AgentRuntimeEvent) => {
    if (event.type === 'input-state' && event.input.inputId) recorded.set(event.input.inputId, event.input)
    return new Promise<void>((consumed) => queue.push({ event, consumed }))
  }
  const connections = { opened: 0, closed: 0, sent: [] as string[], followUps: [] as string[], steers: [] as string[] }
  runtimeDriverRegistry.register({
    type: agentType,
    validateSession: () => {},
    connect: async () => {
      connections.opened++
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
        send: async ({ message }) => {
          connections.sent.push(message.id)
        },
        redirect: ({ message }: { message: { id: string } }) => {
          connections.steers.push(message.id)
          return true
        },
        ...(agentType === 'pi-durable' && {
          followUp: ({ message }: { message: { id: string } }) => {
            connections.followUps.push(message.id)
            return true
          },
          lookupInput: async (_contextId: string, inputId: string) => {
            const input = recorded.get(inputId)
            return {
              status: 'confirmed' as const,
              value: input ? { found: true as const, input } : { found: false as const }
            }
          }
        }),
        close: async () => {
          connections.closed++
          activeQueue.close()
          closed.resolve()
        },
        reconcile: async () => 'current',
        retainWhileIdle: true,
        retainOnStop,
        ...(interrupt && { interrupt: () => interrupt(emit) })
      }
    }
  })
  const service = new AgentSessionRuntimeService()
  const handle = service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType,
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
    source,
    handle.abortController.signal,
    { id: reply.id, role: 'assistant' },
    (message) => views.push(message),
    () => {},
    onPartAppend
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
    await service['commandConnection']('root')
  }
  return { service, handle, context, user, reply, emit, project, views, done, reconnect, connections }
}
const text = (id: string, value: string): CherryUIMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text: value, state: 'done' }]
})

const reply = (parts: CherryUIMessage['parts']): CherryUIMessage => ({ id: 'native', role: 'assistant', parts })
const storedParts = (messageId: string) =>
  dbh.db
    .select({ id: agentSessionMessagePartTable.id, updatedAt: agentSessionMessagePartTable.updatedAt })
    .from(agentSessionMessagePartTable)
    .where(eq(agentSessionMessagePartTable.messageId, messageId))
    .orderBy(agentSessionMessagePartTable.seq)
    .all()

it('saves each completed part before the reply completes and writes nothing for deltas', async () => {
  const f = await fixture()
  const answer = { type: 'text' as const, text: 'Answer', state: 'done' as const }
  const call = { type: 'dynamic-tool' as const, toolCallId: 'call', toolName: 'bash', input: { command: 'ls' } }
  await f.project([reply([{ type: 'text', text: 'Ans', state: 'streaming' }])])
  await f.project([reply([{ type: 'text', text: 'Answe', state: 'streaming' }])])
  expect(storedParts(f.reply.id)).toEqual([])

  await f.project([reply([answer, { ...call, state: 'input-available' }])])
  const [saved] = storedParts(f.reply.id)
  // Marks the committed row so any later rewrite of it is observable.
  dbh.db
    .update(agentSessionMessagePartTable)
    .set({ updatedAt: 1 })
    .where(eq(agentSessionMessagePartTable.id, saved.id))
    .run()
  await f.project([reply([answer, { ...call, state: 'output-available', output: 'listing' }])])
  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
    status: 'pending',
    data: { parts: [answer, { ...call, state: 'output-available', output: 'listing' }] }
  })

  await f.project([
    reply([
      answer,
      { ...call, state: 'output-available', output: 'listing' },
      { type: 'text', text: 'Tail', state: 'done' }
    ])
  ])
  await f.emit({ type: 'turn-complete' })
  const completed: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(completed)
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('success')
  const settled = storedParts(f.reply.id)
  expect(settled).toHaveLength(3)
  expect(settled[0]).toEqual({ id: saved.id, updatedAt: 1 })
})

it('saves the unfinished part with its received content when the reply is stopped', async () => {
  const f = await fixture()
  await f.project([reply([{ type: 'text', text: 'Partial', state: 'streaming' }])])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toHaveLength(1))
  expect(storedParts(f.reply.id)).toEqual([])
  f.handle.abortController.abort()
  const stopped = await f.done
  await f.handle.listeners[0].onPaused({ status: 'paused', finalMessage: stopped.finalMessage })
  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
    status: 'paused',
    data: { parts: [{ type: 'text', text: 'Partial', state: 'done' }] }
  })
})

it('delivers a native suffix under the same part ID and saves it once on stop', async () => {
  const appends: AgentPartChange[] = []
  const f = await fixture(undefined, false, 'pi-durable', 0, (change) => {
    appends.push(change)
    return true
  })
  await f.project([text('previous', 'Earlier'), reply([{ type: 'text', text: 'Partial', state: 'streaming' }])])
  await vi.waitFor(() => expect(f.views.at(-1)?.partIds).toHaveLength(2))
  const partId = f.views.at(-1)!.partIds![1]
  await f.emit({
    type: 'message.text-append',
    contextId: f.context.id,
    ref: { id: runtimeId('native'), session: { backendId: runtimeId('backend'), id: runtimeId('thread') } },
    part: 0,
    text: ' answer'
  })
  await vi.waitFor(() => expect(appends).toEqual([{ type: 'part-append', partId, text: ' answer' }]))
  expect(storedParts(f.reply.id)).toHaveLength(1)
  f.handle.abortController.abort()
  const stopped = await f.done
  await f.handle.listeners[0].onPaused({ status: 'paused', finalMessage: stopped.finalMessage })
  expect(storedParts(f.reply.id)[1]?.id).toBe(partId)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([
    { type: 'text', text: 'Earlier', state: 'done' },
    { type: 'text', text: 'Partial answer', state: 'done' }
  ])
})

it('keeps SDK backoff through an empty projection and clears it when the reply resumes', async () => {
  const f = await fixture()
  await f.project([reply([{ type: 'text', text: 'First', state: 'streaming' }])])
  const cache = application.get('CacheService')
  const key = AGENT_SESSION_API_RETRY_CACHE_KEY('root')
  await f.emit({
    type: 'api-retry',
    retry: { attempt: 2, maxRetries: 3, retryDelayMs: 1000, errorStatus: 503, errorCategory: 'server_error' }
  })
  expect(cache.getShared(key)?.status).toBe('retrying')
  await f.project([])
  expect(cache.getShared(key)?.status).toBe('retrying')
  await f.project([reply([{ type: 'text', text: 'First resumed', state: 'streaming' }])])
  expect(cache.getShared(key)?.status).toBe('idle')
})

it.each(['claude-code', 'pi', 'pi-durable'] as const)(
  'keeps a compaction boundary in admission order on %s',
  async (harness) => {
    const changes: AgentPartChange[] = []
    const f = await fixture(undefined, false, harness, 10, (change) => changes.push(change))
    await f.project([reply([{ type: 'text', text: 'A', state: 'streaming' }])])
    await f.emit({ type: 'compaction-complete', anchor: { phase: 'agent-session', status: 'done' } })
    const ref = {
      id: runtimeId<'item'>('native'),
      session: { backendId: runtimeId<'backend'>('backend'), id: runtimeId<'thread'>('thread') }
    }
    await f.emit({ type: 'message.text-open', contextId: f.context.id, ref, part: 1, kind: 'text' })
    await f.emit({ type: 'message.text-append', contextId: f.context.id, ref, part: 1, text: 'B' })
    await f.emit({ type: 'message.text-append', contextId: f.context.id, ref, part: 0, text: '1' })
    expect(changes).toMatchObject([
      { type: 'part-add', placement: { messageId: f.reply.id, pos: 12 }, part: { type: 'data-compaction-anchor' } },
      { type: 'part-open', messageId: f.reply.id, pos: 13 },
      { type: 'part-append', text: 'B' },
      { type: 'part-append', text: '1' }
    ])
    f.handle.abortController.abort()
    const { finalMessage } = await f.done
    expect(finalMessage?.parts).toMatchObject([{ text: 'A1' }, { type: 'data-compaction-anchor' }, { text: 'B' }])
    await f.handle.listeners[0].onPaused({ status: 'paused', finalMessage })
    expect(messages.getStoredMessageParts('root', f.reply.id).map(({ partId, pos }) => [partId, pos])).toEqual(
      finalMessage!.partIds!.map((id, i) => [id, 11 + i])
    )
  }
)

it('admits, appends and commits a native reasoning block at one part ID', async () => {
  const changes: AgentPartChange[] = []
  const f = await fixture(undefined, false, 'pi-durable', 0, (change) => {
    changes.push(change)
    return true
  })
  await f.project([text('earlier', 'Earlier'), reply([])])
  await vi.waitFor(() => expect(f.views.at(-1)?.partIds).toHaveLength(1))
  const address = {
    contextId: f.context.id,
    ref: {
      id: runtimeId<'item'>('native'),
      session: { backendId: runtimeId<'backend'>('backend'), id: runtimeId<'thread'>('thread') }
    },
    part: 0
  }
  await f.emit({ ...address, type: 'message.text-open', kind: 'reasoning' })
  await f.emit({ ...address, type: 'message.text-append', text: 'Working' })
  await vi.waitFor(() => expect(changes).toHaveLength(2))
  const partId = changes[0].partId
  expect(changes).toEqual([
    { type: 'part-open', messageId: f.reply.id, partId, pos: 2, kind: 'reasoning' },
    { type: 'part-append', partId, text: 'Working' }
  ])
  expect(storedParts(f.reply.id)).toHaveLength(1)

  const following = { ...address, part: 1 }
  await f.emit({ ...following, type: 'message.text-open', kind: 'text' })
  await f.emit({ ...following, type: 'message.text-append', text: 'Answer' })
  await f.emit({ ...following, type: 'message.text-finish' })
  await vi.waitFor(() => expect(changes).toHaveLength(5))
  const followingId = changes[2].partId
  expect(storedParts(f.reply.id)[1]?.id).toBe(followingId)

  await f.emit({ ...address, type: 'message.text-finish' })
  await vi.waitFor(() => expect(changes.at(-1)).toEqual({ type: 'part-finish', partId }))
  expect(storedParts(f.reply.id)[1]?.id).toBe(partId)
  f.handle.abortController.abort()
  const stopped = await f.done
  expect(stopped.finalMessage?.parts[1]).toMatchObject({ type: 'reasoning', text: 'Working', state: 'done' })
  await f.handle.listeners[0].onPaused({ status: 'paused', finalMessage: stopped.finalMessage })
  expect(storedParts(f.reply.id)[1]?.id).toBe(partId)
  expect(storedParts(f.reply.id)[2]?.id).toBe(followingId)
})

it('updates the tool of its native source and saves only final output at the original timeline position', async () => {
  const changes: AgentPartChange[] = []
  const f = await fixture(undefined, false, 'pi-durable', 30, (change) => changes.push(change))
  const call = { type: 'dynamic-tool' as const, toolName: 'shell', toolCallId: 'call', input: {} }
  await f.project([text('earlier-source', 'Earlier'), reply([{ ...call, state: 'input-available' }])])
  const emitOutput = (output: string, preliminary: boolean) =>
    f.emit({
      type: 'message.tool-output',
      contextId: f.context.id,
      ref: { id: runtimeId('native'), session: { backendId: runtimeId('backend'), id: runtimeId('thread') } },
      part: 0,
      tool: { ...call, state: 'output-available', output, preliminary }
    })
  await emitOutput('working', true)
  await vi.waitFor(() =>
    expect(changes.at(-1)).toMatchObject({
      type: 'part-put',
      archiveMessageId: f.reply.id,
      part: { output: 'working', preliminary: true }
    })
  )
  expect(storedParts(f.reply.id)).toHaveLength(1)

  const output = 'result'.repeat(7000)
  await emitOutput(output, false)
  const row = dbh.db
    .select({ id: agentSessionMessagePartTable.id, pos: agentSessionMessagePartTable.pos })
    .from(agentSessionMessagePartTable)
    .where(eq(agentSessionMessagePartTable.messageId, f.reply.id))
    .orderBy(agentSessionMessagePartTable.seq)
    .all()[1]
  expect(row?.pos).toBe(32)
  expect(messages.getSessionToolOutput('root', f.reply.id, call.toolCallId)).toEqual({ found: true, output })
  await emitOutput('late preview', true)
  expect(messages.getSessionToolOutput('root', f.reply.id, call.toolCallId)).toEqual({ found: true, output })
  await emitOutput('corrected', false)
  expect(storedParts(f.reply.id)[1].id).toBe(row.id)
  expect(messages.getSessionToolOutput('root', f.reply.id, call.toolCallId)).toEqual({
    found: true,
    output: 'corrected'
  })
})

it('saves Durable input and part positions in admission order, including on Stop', async () => {
  const f = await fixture(undefined, false, 'pi-durable', 30)
  const place = async (id: string) => {
    application.get('DbService').withWriteTx((tx) => {
      messages.bindInputContextTx(tx, 'root', id, f.context.id)
    })
    await f.emit({
      type: 'input-state',
      contextId: f.context.id,
      input: { inputId: runtimeId(id), facts: ['accepted', 'queued'] }
    })
    const native = { id: `native-${id}`, role: 'user' as const, parts: [] }
    await f.project([native], { inputs: { [native.id]: id } })
    expect(savedPosition(id)).toBeNull()
    await f.emit({ type: 'input-state', contextId: f.context.id, input: { inputId: runtimeId(id), facts: ['placed'] } })
  }
  const savedPosition = (id: string) =>
    dbh.db
      .select({ pos: agentSessionMessageTable.pos })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, id))
      .get()?.pos
  const positions = () =>
    dbh.db
      .select({ id: agentSessionMessagePartTable.id, pos: agentSessionMessagePartTable.pos })
      .from(agentSessionMessagePartTable)
      .where(eq(agentSessionMessagePartTable.messageId, f.reply.id))
      .orderBy(agentSessionMessagePartTable.seq)
      .all()

  await place(f.user.id)
  await f.project([reply([{ type: 'text', text: 'A', state: 'streaming' }])])
  expect(positions()).toEqual([])
  const input = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', data: { parts: [{ type: 'text', text: 'Steer' }] } }
  })
  await place(input.id)
  expect(savedPosition(f.user.id)).toBe(31)
  expect(savedPosition(input.id)).toBe(33)
  expect(positions()).toEqual([])

  const answer = { type: 'text' as const, text: 'Answer', state: 'done' as const }
  await f.project([{ ...reply([answer, { type: 'text', text: 'Tail', state: 'streaming' }]), id: 'committed' }], {
    replaces: { native: 'committed' }
  })
  const [saved] = positions()
  expect(saved?.pos).toBe(32)
  expect(positions()).toHaveLength(1)
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toHaveLength(2))
  f.handle.abortController.abort()
  await f.handle.listeners[0].onPaused({ status: 'paused', finalMessage: (await f.done).finalMessage })

  expect(positions()[0]).toEqual(saved)
  expect(positions().map(({ pos }) => pos)).toEqual([32, 34])
  expect(dbh.db.select({ pos: agentSessionTable.lastPos }).from(agentSessionTable).get()?.pos).toBe(34)
})

it('persists a Claude tool-result retraction on its settled reply', async () => {
  const f = await fixture(undefined, false, 'claude-code')
  const call = { type: 'dynamic-tool' as const, toolCallId: 'call', toolName: 'Read', input: { path: '/a' } }
  const output = 'withdrawn'.repeat(8192)
  await f.project([reply([{ ...call, state: 'output-available', output }])])
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  for (const listener of f.handle.listeners) await listener.onDone(result)
  const [saved] = storedParts(f.reply.id)
  expect(messages.getSessionToolOutput('root', f.reply.id, call.toolCallId)).toEqual({ found: true, output })

  await f.emit({
    type: 'message.parts',
    contextId: f.context.id,
    ref: { id: runtimeId('native'), session: { backendId: runtimeId('backend'), id: runtimeId('thread') } },
    changes: [{ type: 'put', part: 0, value: { ...call, state: 'input-available' } }]
  })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([{ ...call, state: 'input-available' }])
  expect(storedParts(f.reply.id).map((part) => part.id)).toEqual([saved.id])
  expect(messages.getSessionToolOutput('root', f.reply.id, call.toolCallId)).toEqual({ found: false })
})

it('does not recreate a deleted reply from a late completed part', async () => {
  const f = await fixture()
  await f.project([reply([{ type: 'text', text: 'Draft', state: 'streaming' }])])
  messages.deleteSessionMessage('root', f.reply.id)
  await f.project([reply([{ type: 'text', text: 'Draft done', state: 'done' }])])
  expect(messages.hasSessionMessage('root', f.reply.id)).toBe(false)
  expect(storedParts(f.reply.id)).toEqual([])
})

async function settleFirstTurn(f: Awaited<ReturnType<typeof fixture>>) {
  await f.project([text('first', 'First answer')])
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
}

/** A user input and its reply left unsettled by an exit; Durable reports it as `native-user`. */
function unsettledInput(parentId: string) {
  const user = messages.saveMessage({
    sessionId: 'root',
    parentId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Before exit' }] } }
  })
  const reply = messages.saveMessage({
    sessionId: 'root',
    parentId: user.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const native: CherryUIMessage = { id: 'native-user', role: 'user', parts: [{ type: 'text', text: 'Before exit' }] }
  return { user, reply, native, inputs: { [native.id]: user.id } }
}

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
    source,
    handle.abortController.signal,
    { id: reply.id, role: 'assistant' },
    () => {},
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

// #24732: Durable records the user's stop before the connection closes; closing must not rewrite it as an error.
it('keeps a stopped reply paused when the runtime reports the abort before closing', async () => {
  const stopped = Promise.withResolvers<void>()
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(async (emit) => {
    await stopped.promise
    await emit({ type: 'turn-complete', status: 'paused' })
  })
  await f.project([text('partial', 'Partial answer')])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual(text('', 'Partial answer').parts))
  f.handle.abortController.abort('agent-runtime-interrupt')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  stopped.resolve()
  await f.service.closeSession('root')

  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
    status: 'paused',
    data: { parts: text('', 'Partial answer').parts }
  })
})

it('keeps a retained connection open on Stop and starts later input only after native confirmation', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false,
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(async () => {}, true)
  const terminals: string[] = []
  f.service.onTurnTerminal((event) => void (event.assistantMessageId === f.reply.id && terminals.push(event.status)))
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('partial', 'Partial answer')])
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual(text('', 'Partial answer').parts))
  f.handle.abortController.abort('user-requested')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  const followup = messages.saveMessage({
    sessionId: 'root',
    parentId: f.reply.id,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'After Stop' }] } }
  })
  f.service.enqueueUserMessage('root', followup)

  await f.emit({ type: 'turn-complete', status: 'paused' })
  expect(f.service.isSessionBusy('root')).toBe(true)
  expect(next).toBeUndefined()
  await f.emit({ type: 'stop-confirmed' })

  await vi.waitFor(() => expect(next?.listeners).toBeDefined())
  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
    status: 'paused',
    data: { parts: text('', 'Partial answer').parts }
  })
  expect(f.connections.opened).toBe(1)
  expect(f.connections.closed).toBe(0)
  await vi.waitFor(() => expect(terminals).toEqual(['paused']))
})

// AC5: Durable resumes a placed input after an unclean exit; its output must not land in the latest reply.
it('continues a resumed Durable input in its original reply', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const left = unsettledInput(f.reply.id)

  await f.emit({
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    recoveredInputId: left.user.id
  })
  await expect.poll(() => next).toBeDefined()
  expect(next!.request.messageId).toBe(left.reply.id)
  const runtime = next!.request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected a resumed runtime turn')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: next!.abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const done = pipeMessageStream(
    source,
    next!.abortController!.signal,
    { id: left.reply.id, role: 'assistant' },
    () => {},
    () => {},
    () => {}
  )
  await f.project([left.native, text('committed', 'Committed before exit')], { live: [], inputs: left.inputs })
  await f.project([text('resumed', 'Resumed after reopen')])
  await f.emit({ type: 'turn-complete' })
  await next!.listeners[0].onDone({ status: 'success', finalMessage: (await done).finalMessage })

  expect(messages.getSessionMessage('root', left.reply.id)).toMatchObject({
    status: 'success',
    data: { parts: [...text('', 'Committed before exit').parts, ...text('', 'Resumed after reopen').parts] }
  })
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

function savedUser(parentId: string, value: string) {
  return messages.saveMessage({
    sessionId: 'root',
    parentId,
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: value }] } }
  })
}

// Only native placement associates an input with the executing Run.
it('links a placed steer to the active run while a pending input remains unowned', async () => {
  const f = await fixture()
  await f.project([text('first', 'Original answer')])
  const first = savedUser(f.reply.id, 'First steer')
  f.service.enqueueUserMessage('root', first)
  const second = savedUser(first.id, 'Still queued')
  f.service.enqueueUserMessage('root', second, { followUp: true })
  await f.emit({ type: 'steer-boundary', inputIds: [first.id] })
  expect(messages.replyTo('root', first.id)?.id).toBe(f.reply.id)
  expect(messages.replyTo('root', second.id)).toBeUndefined()
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('pending')
  await f.emit({ type: 'turn-complete' })
  await f.done
})

// Two queued inputs leave Q2 -> Q3 -> A2 -> A3; closing during A3 must resume Q3 in A3, not in A2.
it('continues a resumed input in its linked reply when an earlier reply sits below it', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const q2 = savedUser(f.reply.id, 'Second question')
  const q3 = savedUser(q2.id, 'Third question')
  const a2 = messages.saveMessage({
    sessionId: 'root',
    parentId: q3.id,
    message: { role: 'assistant', status: 'success', data: { parts: text('', 'Second answer').parts } }
  })
  const a3 = messages.saveMessage({
    sessionId: 'root',
    parentId: a2.id,
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  messages.linkReply('root', [q2.id], a2.id)
  messages.linkReply('root', [q3.id], a3.id)

  await f.emit({
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    recoveredInputId: q3.id
  })
  await expect.poll(() => next).toBeDefined()

  expect(next!.request.messageId).toBe(a3.id)
  expect(messages.getSessionMessage('root', a2.id).status).toBe('success')
})

it('keeps an orphan pending when live events cannot prove its archived native reply', async () => {
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const left = unsettledInput(f.reply.id)
  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: { inputId: runtimeId(left.user.id), facts: ['accepted', 'placed'], outcome: 'completed' }
  })
  await f.project([left.native, text('answer', 'Unverified answer')], { live: [], inputs: left.inputs })
  expect(messages.getSessionMessage('root', left.reply.id).status).toBe('pending')
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

// Stop ends the background run that continued a finished input's reply, so that input's outcome is not the reply's.
it('keeps a reply paused when Stop ends its background continuation', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(async () => {}, true, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('answer', 'First answer')])
  const completed: AgentRuntimeEvent = {
    type: 'input-state',
    contextId: f.context.id,
    input: { inputId: runtimeId(f.user.id), facts: ['accepted', 'placed'], outcome: 'completed' }
  }
  await f.emit(completed)
  await f.emit({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'background-work' } })
  await f.project([text('answer', 'First answer'), text('more', 'Background continuation')])
  f.handle.abortController.abort('user-requested')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  const stopped = f.service.stopSession('root', 'user-requested')

  // Durable republishes every input on its next revision.
  await f.emit(completed)
  await f.emit({ type: 'turn-complete', status: 'paused' })
  await f.emit({ type: 'stop-confirmed' })
  await stopped

  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('paused')
})

// The run completed natively before the user's Stop landed; the reply keeps Durable's outcome.
it.each(['before', 'after'] as const)(
  'replaces a paused reply with the Durable outcome reported %s Stop registers',
  async (reported) => {
    MockApplicationUtils.setService('AiStreamManager', {
      drainRuntimeReply: async () => {},
      pauseRuntimeTurn: () => false
    })
    const f = await fixture(async () => {}, true, 'pi-durable')
    const terminals: string[] = []
    f.service.onTurnTerminal((event) => void (event.assistantMessageId === f.reply.id && terminals.push(event.status)))
    const completed = () =>
      f.emit({
        type: 'input-state',
        contextId: f.context.id,
        input: { inputId: runtimeId(f.user.id), facts: ['accepted', 'placed'], outcome: 'completed' }
      })
    await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
    await f.project([text('answer', 'Partial answer')])
    await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual(text('', 'Partial answer').parts))
    if (reported === 'before') await completed()
    f.handle.abortController.abort('user-requested')
    const paused: StreamPausedResult = {
      status: 'paused',
      isTopicDone: true,
      finalMessage: (await f.done).finalMessage
    }
    await f.handle.listeners[0].onPaused(paused)
    await f.handle.listeners[1].onPaused(paused)

    await f.project([text('answer', 'Complete answer')], { live: [], refresh: ['answer'] })
    if (reported === 'after') await completed()
    await f.emit({ type: 'turn-complete' })
    await f.emit({ type: 'stop-confirmed' })

    await vi.waitFor(() =>
      expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({
        status: 'success',
        data: { parts: text('', 'Complete answer').parts }
      })
    )
    // Deliveries finalize on the first terminal, so the paused one must not precede Durable's outcome.
    expect(terminals).toEqual(['success'])
  }
)

// The native interrupt waits on admission and child stops; a hang there must still end the Stop.
it('ends a retained Stop whose native interrupt never returns', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(() => new Promise<void>(() => {}), true)
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  onTestFinished(() => void vi.useRealTimers())
  f.handle.abortController.abort('user-requested')
  let settled = false
  void f.service.stopSession('root', 'user-requested').then(
    () => (settled = true),
    () => (settled = true)
  )

  await vi.advanceTimersByTimeAsync(40_000)

  expect(settled).toBe(true)
  // The fallback closes the connection instead of waiting on a second stalled interrupt.
  expect(f.connections.closed).toBe(1)
  expect(f.service.isSessionBusy('root')).toBe(false)
  await f.reconnect()
  expect(f.connections.opened).toBe(2)
})

/** Streams the successor reply that the host launched for a placed input and persists it. */
async function answerSuccessor(f: Awaited<ReturnType<typeof fixture>>, next: StartRuntimeTurnInput, value: string) {
  const runtime = next.request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected a runtime turn')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: next.abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const done = pipeMessageStream(
    source,
    next.abortController!.signal,
    { id: next.request.messageId!, role: 'assistant' },
    () => {},
    () => {},
    () => {}
  )
  await f.project([text('second', value)])
  await f.emit({ type: 'turn-complete' })
  await next.listeners[0].onDone({ status: 'success', finalMessage: (await done).finalMessage })
  return messages.getSessionMessage('root', next.request.messageId!)
}

// AC4: busy-time input waits in Durable's queue, then gets its own reply once Durable places it.
it.each([
  { submitted: true, label: 'submitted in this process' },
  { submitted: false, label: 'queued before a restart' }
])('gives a Durable input $label its own reply when placed', async ({ submitted }) => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('first', 'First answer')])
  const followup = savedUser(f.reply.id, 'Second question')
  if (submitted) {
    f.service.enqueueUserMessage('root', followup, { followUp: true })
    expect(f.connections.followUps).toEqual([followup.id])
    expect(f.connections.steers).toEqual([])
  } else
    application.get('DbService').withWriteTx((tx) => messages.bindInputContextTx(tx, 'root', followup.id, f.context.id))
  expect(f.service.inspect('root')?.pendingMessageCount).toBe(0)

  await f.emit({ type: 'run-started', inputIds: [followup.id] })
  const first = await f.done
  await f.handle.listeners[0].onDone({ status: 'success', finalMessage: first.finalMessage, isTopicDone: false })
  await f.handle.listeners[1].onDone({ status: 'success', finalMessage: first.finalMessage, isTopicDone: false })
  await expect.poll(() => next).toBeDefined()
  const second = await answerSuccessor(f, next!, 'Second answer')

  expect(second.data.parts).toEqual(text('', 'Second answer').parts)
  expect(messages.replyTo('root', followup.id)?.id).toBe(second.id)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

// Durable answers each placement in its own run; one placed before the previous reply opens must not join it.
it('gives a Durable placement its own reply when it arrives before the previous one opens', async () => {
  const launched: StartRuntimeTurnInput[] = []
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => void launched.push(input)
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('first', 'First answer')])
  const second = savedUser(f.reply.id, 'Second question')
  const third = savedUser(second.id, 'Third question')
  f.service.enqueueUserMessage('root', second, { followUp: true })
  f.service.enqueueUserMessage('root', third, { followUp: true })

  await f.emit({ type: 'run-started', inputIds: [second.id] })
  await f.project([text('second', 'Second answer')])
  await f.emit({ type: 'run-started', inputIds: [third.id] })
  const first = await f.done
  const result: StreamDoneResult = { status: 'success', finalMessage: first.finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  await expect.poll(() => launched).toHaveLength(1)
  const runtime = launched[0].request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected a runtime turn')
  const source = f.service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: launched[0].abortController!.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  let streamed: Awaited<ReturnType<typeof pipeMessageStream>> | undefined
  void pipeMessageStream(
    source,
    launched[0].abortController!.signal,
    { id: launched[0].request.messageId!, role: 'assistant' },
    () => {},
    () => {},
    () => {}
  ).then((value) => (streamed = value))
  // The third placement ends this reply once its stream has taken the buffered answer.
  await expect.poll(() => streamed).toBeDefined()
  const handoff: StreamDoneResult = { status: 'success', finalMessage: streamed!.finalMessage, isTopicDone: false }
  for (const listener of launched[0].listeners) await listener.onDone(handoff)
  await expect.poll(() => launched).toHaveLength(2)

  expect(launched.map((input) => input.request.messages?.[0]?.id)).toEqual([second.id, third.id])
  expect(launched[1].request.messageId).not.toBe(launched[0].request.messageId)
  expect(messages.getSessionMessage('root', launched[0].request.messageId!).data.parts).toEqual(
    text('', 'Second answer').parts
  )
})

// Durable reports an answer's outcome only when the run ends, after the follow-up placed behind it.
it('saves a truncated answer as an output-limit error after its follow-up was placed', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: () => {},
    drainRuntimeReply: async () => {}
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('first', 'First answer')])
  const followup = savedUser(f.reply.id, 'Second question')
  f.service.enqueueUserMessage('root', followup, { followUp: true })
  await f.emit({ type: 'run-started', inputIds: [followup.id] })
  const first = await f.done
  const result: StreamDoneResult = { status: 'success', finalMessage: first.finalMessage, isTopicDone: false }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)

  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: {
      inputId: runtimeId(f.user.id),
      facts: ['accepted', 'placed'],
      outcome: 'unanswered',
      error: { operation: 'input', code: 'output-truncated', message: 'Output limit reached' }
    }
  })

  await vi.waitFor(() => expect(messages.getSessionMessage('root', f.reply.id).status).toBe('error'))
  const saved = messages.getSessionMessage('root', f.reply.id)
  expect(saved.data.parts).toEqual([
    ...text('', 'First answer').parts,
    expect.objectContaining({
      type: 'data-error',
      data: expect.objectContaining({ finishReason: 'length', i18nKey: 'output_token_limit_reached' })
    })
  ])
})

// AC4 Stop: Durable withdraws input still queued; the transcript must not show it as sent.
it('marks a queued Durable input that Stop withdrew as not sent', async () => {
  MockApplicationUtils.setService('AiStreamManager', {
    drainRuntimeReply: async () => {},
    pauseRuntimeTurn: () => false
  })
  const f = await fixture(async () => {}, true, 'pi-durable')
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  await f.project([text('answer', 'Partial answer')])
  const queued = savedUser(f.reply.id, 'Queued question')
  f.service.enqueueUserMessage('root', queued, { followUp: true })
  f.handle.abortController.abort('user-requested')
  const paused: StreamPausedResult = { status: 'paused', isTopicDone: true, finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onPaused(paused)
  await f.handle.listeners[1].onPaused(paused)
  const stopped = f.service.stopSession('root', 'user-requested')

  await f.emit({
    type: 'input-state',
    contextId: f.context.id,
    input: {
      inputId: runtimeId(queued.id),
      facts: ['accepted', 'queued'],
      outcome: 'aborted',
      error: { operation: 'input', code: 'aborted', message: 'aborted' }
    }
  })
  await f.emit({ type: 'turn-complete', status: 'paused' })
  await f.emit({ type: 'stop-confirmed' })
  await stopped

  expect(messages.getSessionMessage('root', queued.id).status).toBe('paused')
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('paused')
})

// AC4: a queued input that starts native work on its own has no reply to continue yet.
it('opens a new reply when a queued Durable input starts native work', async () => {
  let next: StartRuntimeTurnInput | undefined
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      next = input
    }
  })
  const f = await fixture(undefined, false, 'pi-durable')
  await settleFirstTurn(f)
  const queued = savedUser(f.reply.id, 'Queued before exit')
  application.get('DbService').withWriteTx((tx) => messages.bindInputContextTx(tx, 'root', queued.id, f.context.id))

  await f.emit({
    type: 'autonomous-turn-state',
    state: 'started',
    origin: { kind: 'background-work' },
    recoveredInputId: queued.id
  })
  await expect.poll(() => next).toBeDefined()
  const reply = await answerSuccessor(f, next!, 'Queued answer')

  expect(reply.data.parts).toEqual(text('', 'Queued answer').parts)
  expect(messages.replyTo('root', queued.id)?.id).toBe(reply.id)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual(text('', 'First answer').parts)
})

// The native successor can publish before the preceding reply has committed and created its row.
it('retains a newly started queued run until its stream takes ownership', async () => {
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
  await f.emit({ type: 'run-started', inputIds: [followup.id] })
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
    source,
    next!.abortController!.signal,
    { id: next!.request.messageId!, role: 'assistant' },
    (message) => views.push(message),
    () => {},
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
  const restored = new RootMessageProjection(f.context.id, { lastPos: messages.lastTimelinePosition('root') })
  expect(
    restored.accept(
      { contextId: f.context.id, messages: [text('b', 'stale')], live: ['b'], removed: [], replaces: {} },
      f.reply.id
    ).size
  ).toBe(0)
})

it('publishes the tool input when approval arrives before the native tool part', async () => {
  const f = await fixture()
  const input = { questions: [{ question: 'Choose a database' }] }
  await f.emit({
    type: 'tool-approval-request',
    request: {
      approvalId: 'approval-live',
      toolCallId: 'tool-call-live',
      toolName: 'AskUserQuestion',
      input,
      presentation: 'stream'
    }
  })
  await vi.waitFor(() =>
    expect(f.views.at(-1)).toMatchObject({
      partIds: [expect.any(String)],
      parts: [{ type: 'dynamic-tool', toolCallId: 'tool-call-live', input, state: 'approval-requested' }]
    })
  )
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
      inputDelivered = f.emit({ type: 'tool-input-available', ...value, dynamic: true })
    }
    surfaceExitPlanModeInput('root', 'ExitPlanMode', input, 'plan')
    await inputDelivered
    await f.emit({
      type: 'tool-approval-request',
      request: { toolCallId: 'plan', approvalId: 'approval', toolName: 'ExitPlanMode', input, presentation: 'stream' }
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
  await f.emit({
    type: 'tool-approval-request',
    request: { toolCallId, approvalId, toolName: 'write', input, presentation: 'stream' }
  })
  MockApplicationUtils.setService('AiStreamManager', { resolveToolApproval: () => {} })
  const decision = Promise.withResolvers<{ approved: boolean }>()
  toolApprovalRegistry.register({
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
  expect(f.service.respondToolApproval(approvalId, { approved })).toEqual({ ok: true })
  expect(await decision.promise).toMatchObject({ approved })
  const native: CherryUIMessage = {
    id: 'native-write',
    role: 'assistant',
    parts: [{ ...call, state: 'output-error', errorText: approved ? 'Disk full' : 'Tool blocked' }]
  }
  await f.project([native])
  const expected = approved
    ? { ...call, state: 'output-error', errorText: 'Disk full', approval: { id: approvalId, approved } }
    : { ...call, state: 'output-denied', approval: { id: approvalId, approved } }
  await vi.waitFor(() => expect(f.views.at(-1)?.parts).toEqual([expected]))
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  await f.handle.listeners[0].onDone(result)
  await f.handle.listeners[1].onDone(result)
  expect(messages.getSessionMessage('root', f.reply.id).data.parts).toEqual([expected])
  const restored = new RootMessageProjection(f.context.id, { lastPos: messages.lastTimelinePosition('root') })
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

it('releases unplaced inputBinding when recovering an unresolved steer across reconnect and skips already-placed bindings', async () => {
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
    .values({ id: 'root', agentId: 'agent', workspaceId: 'workspace', name: 'Root', orderKey: 'a0', lastPos: 0 })
    .run()

  const context = preparePiBranch('root')
  const firstUser = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'First' }] } }
  })
  const firstReply = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'assistant', status: 'pending', data: { parts: [] } }
  })
  const unplacedSteer = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Unplaced steer' }] } }
  })
  const placedSteer = messages.saveMessage({
    sessionId: 'root',
    message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Placed steer' }] } }
  })

  const q1 = new AsyncEventQueue<AgentRuntimeEvent>()
  const q2 = new AsyncEventQueue<AgentRuntimeEvent>()
  const sentOnSecond: string[] = []
  let firstCallbacks: Parameters<Parameters<typeof runtimeDriverRegistry.register>[0]['connect']>[0] | undefined
  runtimeDriverRegistry.register({
    type: 'pi',
    validateSession: () => {},
    connect: vi
      .fn()
      .mockImplementationOnce(async (connectInput) => {
        firstCallbacks = connectInput
        return {
          contextId: context.id,
          events: q1,
          send: ({ message }) => {
            prepareNativeSubmission('root', message.id, context.id, 'reject')
          },
          redirect: ({ message }) => {
            prepareNativeSubmission('root', message.id, context.id, 'steer')
            firstCallbacks?.onInputPrepared?.(message.id, context.id)
            return true
          },
          close: async () => q1.close()
        }
      })
      .mockImplementationOnce(async () => ({
        contextId: context.id,
        events: q2,
        send: ({ message }) => {
          prepareNativeSubmission('root', message.id, context.id, 'reject')
          sentOnSecond.push(message.id)
        },
        lookupInput: async () => ({
          status: 'unknown',
          error: { operation: 'lookup-input', code: 'unavailable', message: 'unavailable' }
        }),
        reconcile: async () => 'current',
        close: async () => q2.close()
      }))
  })

  const service = new AgentSessionRuntimeService()
  onTestFinished(async () => {
    await service.closeSession('root')
    runtimeDriverRegistry.clearForTest()
  })
  const starts: StartRuntimeTurnInput[] = []
  MockApplicationUtils.setService('AiStreamManager', {
    startRuntimeTurn: (input: StartRuntimeTurnInput) => {
      starts.push(input)
    },
    drainRuntimeReply: async () => {}
  })

  const handle = service.beginTurn({
    sessionId: 'root',
    topicId: 'agent-session:root',
    agentId: 'agent',
    agentType: 'pi',
    modelId: 'test::model',
    assistantMessageId: firstReply.id,
    userMessage: firstUser
  })
  const source = service.openTurnStream({
    sessionId: 'root',
    turnId: handle.turnId,
    signal: handle.abortController.signal
  })
  if (source.kind !== 'messages') throw new Error('Expected message source')
  const reader = source.stream.getReader()
  await reader.read()
  await vi.waitFor(() => expect(messages.inputBinding('root', firstUser.id)?.contextId).toBe(context.id))

  service.enqueueUserMessage('root', unplacedSteer)
  service.enqueueUserMessage('root', placedSteer)
  expect(messages.inputBinding('root', unplacedSteer.id)?.contextId).toBe(context.id)
  expect(messages.inputBinding('root', placedSteer.id)?.contextId).toBe(context.id)
  // Simulate native placement persisted in DB for placedSteer before connection loss.
  messages.saveInputTimelinePosition('root', placedSteer.id, context.id, 1)

  await service.closeSession('root')
  await (service as any).ensureConnection((service as any).entries.get('root'))

  await vi.waitFor(() => expect(starts).toHaveLength(1))
  expect((service as any).entries.get('root')?.pendingInputs?.size ?? 0).toBe(0)
  expect(starts[0].taskIds).toEqual([unplacedSteer.id])

  const runtime = starts[0].request.runtime
  if (runtime?.kind !== 'agent-session') throw new Error('Expected agent-session runtime')
  const recoveredSource = service.openTurnStream({
    sessionId: 'root',
    turnId: runtime.turnId,
    signal: starts[0].abortController!.signal
  })
  if (recoveredSource.kind !== 'messages') throw new Error('Expected message source')
  const recoveredReader = recoveredSource.stream.getReader()
  await recoveredReader.read()
  await vi.waitFor(() => expect(sentOnSecond).toEqual([unplacedSteer.id]))
  expect(messages.inputBinding('root', unplacedSteer.id)?.contextId).toBe(context.id)
  expect(messages.replyTo('root', unplacedSteer.id)?.id).toBe(starts[0].request.messageId)
  await reader.cancel().catch(() => undefined)
  await recoveredReader.cancel().catch(() => undefined)
})

// A redirect changes the input, not the native execution or its durable output owner.
it('keeps steered inputs, late tool results and new output in one run until native terminal', async () => {
  const f = await fixture()
  await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
  const call = { type: 'dynamic-tool' as const, toolCallId: 'held', toolName: 'bash', input: { command: 'sleep 1' } }
  const running = { id: 'tool', role: 'assistant' as const, parts: [{ ...call, state: 'input-available' as const }] }
  await f.project([text('before', 'Before steer'), running])
  const toolBefore = f.views.at(-1)!.partIds![1]
  const first = savedUser(f.reply.id, 'First steer')
  f.service.enqueueUserMessage('root', first)
  await f.emit({ type: 'steer-boundary', inputIds: [first.id] })
  const second = savedUser(first.id, 'Second steer')
  f.service.enqueueUserMessage('root', second)
  await f.emit({ type: 'steer-boundary', inputIds: [second.id] })
  const completed = { ...running, parts: [{ ...call, state: 'output-available' as const, output: 'done' }] }
  await f.project([completed, text('after', 'After steer')])

  expect(messages.replyTo('root', first.id)?.id).toBe(f.reply.id)
  expect(messages.replyTo('root', second.id)?.id).toBe(f.reply.id)
  expect(messages.getSessionMessage('root', f.reply.id).status).toBe('pending')
  expect(f.views.at(-1)?.parts).toEqual([
    ...text('', 'Before steer').parts,
    ...completed.parts,
    ...text('', 'After steer').parts
  ])
  const toolAfter = dbh.db
    .select()
    .from(agentSessionMessagePartTable)
    .all()
    .find((part) => part.payload.type === 'dynamic-tool')
  expect(toolAfter).toMatchObject({ id: toolBefore, messageId: f.reply.id, pos: 2 })
  expect(
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.role, 'assistant')).all()
  ).toHaveLength(1)
  await f.emit({ type: 'turn-complete' })
  const result: StreamDoneResult = { status: 'success', finalMessage: (await f.done).finalMessage }
  for (const listener of f.handle.listeners) await listener.onDone(result)
  expect(messages.getSessionMessage('root', f.reply.id)).toMatchObject({ status: 'success' })
  expect(f.connections.sent).toEqual([f.user.id])
})

it.each([
  { outcome: 'aborted', status: 'paused' },
  { outcome: undefined, status: 'paused' },
  { outcome: 'completed', status: 'success' },
  { outcome: 'failed', status: 'error' }
] as const)(
  'settles a stopped Run with a completed original input and a $outcome steer as $status',
  async ({ outcome, status }) => {
    MockApplicationUtils.setService('AiStreamManager', {
      drainRuntimeReply: async () => {},
      pauseRuntimeTurn: () => false
    })
    const f = await fixture(async () => {}, true, 'pi-durable')
    const terminals: string[] = []
    f.service.onTurnTerminal((event) => void terminals.push(event.status))
    await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
    const steer = savedUser(f.reply.id, 'Steer before Stop')
    f.service.enqueueUserMessage('root', steer)
    await f.emit({ type: 'steer-boundary', inputIds: [steer.id] })
    await f.project([text('answer', 'Partial steered answer')])
    await f.emit({
      type: 'input-state',
      contextId: f.context.id,
      input: { inputId: runtimeId(f.user.id), facts: ['accepted', 'placed'], outcome: 'completed' }
    })
    f.handle.abortController.abort('user-requested')
    const paused: StreamPausedResult = {
      status: 'paused',
      isTopicDone: true,
      finalMessage: (await f.done).finalMessage
    }
    for (const listener of f.handle.listeners) await listener.onPaused(paused)
    const stopping = f.service.stopSession('root', 'user-requested')
    await f.emit({
      type: 'input-state',
      contextId: f.context.id,
      input: { inputId: runtimeId(steer.id), facts: ['accepted', 'placed'], ...(outcome && { outcome }) }
    })
    await f.emit({ type: 'turn-complete', status: 'paused' })
    await f.emit({ type: 'stop-confirmed' })
    await stopping
    const saved = messages.getSessionMessage('root', f.reply.id)
    expect(saved.status).toBe(status)
    expect(saved.data.parts?.[0]).toEqual(text('', 'Partial steered answer').parts[0])
    expect(terminals).toEqual([status])
  }
)

it.each(['before', 'after'] as const)(
  'settles a followed Run once when its input outcomes arrive %s the next execution starts',
  async (reported) => {
    MockApplicationUtils.setService('AiStreamManager', {
      startRuntimeTurn: () => {},
      drainRuntimeReply: async () => {}
    })
    const f = await fixture(undefined, false, 'pi-durable')
    const terminals: string[] = []
    f.service.onTurnTerminal((event) => {
      if (event.assistantMessageId === f.reply.id && event.boundary === 'turn') terminals.push(event.status)
    })
    await vi.waitFor(() => expect(f.connections.sent).toHaveLength(1))
    await f.project([text('answer', 'Partial answer')])
    const steer = savedUser(f.reply.id, 'Correction')
    f.service.enqueueUserMessage('root', steer)
    await f.emit({ type: 'steer-boundary', inputIds: [steer.id] })
    const failed: AgentRuntimeEvent = {
      type: 'input-state',
      contextId: f.context.id,
      input: {
        inputId: runtimeId(f.user.id),
        facts: ['accepted', 'placed'],
        outcome: 'unanswered',
        error: { operation: 'input', code: 'output-truncated', message: 'Output limit reached' }
      }
    }
    if (reported === 'before') await f.emit(failed)
    const queued = savedUser(steer.id, 'Next execution')
    f.service.enqueueUserMessage('root', queued, { followUp: true })
    await f.emit({ type: 'run-started', inputIds: [queued.id] })
    const result: StreamDoneResult = {
      status: 'success',
      finalMessage: (await f.done).finalMessage,
      isTopicDone: false
    }
    for (const listener of f.handle.listeners) await listener.onDone(result)
    if (reported === 'after') await f.emit(failed)
    expect(messages.getSessionMessage('root', f.reply.id).status).toBe('success')
    const aborted: AgentRuntimeEvent = {
      type: 'input-state',
      contextId: f.context.id,
      input: { inputId: runtimeId(steer.id), facts: ['accepted', 'placed'], outcome: 'aborted' }
    }
    await f.emit(aborted)
    await f.emit(aborted)
    await vi.waitFor(() => expect(terminals).toEqual(['error']))
    const saved = messages.getSessionMessage('root', f.reply.id)
    expect(saved.status).toBe('error')
    expect(saved.data.parts?.filter((part) => part.type === 'data-error')).toHaveLength(1)
    expect(saved.data.parts?.[0]).toEqual(text('', 'Partial answer').parts[0])
  }
)

it('publishes compaction progress and completion on one part without moving its timeline position', async () => {
  const changes: AgentPartChange[] = []
  const f = await fixture(undefined, false, 'pi', 0, (change) => changes.push(change))
  await f.emit({ type: 'compaction-start', trigger: 'manual' })
  const added = changes.find((part) => part.type === 'part-add')
  expect(added).toMatchObject({ part: { type: 'data-compaction-anchor', data: { status: 'compacting' } } })
  expect(storedParts(f.reply.id)).toEqual([])
  await f.emit({ type: 'compaction-complete', anchor: { phase: 'agent-session', status: 'done' } })
  expect(changes).toContainEqual(
    expect.objectContaining({
      type: 'part-put',
      partId: added && 'partId' in added ? added.partId : undefined,
      part: expect.objectContaining({ data: { phase: 'agent-session', status: 'done' } })
    })
  )
  expect(storedParts(f.reply.id)).toHaveLength(1)
})

it('persists a terminal compaction marker when closing and reopening during compaction', async () => {
  const changes: AgentPartChange[] = []
  const f = await fixture(undefined, false, 'pi-durable', 0, (change) => changes.push(change))
  await f.emit({ type: 'run-started', inputIds: [f.user.id] })
  await f.project([text('before-close', 'Before compaction')])
  await f.emit({ type: 'compaction-start', trigger: 'manual' })
  const added = changes.find((part) => part.type === 'part-add')!
  if (added.type !== 'part-add') throw new Error('Missing compaction part')
  await f.service.closeSession('root')
  const result: StreamPausedResult = { status: 'paused', finalMessage: f.views.at(-1)! }
  for (const listener of f.handle.listeners) await listener.onPaused(result)
  const saved = messages.getSessionMessage('root', f.reply.id)
  expect(saved.status).toBe('paused')
  expect(saved.data.parts).toContainEqual(
    expect.objectContaining({
      type: 'data-compaction-anchor',
      data: expect.objectContaining({ status: 'skipped' })
    })
  )
  const reopened = new RootMessageProjection(f.context.id, { lastPos: messages.lastTimelinePosition('root') })
  expect(reopened.replyEntries(f.reply.id)).toContainEqual(
    expect.objectContaining({
      partId: added.partId,
      pos: added.placement?.pos,
      payload: expect.objectContaining({
        type: 'data-compaction-anchor',
        data: expect.objectContaining({ status: 'skipped' })
      })
    })
  )
})
