import {
  ConversationActiveNodeMove,
  ConversationKind,
  type ConversationRef,
  conversationRefKey,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => {
  type Projection = {
    turnId: string
    executionId: string
    modelId: string
    outputNodeId?: string
  }
  type Terminal = {
    turnId: string
    executionId: string
    outputNodeId: string
    isAbort: boolean
    isError: boolean
  }
  type Branch = {
    stream: ReadableStream<unknown>
    controller: ReadableStreamDefaultController<unknown>
    closed: boolean
  }
  type RefreshRequest = { reason: string; turnIds: readonly string[] }

  class FakeConversationStreamSubscription {
    readonly branches = new Map<string, Branch>()
    readonly terminals = new Map<string, Terminal>()
    readonly terminalListeners = new Set<(terminal: Terminal) => void>()
    readonly stateListeners = new Set<() => void>()
    readonly quiescedListeners = new Set<(turnId: string) => void>()
    readonly refreshRequiredListeners = new Set<(request: RefreshRequest) => void>()
    conversationOpen = false
    listenCalls = 0
    disposed = false

    constructor(readonly conversation: { kind: string; id: string }) {
      instances.set(`${conversation.kind}:${conversation.id}`, this)
    }

    listen() {
      this.listenCalls += 1
    }

    private createBranch(): Branch {
      let controller!: ReadableStreamDefaultController<unknown>
      const stream = new ReadableStream<unknown>({ start: (value) => (controller = value) })
      return { stream, controller, closed: false }
    }

    register(projection: Projection): ReadableStream<unknown> {
      let branch = this.branches.get(projection.executionId)
      if (!branch) {
        branch = this.createBranch()
        this.branches.set(projection.executionId, branch)
      }
      this.conversationOpen = true
      return branch.stream
    }

    hasOpenBranch(executionId: string) {
      return this.branches.get(executionId)?.closed === false
    }

    hasAnyOpenBranch() {
      return [...this.branches.values()].some(({ closed }) => !closed)
    }

    isConversationOpen() {
      return this.conversationOpen
    }

    isSettled(executionId: string) {
      return this.terminals.has(executionId)
    }

    unregister(executionId: string) {
      this.close(executionId)
      this.branches.delete(executionId)
    }

    retireExecution(executionId: string) {
      this.unregister(executionId)
      this.terminals.delete(executionId)
    }

    cancelBranch(executionId: string) {
      this.close(executionId)
    }

    onExecutionTerminal(listener: (terminal: Terminal) => void) {
      this.terminalListeners.add(listener)
      for (const terminal of this.terminals.values()) listener(terminal)
      return () => this.terminalListeners.delete(listener)
    }

    onConversationStateChange(listener: () => void) {
      this.stateListeners.add(listener)
      return () => this.stateListeners.delete(listener)
    }

    onConversationQuiesced(listener: (turnId: string) => void) {
      this.quiescedListeners.add(listener)
      return () => this.quiescedListeners.delete(listener)
    }

    onRefreshRequired(listener: (request: RefreshRequest) => void) {
      this.refreshRequiredListeners.add(listener)
      return () => this.refreshRequiredListeners.delete(listener)
    }

    dispose() {
      this.disposed = true
      for (const executionId of [...this.branches.keys()]) this.unregister(executionId)
    }

    emit(executionId: string, chunk: CherryUIMessageChunk) {
      let branch = this.branches.get(executionId)
      if (!branch) {
        branch = this.createBranch()
        this.branches.set(executionId, branch)
      }
      if (!branch.closed) branch.controller.enqueue(chunk)
    }

    close(executionId: string) {
      const branch = this.branches.get(executionId)
      if (!branch || branch.closed) return
      branch.closed = true
      try {
        branch.controller.close()
      } catch {
        // Reader already settled.
      }
    }

    settle(terminal: Terminal) {
      this.terminals.set(terminal.executionId, terminal)
      for (const listener of this.terminalListeners) listener(terminal)
      this.close(terminal.executionId)
    }

    quiesce(turnId: string) {
      this.conversationOpen = false
      for (const listener of this.stateListeners) listener()
      for (const listener of this.quiescedListeners) listener(turnId)
    }

    requestRefresh(turnId: string, reason = 'replay-gap') {
      for (const listener of this.refreshRequiredListeners) listener({ reason, turnIds: [turnId] })
    }
  }

  const instances = new Map<string, FakeConversationStreamSubscription>()
  return { FakeConversationStreamSubscription, instances }
})

