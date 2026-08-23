import {
  ConversationKind,
  type ConversationRef,
  conversationRefKey,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { ConversationExecutionProjection } from '@shared/ai/transport'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  type Projection = {
    turnId: string
    executionId: string
    modelId: string
    outputNodeId: string
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

  class Subscription {
    readonly branches = new Map<string, Branch>()
    readonly terminals = new Map<string, Terminal>()
    readonly terminalListeners = new Set<(terminal: Terminal) => void>()
    readonly stateListeners = new Set<() => void>()
    readonly quiescedListeners = new Set<(turnId: string) => void>()
    readonly refreshListeners = new Set<(request: RefreshRequest) => void>()
    conversationOpen = false

    constructor(readonly conversation: ConversationRef) {
      instances.set(conversationRefKey(conversation), this)
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
      this.close(executionId)
      this.branches.delete(executionId)
    }

    retireExecution(executionId: string) {
      this.unregister(executionId)
      this.terminals.delete(executionId)
    }

    cancelBranch(executionId: string) {
      const branch = this.branches.get(executionId)
      if (!branch || branch.closed) return
      branch.closed = true
      try {
        branch.controller.error()
      } catch {
        // Reader already settled.
      }
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
      this.refreshListeners.add(listener)
      return () => this.refreshListeners.delete(listener)
    }

    dispose() {
      for (const executionId of [...this.branches.keys()]) this.unregister(executionId)
    }

    emit(executionId: string, chunk: CherryUIMessageChunk) {
      this.branches.get(executionId)?.controller.enqueue(chunk)
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

    settle(projection: Projection, flags: { isAbort?: boolean; isError?: boolean } = {}) {
      const terminal = {
        turnId: projection.turnId,
        executionId: projection.executionId,
        outputNodeId: projection.outputNodeId,
        isAbort: flags.isAbort === true,
        isError: flags.isError === true
      }
      this.terminals.set(projection.executionId, terminal)
      for (const listener of this.terminalListeners) listener(terminal)
      this.close(projection.executionId)
    }

    quiesce(turnId: string) {
      this.conversationOpen = false
      for (const listener of this.stateListeners) listener()
      for (const listener of this.quiescedListeners) listener(turnId)
    }
  }

  const instances = new Map<string, Subscription>()
  return { instances, Subscription }
})

vi.mock('@renderer/services/aiTransport/ConversationStreamSubscription', () => ({
  ConversationStreamRefreshReason: {
    AttachUnavailable: 'attach-unavailable',
    NotFound: 'not-found',
    ReplayGap: 'replay-gap'
  },
  ConversationStreamSubscription: fake.Subscription
}))

import { useExecutionOverlay } from '../useExecutionOverlay'

let sequence = 0
const modelA = 'openai::gpt-4o' as UniqueModelId
const modelB = 'anthropic::claude' as UniqueModelId
type TestProjection = ConversationExecutionProjection & { outputNodeId: string }

const conversation = (): ConversationRef => ({ kind: ConversationKind.Chat, id: `overlay-${++sequence}` })
const execution = (
  turn: string,
  id: string,
  outputNodeId: string,
  modelId = modelA,
  seedFromEmpty?: boolean
): TestProjection => ({
  turnId: toConversationTurnId(turn),
  executionId: toConversationExecutionId(id),
  modelId,
  outputNodeId,
  ...(seedFromEmpty ? { seedFromEmpty: true } : {})
})
const assistant = (id: string, parts: CherryUIMessage['parts'] = []): CherryUIMessage =>
  ({ id, role: 'assistant', parts }) as CherryUIMessage

function streamText(ref: ConversationRef, value: TestProjection, textId: string, text: string): void {
  const subscription = fake.instances.get(conversationRefKey(ref))!
  subscription.emit(value.executionId, { type: 'text-start', id: textId } as CherryUIMessageChunk)
  subscription.emit(value.executionId, { type: 'text-delta', id: textId, delta: text } as CherryUIMessageChunk)
  subscription.emit(value.executionId, { type: 'text-end', id: textId } as CherryUIMessageChunk)
  subscription.emit(value.executionId, { type: 'finish' } as CherryUIMessageChunk)
}

function textOf(parts: CherryUIMessage['parts'] | undefined): string {
  return (parts ?? []).flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
}

async function drainReaders(): Promise<void> {
  for (let index = 0; index < 32; index++) await Promise.resolve()
}

function controlledCommitTimers() {
  let nextId = 1
  const callbacks = new Map<number, () => void>()
  const request = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: () => void) => {
    const id = nextId++
    callbacks.set(id, handler)
    return id
  }) as unknown as typeof window.setTimeout)
  const cancel = vi.spyOn(window, 'clearTimeout').mockImplementation(((id?: number) => {
    if (id !== undefined) callbacks.delete(id)
  }) as unknown as typeof window.clearTimeout)
  return {
    callbacks,
    request,
    cancel,
    runNext() {
      const entry = callbacks.entries().next().value
      if (!entry) return
      callbacks.delete(entry[0])
      entry[1]()
    }
  }
}

