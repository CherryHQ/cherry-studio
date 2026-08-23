import { APPROVAL_IDLE_TIMEOUT } from '@main/ai/constants'
import type { CompactionSink } from '@shared/ai/compaction'
import {
  ConversationInteractionResumeMode,
  ConversationKind,
  ConversationOutcomeKind,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInteractionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { CherryUIMessage } from '@shared/data/types/message'
import { APICallError, readUIMessageStream, type UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

import {
  type ConversationExecutionDriverBinding,
  ConversationExecutionDriverBindingKind,
  type ConversationExecutionPreparationDescriptor,
  ConversationExecutionPreparationKind
} from '../../streamManager'
import type { AiStreamRequest } from '../../types'
import {
  AiExecutionManager as ResourceExecutionManager,
  ConversationEffectType,
  type ConversationExecutionChunk,
  type ConversationExecutionDescriptor,
  type ConversationExecutionDriver,
  type ConversationExecutionSink
} from '..'

const ref = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const turnId = toConversationTurnId('turn-1')
const executionId = toConversationExecutionId('execution-1')

type TestRequestFactory = (signal: AbortSignal, sink: CompactionSink) => Promise<AiStreamRequest>
type TestExecutionDescriptor = Omit<
  ConversationExecutionDescriptor,
  'driver' | 'preparation' | 'preparationIndex' | 'telemetry'
> & {
  readonly request: AiStreamRequest | TestRequestFactory
  readonly suspend?: () => boolean
  readonly resumeSuspended?: () => void
  readonly abortController?: AbortController
}

interface TestPreparation {
  readonly conversation: TestExecutionDescriptor['conversation']
  readonly modelId: TestExecutionDescriptor['modelId']
  readonly outputNodeId: string
  readonly request: TestExecutionDescriptor['request']
}

interface TestDriverCallbacks {
  readonly suspend?: () => boolean
  readonly resumeSuspended?: () => void
}

class TestExecutionDriver implements ConversationExecutionDriver {
  private readonly preparations = new WeakMap<object, TestPreparation>()
  private readonly callbacks = new WeakMap<object, TestDriverCallbacks>()

  register(
    preparation: ConversationExecutionPreparationDescriptor,
    driver: ConversationExecutionDriverBinding,
    descriptor: TestExecutionDescriptor
  ): void {
    this.preparations.set(preparation, descriptor)
    this.callbacks.set(driver, descriptor)
  }

  setControl(): void {}

  async prepare(
    descriptor: ConversationExecutionPreparationDescriptor,
    _driver: ConversationExecutionDriverBinding,
    signal: AbortSignal,
    sink?: CompactionSink
  ) {
    const preparation = this.preparations.get(descriptor)
    if (!preparation) throw new Error('Missing test execution preparation')
    const request =
      typeof preparation.request === 'function'
        ? await preparation.request(signal, sink ?? (() => {}))
        : preparation.request
    return {
      conversation: preparation.conversation,
      models: [
        {
          modelId: preparation.modelId,
          request: { ...request, messageId: request.messageId ?? preparation.outputNodeId }
        }
      ]
    }
  }

  openTelemetry(): undefined {
    return undefined
  }

  annotateTelemetry(): void {}

  redirect(): boolean {
    return false
  }

  suspend(driver: ConversationExecutionDriverBinding): boolean {
    return this.callbacks.get(driver)?.suspend?.() ?? false
  }

  resumeSuspended(driver: ConversationExecutionDriverBinding): void {
    this.callbacks.get(driver)?.resumeSuspended?.()
  }

  discardRuntimeBuffer(): void {}
}

class AiExecutionManager extends ResourceExecutionManager {
  private readonly testDriver: TestExecutionDriver

  constructor(openStream?: ConstructorParameters<typeof ResourceExecutionManager>[0]) {
    const driver = new TestExecutionDriver()
    super(openStream, driver)
    this.testDriver = driver
  }

  register(input: ConversationExecutionDescriptor | TestExecutionDescriptor): void {
    if (!('request' in input)) {
      super.register(input)
      return
    }
    const base: Omit<ConversationExecutionDescriptor, 'driver' | 'preparation' | 'preparationIndex'> = {
      conversation: input.conversation,
      turnId: input.turnId,
      executionId: input.executionId,
      outputNodeId: input.outputNodeId,
      modelId: input.modelId,
      observers: input.observers,
      interactionResumeMode: input.interactionResumeMode,
      ...(input.runtimeTimingSeed ? { runtimeTimingSeed: input.runtimeTimingSeed } : {}),
      ...(input.maxBufferChunks !== undefined ? { maxBufferChunks: input.maxBufferChunks } : {})
    }
    const preparation: ConversationExecutionPreparationDescriptor = {
      kind: ConversationExecutionPreparationKind.Failure,
      conversation: input.conversation,
      error: { name: 'TestPreparation', message: 'test-only driver descriptor', stack: null }
    }
    const driver: ConversationExecutionDriverBinding = { kind: ConversationExecutionDriverBindingKind.Chat }
    this.testDriver.register(preparation, driver, input)
    super.register({ ...base, preparation, preparationIndex: 0, driver })
  }
}

function controlledStream() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value
    }
  })
  return { stream, controller }
}