vi.mock('../ConversationStreamSubscription', () => ({
  ConversationStreamRefreshReason: {
    AttachUnavailable: 'attach-unavailable',
    NotFound: 'not-found',
    ReplayGap: 'replay-gap'
  },
  ConversationStreamSubscription: fakes.FakeConversationStreamSubscription
}))

import { ExecutionOverlayPhase, ExecutionStreamOverlayService } from '../ExecutionStreamOverlayService'

const modelId = 'openai::gpt-4o' as UniqueModelId

const chat = (id: string): ConversationRef => ({ kind: ConversationKind.Chat, id })
const execution = (
  turn: string,
  id: string,
  outputNodeId: string,
  seedFromEmpty?: boolean
): ConversationExecutionProjection => ({
  turnId: toConversationTurnId(turn),
  executionId: toConversationExecutionId(id),
  modelId,
  outputNodeId,
  ...(seedFromEmpty ? { seedFromEmpty: true } : {})
})
const assistant = (id: string): CherryUIMessage => ({ id, role: 'assistant', parts: [] }) as CherryUIMessage

function streamText(
  subscription: InstanceType<typeof fakes.FakeConversationStreamSubscription>,
  id: string,
  text: string
) {
  subscription.emit(id, { type: 'text-start', id: `text-${id}` } as CherryUIMessageChunk)
  subscription.emit(id, { type: 'text-delta', id: `text-${id}`, delta: text } as CherryUIMessageChunk)
  subscription.emit(id, { type: 'text-end', id: `text-${id}` } as CherryUIMessageChunk)
  subscription.emit(id, { type: 'finish' } as CherryUIMessageChunk)
}

function overlayText(service: ExecutionStreamOverlayService, conversation: ConversationRef, messageId: string): string {
  return (service.getView(conversation).overlay[messageId] ?? [])
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
}