describe('useExecutionOverlay retained behavior contracts', () => {
  beforeEach(() => fake.instances.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    fake.instances.clear()
  })

  it('N1 — anchored overlay isolation: each execution lands only on its own anchor', async () => {
    const ref = conversation()
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2', modelB)
    const { result } = renderHook(() =>
      useExecutionOverlay(ref, [first, second], [assistant('assistant-1'), assistant('assistant-2')])
    )

    streamText(ref, first, 'text-1', 'first')
    streamText(ref, second, 'text-2', 'second')

    await waitFor(() => expect(textOf(result.current.overlay['assistant-1'])).toBe('first'))
    await waitFor(() => expect(textOf(result.current.overlay['assistant-2'])).toBe('second'))
    expect(textOf(result.current.overlay['assistant-1'])).not.toContain('second')
  })

  it('N2 — no cross-turn pollution: same model, new anchor next turn is clean', async () => {
    const ref = conversation()
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-2', 'execution-2', 'assistant-2')
    const { result, rerender } = renderHook(({ active, messages }) => useExecutionOverlay(ref, active, messages), {
      initialProps: { active: [first], messages: [assistant('assistant-1')] }
    })
    streamText(ref, first, 'text-1', 'round-1')
    await waitFor(() => expect(textOf(result.current.overlay['assistant-1'])).toBe('round-1'))
    fake.instances.get(conversationRefKey(ref))!.settle(first)

    rerender({
      active: [second],
      messages: [assistant('assistant-1', [{ type: 'text', text: 'round-1' }]), assistant('assistant-2')]
    })
    streamText(ref, second, 'text-2', 'round-2')

    await waitFor(() => expect(textOf(result.current.overlay['assistant-2'])).toBe('round-2'))
    expect(textOf(result.current.overlay['assistant-2'])).not.toContain('round-1')
  })

  it('N2b — same model direct anchor switch starts a fresh reader', async () => {
    const ref = conversation()
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-2', 'execution-2', 'assistant-2')
    const { result, rerender } = renderHook(({ active }) => useExecutionOverlay(ref, active, []), {
      initialProps: { active: [first] }
    })
    streamText(ref, first, 'text-1', 'round-1')
    await waitFor(() => expect(textOf(result.current.overlay['assistant-1'])).toBe('round-1'))

    rerender({ active: [second] })
    streamText(ref, second, 'text-2', 'round-2')

    await waitFor(() => expect(textOf(result.current.overlay['assistant-2'])).toBe('round-2'))
  })

  it('N3 — continue/tool seed: reader seeded from current DB anchor keeps prior parts', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const { result } = renderHook(() =>
      useExecutionOverlay(ref, [active], [assistant('assistant-1', [{ type: 'text', text: 'PRIOR ' }])])
    )
    streamText(ref, active, 'text-2', 'CONTINUED')

    await waitFor(() => expect(textOf(result.current.overlay['assistant-1'])).toBe('PRIOR CONTINUED'))
  })

  it('N3b — leaves the SWR-cached seed row unmutated during streaming (REGRESSION renderer-transport-1)', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const parts: CherryUIMessage['parts'] = [{ type: 'text', text: 'PRIOR ' }]
    const { result } = renderHook(() => useExecutionOverlay(ref, [active], [assistant('assistant-1', parts)]))
    streamText(ref, active, 'text-2', 'CONTINUED')

    await waitFor(() => expect(textOf(result.current.overlay['assistant-1'])).toContain('CONTINUED'))
    expect(parts).toEqual([{ type: 'text', text: 'PRIOR ' }])
  })

  it('structurally shares protocol-settled parts while the live frontier advances', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const { result } = renderHook(() => useExecutionOverlay(ref, [active], [assistant('assistant-1')]))
    const subscription = fake.instances.get(conversationRefKey(ref))!
    subscription.emit(active.executionId, { type: 'text-start', id: 'text-1' } as CherryUIMessageChunk)
    subscription.emit(active.executionId, {
      type: 'text-delta',
      id: 'text-1',
      delta: 'settled'
    } as CherryUIMessageChunk)
    subscription.emit(active.executionId, { type: 'text-end', id: 'text-1' } as CherryUIMessageChunk)
    await waitFor(() => expect(result.current.overlay['assistant-1']?.[0]).toMatchObject({ state: 'done' }))
    const settledText = result.current.overlay['assistant-1'][0]

    subscription.emit(active.executionId, {
      type: 'tool-input-start',
      toolCallId: 'tool-1',
      toolName: 'search',
      dynamic: true
    } as CherryUIMessageChunk)

    await waitFor(() => expect(result.current.overlay['assistant-1']).toHaveLength(2))
    expect(result.current.overlay['assistant-1'][0]).toBe(settledText)
  })

  it('coalesces burst snapshots from every execution into one render per commit flush', async () => {
    const timers = controlledCommitTimers()
    const ref = conversation()
    const first = execution('turn-1', 'execution-1', 'assistant-1')
    const second = execution('turn-1', 'execution-2', 'assistant-2', modelB)
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useExecutionOverlay(ref, [first, second], [assistant('assistant-1'), assistant('assistant-2')])
    })
    const subscription = fake.instances.get(conversationRefKey(ref))!

    await act(async () => {
      subscription.emit(first.executionId, { type: 'text-start', id: 'text-1' } as CherryUIMessageChunk)
      subscription.emit(first.executionId, { type: 'text-delta', id: 'text-1', delta: 'a' } as CherryUIMessageChunk)
      subscription.emit(second.executionId, { type: 'text-start', id: 'text-2' } as CherryUIMessageChunk)
      subscription.emit(second.executionId, { type: 'text-delta', id: 'text-2', delta: 'b' } as CherryUIMessageChunk)
      await drainReaders()
    })
    expect(timers.request).toHaveBeenCalledOnce()
    const before = renders

    act(() => timers.runNext())

    expect(textOf(result.current.overlay['assistant-1'])).toBe('a')
    expect(textOf(result.current.overlay['assistant-2'])).toBe('b')
    expect(renders).toBe(before + 1)
  })

  it('flushes a terminal snapshot immediately instead of waiting for the next commit', async () => {
    const timers = controlledCommitTimers()
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const onFinish = vi.fn()
    const { result } = renderHook(() => useExecutionOverlay(ref, [active], [assistant('assistant-1')], { onFinish }))
    const subscription = fake.instances.get(conversationRefKey(ref))!
    await act(async () => {
      subscription.emit(active.executionId, { type: 'text-start', id: 'text-1' } as CherryUIMessageChunk)
      subscription.emit(active.executionId, {
        type: 'text-delta',
        id: 'text-1',
        delta: 'final'
      } as CherryUIMessageChunk)
      subscription.emit(active.executionId, { type: 'text-end', id: 'text-1' } as CherryUIMessageChunk)
      subscription.settle(active)
      await drainReaders()
    })

    expect(textOf(result.current.overlay['assistant-1'])).toBe('final')
    expect(onFinish).toHaveBeenCalledOnce()
    expect(timers.callbacks.size).toBe(0)
  })

  it('React round-trip: unmount keeps assembling, remount renders pre- and post-unmount content', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const useTestOverlay = () => useExecutionOverlay(ref, [active], [assistant('assistant-1')])
    const first = renderHook(useTestOverlay)
    const subscription = fake.instances.get(conversationRefKey(ref))!
    subscription.emit(active.executionId, { type: 'text-start', id: 'text-1' } as CherryUIMessageChunk)
    subscription.emit(active.executionId, { type: 'text-delta', id: 'text-1', delta: 'before' } as CherryUIMessageChunk)
    await waitFor(() => expect(textOf(first.result.current.overlay['assistant-1'])).toBe('before'))
    first.unmount()

    await act(async () => {
      subscription.emit(active.executionId, {
        type: 'text-delta',
        id: 'text-1',
        delta: ' after'
      } as CherryUIMessageChunk)
      await drainReaders()
    })
    const second = renderHook(useTestOverlay)
    expect(textOf(second.result.current.overlay['assistant-1'])).toBe('before after')
  })

  it('prevents a cancelled commit from restoring snapshots after a destructive clear', async () => {
    const timers = controlledCommitTimers()
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const { result } = renderHook(() => useExecutionOverlay(ref, [active], [assistant('assistant-1')]))
    const subscription = fake.instances.get(conversationRefKey(ref))!
    await act(async () => {
      subscription.emit(active.executionId, { type: 'text-start', id: 'text-1' } as CherryUIMessageChunk)
      subscription.emit(active.executionId, {
        type: 'text-delta',
        id: 'text-1',
        delta: 'stale'
      } as CherryUIMessageChunk)
      await drainReaders()
    })
    const staleFlush = timers.callbacks.values().next().value as () => void

    act(() => result.current.clear())
    act(() => staleFlush())

    expect(result.current.overlay).toEqual({})
  })

  it('keeps live message metadata from message-metadata chunks', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const { result } = renderHook(() => useExecutionOverlay(ref, [active], [assistant('assistant-1')]))
    fake.instances.get(conversationRefKey(ref))!.emit(active.executionId, {
      type: 'message-metadata',
      messageMetadata: { totalTokens: 321 }
    } as CherryUIMessageChunk)

    await waitFor(() => expect(result.current.liveAssistants.at(-1)?.metadata?.totalTokens).toBe(321))
  })

  it('N4 — terminal classification drives onFinish (success / paused / error)', async () => {
    const outcomes = [
      { suffix: 'success', flags: {}, expected: { isAbort: false, isError: false } },
      { suffix: 'paused', flags: { isAbort: true }, expected: { isAbort: true, isError: false } },
      { suffix: 'error', flags: { isError: true }, expected: { isAbort: false, isError: true } }
    ] as const

    for (const outcome of outcomes) {
      const ref = conversation()
      const active = execution('turn-1', `execution-${outcome.suffix}`, `assistant-${outcome.suffix}`)
      const onFinish = vi.fn()
      const rendered = renderHook(() =>
        useExecutionOverlay(ref, [active], [assistant(active.outputNodeId)], { onFinish })
      )
      streamText(ref, active, 'text-1', 'answer')
      fake.instances.get(conversationRefKey(ref))!.settle(active, outcome.flags)
      await waitFor(() => expect(onFinish).toHaveBeenCalledOnce())
      expect(onFinish.mock.calls[0]?.[1]).toMatchObject(outcome.expected)
      rendered.unmount()
    }
  })

  it('N5 — temp topic (no anchor): overlay/liveAssistants keyed by start-chunk id', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'generated-message')
    const { result } = renderHook(() => useExecutionOverlay(ref, [active], []))
    streamText(ref, active, 'text-1', 'temporary')

    await waitFor(() => expect(textOf(result.current.overlay['generated-message'])).toBe('temporary'))
    expect(result.current.liveAssistants.at(-1)?.id).toBe('generated-message')
  })

  it('disposeOverlay drops a single settled entry by message id', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const refresh = vi.fn(async () => undefined)
    const { result } = renderHook(() =>
      useExecutionOverlay(ref, [active], [assistant('assistant-1')], { refreshOnQuiesced: refresh })
    )
    streamText(ref, active, 'text-1', 'done')
    fake.instances.get(conversationRefKey(ref))!.settle(active)
    await waitFor(() => expect(result.current.overlay['assistant-1']).toBeDefined())

    act(() => result.current.disposeOverlay('assistant-1'))

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await waitFor(() => expect(result.current.overlay['assistant-1']).toBeUndefined())
  })

  it('does NOT fire onFinish when an execution leaves activeExecutions (why the status-driven handoff exists)', async () => {
    const ref = conversation()
    const active = execution('turn-1', 'execution-1', 'assistant-1')
    const onFinish = vi.fn()
    const { rerender } = renderHook(
      ({ executions }) => useExecutionOverlay(ref, executions, [assistant('assistant-1')], { onFinish }),
      { initialProps: { executions: [active] as ConversationExecutionProjection[] } }
    )

    await act(async () => {
      rerender({ executions: [] })
      await Promise.resolve()
    })

    expect(onFinish).not.toHaveBeenCalled()
  })
})