describe('AiExecutionManager', () => {
  it('suspends an unadmitted runtime turn without terminalizing its internal listeners', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const suspend = vi.fn(() => {
      first.controller.close()
      return true
    })
    const resumeSuspended = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      suspend,
      resumeSuspended,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )
    expect(manager.inFlightOperations().map(({ id }) => id)).toEqual([`chat:topic-1/${turnId}/${executionId}`])
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledOnce())

    expect(
      manager.suspend({
        type: ConversationEffectType.SuspendExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('suspend-1')
      })
    ).toBe(true)
    await Promise.resolve()
    expect(sink.terminal).not.toHaveBeenCalled()

    expect(() =>
      manager.resumeSuspended({
        type: ConversationEffectType.ResumeSuspendedExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('resume-stale'),
        runEffectId: toConversationEffectId('stale-run'),
        suspendEffectId: toConversationEffectId('suspend-1')
      })
    ).toThrow('Conversation execution is not suspended')

    manager.resumeSuspended({
      type: ConversationEffectType.ResumeSuspendedExecution,
      conversation: ref,
      turnId,
      executionId,
      effectId: toConversationEffectId('resume-1'),
      runEffectId: toConversationEffectId('start-1'),
      suspendEffectId: toConversationEffectId('suspend-1')
    })
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
    second.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(suspend).toHaveBeenCalledOnce()
    expect(resumeSuspended).toHaveBeenCalledOnce()
    expect(sink.terminal).toHaveBeenCalledOnce()
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
  })

  it('owns chunks and resources while returning only control facts to Conversation', async () => {
    const controlled = controlledStream()
    const chunks: ConversationExecutionChunk[] = []
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: {
        chatId: 'topic-1',
        trigger: 'submit-message',
        uniqueModelId: 'provider::model',
        messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]
      },
      observers: [{ id: 'observer-1', onChunk: (chunk) => chunks.push(chunk), isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.firstChunk).toHaveBeenCalledOnce()
    expect(chunks.map(({ chunkSeq }) => chunkSeq)).toEqual([1, 2, 3])
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
    expect(manager.result(ref, turnId, executionId)).toMatchObject({
      outputNodeId: 'assistant-1',
      outcome: { kind: ConversationOutcomeKind.Success }
    })
  })

  it('emits a generic terminal event without owning delivery persistence', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: {
        chatId: 'session-1',
        trigger: 'submit-message',
        uniqueModelId: 'provider::model',
        messages: []
      },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })

    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        turnId,
        executionId,
        effectId: toConversationEffectId('agent-terminal')
      },
      sink
    )
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.terminal).toHaveBeenCalledExactlyOnceWith({ kind: ConversationOutcomeKind.Success })
    expect(manager.result({ kind: ConversationKind.Agent, id: 'session-1' }, turnId, executionId)).toMatchObject({
      outcome: { kind: ConversationOutcomeKind.Success }
    })
  })

  it('multicasts to all alive listeners', async () => {
    const controlled = controlledStream()
    const first = vi.fn()
    const second = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [
        { id: 'first', onChunk: first, isAlive: () => true },
        { id: 'second', onChunk: second, isAlive: () => true }
      ],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-multicast')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('removes dead listeners and skips delivery to them', async () => {
    const controlled = controlledStream()
    const dead = vi.fn()
    const alive = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [
        { id: 'dead', onChunk: dead, isAlive: () => false },
        { id: 'alive', onChunk: alive, isAlive: () => true }
      ],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-dead-observer')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'live' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(dead).not.toHaveBeenCalled()
    expect(alive).toHaveBeenCalledTimes(2)
  })

  it('does not deliver to a non-streaming topic', async () => {
    const controlled = controlledStream()
    const observer = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-other-topic')
      },
      sink
    )
    expect(
      manager.attachSnapshot({ kind: ConversationKind.Chat, id: 'topic-2' }, turnId, {
        id: 'other-topic',
        onChunk: observer,
        isAlive: () => true
      })
    ).toEqual([])

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(observer).not.toHaveBeenCalled()
  })

  it('isolates listener errors — one throw does not block others', async () => {
    const controlled = controlledStream()
    const failing = vi.fn(() => {
      throw new Error('renderer gone')
    })
    const surviving = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [
        { id: 'failing', onChunk: failing, isAlive: () => true },
        { id: 'surviving', onChunk: surviving, isAlive: () => true }
      ],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-observer-isolation')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'still streams' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(failing).toHaveBeenCalledOnce()
    expect(surviving).toHaveBeenCalledTimes(2)
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
  })

  it('removeListener prevents further delivery', async () => {
    const controlled = controlledStream()
    const observer = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'renderer', onChunk: observer, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-detach-observer')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    await vi.waitFor(() => expect(observer).toHaveBeenCalledOnce())
    manager.detach(ref, 'renderer')
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'background' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(observer).toHaveBeenCalledOnce()
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
  })

  it('upserts listeners onto a live stream without calling streamText again', async () => {
    const controlled = controlledStream()
    const openStream = vi.fn(async () => controlled.stream)
    const original = vi.fn()
    const replacement = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'renderer', onChunk: original, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-observer-upsert')
      },
      sink
    )
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledOnce())

    manager.observe(ref, turnId, { id: 'renderer', onChunk: replacement, isAlive: () => true })
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(openStream).toHaveBeenCalledOnce()
    expect(original).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledOnce()
  })

  it('upserts an agent-session follow-up subscriber without restarting the stream', async () => {
    const agentRef = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const controlled = controlledStream()
    const openStream = vi.fn(async () => controlled.stream)
    const original = vi.fn()
    const replacement = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: agentRef,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'session-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'renderer', onChunk: original, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: agentRef,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-agent-observer-upsert')
      },
      sink
    )
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledOnce())

    manager.observe(agentRef, turnId, { id: 'renderer', onChunk: replacement, isAlive: () => true })
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(openStream).toHaveBeenCalledOnce()
    expect(original).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledOnce()
  })

  it('releases the manager-owned agent resource for a pre-stream stop request', () => {
    const manager = new AiExecutionManager()
    manager.register({
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'session-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })

    manager.abort({
      type: ConversationEffectType.AbortExecution,
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId,
      executionId,
      effectId: toConversationEffectId('abort-before-start'),
      reason: 'user-stop'
    })

    expect(() =>
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          turnId,
          executionId,
          effectId: toConversationEffectId('start-after-stop')
        },
        {
          firstChunk: vi.fn(),
          interactionOpened: vi.fn(),
          interactionCompleted: vi.fn(),
          terminal: vi.fn(),
          startFailed: vi.fn()
        }
      )
    ).toThrow('Conversation execution is not registered')
  })

  it('does not apply an old pre-stream stop request to a new manager-owned agent resource', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    const conversation = { kind: ConversationKind.Agent, id: 'session-1' } as const
    manager.register({
      conversation,
      turnId,
      executionId,
      outputNodeId: 'assistant-old',
      modelId: 'provider::model',
      request: { chatId: 'session-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })
    manager.abort({
      type: ConversationEffectType.AbortExecution,
      conversation,
      turnId,
      executionId,
      effectId: toConversationEffectId('abort-old'),
      reason: 'old-stop'
    })
    const nextTurnId = toConversationTurnId('turn-2')
    const nextExecutionId = toConversationExecutionId('execution-2')
    let nextSignal: AbortSignal | undefined
    manager.register({
      conversation,
      turnId: nextTurnId,
      executionId: nextExecutionId,
      outputNodeId: 'assistant-new',
      modelId: 'provider::model',
      request: async (signal) => {
        nextSignal = signal
        return { chatId: 'session-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] }
      },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation,
        turnId: nextTurnId,
        executionId: nextExecutionId,
        effectId: toConversationEffectId('start-new')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )
    await vi.waitFor(() => expect(nextSignal).toBeDefined())

    manager.abort({
      type: ConversationEffectType.AbortExecution,
      conversation,
      turnId,
      executionId,
      effectId: toConversationEffectId('late-abort-old'),
      reason: 'late-old-stop'
    })

    expect(nextSignal?.aborted).toBe(false)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('does not affect non-streaming topics', async () => {
    const controlled = controlledStream()
    let exactSignal: AbortSignal | undefined
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: async (signal) => {
        exactSignal = signal
        return { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] }
      },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-wrong-topic-abort')
      },
      sink
    )

    manager.abort({
      type: ConversationEffectType.AbortExecution,
      conversation: { kind: ConversationKind.Chat, id: 'topic-2' },
      turnId,
      executionId,
      effectId: toConversationEffectId('abort-wrong-topic'),
      reason: 'wrong-topic'
    })

    await vi.waitFor(() => expect(exactSignal).toBeDefined())
    expect(exactSignal?.aborted).toBe(false)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('tags every chunk with its sourceModelId (single- and multi-model)', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const firstChunk = vi.fn()
    const secondChunk = vi.fn()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'renderer-1', onChunk: firstChunk, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-chunk-identity')
      },
      sink
    )
    const secondExecutionId = toConversationExecutionId('execution-2')
    manager.register({
      conversation: ref,
      turnId,
      executionId: secondExecutionId,
      outputNodeId: 'assistant-2',
      modelId: 'provider::other-model',
      request: {
        chatId: 'topic-1',
        trigger: 'submit-message',
        uniqueModelId: 'provider::other-model',
        messages: []
      },
      observers: [{ id: 'renderer-2', onChunk: secondChunk, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId: secondExecutionId,
        effectId: toConversationEffectId('start-second-chunk-identity')
      },
      sink
    )

    first.controller.enqueue({ type: 'text-start', id: 'text-1' })
    second.controller.enqueue({ type: 'text-start', id: 'text-2' })
    first.controller.close()
    second.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(firstChunk).toHaveBeenCalledWith(
      expect.objectContaining({ conversation: ref, turnId, executionId, modelId: 'provider::model' })
    )
    expect(secondChunk).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: ref,
        turnId,
        executionId: secondExecutionId,
        modelId: 'provider::other-model'
      })
    )
  })

  it('tags single-model chunks consistently after the transitional flag was removed', async () => {
    const controlled = controlledStream()
    const onChunk = vi.fn()
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'renderer', onChunk, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-single-model-identity')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'provider::model' }))
  })

  it('writes exec.finalMessage via the accumulator before the terminal event fires', async () => {
    const controlled = controlledStream()
    const terminal = vi.fn(() => {
      expect(manager.result(ref, turnId, executionId)?.finalMessage?.parts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'complete' })])
      )
    })
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal,
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-final-message-order')
      },
      sink
    )

    controlled.controller.enqueue({ type: 'start', messageId: 'assistant-1' } as UIMessageChunk)
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'complete' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    controlled.controller.enqueue({ type: 'finish' } as UIMessageChunk)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(terminal).toHaveBeenCalledOnce()
  })

  it('uses the anchor message id when execution errors before receiving chunks', async () => {
    const manager = new AiExecutionManager(async () => {
      throw new Error('provider unavailable')
    })
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-anchor',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-before-chunk-error')
      },
      sink
    )
    await Promise.all(manager.inFlightRuns())

    expect(manager.result(ref, turnId, executionId)).toMatchObject({
      outputNodeId: 'assistant-anchor',
      outcome: { kind: ConversationOutcomeKind.Error }
    })
    expect(sink.firstChunk).not.toHaveBeenCalled()
  })

  it('uses a private resource fence and exact identity for abort', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )
    manager.abort({
      type: ConversationEffectType.AbortExecution,
      conversation: ref,
      turnId,
      executionId,
      effectId: toConversationEffectId('abort-1'),
      reason: 'user-stop'
    })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Paused, reason: 'user-stop' })
  })

  it('reports approval as a typed interaction instead of changing business state itself', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-1')
      },
      sink
    )
    controlled.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as UIMessageChunk)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.interactionOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval-1', executionId }))
  })

  it('clears awaiting-approval when a tool-output chunk resolves the approval before terminal', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-live-interaction')
      },
      sink
    )

    controlled.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    })
    controlled.controller.enqueue({
      type: 'tool-output-available',
      toolCallId: 'tool-1',
      output: { ok: true }
    })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.interactionOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'approval-1', executionId }))
    expect(sink.interactionCompleted).toHaveBeenCalledWith(toConversationInteractionId('approval-1'))
    expect(sink.terminal).toHaveBeenCalledWith({ kind: ConversationOutcomeKind.Success })
    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'approval-replay',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay.chunks.map(({ chunk }) => chunk.type)).toEqual(['tool-output-available'])
  })

  it('does not publish automatically approved tool execution', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-auto-approved-tool')
      },
      sink
    )

    controlled.controller.enqueue({
      type: 'tool-input-available',
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      input: {}
    } as UIMessageChunk)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(sink.interactionOpened).not.toHaveBeenCalled()
  })

  it('routes turn-start compaction through the exact execution observer', async () => {
    const controlled = controlledStream()
    const chunks: ConversationExecutionChunk[] = []
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: async (_signal, compactionSink) => {
        compactionSink('anchor-1', {
          status: 'compacting',
          phase: 'turn-start',
          startedAt: new Date().toISOString()
        })
        return { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] }
      },
      observers: [{ id: 'observer-1', onChunk: (chunk) => chunks.push(chunk), isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-compaction')
      },
      sink
    )

    await vi.waitFor(() => expect(chunks).toHaveLength(1))
    expect(chunks[0]).toMatchObject({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      chunk: { type: 'data-compaction-anchor', id: 'anchor-1' }
    })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('drops preparation callbacks after the exact execution resource is released', async () => {
    let releasePreparation!: () => void
    let compactionSink!: CompactionSink
    const preparation = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const observer = vi.fn()
    const openStream = vi.fn(async () => controlledStream().stream)
    const manager = new AiExecutionManager(openStream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: async (_signal, sink) => {
        compactionSink = sink
        await preparation
        return { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] }
      },
      observers: [{ id: 'observer-1', onChunk: observer, isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-stale')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )
    await vi.waitFor(() => expect(compactionSink).toBeTypeOf('function'))

    manager.release(ref, turnId, executionId)
    compactionSink('late-anchor', {
      status: 'done',
      phase: 'turn-start',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    })
    releasePreparation()
    await Promise.all(manager.inFlightRuns())

    expect(observer).not.toHaveBeenCalled()
    expect(openStream).not.toHaveBeenCalled()
  })

  it('pauses the idle timer while a tool is awaiting approval — a long deliberation is not killed', async () => {
    vi.useFakeTimers()
    try {
      const controlled = controlledStream()
      let requestSignal: AbortSignal | undefined
      const sink: ConversationExecutionSink = {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
      const manager = new AiExecutionManager(async (request) => {
        requestSignal = (request.requestOptions as { signal?: AbortSignal } | undefined)?.signal
        return controlled.stream
      })
      manager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: 'assistant-1',
        modelId: 'provider::model',
        request: {
          chatId: 'topic-1',
          trigger: 'submit-message',
          uniqueModelId: 'provider::model',
          messages: [],
          requestOptions: { timeout: 10_000 }
        },
        observers: [],
        interactionResumeMode: ConversationInteractionResumeMode.InPlace
      })
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: ref,
          turnId,
          executionId,
          effectId: toConversationEffectId('start-approval-timeout')
        },
        sink
      )
      await vi.waitFor(() => expect(requestSignal).toBeDefined())
      controlled.controller.enqueue({
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        toolCallId: 'tool-1'
      } as UIMessageChunk)
      await vi.waitFor(() => expect(sink.interactionOpened).toHaveBeenCalledOnce())

      await vi.advanceTimersByTimeAsync(15_000)
      expect(requestSignal?.aborted).toBe(false)

      manager.resume({
        type: ConversationEffectType.ResumeExecution,
        conversation: ref,
        turnId,
        executionId,
        interactionId: toConversationInteractionId('approval-1'),
        effectId: toConversationEffectId('resume-approval')
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(requestSignal?.aborted).toBe(true)
      await Promise.all(manager.inFlightRuns())
    } finally {
      vi.useRealTimers()
    }
  })

  it('still bounds an approval wait — an unresponsive renderer is aborted after the approval timeout', async () => {
    vi.useFakeTimers()
    try {
      const controlled = controlledStream()
      let requestSignal: AbortSignal | undefined
      const sink: ConversationExecutionSink = {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
      const manager = new AiExecutionManager(async (request) => {
        requestSignal = (request.requestOptions as { signal?: AbortSignal } | undefined)?.signal
        return controlled.stream
      })
      manager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: 'assistant-1',
        modelId: 'provider::model',
        request: {
          chatId: 'topic-1',
          trigger: 'submit-message',
          uniqueModelId: 'provider::model',
          messages: [],
          requestOptions: { timeout: 10_000 }
        },
        observers: [],
        interactionResumeMode: ConversationInteractionResumeMode.InPlace
      })
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: ref,
          turnId,
          executionId,
          effectId: toConversationEffectId('start-bounded-approval')
        },
        sink
      )
      await vi.waitFor(() => expect(requestSignal).toBeDefined())
      controlled.controller.enqueue({
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        toolCallId: 'tool-1'
      } as UIMessageChunk)
      await vi.advanceTimersByTimeAsync(0)
      expect(sink.interactionOpened).toHaveBeenCalledOnce()

      await vi.advanceTimersByTimeAsync(APPROVAL_IDLE_TIMEOUT - 1)
      expect(requestSignal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(requestSignal?.aborted).toBe(true)
      await Promise.all(manager.inFlightRuns())
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a timed-out execution as paused, not done', async () => {
    vi.useFakeTimers()
    try {
      const sink: ConversationExecutionSink = {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
      const manager = new AiExecutionManager(async (request) => {
        const signal = (request.requestOptions as { signal?: AbortSignal } | undefined)?.signal
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            signal?.addEventListener('abort', () => controller.close(), { once: true })
          }
        })
      })
      manager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: 'assistant-1',
        modelId: 'provider::model',
        request: {
          chatId: 'topic-1',
          trigger: 'submit-message',
          uniqueModelId: 'provider::model',
          messages: [],
          requestOptions: { timeout: 10 }
        },
        observers: [],
        interactionResumeMode: ConversationInteractionResumeMode.NewRun
      })
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: ref,
          turnId,
          executionId,
          effectId: toConversationEffectId('start-idle-timeout')
        },
        sink
      )

      await vi.advanceTimersByTimeAsync(9)
      expect(sink.terminal).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all(manager.inFlightRuns())

      expect(sink.terminal).toHaveBeenCalledOnce()
      expect(sink.terminal).toHaveBeenCalledWith(expect.objectContaining({ kind: ConversationOutcomeKind.Paused }))
      expect(manager.result(ref, turnId, executionId)?.outcome.kind).toBe(ConversationOutcomeKind.Paused)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the approval idle window while any parallel interaction remains unresolved', async () => {
    vi.useFakeTimers()
    try {
      const controlled = controlledStream()
      let requestSignal: AbortSignal | undefined
      const sink: ConversationExecutionSink = {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
      const manager = new AiExecutionManager(async (request) => {
        requestSignal = (request.requestOptions as { signal?: AbortSignal } | undefined)?.signal
        return controlled.stream
      })
      manager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: 'assistant-1',
        modelId: 'provider::model',
        request: {
          chatId: 'topic-1',
          trigger: 'submit-message',
          uniqueModelId: 'provider::model',
          messages: [],
          requestOptions: { timeout: 10_000 }
        },
        observers: [],
        interactionResumeMode: ConversationInteractionResumeMode.InPlace
      })
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: ref,
          turnId,
          executionId,
          effectId: toConversationEffectId('start-parallel-approval')
        },
        sink
      )
      await vi.waitFor(() => expect(requestSignal).toBeDefined())
      for (const id of ['approval-1', 'approval-2']) {
        controlled.controller.enqueue({
          type: 'tool-approval-request',
          approvalId: id,
          toolCallId: `tool-${id}`
        } as UIMessageChunk)
      }
      await vi.waitFor(() => expect(sink.interactionOpened).toHaveBeenCalledTimes(2))

      manager.resume({
        type: ConversationEffectType.ResumeExecution,
        conversation: ref,
        turnId,
        executionId,
        interactionId: toConversationInteractionId('approval-1'),
        effectId: toConversationEffectId('resume-approval-1')
      })
      controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'still waiting' })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(requestSignal?.aborted).toBe(false)

      manager.resume({
        type: ConversationEffectType.ResumeExecution,
        conversation: ref,
        turnId,
        executionId,
        interactionId: toConversationInteractionId('approval-2'),
        effectId: toConversationEffectId('resume-approval-2')
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(requestSignal?.aborted).toBe(true)
      await Promise.all(manager.inFlightRuns())
    } finally {
      vi.useRealTimers()
    }
  })

  it('attach returns compact replay chunks', async () => {
    const controlled = controlledStream()
    const initialChunks: ConversationExecutionChunk[] = []
    const attachedChunks: ConversationExecutionChunk[] = []
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [{ id: 'initial', onChunk: (chunk) => initialChunks.push(chunk), isAlive: () => true }],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-replay')
      },
      sink
    )
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'hello ' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'world' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    await vi.waitFor(() => expect(initialChunks).toHaveLength(4))

    const staleObserver = vi.fn()
    expect(
      manager.attachSnapshot(ref, toConversationTurnId('old-turn'), {
        id: 'stale',
        onChunk: staleObserver,
        isAlive: () => true
      })
    ).toEqual([])

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: (chunk) => attachedChunks.push(chunk),
      isAlive: () => true
    })
    expect(snapshot.replay).toMatchObject({
      throughChunkSeq: 4,
      firstAvailableChunkSeq: 1,
      truncated: false
    })
    expect(snapshot.replay.chunks).toMatchObject([
      { chunkSeq: 1, throughChunkSeq: 1, chunk: { type: 'text-start' } },
      { chunkSeq: 2, throughChunkSeq: 3, chunk: { type: 'text-delta', delta: 'hello world' } },
      { chunkSeq: 4, throughChunkSeq: 4, chunk: { type: 'text-end' } }
    ])

    const [cursorSnapshot] = manager.attachSnapshot(
      ref,
      turnId,
      { id: 'cursor', onChunk: vi.fn(), isAlive: () => true },
      [{ turnId, executionId, throughChunkSeq: 2 }]
    )
    expect(cursorSnapshot.replay).toMatchObject({ throughChunkSeq: 4, truncated: false })
    expect(cursorSnapshot.replay.chunks).toMatchObject([
      { chunkSeq: 3, throughChunkSeq: 3, chunk: { type: 'text-delta', delta: 'world' } },
      { chunkSeq: 4, throughChunkSeq: 4, chunk: { type: 'text-end' } }
    ])

    controlled.controller.enqueue({ type: 'text-start', id: 'text-2' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
    expect(staleObserver).not.toHaveBeenCalled()
    expect(attachedChunks).toHaveLength(1)
    expect(attachedChunks[0]?.chunkSeq).toBe(5)
  })

  it('buffers chunks and replays to late-joining listener', async () => {
    const controlled = controlledStream()
    const lateChunks: ConversationExecutionChunk[] = []
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-late-listener')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'history' })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(2)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'late-listener',
      onChunk: (chunk) => lateChunks.push(chunk),
      isAlive: () => true
    })
    expect(snapshot.replay.chunks.map(({ chunk }) => chunk.type)).toEqual(['text-start', 'text-delta'])

    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
    expect(lateChunks).toEqual([expect.objectContaining({ chunk: { type: 'text-end', id: 'text-1' } })])
  })

  it('pauses ring eviction while an approval is pending and resumes once it resolves', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 2,
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-approval-eviction')
      },
      sink
    )
    controlled.controller.enqueue({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'search',
      input: { query: 'Cherry Studio' }
    })
    controlled.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as UIMessageChunk)
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    await vi.waitFor(() => expect(sink.interactionOpened).toHaveBeenCalledOnce())

    const [pending] = manager.attachSnapshot(ref, turnId, {
      id: 'pending',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(pending.replay.chunks.map(({ chunk }) => chunk.type)).toContain('tool-input-available')
    expect(pending.replay.chunks.map(({ chunk }) => chunk.type)).toContain('tool-approval-request')

    manager.resume({
      type: ConversationEffectType.ResumeExecution,
      conversation: ref,
      turnId,
      executionId,
      interactionId: toConversationInteractionId('approval-1'),
      effectId: toConversationEffectId('resume-approval-eviction')
    })
    const [resolved] = manager.attachSnapshot(ref, turnId, {
      id: 'resolved',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(resolved.replay.chunks.map(({ chunk }) => chunk.type)).not.toContain('tool-approval-request')
    expect(resolved.replay.truncated).toBe(true)

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('bounds raw provider events and repairs an evicted opener only when building replay', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 3,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-delta-flood')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    for (const delta of ['0', '1', '2', '3', '4']) {
      controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta })
    }
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(6)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay).toMatchObject({ firstAvailableChunkSeq: 4, throughChunkSeq: 6, truncated: true })
    expect(snapshot.replay.chunks).toMatchObject([
      { chunk: { type: 'text-start', id: 'text-1' } },
      { chunk: { type: 'text-delta', id: 'text-1', delta: '234' } }
    ])

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('replays a post-eviction buffer that the real readUIMessageStream accepts', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 4,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-post-eviction-replay')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )

    controlled.controller.enqueue({ type: 'reasoning-start', id: 'reasoning-1' })
    for (const delta of ['thinking ', 'in ', 'pieces']) {
      controlled.controller.enqueue({ type: 'reasoning-delta', id: 'reasoning-1', delta })
    }
    controlled.controller.enqueue({ type: 'reasoning-end', id: 'reasoning-1' })
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'answer' })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(7)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay.truncated).toBe(true)
    const errors: unknown[] = []
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const { chunk } of snapshot.replay.chunks) controller.enqueue(chunk)
        controller.close()
      }
    })
    let message: CherryUIMessage | undefined
    for await (const current of readUIMessageStream<CherryUIMessage>({
      stream,
      terminateOnError: false,
      onError: (error) => errors.push(error)
    })) {
      message = current
    }

    expect(errors).toEqual([])
    expect(message?.parts).toMatchObject([
      { type: 'reasoning', text: 'pieces', state: 'done' },
      { type: 'text', text: 'answer', state: 'streaming' }
    ])

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('bounds replay delta segments without treating one provider event as several ring entries', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 2,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-oversized-delta')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )

    const segmentBytes = 16 * 1024
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({
      type: 'text-delta',
      id: 'text-1',
      delta: 'a'.repeat(segmentBytes) + 'b'.repeat(segmentBytes) + 'c'.repeat(segmentBytes)
    })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(2)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay.truncated).toBe(false)
    expect(snapshot.replay.chunks.map(({ chunk }) => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-delta'
    ])
    expect(snapshot.replay.chunks.slice(1).map(({ chunk }) => ('delta' in chunk ? chunk.delta : undefined))).toEqual([
      'a'.repeat(segmentBytes),
      'b'.repeat(segmentBytes),
      'c'.repeat(segmentBytes)
    ])

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('splits UTF-8 tool deltas at 16 KiB without breaking code points', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-tool-utf8')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )

    const inputTextDelta = '😀'.repeat(9_000)
    controlled.controller.enqueue({ type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'test-tool' })
    controlled.controller.enqueue({
      type: 'tool-input-delta',
      toolCallId: 'tool-1',
      inputTextDelta
    })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(2)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    const deltas = snapshot.replay.chunks.flatMap(({ chunk }) =>
      chunk.type === 'tool-input-delta' ? [chunk.inputTextDelta] : []
    )
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.every((delta) => Buffer.byteLength(delta, 'utf8') <= 16 * 1024)).toBe(true)
    expect(deltas.join('')).toBe(inputTextDelta)

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('retains at most 10,000 raw provider events before replay compaction', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 20_000,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-raw-ring-bound')
      },
      {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    for (let index = 0; index < 10_001; index += 1) {
      controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'x' })
    }
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(10_002)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay).toMatchObject({
      firstAvailableChunkSeq: 3,
      throughChunkSeq: 10_002,
      truncated: true
    })

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('per-execution ring buffer drops oldest chunk on overflow and tracks droppedChunks', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 2,
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-truncated')
      },
      sink
    )
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'answer' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(3)
    )

    const [snapshot] = manager.attachSnapshot(ref, turnId, {
      id: 'attached',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(snapshot.replay).toMatchObject({ firstAvailableChunkSeq: 2, throughChunkSeq: 3, truncated: true })
    expect(snapshot.replay.chunks.map(({ chunk }) => chunk.type)).toEqual(['text-start', 'text-delta', 'text-end'])
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('attaches when the surviving ring contains a complete pending approval', async () => {
    const controlled = controlledStream()
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    const manager = new AiExecutionManager(async () => controlled.stream)
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      maxBufferChunks: 3,
      interactionResumeMode: ConversationInteractionResumeMode.InPlace
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-approval-replay')
      },
      sink
    )
    controlled.controller.enqueue({
      type: 'tool-input-available',
      toolCallId: 'tool-1',
      toolName: 'search',
      input: { query: 'Cherry Studio' }
    })
    controlled.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as UIMessageChunk)
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'after approval' })
    await vi.waitFor(() => expect(sink.interactionOpened).toHaveBeenCalledOnce())

    const [pending] = manager.attachSnapshot(ref, turnId, {
      id: 'pending-approval',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(pending.replay.chunks.map(({ chunk }) => chunk.type)).toEqual([
      'tool-input-available',
      'tool-approval-request',
      'text-start',
      'text-delta'
    ])

    manager.resume({
      type: ConversationEffectType.ResumeExecution,
      conversation: ref,
      turnId,
      executionId,
      interactionId: toConversationInteractionId('approval-1'),
      effectId: toConversationEffectId('resume-approval-replay')
    })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    await vi.waitFor(() =>
      expect(
        manager.attachSnapshot(ref, turnId, { id: 'probe-resolved', onChunk: vi.fn(), isAlive: () => true })[0]?.replay
          .throughChunkSeq
      ).toBe(5)
    )
    const [resolved] = manager.attachSnapshot(ref, turnId, {
      id: 'resolved-approval',
      onChunk: vi.fn(),
      isAlive: () => true
    })
    expect(resolved.replay.chunks.map(({ chunk }) => chunk.type)).toEqual([
      'tool-input-available',
      'text-start',
      'text-delta',
      'text-end'
    ])

    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it.each([
    { statusCode: 400, isRetryable: false, message: 'Maximum context length exceeded' },
    { statusCode: 503, isRetryable: true, message: 'Upstream unavailable' }
  ])(
    'serializes API error status $statusCode and retryability from a rejecting stream',
    async ({ statusCode, isRetryable, message }) => {
      const apiError = new APICallError({
        message,
        url: 'https://api.example.com/chat/completions',
        requestBodyValues: {},
        statusCode,
        responseHeaders: {},
        responseBody: '',
        isRetryable
      })
      const manager = new AiExecutionManager(
        async () =>
          new ReadableStream<UIMessageChunk>({
            start(controller) {
              controller.error(apiError)
            }
          })
      )
      const sink: ConversationExecutionSink = {
        firstChunk: vi.fn(),
        interactionOpened: vi.fn(),
        interactionCompleted: vi.fn(),
        terminal: vi.fn(),
        startFailed: vi.fn()
      }
      manager.register({
        conversation: ref,
        turnId,
        executionId,
        outputNodeId: 'assistant-1',
        modelId: 'provider::model',
        request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
        observers: [],
        interactionResumeMode: ConversationInteractionResumeMode.NewRun
      })
      manager.start(
        {
          type: ConversationEffectType.StartExecution,
          conversation: ref,
          turnId,
          executionId,
          effectId: toConversationEffectId('start-api-error')
        },
        sink
      )

      await Promise.all(manager.inFlightRuns())

      expect(manager.result(ref, turnId, executionId)?.outcome).toMatchObject({
        kind: ConversationOutcomeKind.Error,
        error: { statusCode, isRetryable, message }
      })
    }
  )

  it('routes a terminal error chunk through onExecutionError with the translated stream error', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-stream-error')
      },
      sink
    )
    controlled.controller.enqueue({ type: 'error', errorText: 'boom' } as UIMessageChunk)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    expect(manager.result(ref, turnId, executionId)?.outcome).toEqual({
      kind: ConversationOutcomeKind.Error,
      error: { name: 'StreamError', message: 'boom', stack: null }
    })
  })

  it('keeps the thrown error when a lossy error chunk precedes it', async () => {
    const apiError = new APICallError({
      message: 'Forbidden',
      url: 'https://api.example.com/chat/completions',
      requestBodyValues: {},
      statusCode: 403,
      responseHeaders: {},
      responseBody: '{"detail":"no access"}',
      isRetryable: false
    })
    let pulls = 0
    const manager = new AiExecutionManager(
      async () =>
        new ReadableStream<UIMessageChunk>({
          pull(controller) {
            pulls += 1
            if (pulls === 1) controller.enqueue({ type: 'error', errorText: 'Forbidden' } as UIMessageChunk)
            else controller.error(apiError)
          }
        })
    )
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-lossy-error')
      },
      sink
    )
    await Promise.all(manager.inFlightRuns())

    expect(manager.result(ref, turnId, executionId)?.outcome).toMatchObject({
      kind: ConversationOutcomeKind.Error,
      error: { statusCode: 403, responseBody: '{"detail":"no access"}' }
    })
  })

  it('does not treat an undefined stream rejection as successful completion', async () => {
    const manager = new AiExecutionManager(
      async () =>
        new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.error(undefined)
          }
        })
    )
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-undefined-error')
      },
      sink
    )
    await Promise.all(manager.inFlightRuns())

    expect(manager.result(ref, turnId, executionId)?.outcome).toMatchObject({
      kind: ConversationOutcomeKind.Error,
      error: { message: 'undefined' }
    })
  })

  it('retains only outputs large enough to have been stripped on the way out', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-output-threshold')
      },
      sink
    )

    controlled.controller.enqueue({
      type: 'tool-output-available',
      toolCallId: 'small',
      output: { content: 'tiny' }
    } as UIMessageChunk)
    controlled.controller.enqueue({
      type: 'tool-output-available',
      toolCallId: 'large',
      output: { content: 'large:'.padEnd(64 * 1024, 'x') }
    } as UIMessageChunk)
    await vi.waitFor(() => expect(manager.deferredOutput(ref, 'assistant-1', 'large')).toMatchObject({ found: true }))

    expect(manager.deferredOutput(ref, 'assistant-1', 'small')).toEqual({ found: false })
    expect(manager.deferredOutput(ref, 'assistant-other', 'large')).toEqual({ found: false })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('evicts the oldest retained output instead of growing without bound', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-1',
      modelId: 'provider::model',
      request: { chatId: 'topic-1', trigger: 'submit-message', uniqueModelId: 'provider::model', messages: [] },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-deferred-output')
      },
      sink
    )

    controlled.controller.enqueue({
      type: 'tool-output-available',
      toolCallId: 'small',
      output: { content: 'tiny' }
    } as UIMessageChunk)
    for (let index = 0; index < 17; index += 1) {
      controlled.controller.enqueue({
        type: 'tool-output-available',
        toolCallId: `large-${index}`,
        output: { content: `${index}:`.padEnd(64 * 1024, 'x') }
      } as UIMessageChunk)
    }
    await vi.waitFor(() =>
      expect(manager.deferredOutput(ref, 'assistant-1', 'large-16')).toMatchObject({ found: true })
    )

    expect(manager.deferredOutput(ref, 'assistant-1', 'small')).toEqual({ found: false })
    expect(manager.deferredOutput(ref, 'assistant-1', 'large-0')).toEqual({ found: false })
    expect(manager.deferredOutput(ref, 'assistant-1', 'large-1')).toMatchObject({ found: true })
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())
  })

  it('seeds the accumulator from a trailing assistant message so finalMessage accumulates', async () => {
    const controlled = controlledStream()
    const resumedAssistant = {
      id: 'assistant-resume',
      role: 'assistant',
      parts: [
        {
          type: 'tool-myTool',
          toolCallId: 'tool-1',
          state: 'input-available',
          input: { query: 'x' }
        }
      ]
    } as unknown as CherryUIMessage
    const manager = new AiExecutionManager(async () => controlled.stream)
    const sink: ConversationExecutionSink = {
      firstChunk: vi.fn(),
      interactionOpened: vi.fn(),
      interactionCompleted: vi.fn(),
      terminal: vi.fn(),
      startFailed: vi.fn()
    }
    manager.register({
      conversation: ref,
      turnId,
      executionId,
      outputNodeId: 'assistant-resume',
      modelId: 'provider::model',
      request: {
        chatId: 'topic-1',
        trigger: 'submit-message',
        uniqueModelId: 'provider::model',
        messages: [resumedAssistant]
      },
      observers: [],
      interactionResumeMode: ConversationInteractionResumeMode.NewRun
    })
    manager.start(
      {
        type: ConversationEffectType.StartExecution,
        conversation: ref,
        turnId,
        executionId,
        effectId: toConversationEffectId('start-continuation')
      },
      sink
    )
    controlled.controller.enqueue({ type: 'start', messageId: 'assistant-resume' } as UIMessageChunk)
    controlled.controller.enqueue({
      type: 'tool-output-available',
      toolCallId: 'tool-1',
      output: { ok: true }
    } as UIMessageChunk)
    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    controlled.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'continued' })
    controlled.controller.enqueue({ type: 'text-end', id: 'text-1' })
    controlled.controller.enqueue({ type: 'finish' } as UIMessageChunk)
    controlled.controller.close()
    await Promise.all(manager.inFlightRuns())

    const parts = manager.result(ref, turnId, executionId)?.finalMessage?.parts ?? []
    expect(parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'tool-myTool', state: 'output-available' }),
        expect.objectContaining({ type: 'text', text: 'continued' })
      ])
    )
  })
})