async function drainReaders(): Promise<void> {
  for (let round = 0; round < 3; round++) {
    for (let index = 0; index < 24; index++) await Promise.resolve()
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

async function nextCommit(): Promise<void> {
  await drainReaders()
  await new Promise<void>((resolve) => setTimeout(resolve, 110))
}

function settle(
  subscription: InstanceType<typeof fakes.FakeConversationStreamSubscription>,
  value: ConversationExecutionProjection,
  flags: { isAbort?: boolean; isError?: boolean } = {}
): void {
  subscription.settle({
    turnId: value.turnId,
    executionId: value.executionId,
    outputNodeId: value.outputNodeId ?? '',
    isAbort: flags.isAbort === true,
    isError: flags.isError === true
  })
}

describe('ExecutionStreamOverlayService', () => {
  beforeEach(() => fakes.instances.clear())
  afterEach(() => vi.useRealTimers())

  it('keeps stream overlays isolated by exact ConversationRef', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversationA = chat('a')
    const conversationB = chat('b')
    const executionA = execution('turn-a', 'execution-a', 'assistant-a')
    const executionB = execution('turn-b', 'execution-b', 'assistant-b')

    service.acquire(conversationA)
    service.acquire(conversationB)
    service.syncExecutions(conversationA, {}, [executionA], () => [assistant('assistant-a')])
    service.syncExecutions(conversationB, {}, [executionB], () => [assistant('assistant-b')])
    streamText(fakes.instances.get(conversationRefKey(conversationA))!, executionA.executionId, 'A')
    streamText(fakes.instances.get(conversationRefKey(conversationB))!, executionB.executionId, 'B')

    await waitFor(() => expect(overlayText(service, conversationA, 'assistant-a')).toBe('A'))
    await waitFor(() => expect(overlayText(service, conversationB, 'assistant-b')).toBe('B'))

    service.clear(conversationA)

    expect(service.getView(conversationA).overlay).toEqual({})
    expect(overlayText(service, conversationB, 'assistant-b')).toBe('B')
  })

  it('settles only the exact execution within a multi-execution turn', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('multi-model')
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2')
    const finished = vi.fn()

    service.acquire(conversation)
    service.onFinish(conversation, finished)
    service.syncExecutions(conversation, {}, [first, second], () => [
      assistant('assistant-1'),
      assistant('assistant-2')
    ])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'first')
    streamText(subscription, second.executionId, 'second')
    subscription.settle({
      turnId: first.turnId,
      executionId: first.executionId,
      outputNodeId: 'assistant-1',
      isAbort: false,
      isError: false
    })

    await waitFor(() => expect(finished).toHaveBeenCalledTimes(1))
    expect(finished.mock.calls[0]?.[0]).toBe(first.executionId)
    expect(finished.mock.calls[0]?.[1]).toMatchObject({ turnId: first.turnId, executionId: first.executionId })
    expect(service.getView(conversation).records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ executionId: first.executionId, phase: ExecutionOverlayPhase.Settled }),
        expect.objectContaining({ executionId: second.executionId, phase: ExecutionOverlayPhase.Active })
      ])
    )
  })

  it('refreshes durable history before retiring a quiesced turn', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('refresh-handoff')
    const activeExecution = execution('turn-1', 'execution-1', 'assistant-1')
    let finishRefresh!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finishRefresh = resolve)))

    service.acquire(conversation)
    service.registerRefreshPort(conversation, refresh)
    service.seedReservations(
      conversation,
      [assistant('assistant-1')],
      [activeExecution],
      { move: ConversationActiveNodeMove.Advance },
      null,
      () => [assistant('assistant-1')]
    )
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, activeExecution.executionId, 'durable')
    subscription.settle({
      turnId: activeExecution.turnId,
      executionId: activeExecution.executionId,
      outputNodeId: 'assistant-1',
      isAbort: false,
      isError: false
    })
    await waitFor(() => expect(service.getView(conversation).records[0]?.phase).toBe(ExecutionOverlayPhase.Settled))

    subscription.quiesce(activeExecution.turnId)
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(service.getView(conversation).records).toHaveLength(1)

    finishRefresh()
    await waitFor(() => expect(service.getView(conversation).records).toHaveLength(0))
    expect(service.getView(conversation).activeNodeOverride).toBeNull()
  })

  it('refreshes a replay gap without retiring the still-live execution', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('live-replay-gap')
    const activeExecution = execution('turn-1', 'execution-1', 'assistant-1')
    const refresh = vi.fn(async () => undefined)

    service.acquire(conversation)
    service.registerRefreshPort(conversation, refresh)
    service.syncExecutions(conversation, {}, [activeExecution], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    subscription.emit(activeExecution.executionId, {
      type: 'text-start',
      id: `text-${activeExecution.executionId}`
    } as CherryUIMessageChunk)
    subscription.emit(activeExecution.executionId, {
      type: 'text-delta',
      id: `text-${activeExecution.executionId}`,
      delta: 'before'
    } as CherryUIMessageChunk)
    await nextCommit()

    subscription.requestRefresh(activeExecution.turnId)
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())

    expect(subscription.hasOpenBranch(activeExecution.executionId)).toBe(true)
    subscription.emit(activeExecution.executionId, {
      type: 'text-delta',
      id: `text-${activeExecution.executionId}`,
      delta: '-after'
    } as CherryUIMessageChunk)
    await nextCommit()
    expect(overlayText(service, conversation, 'assistant-1')).toBe('before-after')
  })

  it('refreshes before retiring an optimistic execution that Main reports as NotFound', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('not-found')
    const activeExecution = execution('turn-1', 'execution-1', 'assistant-1')
    let finishRefresh!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finishRefresh = resolve)))

    service.acquire(conversation)
    service.registerRefreshPort(conversation, refresh)
    service.seedReservations(
      conversation,
      [assistant('assistant-1')],
      [activeExecution],
      { move: ConversationActiveNodeMove.Advance },
      null,
      () => [assistant('assistant-1')]
    )
    const subscription = fakes.instances.get(conversationRefKey(conversation))!

    subscription.requestRefresh(activeExecution.turnId, 'not-found')
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(service.getView(conversation).activeNodeOverride).toEqual({
      previousActiveNodeId: null,
      activeNodeId: 'assistant-1'
    })
    expect(subscription.hasOpenBranch(activeExecution.executionId)).toBe(true)

    finishRefresh()
    await waitFor(() => expect(service.getView(conversation).records).toHaveLength(0))
    expect(subscription.hasOpenBranch(activeExecution.executionId)).toBe(false)
    expect(service.getView(conversation).activeNodeOverride).toBeNull()
  })

  it('starts an in-place retry from empty parts even when cached history still has the old failure', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('retry')
    const retry = execution('turn-2', 'execution-retry', 'assistant-1', true)
    const staleSeed = () =>
      [
        assistant('assistant-1') as CherryUIMessage & {
          parts: CherryUIMessage['parts']
        }
      ].map((message) => ({
        ...message,
        parts: [
          { type: 'text', text: 'old partial response' },
          { type: 'data-error', data: { message: 'old failure' } }
        ]
      })) as CherryUIMessage[]

    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [retry], staleSeed)
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, retry.executionId, 'new response')
    await nextCommit()

    expect(overlayText(service, conversation, 'assistant-1')).toBe('new response')
    expect(service.getView(conversation).overlay['assistant-1']?.some((part) => part.type === 'data-error')).toBe(false)
  })

  it('keeps the reader running and the view updating across release, restores synchronously on re-acquire', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('release-retain')
    const consumer = {}
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [active], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!

    streamText(subscription, active.executionId, 'before-release')
    await nextCommit()
    service.release(conversation, consumer)
    streamText(subscription, active.executionId, ' after-release')
    await nextCommit()

    expect(overlayText(service, conversation, 'assistant-1')).toBe('before-release after-release')
    expect(subscription.disposed).toBe(false)
    service.acquire(conversation)
    expect(overlayText(service, conversation, 'assistant-1')).toBe('before-release after-release')
  })

  it('drops the entry (and detaches) when the last reader ends at refCount 0', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('drop-after-terminal')
    const consumer = {}
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [active], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, active.executionId, 'done')
    await nextCommit()

    service.release(conversation, consumer)
    settle(subscription, active)
    subscription.quiesce(active.turnId)
    await drainReaders()

    expect(subscription.disposed).toBe(true)
    expect(service.getView(conversation).overlay).toEqual({})
  })

  it('does NOT self-clean on terminal while a consumer is mounted — the status-edge handoff owns disposal', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('mounted-terminal')
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    let finishRefresh!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finishRefresh = resolve)))
    service.acquire(conversation)
    service.registerRefreshPort(conversation, refresh)
    service.syncExecutions(conversation, {}, [active], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, active.executionId, 'final')
    settle(subscription, active)
    await drainReaders()

    expect(overlayText(service, conversation, 'assistant-1')).toBe('final')
    expect(refresh).not.toHaveBeenCalled()

    subscription.quiesce(active.turnId)
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(overlayText(service, conversation, 'assistant-1')).toBe('final')
    finishRefresh()
    await waitFor(() => expect(service.getView(conversation).overlay).toEqual({}))
  })

  it('retires watermark-covered sibling readers without reporting an implicit success', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('sibling-retirement')
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2')
    const finished = vi.fn()
    const refresh = vi.fn(async () => undefined)
    service.acquire(conversation)
    service.onFinish(conversation, finished)
    service.registerRefreshPort(conversation, refresh)
    service.syncExecutions(conversation, {}, [first, second], () => [
      assistant('assistant-1'),
      assistant('assistant-2')
    ])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!

    streamText(subscription, first.executionId, 'partial')
    streamText(subscription, second.executionId, 'answer')
    settle(subscription, second)
    await drainReaders()
    expect(finished).toHaveBeenCalledTimes(1)
    expect(finished).toHaveBeenCalledWith(second.executionId, expect.objectContaining({ isError: false }))

    subscription.quiesce(first.turnId)
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('remount with a stale active set does not restart a settled execution or wipe its final frame', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('stale-remount')
    const firstConsumer = {}
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2')
    const seeds = () => [assistant('assistant-1'), assistant('assistant-2')]
    service.acquire(conversation)
    service.syncExecutions(conversation, firstConsumer, [first, second], seeds)
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'final')
    settle(subscription, first)
    subscription.emit(second.executionId, {
      type: 'text-start',
      id: `text-${second.executionId}`
    } as CherryUIMessageChunk)
    subscription.emit(second.executionId, {
      type: 'text-delta',
      id: `text-${second.executionId}`,
      delta: 'live'
    } as CherryUIMessageChunk)
    await nextCommit()
    service.release(conversation, firstConsumer)

    const nextConsumer = {}
    service.acquire(conversation)
    service.syncExecutions(conversation, nextConsumer, [first, second], seeds)
    await drainReaders()

    expect(subscription.branches.has(first.executionId)).toBe(false)
    expect(overlayText(service, conversation, 'assistant-1')).toBe('final')
    expect(overlayText(service, conversation, 'assistant-2')).toBe('live')
  })

  it('reset drops only settled snapshots — a newer turn already streaming keeps its reader publishing', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('turn-scoped-reset')
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-2', 'execution-2', 'assistant-2')
    service.acquire(conversation)
    service.registerRefreshPort(
      conversation,
      vi.fn(async () => undefined)
    )
    service.syncExecutions(conversation, {}, [first, second], () => [
      assistant('assistant-1'),
      assistant('assistant-2')
    ])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'finished')
    settle(subscription, first)
    subscription.emit(second.executionId, {
      type: 'text-start',
      id: `text-${second.executionId}`
    } as CherryUIMessageChunk)
    subscription.emit(second.executionId, {
      type: 'text-delta',
      id: `text-${second.executionId}`,
      delta: 'live'
    } as CherryUIMessageChunk)
    await nextCommit()

    service.reset(conversation)
    await waitFor(() => expect(service.getView(conversation).overlay['assistant-1']).toBeUndefined())
    expect(overlayText(service, conversation, 'assistant-2')).toBe('live')

    subscription.emit(second.executionId, {
      type: 'text-delta',
      id: `text-${second.executionId}`,
      delta: '-more'
    } as CherryUIMessageChunk)
    await nextCommit()
    expect(overlayText(service, conversation, 'assistant-2')).toBe('live-more')
  })

  it('clear destructively drops everything, including a live reader’s future frames', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('destructive-clear')
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [active], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, active.executionId, 'live')
    await nextCommit()

    service.clear(conversation)
    subscription.emit(active.executionId, {
      type: 'text-delta',
      id: `text-${active.executionId}`,
      delta: '-stale'
    } as CherryUIMessageChunk)
    await nextCommit()

    expect(service.getView(conversation).overlay).toEqual({})
  })

  it('reconciles on remount: drops snapshots of no-longer-active executions, keeps streaming ones', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('reconcile-remount')
    const consumer = {}
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2')
    const seeds = () => [assistant('assistant-1'), assistant('assistant-2')]
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [first, second], seeds)
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'finished-away')
    streamText(subscription, second.executionId, 'still-live')
    await nextCommit()
    service.release(conversation, consumer)
    settle(subscription, first)
    await drainReaders()

    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [second], seeds)

    expect(service.getView(conversation).overlay['assistant-1']).toBeUndefined()
    expect(overlayText(service, conversation, 'assistant-2')).toBe('still-live')
  })

  it('A7: does not restart an execution that finished in the background when a stale set is re-reported', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('background-finish')
    const consumer = {}
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2')
    const seeds = () => [assistant('assistant-1'), assistant('assistant-2')]
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [first, second], seeds)
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'first')
    streamText(subscription, second.executionId, 'live')
    await nextCommit()
    service.release(conversation, consumer)
    settle(subscription, first)
    await drainReaders()

    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [first, second], seeds)
    await drainReaders()

    expect(subscription.branches.has(first.executionId)).toBe(false)
    expect(subscription.branches.has(second.executionId)).toBe(true)
  })

  it('hidden steer continuation: keeps the entry attached while the next round’s chunks queue unclaimed', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('hidden-continuation')
    const consumer = {}
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-2', 'execution-2', 'assistant-2')
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [first], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'first')
    await nextCommit()
    service.release(conversation, consumer)
    settle(subscription, first)
    await drainReaders()
    expect(subscription.disposed).toBe(false)

    streamText(subscription, second.executionId, 'second')
    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [second], () => [assistant('assistant-2')])
    await nextCommit()

    expect(subscription.disposed).toBe(false)
    expect(overlayText(service, conversation, 'assistant-2')).toBe('second')
  })

  it('hidden steer continuation: drops the pinned entry once its queued round terminates unobserved', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('hidden-terminal')
    const consumer = {}
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-2', 'execution-2', 'assistant-2')
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [first], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    service.release(conversation, consumer)
    settle(subscription, first)
    await drainReaders()

    streamText(subscription, second.executionId, 'second')
    settle(subscription, second)
    subscription.quiesce(second.turnId)
    await drainReaders()

    expect(subscription.disposed).toBe(true)
  })

  it('restarts a finished execution only when a new turn’s chunks are already queued in the transport', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('queued-restart')
    const consumer = {}
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-2', 'execution-2', 'assistant-1')
    service.acquire(conversation)
    service.syncExecutions(conversation, consumer, [first], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, first.executionId, 'first')
    await nextCommit()
    service.release(conversation, consumer)
    settle(subscription, first)
    await drainReaders()

    streamText(subscription, second.executionId, 'second')
    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [second], () => [assistant('assistant-1')])
    await nextCommit()

    expect(overlayText(service, conversation, 'assistant-1')).toBe('second')
  })

  it('notifies every mounted consumer exactly once per execution finish', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('finish-listeners')
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const firstConsumer = {}
    const secondConsumer = {}
    const firstFinish = vi.fn()
    const secondFinish = vi.fn()
    service.acquire(conversation)
    service.acquire(conversation)
    service.onFinish(conversation, firstFinish)
    service.onFinish(conversation, secondFinish)
    service.syncExecutions(conversation, firstConsumer, [active], () => [assistant('assistant-1')])
    service.syncExecutions(conversation, secondConsumer, [active], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    expect(subscription.branches.size).toBe(1)

    streamText(subscription, active.executionId, 'final')
    settle(subscription, active, { isAbort: true })
    await drainReaders()

    expect(firstFinish).toHaveBeenCalledOnce()
    expect(secondFinish).toHaveBeenCalledOnce()
    expect(firstFinish.mock.calls[0]?.[1]).toMatchObject({ executionId: active.executionId, isAbort: true })
  })

  it('extends the shared commit deadline when a larger execution joins the pending batch', async () => {
    vi.useFakeTimers()
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('commit-deadline')
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2')
    const changed = vi.fn()
    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [first, second], () => [
      assistant('assistant-1'),
      assistant('assistant-2')
    ])
    service.subscribe(conversation, changed)
    const subscription = fakes.instances.get(conversationRefKey(conversation))!

    streamText(subscription, first.executionId, 'initial')
    await vi.advanceTimersByTimeAsync(100)
    changed.mockClear()
    streamText(subscription, first.executionId, 'small')
    await vi.advanceTimersByTimeAsync(0)
    streamText(subscription, second.executionId, 'x'.repeat(600_000))
    await vi.advanceTimersByTimeAsync(100)

    expect(changed).not.toHaveBeenCalled()
    expect(service.getView(conversation).overlay['assistant-2']).toBeUndefined()

    await vi.advanceTimersByTimeAsync(201)
    expect(changed).toHaveBeenCalledOnce()
    expect(overlayText(service, conversation, 'assistant-2')).toHaveLength(600_000)
  })

  it('flushes stalled pending snapshots on acquire (hidden-window timer stall)', async () => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat('stalled-commit')
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    service.acquire(conversation)
    service.syncExecutions(conversation, {}, [active], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!

    streamText(subscription, active.executionId, 'committed')
    await nextCommit()
    streamText(subscription, active.executionId, '-flushed')
    await drainReaders()
    streamText(subscription, active.executionId, '-stalled')
    await drainReaders()
    expect(overlayText(service, conversation, 'assistant-1')).toBe('committed-flushed')

    service.acquire(conversation)
    expect(overlayText(service, conversation, 'assistant-1')).toBe('committed-flushed-stalled')
  })

  it('evicts the oldest refCount-0 entry past MAX_ENTRIES as a leak backstop', async () => {
    const service = new ExecutionStreamOverlayService()
    for (let index = 0; index < 32; index++) {
      const conversation = chat(`leak-${index}`)
      const consumer = {}
      service.acquire(conversation)
      service.syncExecutions(conversation, consumer, [execution('turn-1', `execution-${index}`, 'assistant-1')], () => [
        assistant('assistant-1')
      ])
      service.release(conversation, consumer)
    }
    await drainReaders()

    service.acquire(chat('fresh-topic'))

    expect(fakes.instances.get('chat:leak-0')?.disposed).toBe(true)
    expect(fakes.instances.get('chat:leak-1')?.disposed).toBe(false)
    expect(fakes.instances.get('chat:fresh-topic')).toBeDefined()
  })

  it('does not let an evicted reader finalizer delete a replacement entry for the same topic', async () => {
    const service = new ExecutionStreamOverlayService()
    for (let index = 0; index < 32; index++) {
      const conversation = chat(`replace-${index}`)
      const consumer = {}
      service.acquire(conversation)
      service.syncExecutions(conversation, consumer, [execution('turn-1', `execution-${index}`, 'assistant-1')], () => [
        assistant('assistant-1')
      ])
      service.release(conversation, consumer)
    }
    service.acquire(chat('fresh-topic'))
    expect(fakes.instances.get('chat:replace-0')?.disposed).toBe(true)

    const replacementConversation = chat('replace-0')
    const replacement = execution('turn-2', 'replacement-execution', 'assistant-2')
    service.acquire(replacementConversation)
    service.syncExecutions(replacementConversation, {}, [replacement], () => [assistant('assistant-2')])
    await drainReaders()

    expect(fakes.instances.get('chat:replace-0')?.disposed).toBe(false)
    expect(fakes.instances.get('chat:replace-0')?.branches.has(replacement.executionId)).toBe(true)
  })

  it('does not listen on an empty topicId (pending temp topic)', () => {
    const service = new ExecutionStreamOverlayService()
    const emptyConversation = chat('')

    service.acquire(emptyConversation)

    expect(fakes.instances.get('chat:')?.listenCalls).toBe(0)
  })

  it.each(['dispose', 'reset'] as const)('refreshes durable history before retiring through %s', async (action) => {
    const service = new ExecutionStreamOverlayService()
    const conversation = chat(`manual-${action}`)
    const activeExecution = execution('turn-1', 'execution-1', 'assistant-1')
    let finishRefresh!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (finishRefresh = resolve)))

    service.acquire(conversation)
    service.registerRefreshPort(conversation, refresh)
    service.syncExecutions(conversation, {}, [activeExecution], () => [assistant('assistant-1')])
    const subscription = fakes.instances.get(conversationRefKey(conversation))!
    streamText(subscription, activeExecution.executionId, 'durable')
    subscription.settle({
      turnId: activeExecution.turnId,
      executionId: activeExecution.executionId,
      outputNodeId: 'assistant-1',
      isAbort: false,
      isError: false
    })
    await waitFor(() => expect(service.getView(conversation).records[0]?.phase).toBe(ExecutionOverlayPhase.Settled))

    if (action === 'dispose') service.disposeOverlay(conversation, 'assistant-1')
    else service.reset(conversation)

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    expect(service.getView(conversation).records).toHaveLength(1)
    finishRefresh()
    await waitFor(() => expect(service.getView(conversation).records).toHaveLength(0))
  })
})
