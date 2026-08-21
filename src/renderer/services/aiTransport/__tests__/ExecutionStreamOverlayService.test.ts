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
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

  class FakeConversationStreamSubscription {
    readonly branches = new Map<string, Branch>()
    readonly terminals = new Map<string, Terminal>()
    readonly terminalListeners = new Set<(terminal: Terminal) => void>()
    readonly stateListeners = new Set<() => void>()
    readonly quiescedListeners = new Set<(turnId: string) => void>()
    readonly refreshRequiredListeners = new Set<(turnIds: readonly string[]) => void>()
    conversationOpen = false

    constructor(readonly conversation: { kind: string; id: string }) {
      instances.set(`${conversation.kind}:${conversation.id}`, this)
    }

    listen() {}

    register(projection: Projection): ReadableStream<unknown> {
      let branch = this.branches.get(projection.executionId)
      if (!branch) {
        let controller!: ReadableStreamDefaultController<unknown>
        const stream = new ReadableStream<unknown>({ start: (value) => (controller = value) })
        branch = { stream, controller, closed: false }
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
      this.branches.delete(executionId)
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

    onRefreshRequired(listener: (turnIds: readonly string[]) => void) {
      this.refreshRequiredListeners.add(listener)
      return () => this.refreshRequiredListeners.delete(listener)
    }

    dispose() {}

    emit(executionId: string, chunk: CherryUIMessageChunk) {
      this.branches.get(executionId)?.controller.enqueue(chunk)
    }

    close(executionId: string) {
      const branch = this.branches.get(executionId)
      if (!branch || branch.closed) return
      branch.closed = true
      branch.controller.close()
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
  }

  const instances = new Map<string, FakeConversationStreamSubscription>()
  return { FakeConversationStreamSubscription, instances }
})

vi.mock('../ConversationStreamSubscription', () => ({
  ConversationStreamSubscription: fakes.FakeConversationStreamSubscription
}))

import { ExecutionOverlayPhase, ExecutionStreamOverlayService } from '../ExecutionStreamOverlayService'

const modelId = 'openai::gpt-4o' as UniqueModelId

const chat = (id: string): ConversationRef => ({ kind: ConversationKind.Chat, id })
const execution = (turn: string, id: string, outputNodeId: string): ConversationExecutionProjection => ({
  turnId: toConversationTurnId(turn),
  executionId: toConversationExecutionId(id),
  modelId,
  outputNodeId
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

describe('ExecutionStreamOverlayService', () => {
  beforeEach(() => fakes.instances.clear())

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
