import { BaseService } from '@main/core/lifecycle'
import {
  ConversationActiveNodeMove,
  ConversationActivityKind,
  ConversationAttachStatus,
  ConversationContinuationTrigger,
  ConversationExecutionAttachState,
  ConversationExecutionPhase,
  ConversationInboxMutationKind,
  ConversationInputTarget,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  ConversationPhase,
  ConversationStatus,
  ConversationStreamTerminalStatus,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInputId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import type { SerializedError } from '@shared/types/error'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentRuntimeRedirectReceiptKind, toAgentRuntimeRedirectId, toAgentRuntimeSegmentId } from '../../runtime/types'
import type {
  ConversationExecutionContext,
  ConversationExecutionDriverBinding,
  ConversationExecutionPreparationDescriptor,
  ConversationHistoryPort as RuntimeConversationHistoryPort,
  ConversationTerminalPersistenceDescriptor,
  MainDispatchRequest,
  StreamCleanupPort,
  StreamListener,
  ValidatedConversationIntent
} from '../../streamManager'
import {
  type CommittedConversationIntent,
  ConversationExecutionDriverBindingKind,
  ConversationExecutionMutationKind,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  ConversationInteractionCommitResultKind,
  ConversationPostCommitTaskKind,
  ConversationTerminalPersistenceKind,
  type ValidatedConversationInputFailure
} from '../../streamManager/context/ConversationHistoryPort'
import {
  AiExecutionManager as ResourceExecutionManager,
  type ConversationActor,
  type ConversationExecutionDriver,
  ConversationExecutionDriverKind,
  ConversationInputProvenance,
  type ConversationNamingTaskExecutor,
  type ConversationQuiescenceTaskExecutor,
  ConversationResponderKind,
  ConversationRunMode,
  ConversationRuntimeService as RuntimeConversationRuntimeService
} from '..'
import { AgentRedirectBindingPhase } from '../ConversationBindingRegistry'
import { type ConversationRedirectInput, ConversationRedirectPhase } from '../conversationState'

type ConversationHistoryPort = Omit<RuntimeConversationHistoryPort, 'persistTerminal' | 'prepareExecutionContext'>

const services = vi.hoisted(() => ({
  cache: { getShared: vi.fn(), setShared: vi.fn() },
  agentConnection: { describeConversationAutonomous: vi.fn(), redirectConversationInput: vi.fn() }
}))
vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => (name === 'AgentConnectionManager' ? services.agentConnection : services.cache))
  }
}))
vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    maybeRenameFromFirstUserMessage: vi.fn(),
    maybeRenameAgentSessionFromFirstUserMessage: vi.fn(),
    maybeRenameFromConversationSummary: vi.fn(),
    maybeRenameAgentSession: vi.fn()
  }
}))

const modelId = createUniqueModelId('provider', 'model')
const ref = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const cacheValues = new Map<string, unknown>()

function controlledStream() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value
    }
  })
  return { stream, controller }
}

function listener(): StreamListener {
  return {
    id: 'listener-1',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

function request(text = 'hello'): MainDispatchRequest {
  return {
    trigger: ConversationOpenTrigger.SubmitMessage,
    conversation: ref,
    userMessageParts: [{ type: 'text', text }]
  }
}

function queuedRequest(text: string): MainDispatchRequest {
  const userMessageParts = [{ type: 'text' as const, text }]
  return {
    trigger: ConversationOpenTrigger.SubmitMessage,
    conversation: ref,
    userMessageParts,
    inputTarget: ConversationInputTarget.NextTurn,
    inboxPresentation: {
      draft: { text, tokens: [] },
      payload: { text, userMessageParts }
    }
  }
}

function validation(req: MainDispatchRequest, hasLiveStream: boolean): ValidatedConversationIntent {
  return {
    kind: ConversationHistoryAdapterKind.PersistentChat,
    request: req,
    context: { hasLiveStream },
    executionModelIds: hasLiveStream ? [] : [modelId],
    resolvedModels: [],
    inputModelId: modelId
  }
}

function committed(
  hasLiveStream: boolean,
  options: {
    prepareExecutionContext?: TestPrepareExecution
    persistence?: StreamListener
    cleanup?: StreamCleanupPort
    postCommitTask?: CommittedConversationIntent['postCommitTasks'][number]
  } = {}
): CommittedConversationIntent {
  if (hasLiveStream) {
    return {
      conversation: ref,
      input: { historyNodeId: 'user-2' },
      executions: [],
      reservedMessages: [{ id: 'user-2', role: 'user', parts: [] }],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: []
    }
  }
  const persistence = options.persistence ?? listener()
  const preparation: ConversationExecutionPreparationDescriptor = {
    kind: ConversationExecutionPreparationKind.Failure,
    conversation: ref,
    error: { name: 'TestPreparation', message: 'test-only History descriptor', stack: null }
  }
  const prepare =
    options.prepareExecutionContext ??
    (async () => ({
      conversation: ref,
      models: [
        {
          modelId,
          request: {
            chatId: ref.id,
            trigger: ConversationOpenTrigger.SubmitMessage,
            uniqueModelId: modelId,
            messageId: 'assistant-1',
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }]
          }
        }
      ]
    }))
  testPreparations.set(preparation, { prepare, outputNodeIds: ['assistant-1'] })
  const persistenceDescriptor: ConversationTerminalPersistenceDescriptor = {
    kind: ConversationTerminalPersistenceKind.TemporaryChat,
    topicId: ref.id,
    modelId,
    messageId: 'assistant-1'
  }
  testPersistence.set(persistenceDescriptor, [persistence])
  const postCommitTasks: Array<CommittedConversationIntent['postCommitTasks'][number]> = []
  if (options.cleanup) {
    const id = `test-cleanup:${crypto.randomUUID()}`
    testCleanup.set(id, options.cleanup)
    postCommitTasks.push({ kind: ConversationPostCommitTaskKind.RegisterTraceFlush, conversationId: id })
  }
  if (options.postCommitTask) postCommitTasks.push(options.postCommitTask)
  return {
    conversation: ref,
    input: { historyNodeId: 'user-1' },
    executions: [
      {
        modelId,
        outputNodeId: 'assistant-1',
        preparation,
        preparationIndex: 0,
        persistence: persistenceDescriptor,
        driver: { kind: ConversationExecutionDriverBindingKind.Chat }
      }
    ],
    reservedMessages: [
      { id: 'user-1', role: 'user', parts: [] },
      { id: 'assistant-1', role: 'assistant', parts: [] }
    ],
    activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
    postCommitTasks
  }
}

type TestPrepareExecution = (
  signal: AbortSignal,
  sink?: Parameters<RuntimeConversationHistoryPort['prepareExecutionContext']>[2]
) => Promise<ConversationExecutionContext>

interface TestPreparationBinding {
  readonly prepare: TestPrepareExecution
  readonly outputNodeIds: readonly string[]
}

const testPreparations = new WeakMap<object, TestPreparationBinding>()
const testPersistence = new WeakMap<object, readonly StreamListener[]>()
const testCleanup = new Map<string, StreamCleanupPort>()

function committedModels(options: {
  readonly models: readonly {
    readonly modelId: typeof modelId
    readonly outputNodeId: string
    readonly seedFromEmpty?: boolean
  }[]
  readonly prepare: TestPrepareExecution
  readonly persistence?: readonly StreamListener[]
  readonly reservedMessages: CommittedConversationIntent['reservedMessages']
  readonly inputId?: string
}): CommittedConversationIntent {
  const preparation: ConversationExecutionPreparationDescriptor = {
    kind: ConversationExecutionPreparationKind.Failure,
    conversation: ref,
    error: { name: 'TestPreparation', message: 'test-only History descriptor', stack: null }
  }
  testPreparations.set(preparation, {
    prepare: options.prepare,
    outputNodeIds: options.models.map(({ outputNodeId }) => outputNodeId)
  })
  const executions = options.models.map((model, preparationIndex) => {
    const persistence: ConversationTerminalPersistenceDescriptor = {
      kind: ConversationTerminalPersistenceKind.TemporaryChat,
      topicId: ref.id,
      modelId: model.modelId,
      messageId: model.outputNodeId
    }
    testPersistence.set(persistence, options.persistence ?? [])
    return {
      modelId: model.modelId,
      outputNodeId: model.outputNodeId,
      ...(model.seedFromEmpty ? { seedFromEmpty: true } : {}),
      preparation,
      preparationIndex,
      persistence,
      driver: { kind: ConversationExecutionDriverBindingKind.Chat as const }
    }
  })
  return {
    conversation: ref,
    input: {
      historyNodeId:
        options.inputId ??
        options.reservedMessages.find(({ role }) => role === 'user')?.id ??
        `test-input:${crypto.randomUUID()}`
    },
    executions,
    reservedMessages: options.reservedMessages,
    activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
    postCommitTasks: []
  }
}

class TestExecutionDriver implements ConversationExecutionDriver {
  setControl(): void {}

  async prepare(
    descriptor: ConversationExecutionPreparationDescriptor,
    _driver: ConversationExecutionDriverBinding,
    signal: AbortSignal,
    sink?: Parameters<RuntimeConversationHistoryPort['prepareExecutionContext']>[2]
  ): Promise<ConversationExecutionContext> {
    const binding = testPreparations.get(descriptor)
    if (!binding) throw new Error('Missing test History preparation binding')
    const context = await binding.prepare(signal, sink)
    return {
      ...context,
      models: context.models.map((model, index) => ({
        ...model,
        request: { ...model.request, messageId: model.request.messageId ?? binding.outputNodeIds[index] }
      }))
    }
  }

  openTelemetry(): undefined {
    return undefined
  }

  annotateTelemetry(): void {}

  redirect(effect: Parameters<ConversationExecutionDriver['redirect']>[0]) {
    return { kind: AgentRuntimeRedirectReceiptKind.Rejected, redirectId: effect.input.redirect.id }
  }

  suspend(): boolean {
    return false
  }

  resumeSuspended(): void {}

  discardRuntimeBuffer(): void {}

  checkpoint(): undefined {
    return undefined
  }

  async teardown(): Promise<void> {}
}

class AiExecutionManager extends ResourceExecutionManager {
  constructor(openStream?: ConstructorParameters<typeof ResourceExecutionManager>[0]) {
    super(openStream, new TestExecutionDriver())
  }
}

const testQuiescenceTaskExecutor: ConversationQuiescenceTaskExecutor = {
  async execute(task, terminal) {
    await testCleanup.get(task.conversationId)?.onTopicQuiesced(terminal)
    testCleanup.delete(task.conversationId)
  }
}

function adaptHistoryPort(provider: ConversationHistoryPort): RuntimeConversationHistoryPort {
  const adapted: RuntimeConversationHistoryPort = {
    ...provider,
    prepareExecutionContext: async (descriptor, signal, sink) => {
      const binding = testPreparations.get(descriptor)
      if (!binding) throw new Error('Missing test History preparation binding')
      return binding.prepare(signal, sink)
    },
    persistTerminal: async (descriptor, terminal) => {
      for (const persistence of testPersistence.get(descriptor) ?? []) {
        if (terminal.status === ConversationOutcomeKind.Success) await persistence.onDone(terminal)
        else if (terminal.status === ConversationOutcomeKind.Paused) await persistence.onPaused(terminal)
        else await persistence.onError(terminal)
      }
    }
  }
  return adapted
}

type RuntimeServiceOptions = ConstructorParameters<typeof RuntimeConversationRuntimeService>[0]
type TestRuntimeServiceOptions = Omit<RuntimeServiceOptions, 'executionManager' | 'providers'> & {
  readonly executionManager?: AiExecutionManager
  readonly namingTasks?: ConversationNamingTaskExecutor
  readonly providers: readonly ConversationHistoryPort[]
  readonly quiescenceTasks?: ConversationQuiescenceTaskExecutor
}

class ConversationRuntimeService extends RuntimeConversationRuntimeService {
  constructor(options: TestRuntimeServiceOptions) {
    super({
      ...options,
      executionManager: options.executionManager ?? new AiExecutionManager(),
      quiescenceTasks: options.quiescenceTasks ?? testQuiescenceTaskExecutor,
      providers: options.providers.map(adaptHistoryPort)
    })
  }
}

async function startApprovalWithLiveSibling() {
  const siblingModelId = createUniqueModelId('provider', 'sibling-model')
  const first = controlledStream()
  const sibling = controlledStream()
  const continuation = controlledStream()
  const continuationAbortController = new AbortController()
  const subscriber = listener()
  const persistence = listener()
  const provider: ConversationHistoryPort = {
    name: 'test-chat',
    isPersistentConversation: true,
    canHandle: () => true,
    validateIntent: vi.fn(async (currentRequest) => ({
      ...validation(currentRequest, false),
      executionModelIds:
        currentRequest.trigger === ConversationContinuationTrigger.ContinueInteraction
          ? [modelId]
          : [modelId, siblingModelId]
    })),
    commitIntent: vi.fn((currentValidation) => {
      const resumesInteraction =
        currentValidation.request.trigger === ConversationContinuationTrigger.ContinueInteraction
      const models = resumesInteraction
        ? [{ modelId, outputNodeId: 'assistant-1' }]
        : [
            { modelId, outputNodeId: 'assistant-1' },
            { modelId: siblingModelId, outputNodeId: 'assistant-2' }
          ]
      return committedModels({
        models,
        persistence: [persistence],
        inputId: 'user-1',
        reservedMessages: [
          ...(resumesInteraction ? [] : [{ id: 'user-1', role: 'user' as const, parts: [] }]),
          ...models.map(({ outputNodeId }) => ({ id: outputNodeId, role: 'assistant' as const, parts: [] }))
        ],
        prepare: async () => ({
          conversation: ref,
          models: models.map(({ modelId: currentModelId, outputNodeId }) => ({
            modelId: currentModelId,
            request: {
              chatId: ref.id,
              trigger: currentValidation.request.trigger,
              uniqueModelId: currentModelId,
              messageId: outputNodeId,
              messages: []
            }
          }))
        })
      })
    }),
    commitInteractionDecision: vi.fn(() => ({ kind: ConversationInteractionCommitResultKind.Ready as const }))
  }
  const service = new ConversationRuntimeService({
    providers: [provider],
    executionManager: new AiExecutionManager(
      vi
        .fn()
        .mockResolvedValueOnce(first.stream)
        .mockResolvedValueOnce(sibling.stream)
        .mockResolvedValueOnce(continuation.stream)
    )
  })

  await service.dispatch(subscriber, request())
  first.controller.enqueue({
    type: 'tool-approval-request',
    approvalId: 'approval-1',
    toolCallId: 'tool-1'
  } as UIMessageChunk)
  sibling.controller.enqueue({ type: 'text-start', id: 'sibling-text' })
  first.controller.close()
  await vi.waitFor(() =>
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.AwaitingInteraction,
      awaitingInteractionExecutions: [expect.objectContaining({ outputNodeId: 'assistant-1' })]
    })
  )

  await expect(
    service.respondChatToolApproval(ref, 'assistant-1', { approvalId: 'approval-1', approved: true }, subscriber)
  ).resolves.toBe(true)

  return { service, sibling, continuation, continuationAbortController, siblingModelId }
}

describe('ConversationRuntimeService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    cacheValues.clear()
    services.cache.getShared.mockImplementation((key: string) => cacheValues.get(key))
    services.cache.setShared.mockImplementation((key: string, value: unknown) => {
      cacheValues.set(key, value)
    })
  })

  it('keeps failed boot recovery in the fixed-point barrier until an authoritative retry succeeds', async () => {
    vi.useFakeTimers()
    const recoverCrashOrphans = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('database unavailable')
      })
      .mockReturnValueOnce({ repairedOutputs: [{ outputNodeId: 'assistant-1', status: 'error' }] })
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(),
      commitIntent: vi.fn(),
      recoverCrashOrphans
    }
    const service = new ConversationRuntimeService({ providers: [provider] })
    const recovered = vi.fn()
    service.onCrashRecoveryCompleted(recovered)

    await service._doInit()
    expect(service.isCrashRecoveryComplete).toBe(false)
    const hold = service.pause('backup')
    const drain = service.drainInFlight({ timeoutMs: 1 })
    await vi.advanceTimersByTimeAsync(1)
    await expect(drain).resolves.toEqual({ stragglerIds: ['boot-recovery'] })

    await vi.advanceTimersByTimeAsync(4_999)
    expect(recoverCrashOrphans).toHaveBeenCalledTimes(2)
    expect(service.isCrashRecoveryComplete).toBe(true)
    expect(recovered).toHaveBeenCalledOnce()

    hold.dispose()
    await service._doDestroy()
    vi.useRealTimers()
  })

  it('materializes an execution resource only after the Actor commits Starting', async () => {
    const controlled = controlledStream()
    const manager = new AiExecutionManager(async () => controlled.stream)
    const register = manager.register.bind(manager)
    vi.spyOn(manager, 'register').mockImplementation((descriptor) => {
      expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
      register(descriptor)
    })
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const service = new ConversationRuntimeService({ providers: [provider], executionManager: manager })

    await service.dispatch(listener(), request())

    expect(manager.register).toHaveBeenCalledOnce()
    controlled.controller.close()
  })

  it('closes the exact Agent activity instance without clearing a newer generation', () => {
    const service = new ConversationRuntimeService({ providers: [] })
    const first = service.openAgentActivity('session-1', ConversationActivityKind.Compaction)
    const second = service.openAgentActivity('session-1', ConversationActivityKind.Compaction)
    const agentRef = { kind: ConversationKind.Agent, id: 'session-1' } as const

    expect(service.inspect(agentRef).activities.size).toBe(2)
    service.closeAgentActivity('session-1', first)

    expect(service.inspect(agentRef).activities.has(first)).toBe(false)
    expect(service.inspect(agentRef).activities.has(second)).toBe(true)
  })

  it('passes the committed follow-up snapshot across the Agent redirect owner boundary', () => {
    const service = new ConversationRuntimeService({ providers: [] })
    const agentRef = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const inputId = toConversationInputId('input-2')
    const redirectId = toAgentRuntimeRedirectId('redirect-2')
    const followUpSnapshot = {
      id: 'agent-1',
      name: 'Agent after edit',
      model: { id: 'model', name: 'Model after edit', provider: 'provider' }
    }
    const deliveryMessage = {
      id: 'user-2',
      role: 'user',
      status: 'success',
      data: { parts: [{ type: 'text', text: 'follow up' }] }
    }
    const committedInput = {
      request: {
        trigger: ConversationOpenTrigger.SubmitMessage,
        conversation: agentRef,
        userMessageParts: deliveryMessage.data.parts,
        agentDeliveryMessage: deliveryMessage
      } as MainDispatchRequest,
      validation: {
        kind: ConversationHistoryAdapterKind.Agent,
        agent: { messageSnapshot: followUpSnapshot }
      } as ValidatedConversationIntent
    }
    const internals = service as unknown as {
      bindings: {
        setInput: (id: typeof inputId, binding: typeof committedInput) => void
        input: (id: typeof inputId) =>
          | (typeof committedInput & {
              agentRedirect: {
                phase: AgentRedirectBindingPhase.Queued
                redirectId: typeof redirectId
              }
            })
          | undefined
      }
      redirectAgentInput: (
        currentRef: typeof agentRef,
        input: ConversationRedirectInput
      ) => {
        kind: AgentRuntimeRedirectReceiptKind.Queued
        redirectId: typeof redirectId
      }
    }
    internals.bindings.setInput(inputId, committedInput)
    services.agentConnection.redirectConversationInput.mockReturnValueOnce({
      kind: AgentRuntimeRedirectReceiptKind.Queued,
      redirectId
    })

    const input: ConversationRedirectInput = {
      id: inputId,
      historyNodeId: deliveryMessage.id,
      provenance: ConversationInputProvenance.Renderer,
      responder: ConversationResponderKind.Interactive,
      redirect: { id: redirectId, phase: ConversationRedirectPhase.Queued }
    }

    expect(internals.redirectAgentInput(agentRef, input)).toEqual({
      kind: AgentRuntimeRedirectReceiptKind.Queued,
      redirectId
    })

    expect(services.agentConnection.redirectConversationInput).toHaveBeenCalledExactlyOnceWith(
      'session-1',
      redirectId,
      deliveryMessage,
      expect.objectContaining({ messageSnapshot: followUpSnapshot })
    )
    expect(internals.bindings.input(inputId)?.agentRedirect).toEqual({
      phase: AgentRedirectBindingPhase.Queued,
      redirectId
    })
  })

  it('routes an undelivered Agent redirect only to its exact Conversation actor', () => {
    const service = new ConversationRuntimeService({ providers: [] })
    const firstRef = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const secondRef = { kind: ConversationKind.Agent, id: 'session-2' } as const
    const internals = service as unknown as {
      actorFor: (ref: { readonly kind: ConversationKind.Agent; readonly id: string }) => {
        rejectUndeliveredRedirects: (redirectIds: readonly ReturnType<typeof toAgentRuntimeRedirectId>[]) => unknown
      }
    }
    const rejectFirst = vi.spyOn(internals.actorFor(firstRef), 'rejectUndeliveredRedirects')
    const rejectSecond = vi.spyOn(internals.actorFor(secondRef), 'rejectUndeliveredRedirects')
    const redirectId = toAgentRuntimeRedirectId('redirect-session-2')

    service.enqueueAgentUndelivered('session-2', [redirectId])

    expect(rejectFirst).not.toHaveBeenCalled()
    expect(rejectSecond).toHaveBeenCalledExactlyOnceWith([redirectId])
  })

  it('acknowledges the durable skeleton before asynchronous execution preparation finishes', async () => {
    let finishPreparation!: (value: ConversationExecutionContext) => void
    const preparation = new Promise<ConversationExecutionContext>((resolve) => {
      finishPreparation = resolve
    })
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false, { prepareExecutionContext: () => preparation }))
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => controlled.stream),
      providers: [provider]
    })

    const acknowledgement = await service.dispatch(subscriber, request())
    expect(acknowledgement).toMatchObject({
      mode: ConversationOpenMode.Started,
      reservedMessages: [{ id: 'user-1' }, { id: 'assistant-1' }]
    })
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)

    finishPreparation({
      conversation: ref,
      models: [
        {
          modelId,
          request: {
            chatId: ref.id,
            trigger: ConversationOpenTrigger.SubmitMessage,
            uniqueModelId: modelId,
            messageId: 'assistant-1',
            messages: []
          }
        }
      ]
    })
    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('creates an active stream and launches an execution loop against AiService.streamText', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const openStream = vi.fn(async () => controlled.stream)
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(openStream),
      providers: [provider]
    })

    await service.dispatch(subscriber, request())

    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledOnce())
    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('reports whether any stream can still persist turn state', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => controlled.stream),
      providers: [provider]
    })

    expect(service.hasLiveStreams()).toBe(false)
    await service.dispatch(subscriber, request())
    expect(service.hasLiveStreams()).toBe(true)

    controlled.controller.close()
    await vi.waitFor(() => expect(service.hasLiveStreams()).toBe(false))
  })

  it('attaches with an atomic live snapshot and an explicit settled terminal', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => controlled.stream),
      providers: [provider]
    })
    const sender = { id: 42, isDestroyed: () => false, send: vi.fn() } as unknown as Electron.WebContents

    await service.dispatch(subscriber, request())
    const live = service.attach(sender, ref)
    expect(live).toMatchObject({
      status: ConversationAttachStatus.Live,
      executions: [{ state: ConversationExecutionAttachState.Live, projection: { outputNodeId: 'assistant-1' } }]
    })

    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    const settled = service.attach(sender, ref)
    expect(settled).toMatchObject({
      status: ConversationAttachStatus.Settled,
      executions: [{ state: ConversationExecutionAttachState.Settled }],
      terminal: { status: ConversationStreamTerminalStatus.Done }
    })
  })

  it('stream remains accessible during grace period', async () => {
    vi.useFakeTimers()
    try {
      const subscriber = listener()
      const provider: ConversationHistoryPort = {
        name: 'test-chat',
        isPersistentConversation: true,
        canHandle: () => true,
        validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
        commitIntent: vi.fn(() => committed(false))
      }
      const controlled = controlledStream()
      const executionManager = new AiExecutionManager(async () => controlled.stream)
      const service = new ConversationRuntimeService({ executionManager, providers: [provider] })
      const sender = { id: 42, isDestroyed: () => false, send: vi.fn() } as unknown as Electron.WebContents

      await service.dispatch(subscriber, request())
      controlled.controller.close()
      await Promise.all(executionManager.inFlightRuns())
      await vi.advanceTimersByTimeAsync(29_999)

      expect(service.attach(sender, ref)).toMatchObject({
        status: ConversationAttachStatus.Settled,
        terminal: { status: ConversationStreamTerminalStatus.Done }
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('stream is cleaned up after grace period expires', async () => {
    vi.useFakeTimers()
    try {
      const subscriber = listener()
      const provider: ConversationHistoryPort = {
        name: 'test-chat',
        isPersistentConversation: true,
        canHandle: () => true,
        validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
        commitIntent: vi.fn(() => committed(false))
      }
      const controlled = controlledStream()
      const executionManager = new AiExecutionManager(async () => controlled.stream)
      const service = new ConversationRuntimeService({ executionManager, providers: [provider] })
      const sender = { id: 42, isDestroyed: () => false, send: vi.fn() } as unknown as Electron.WebContents

      await service.dispatch(subscriber, request())
      controlled.controller.close()
      await Promise.all(executionManager.inFlightRuns())
      await vi.advanceTimersByTimeAsync(0)

      expect(service.attach(sender, ref).status).toBe(ConversationAttachStatus.Settled)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(service.attach(sender, ref).status).toBe(ConversationAttachStatus.Settled)

      await vi.advanceTimersByTimeAsync(1)
      expect(service.attach(sender, ref)).toEqual({ status: ConversationAttachStatus.NotFound })
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a fresh stream instead of appending to a terminal grace-period group', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const contexts: boolean[] = []
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => {
        contexts.push(ctx.hasLiveStream)
        return validation(req, ctx.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(subscriber, request('first'))
    first.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    await expect(service.dispatch(subscriber, request('second'))).resolves.toMatchObject({
      mode: ConversationOpenMode.Started
    })
    expect(contexts).toEqual([false, false])
    expect(openStream).toHaveBeenCalledTimes(2)

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('attaches a follow-up subscriber to a grace-period stream so the next turn carries it', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const firstSubscriber = listener()
    const followUpSubscriber = { ...listener(), id: 'follow-up-subscriber' }
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(firstSubscriber, request('first'))
    first.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    await expect(service.dispatch(followUpSubscriber, request('follow-up'))).resolves.toMatchObject({
      mode: ConversationOpenMode.Started
    })
    second.controller.enqueue({ type: 'text-start', id: 'text-2' })
    await vi.waitFor(() => expect(followUpSubscriber.onChunk).toHaveBeenCalledOnce())
    expect(firstSubscriber.onChunk).not.toHaveBeenCalled()
    expect(openStream).toHaveBeenCalledTimes(2)

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('records pending on send, streaming on first chunk, done on terminal; grace-period cleanup is silent', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const completions: unknown[] = []
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => controlled.stream),
      providers: [provider]
    })
    service.onConversationCompleted((event) => completions.push(event))

    const opened = await service.dispatch(subscriber, request())
    expect(opened).toMatchObject({ mode: ConversationOpenMode.Started })
    const running = service.inspect(ref)
    expect(running.phase).toBe(ConversationPhase.Running)
    if (running.phase !== ConversationPhase.Running) throw new Error('turn did not open')
    const turnId = running.turn.id
    expect(services.cache.setShared).toHaveBeenLastCalledWith(
      'conversation.statuses.chat:topic-1',
      expect.objectContaining({
        status: ConversationStatus.Pending,
        turnId,
        activeExecutions: [
          expect.objectContaining({
            turnId,
            executionId: expect.any(String),
            modelId,
            outputNodeId: 'assistant-1'
          })
        ]
      })
    )

    controlled.controller.enqueue({ type: 'text-start', id: 'text-1' })
    await vi.waitFor(() =>
      expect(services.cache.setShared).toHaveBeenLastCalledWith(
        'conversation.statuses.chat:topic-1',
        expect.objectContaining({ status: ConversationStatus.Streaming })
      )
    )
    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    const terminal = cacheValues.get('conversation.statuses.chat:topic-1')
    expect(terminal).toMatchObject({
      status: ConversationStatus.Done,
      turnId,
      activeExecutions: [],
      awaitingInteractionExecutions: [],
      lastCompletedAt: expect.any(Number)
    })
    expect(completions).toEqual([
      expect.objectContaining({ conversation: ref, turnId, completedAt: expect.any(Number) })
    ])
    expect(completions[0]).toMatchObject({
      completedAt: (terminal as { lastCompletedAt: number }).lastCompletedAt
    })
  })

  it('maps paused status to aborted state', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const executionManager = new AiExecutionManager(async () => controlled.stream)
    const service = new ConversationRuntimeService({ executionManager, providers: [provider] })

    await service.dispatch(subscriber, request())
    expect(service.abort(ref, 'user-stop')).toBe(true)
    controlled.controller.close()
    await Promise.all(executionManager.inFlightRuns())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Aborted,
      activeExecutions: []
    })
  })

  it('records aborted when the user stops the stream', async () => {
    const subscriber = listener()
    const controlled = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await service.dispatch(subscriber, request())
    service.stop(ref, 'user-stop')
    controlled.controller.close()

    await vi.waitFor(() => expect(subscriber.onPaused).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Aborted
    })
  })

  it('sets status and triggers AbortController signal', async () => {
    const subscriber = listener()
    const controlled = controlledStream()
    let ownedSignal: AbortSignal | undefined
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() =>
        committed(false, {
          prepareExecutionContext: async (signal) => {
            ownedSignal = signal
            return {
              conversation: ref,
              models: [
                {
                  modelId,
                  request: {
                    chatId: ref.id,
                    trigger: ConversationOpenTrigger.SubmitMessage,
                    uniqueModelId: modelId,
                    messageId: 'assistant-1',
                    messages: []
                  }
                }
              ]
            }
          }
        })
      )
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await service.dispatch(subscriber, request())
    await vi.waitFor(() => expect(ownedSignal).toBeDefined())
    expect(service.abort(ref, 'user-stop')).toBe(true)
    expect(ownedSignal?.aborted).toBe(true)
    expect(ownedSignal?.reason).toBe('user-stop')
    controlled.controller.close()

    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Aborted
    })
  })

  it('broadcasts error and sets stream status', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => {
        throw new Error('provider unavailable')
      }),
      providers: [provider]
    })

    await service.dispatch(subscriber, request())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Error,
      activeExecutions: []
    })
    expect(subscriber.onError).toHaveBeenCalledOnce()
  })

  it('records error when an execution errors before any chunk', async () => {
    const subscriber = listener()
    const controlled = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await service.dispatch(subscriber, request())
    controlled.controller.error(new Error('provider failed before output'))

    await vi.waitFor(() => expect(subscriber.onError).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Error
    })
  })

  it('does not set lastCompletedAt for non-done terminals (aborted, error)', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const first = controlledStream()
    const executionManager = new AiExecutionManager(
      vi.fn().mockResolvedValueOnce(first.stream).mockRejectedValueOnce(new Error('provider unavailable'))
    )
    const service = new ConversationRuntimeService({ executionManager, providers: [provider] })

    await service.dispatch(subscriber, request('first'))
    service.stop(ref, 'user-stop')
    first.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toHaveProperty('lastCompletedAt', undefined)

    await service.dispatch(subscriber, request('second'))
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({ status: ConversationStatus.Error })
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toHaveProperty('lastCompletedAt', undefined)
  })

  it('does not report a completion for a stream without a persistent completion target', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'temporary-chat',
      isPersistentConversation: false,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const completions: unknown[] = []
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => controlled.stream),
      providers: [provider]
    })
    service.onConversationCompleted((event) => completions.push(event))

    await service.dispatch(subscriber, request())
    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    expect(completions).toEqual([])
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Done,
      lastCompletedAt: expect.any(Number)
    })
  })

  it('does not publish approval requests for temporary streams', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'temporary-chat',
      isPersistentConversation: false,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const executionManager = new AiExecutionManager(async () => controlled.stream)
    const service = new ConversationRuntimeService({ executionManager, providers: [provider] })
    const approvalEvents: unknown[] = []
    service.onApprovalRequested((event) => approvalEvents.push(event))

    await service.dispatch(subscriber, request())
    controlled.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-call-1'
    } as UIMessageChunk)
    await vi.waitFor(() => expect(subscriber.onChunk).toHaveBeenCalledOnce())

    expect(approvalEvents).toEqual([])
    service.stop(ref, 'test-cleanup')
    controlled.controller.close()
    await Promise.all(executionManager.inFlightRuns())
  })

  it('publishes each persistent approval id once', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const executionManager = new AiExecutionManager(async () => controlled.stream)
    const service = new ConversationRuntimeService({ executionManager, providers: [provider] })
    const approvalEvents: unknown[] = []
    service.onApprovalRequested((event) => approvalEvents.push(event))

    await service.dispatch(subscriber, request())
    for (let index = 0; index < 2; index += 1) {
      controlled.controller.enqueue({
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        toolCallId: 'tool-call-1'
      } as UIMessageChunk)
    }
    await vi.waitFor(() => expect(subscriber.onChunk).toHaveBeenCalledTimes(2))

    expect(approvalEvents).toEqual([
      expect.objectContaining({ conversation: ref, approvalId: 'approval-1', requestedAt: expect.any(Number) })
    ])
    service.stop(ref, 'test-cleanup')
    controlled.controller.close()
    await Promise.all(executionManager.inFlightRuns())
  })

  it('carries activeExecutions (with anchor message ids) in every status delta', async () => {
    const secondModelId = createUniqueModelId('provider', 'model-b')
    const subscriber = listener()
    const persistence = listener()
    const first = controlledStream()
    const second = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req) => ({
        ...validation(req, false),
        executionModelIds: [modelId, secondModelId]
      })),
      commitIntent: vi.fn(() =>
        committedModels({
          models: [
            { modelId, outputNodeId: 'assistant-1' },
            { modelId: secondModelId, outputNodeId: 'assistant-2' }
          ],
          persistence: [persistence],
          reservedMessages: [
            { id: 'user-1', role: 'user' as const, parts: [] },
            { id: 'assistant-1', role: 'assistant' as const, parts: [] },
            { id: 'assistant-2', role: 'assistant' as const, parts: [] }
          ],
          prepare: async () => ({
            conversation: ref,
            models: [
              {
                modelId,
                request: {
                  chatId: ref.id,
                  trigger: ConversationOpenTrigger.SubmitMessage,
                  uniqueModelId: modelId,
                  messageId: 'assistant-1',
                  messages: []
                }
              },
              {
                modelId: secondModelId,
                request: {
                  chatId: ref.id,
                  trigger: ConversationOpenTrigger.SubmitMessage,
                  uniqueModelId: secondModelId,
                  messageId: 'assistant-2',
                  messages: []
                }
              }
            ]
          })
        })
      )
    }
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      ),
      providers: [provider]
    })

    await service.dispatch(subscriber, request())
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Pending,
      activeExecutions: [
        expect.objectContaining({ modelId, outputNodeId: 'assistant-1' }),
        expect.objectContaining({ modelId: secondModelId, outputNodeId: 'assistant-2' })
      ]
    })

    first.controller.enqueue({ type: 'text-start', id: 'text-1' })
    await vi.waitFor(() =>
      expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
        status: ConversationStatus.Streaming,
        activeExecutions: [
          expect.objectContaining({ modelId, outputNodeId: 'assistant-1' }),
          expect.objectContaining({ modelId: secondModelId, outputNodeId: 'assistant-2' })
        ]
      })
    )
    first.controller.close()
    await vi.waitFor(() => expect(persistence.onDone).toHaveBeenCalledOnce())

    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Pending,
      activeExecutions: [expect.objectContaining({ modelId: secondModelId, outputNodeId: 'assistant-2' })]
    })
    expect(subscriber.onDone).toHaveBeenCalledWith(expect.objectContaining({ turnTerminal: false }))

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Done,
      activeExecutions: []
    })
  })

  it('drops the anchor from the shared cache when the paused execution has a live sibling (topic stays live)', async () => {
    const { service, sibling, continuation, continuationAbortController, siblingModelId } =
      await startApprovalWithLiveSibling()

    continuationAbortController.abort('user-stop')
    continuation.controller.close()
    await vi.waitFor(() =>
      expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
        status: ConversationStatus.Streaming,
        activeExecutions: [expect.objectContaining({ modelId: siblingModelId, outputNodeId: 'assistant-2' })],
        awaitingInteractionExecutions: []
      })
    )

    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    sibling.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('drops the anchor from the shared cache when the errored execution has a live sibling (topic stays live)', async () => {
    const { service, sibling, continuation, siblingModelId } = await startApprovalWithLiveSibling()

    continuation.controller.error(new Error('provider failed'))
    await vi.waitFor(() =>
      expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
        status: ConversationStatus.Streaming,
        activeExecutions: [expect.objectContaining({ modelId: siblingModelId, outputNodeId: 'assistant-2' })],
        awaitingInteractionExecutions: []
      })
    )

    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    sibling.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('replaces one terminal execution in place without reordering its live sibling', async () => {
    const secondModelId = createUniqueModelId('provider', 'model-b')
    const subscriber = listener()
    const persistence = listener()
    const first = controlledStream()
    const second = controlledStream()
    const retry = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => {
        if (currentRequest.trigger === ConversationOpenTrigger.RetryMessage) {
          return {
            ...validation(currentRequest, true),
            executionModelIds: [modelId],
            liveExecutionMutation: {
              kind: ConversationExecutionMutationKind.Retry,
              outputNodeId: 'assistant-1',
              parentNodeId: 'user-1',
              siblingsGroupId: 1,
              persistedSiblingsGroupId: 1
            }
          }
        }
        return { ...validation(currentRequest, context.hasLiveStream), executionModelIds: [modelId, secondModelId] }
      }),
      commitIntent: vi.fn((currentValidation) => {
        const isRetry = currentValidation.request.trigger === ConversationOpenTrigger.RetryMessage
        const models = isRetry
          ? [{ modelId, outputNodeId: 'assistant-1', seedFromEmpty: true }]
          : [
              { modelId, outputNodeId: 'assistant-1' },
              { modelId: secondModelId, outputNodeId: 'assistant-2' }
            ]
        return committedModels({
          models,
          persistence: [persistence],
          inputId: 'user-1',
          reservedMessages: [
            ...(isRetry ? [] : [{ id: 'user-1', role: 'user' as const, parts: [] }]),
            ...models.map(({ outputNodeId }) => ({
              id: outputNodeId,
              role: 'assistant' as const,
              parts: []
            }))
          ],
          prepare: async () => ({
            conversation: ref,
            models: models.map(({ modelId: currentModelId, outputNodeId, ...modelOptions }) => ({
              modelId: currentModelId,
              ...modelOptions,
              request: {
                chatId: ref.id,
                trigger: ConversationOpenTrigger.RegenerateMessage as const,
                uniqueModelId: currentModelId,
                messageId: outputNodeId,
                messages: []
              }
            }))
          })
        })
      })
    }
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(
        vi
          .fn()
          .mockResolvedValueOnce(first.stream)
          .mockResolvedValueOnce(second.stream)
          .mockResolvedValueOnce(retry.stream)
      ),
      providers: [provider]
    })

    const initial = await service.dispatch(subscriber, request())
    if (initial.mode !== ConversationOpenMode.Started) throw new Error('initial turn did not start')
    const initialExecutions = initial.activeExecutions
    if (!initialExecutions?.[0]) throw new Error('initial turn did not reserve executions')
    first.controller.error(new Error('first attempt failed'))
    await vi.waitFor(() => {
      expect(persistence.onError).toHaveBeenCalledOnce()
      const state = service.inspect(ref)
      if (state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
      expect(state.turn.executions.get(initialExecutions[0].executionId)?.phase).toBe(
        ConversationExecutionPhase.Settled
      )
    })

    const restarted = await service.dispatch(subscriber, {
      trigger: ConversationOpenTrigger.RetryMessage,
      conversation: ref,
      parentAnchorId: 'user-1',
      retryMessageId: 'assistant-1',
      mentionedModelIds: [modelId]
    })
    if (restarted.mode !== ConversationOpenMode.Started) throw new Error('retry did not start')

    expect(restarted.activeExecutions).toEqual([
      expect.objectContaining({
        executionId: initialExecutions[0].executionId,
        modelId,
        outputNodeId: 'assistant-1',
        seedFromEmpty: true
      })
    ])
    const state = service.inspect(ref)
    if (state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect([...state.turn.executions.keys()]).toEqual(initialExecutions.map(({ executionId }) => executionId))

    retry.controller.close()
    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('admits another failed sibling into a retry stream for the same persisted reply group', async () => {
    const retriedModelId = createUniqueModelId('provider', 'model-b')
    const subscriber = listener()
    const active = controlledStream()
    const retry = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => {
        if (currentRequest.trigger === ConversationOpenTrigger.RetryMessage) {
          return {
            ...validation(currentRequest, true),
            inputModelId: retriedModelId,
            executionModelIds: [retriedModelId],
            liveExecutionMutation: {
              kind: ConversationExecutionMutationKind.Retry,
              outputNodeId: 'assistant-b',
              parentNodeId: 'user-1',
              siblingsGroupId: 1,
              persistedSiblingsGroupId: 1
            }
          }
        }
        return validation(currentRequest, context.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => {
        const isRetry = currentValidation.request.trigger === ConversationOpenTrigger.RetryMessage
        const currentModelId = isRetry ? retriedModelId : modelId
        const outputNodeId = isRetry ? 'assistant-b' : 'assistant-1'
        return committedModels({
          models: [{ modelId: currentModelId, outputNodeId, ...(isRetry ? { seedFromEmpty: true } : {}) }],
          persistence: [listener()],
          inputId: 'user-1',
          reservedMessages: [
            ...(isRetry ? [] : [{ id: 'user-1', role: 'user' as const, parts: [] }]),
            { id: outputNodeId, role: 'assistant' as const, parts: [] }
          ],
          prepare: async () => ({
            conversation: ref,
            models: [
              {
                modelId: currentModelId,
                seedFromEmpty: isRetry,
                request: {
                  chatId: ref.id,
                  trigger: ConversationOpenTrigger.RegenerateMessage,
                  uniqueModelId: currentModelId,
                  messageId: outputNodeId,
                  messages: []
                }
              }
            ]
          })
        })
      })
    }
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(active.stream).mockResolvedValueOnce(retry.stream)
      ),
      providers: [provider]
    })

    const initial = await service.dispatch(subscriber, request())
    const appended = await service.dispatch(subscriber, {
      trigger: ConversationOpenTrigger.RetryMessage,
      conversation: ref,
      parentAnchorId: 'user-1',
      retryMessageId: 'assistant-b',
      mentionedModelIds: [retriedModelId]
    })
    if (initial.mode !== ConversationOpenMode.Started || appended.mode !== ConversationOpenMode.Started) {
      throw new Error('live reply group did not start')
    }

    expect(appended.activeExecutions).toEqual([
      expect.objectContaining({ modelId: retriedModelId, outputNodeId: 'assistant-b', seedFromEmpty: true })
    ])
    const state = service.inspect(ref)
    if (state.phase !== ConversationPhase.Running) throw new Error('turn did not remain live')
    expect([...state.turn.executions.values()].map(({ outputNodeId }) => outputNodeId)).toEqual([
      'assistant-1',
      'assistant-b'
    ])

    active.controller.close()
    retry.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('sets lastCompletedAt only on done; carries forward through subsequent live; bumps on next done', async () => {
    const subscriber = listener()
    const streams = [controlledStream(), controlledStream()]
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(streams[0].stream).mockResolvedValueOnce(streams[1].stream)
      ),
      providers: [provider]
    })

    await service.dispatch(subscriber, request('first'))
    streams[0].controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    const firstCompletion = (cacheValues.get('conversation.statuses.chat:topic-1') as { lastCompletedAt?: number })
      .lastCompletedAt
    expect(firstCompletion).toEqual(expect.any(Number))

    await new Promise((resolve) => setTimeout(resolve, 2))
    await service.dispatch(subscriber, request('second'))
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.Pending,
      lastCompletedAt: firstCompletion
    })
    streams[1].controller.enqueue({ type: 'text-start', id: 'text-2' })
    await vi.waitFor(() =>
      expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
        status: ConversationStatus.Streaming,
        lastCompletedAt: firstCompletion
      })
    )
    streams[1].controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    const secondCompletion = (cacheValues.get('conversation.statuses.chat:topic-1') as { lastCompletedAt?: number })
      .lastCompletedAt
    expect(secondCompletion).toBeGreaterThan(firstCompletion!)
  })

  it.each([
    {
      status: ConversationStatus.Aborted,
      finish: (service: ConversationRuntimeService, controlled: ReturnType<typeof controlledStream>) => {
        service.stop(ref, 'user-stop')
        controlled.controller.close()
      }
    },
    {
      status: ConversationStatus.Error,
      finish: (_service: ConversationRuntimeService, controlled: ReturnType<typeof controlledStream>) => {
        controlled.controller.error(new Error('provider failed'))
      }
    }
  ])('does not mint lastCompletedAt for a fresh $status terminal', async ({ status, finish }) => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      executionManager: new AiExecutionManager(async () => controlled.stream),
      providers: [provider]
    })

    await service.dispatch(subscriber, request())
    finish(service, controlled)
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status,
      lastCompletedAt: undefined
    })
  })

  it('interrupts validation before commit so Stop leaves no durable skeleton', async () => {
    let finishValidation!: () => void
    const blocked = new Promise<void>((resolve) => {
      finishValidation = resolve
    })
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => {
        await blocked
        return validation(req, ctx.hasLiveStream)
      }),
      commitIntent: vi.fn(() => committed(false))
    }
    const service = new ConversationRuntimeService({ providers: [provider] })

    const opening = service.dispatch(subscriber, request())
    await vi.waitFor(() => expect(provider.validateIntent).toHaveBeenCalledOnce())
    const stop = service.stop(ref, 'user-stop')
    let stopCompleted = false
    void stop.completed.then(() => {
      stopCompleted = true
    })
    await Promise.resolve()
    expect(stopCompleted).toBe(false)
    finishValidation()

    await expect(opening).rejects.toThrow('superseded')
    await expect(stop.completed).resolves.toBeUndefined()
    expect(provider.commitIntent).not.toHaveBeenCalled()
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
  })

  it('turns a post-ack context failure into one durable Error terminal', async () => {
    const subscriber = listener()
    const persistence = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() =>
        committed(false, {
          persistence,
          prepareExecutionContext: async () => {
            throw new Error('context build failed')
          }
        })
      )
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await expect(service.dispatch(subscriber, request())).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
    await vi.waitFor(() => expect(persistence.onError).toHaveBeenCalledOnce())
    expect(persistence.onPaused).not.toHaveBeenCalled()
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
  })

  it('serializes admissions so the second submit is classified from the committed first turn', async () => {
    const subscriber = listener()
    const contexts: boolean[] = []
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => {
        contexts.push(ctx.hasLiveStream)
        return validation(req, ctx.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    const first = service.dispatch(subscriber, request('first'))
    const second = service.dispatch(subscriber, request('second'))
    await expect(first).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
    await expect(second).resolves.toMatchObject({ mode: ConversationOpenMode.Injected })
    expect(contexts).toEqual([false, true])
  })

  it('keeps an accepted NextTurn input in Actor memory until the turn boundary commits its row', async () => {
    const active = controlledStream()
    const successor = controlledStream()
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => validation(currentRequest, context.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(active.stream).mockResolvedValueOnce(successor.stream)
      )
    })

    await service.dispatch(subscriber, request('active'))
    await expect(service.dispatch(subscriber, queuedRequest('queued'))).resolves.toMatchObject({
      mode: ConversationOpenMode.Injected,
      reservedMessages: []
    })

    expect(provider.commitIntent).toHaveBeenCalledOnce()
    expect(service.inboxSnapshot(ref).items).toEqual([
      expect.objectContaining({ presentation: expect.objectContaining({ draft: { text: 'queued', tokens: [] } }) })
    ])

    active.controller.close()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(2))
    expect(service.inboxSnapshot(ref).items).toEqual([])

    successor.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('claims a same-profile NextTurn prefix in one History batch commit', async () => {
    const active = controlledStream()
    const successor = controlledStream()
    const subscriber = listener()
    const commitBatchIntent = vi.fn((validations: readonly ValidatedConversationIntent[]) => {
      if (validations.length === 0) throw new Error('batch commit requires validated inputs')
      return committed(false)
    })
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => validation(currentRequest, context.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream)),
      commitBatchIntent
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(active.stream).mockResolvedValueOnce(successor.stream)
      )
    })

    await service.dispatch(subscriber, request('active'))
    await service.dispatch(subscriber, queuedRequest('B'))
    await service.dispatch(subscriber, queuedRequest('C'))
    expect(provider.commitIntent).toHaveBeenCalledOnce()
    expect(service.inboxSnapshot(ref).items.map(({ presentation }) => presentation.draft.text)).toEqual(['B', 'C'])

    active.controller.close()
    await vi.waitFor(() => expect(commitBatchIntent).toHaveBeenCalledOnce())
    expect(commitBatchIntent.mock.calls[0]?.[0]).toHaveLength(2)
    expect(provider.commitIntent).toHaveBeenCalledOnce()
    expect(service.inboxSnapshot(ref).items).toEqual([])

    successor.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('keeps a failed successor batch in the inbox for an explicit retry', async () => {
    const active = controlledStream()
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => validation(currentRequest, context.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream)),
      commitBatchIntent: vi.fn(() => {
        throw new Error('batch transaction failed')
      })
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(vi.fn().mockResolvedValueOnce(active.stream))
    })

    await service.dispatch(subscriber, request('active'))
    await service.dispatch(subscriber, queuedRequest('B'))
    await service.dispatch(subscriber, queuedRequest('C'))
    active.controller.close()

    await vi.waitFor(() => expect(provider.commitBatchIntent).toHaveBeenCalledOnce())
    expect(service.inboxSnapshot(ref).items.map(({ presentation }) => presentation.draft.text)).toEqual(['B', 'C'])
    expect(service.inspect(ref).inbox.nextTurn).toHaveLength(2)
  })

  it('reorders visible inbox items without dropping hidden control inputs', async () => {
    const active = controlledStream()
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => validation(currentRequest, context.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(vi.fn().mockResolvedValueOnce(active.stream))
    })
    await service.dispatch(subscriber, request('active'))
    await service.dispatch(subscriber, queuedRequest('B'))
    const firstVisible = service.inboxSnapshot(ref).items[0]
    if (!firstVisible) throw new Error('Expected the first visible inbox item')
    await service.dispatch(subscriber, request('hidden'))
    const hiddenId = service.inspect(ref).inbox.nextTurn[1]?.id
    if (!hiddenId) throw new Error('Expected a hidden control input')
    await service.dispatch(subscriber, queuedRequest('C'))
    const secondVisible = service.inboxSnapshot(ref).items[1]
    if (!secondVisible) throw new Error('Expected the second visible inbox item')

    await service.mutateInbox(ref, {
      kind: ConversationInboxMutationKind.Reorder,
      inputIds: [secondVisible.id, firstVisible.id]
    })

    expect(service.inspect(ref).inbox.nextTurn.map(({ id }) => id)).toEqual([
      secondVisible.id,
      hiddenId,
      firstVisible.id
    ])
    expect(service.inboxSnapshot(ref).items.map(({ presentation }) => presentation.draft.text)).toEqual(['C', 'B'])
    active.controller.close()
  })

  it('tracks the queue and starts a continuation immediately when the topic is idle', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(subscriber, request('active'))
    await service.dispatch(subscriber, request('queued'))
    const pause = service.pause('backup')
    first.controller.close()

    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(service.inspect(ref).inbox.nextTurn).toHaveLength(1)
    expect(provider.commitIntent).toHaveBeenCalledTimes(2)

    pause.dispose()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(3))
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    expect(service.inspect(ref).inbox.nextTurn).toHaveLength(0)

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('binds an accepted successor listener only after that input owns an execution', async () => {
    const activeListener = listener()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const active = controlledStream()
    const successor = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(active.stream).mockResolvedValueOnce(successor.stream)
      )
    })

    await service.dispatch(activeListener, request('active'))
    const acknowledgement = await service.dispatch(successorListener, request('successor'))
    expect(acknowledgement).toMatchObject({ mode: ConversationOpenMode.Injected, inputId: expect.any(String) })

    active.controller.close()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(3))
    expect(successorListener.onDone).not.toHaveBeenCalled()

    successor.controller.close()
    await vi.waitFor(() => expect(successorListener.onDone).toHaveBeenCalledOnce())
  })

  it('carries only renderer listeners into the continuation; persistence/trace are dropped', async () => {
    const firstListener = listener()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const firstPersistence = { ...listener(), id: 'persistence-1' }
    const secondPersistence = { ...listener(), id: 'persistence-2' }
    const firstCleanup: StreamCleanupPort = { id: 'cleanup-1', onTopicQuiesced: vi.fn() }
    const secondCleanup: StreamCleanupPort = { id: 'cleanup-2', onTopicQuiesced: vi.fn() }
    const first = controlledStream()
    const second = controlledStream()
    let freshCommit = 0
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => {
        if (currentValidation.context.hasLiveStream) return committed(true)
        freshCommit += 1
        return committed(false, {
          persistence: freshCommit === 1 ? firstPersistence : secondPersistence,
          cleanup: freshCommit === 1 ? firstCleanup : secondCleanup
        })
      })
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(firstListener, request('first'))
    await service.dispatch(successorListener, request('queued'))
    first.controller.close()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(3))

    expect(firstPersistence.onDone).toHaveBeenCalledOnce()
    expect(firstCleanup.onTopicQuiesced).not.toHaveBeenCalled()
    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    expect(firstPersistence.onDone).toHaveBeenCalledOnce()
    expect(secondPersistence.onDone).toHaveBeenCalledOnce()
    expect(firstCleanup.onTopicQuiesced).not.toHaveBeenCalled()
    expect(secondCleanup.onTopicQuiesced).toHaveBeenCalledOnce()
    expect(successorListener.onDone).toHaveBeenCalledOnce()
  })

  it('falls back to the null listener when the finished turn had no renderer windows', async () => {
    const activeSubscriber = listener()
    const windowlessSubscriber: StreamListener = {
      ...listener(),
      id: 'windowless-successor',
      isAlive: () => false
    }
    const firstPersistence = { ...listener(), id: 'persistence-1' }
    const secondPersistence = { ...listener(), id: 'persistence-2' }
    const first = controlledStream()
    const second = controlledStream()
    let freshCommit = 0
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => {
        if (currentValidation.context.hasLiveStream) return committed(true)
        freshCommit += 1
        return committed(false, {
          persistence: freshCommit === 1 ? firstPersistence : secondPersistence
        })
      })
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(activeSubscriber, request('active'))
    await service.dispatch(windowlessSubscriber, request('windowless-successor'))
    first.controller.close()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(3))

    second.controller.close()
    await vi.waitFor(() => expect(secondPersistence.onDone).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    expect(windowlessSubscriber.onDone).not.toHaveBeenCalled()
    expect(firstPersistence.onDone).toHaveBeenCalledOnce()
    expect(secondPersistence.onDone).toHaveBeenCalledOnce()
  })

  it('writes a terminal error and notifies carried windows when the continuation fails to launch', async () => {
    const activeListener = listener()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const persistence = listener()
    const active = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => {
        if (!ctx.hasLiveStream && req.trigger === ConversationContinuationTrigger.ContinueSteer) {
          throw new Error('continuation model is unavailable')
        }
        return validation(req, ctx.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream)),
      validateInputFailure: vi.fn((failureRequest: MainDispatchRequest, error: SerializedError) => {
        if (failureRequest.trigger !== ConversationContinuationTrigger.ContinueSteer) return undefined
        return {
          kind: ConversationHistoryAdapterKind.PersistentChat,
          request: failureRequest,
          error,
          executionModelIds: [modelId],
          resolvedModel: {
            id: modelId,
            name: 'Model',
            providerId: 'provider',
            capabilities: [],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          }
        } satisfies ValidatedConversationInputFailure
      }),
      commitInputFailureIntent: vi.fn(() =>
        committed(false, {
          persistence,
          prepareExecutionContext: async () => {
            throw new Error('continuation model is unavailable')
          }
        })
      )
    }
    const openStream = vi.fn(async () => active.stream)
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(activeListener, request('active'))
    await service.dispatch(successorListener, request('successor'))
    active.controller.close()

    await vi.waitFor(() => expect(successorListener.onError).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(provider.commitInputFailureIntent).toHaveBeenCalledOnce()
    expect(persistence.onError).toHaveBeenCalledOnce()
    expect(service.inspect(ref).inbox.nextTurn).toEqual([])
    expect(service.hasLiveStreams()).toBe(false)
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({ status: ConversationStatus.Error })
  })

  it('surfaces the error and settles the turn when the next-turn placeholder save rejects (R3)', async () => {
    const activeListener = listener()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const activePersistence = { ...listener(), id: 'active-persistence' }
    const failurePersistence = { ...listener(), id: 'failure-persistence' }
    const active = controlledStream()
    let commitCount = 0
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => {
        commitCount += 1
        if (commitCount === 3) throw new Error('assistant skeleton transaction failed')
        return committed(currentValidation.context.hasLiveStream, {
          persistence: activePersistence
        })
      }),
      validateInputFailure: vi.fn((failureRequest: MainDispatchRequest, error: SerializedError) => {
        if (failureRequest.trigger !== ConversationContinuationTrigger.ContinueSteer) return undefined
        return {
          kind: ConversationHistoryAdapterKind.PersistentChat,
          request: failureRequest,
          error,
          executionModelIds: [modelId],
          resolvedModel: {
            id: modelId,
            name: 'Model',
            providerId: 'provider',
            capabilities: [],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          }
        } satisfies ValidatedConversationInputFailure
      }),
      commitInputFailureIntent: vi.fn(() =>
        committed(false, {
          persistence: failurePersistence,
          prepareExecutionContext: async () => {
            throw new Error('assistant skeleton transaction failed')
          }
        })
      )
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => active.stream)
    })

    await service.dispatch(activeListener, request('active'))
    await service.dispatch(successorListener, request('queued'))
    active.controller.close()

    await vi.waitFor(() => expect(provider.commitInputFailureIntent).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(failurePersistence.onError).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(successorListener.onError).toHaveBeenCalledOnce()
    expect(service.inspect(ref).inbox.nextTurn).toEqual([])
    expect(service.hasLiveStreams()).toBe(false)
  })

  it('retains an unrepresentable successor in the dock without leaving the conversation busy', async () => {
    const activeListener = listener()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const active = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => {
        if (
          !ctx.hasLiveStream &&
          req.trigger === ConversationOpenTrigger.SubmitMessage &&
          req.userMessageParts.some((part) => part.type === 'text' && part.text === 'successor')
        ) {
          throw new Error('continuation cannot be represented')
        }
        return validation(req, ctx.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => active.stream)
    })

    await service.dispatch(activeListener, request('active'))
    await service.dispatch(successorListener, queuedRequest('successor'))
    active.controller.close()

    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(service.inspect(ref).inbox.nextTurn).toHaveLength(1)
    expect(service.inboxSnapshot(ref).items).toEqual([
      expect.objectContaining({ presentation: expect.objectContaining({ draft: { text: 'successor', tokens: [] } }) })
    ])
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
    expect(service.hasLiveConversation(ref)).toBe(false)
    await vi.waitFor(() =>
      expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({ status: ConversationStatus.Done })
    )
  })

  it('drops the committed Chat successor envelope when its predecessor errors', async () => {
    const activeListener = listener()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const active = controlledStream()
    const openStream = vi.fn(async () => active.stream)
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(activeListener, request('active'))
    await expect(service.dispatch(successorListener, request('successor'))).resolves.toMatchObject({
      mode: ConversationOpenMode.Injected
    })
    active.controller.error(new Error('provider failed'))

    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(provider.commitIntent).toHaveBeenCalledTimes(2)
    expect(openStream).toHaveBeenCalledOnce()
    expect(service.hasLiveStreams()).toBe(false)
    expect(successorListener.onDone).not.toHaveBeenCalled()
  })

  it('answers a steer that lands in the chaining window instead of dropping it (variant A)', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const third = controlledStream()
    const successorListener = { ...listener(), id: 'successor-listener' }
    const chainingListener = { ...listener(), id: 'chaining-listener' }
    let chainingDispatch: Promise<Awaited<ReturnType<ConversationRuntimeService['dispatch']>>> | undefined
    const activeListener: StreamListener = {
      ...listener(),
      id: 'active-listener',
      onDone: vi.fn(() => {
        chainingDispatch ??= service.dispatch(chainingListener, request('chaining-window'))
      })
    }
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi
          .fn()
          .mockResolvedValueOnce(first.stream)
          .mockResolvedValueOnce(second.stream)
          .mockResolvedValueOnce(third.stream)
      )
    })

    await service.dispatch(activeListener, request('active'))
    await service.dispatch(successorListener, request('queued-before-terminal'))
    first.controller.close()

    await vi.waitFor(() => expect(chainingDispatch).toBeDefined())
    if (!chainingDispatch) throw new Error('terminal listener did not submit the chaining-window input')
    await expect(chainingDispatch).resolves.toMatchObject({ mode: ConversationOpenMode.Injected })
    expect(provider.commitIntent).toHaveBeenCalledTimes(4)
    expect(service.inspect(ref).inbox.nextTurn).toHaveLength(1)

    second.controller.close()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(5))
    third.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('drains a steer that lands right after a clean `done` settle (inter-turn race)', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const followUpSubscriber = { ...listener(), id: 'follow-up-subscriber' }
    let followUp: Promise<Awaited<ReturnType<ConversationRuntimeService['dispatch']>>> | undefined
    const firstSubscriber: StreamListener = {
      ...listener(),
      id: 'first-subscriber',
      onDone: vi.fn(() => {
        followUp ??= service.dispatch(followUpSubscriber, request('after-done'))
      })
    }
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(firstSubscriber, request('first'))
    first.controller.close()

    await vi.waitFor(() => expect(followUp).toBeDefined())
    if (!followUp) throw new Error('terminal callback did not submit the follow-up')
    await expect(followUp).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    expect(provider.commitIntent).toHaveBeenCalledTimes(2)

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('a finished turn with a queued steer chains a continuation instead of finishing (no idle flicker)', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const published: ConversationStatus[] = []
    services.cache.setShared.mockImplementation((key: string, value: unknown) => {
      cacheValues.set(key, value)
      if (key === 'conversation.statuses.chat:topic-1') {
        published.push((value as { status: ConversationStatus }).status)
      }
    })
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(subscriber, request('first'))
    await service.dispatch(subscriber, request('queued'))
    const terminalStart = published.length
    first.controller.close()

    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(3))
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    expect(published.slice(terminalStart)).not.toContain(ConversationStatus.Done)

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('stays busy throughout the next-turn drain, closing the clobber window', async () => {
    const first = controlledStream()
    const second = controlledStream()
    const subscriber = listener()
    let successorValidationStarted!: () => void
    let finishSuccessorValidation!: () => void
    let blockSuccessor = true
    const validationStarted = new Promise<void>((resolve) => {
      successorValidationStarted = resolve
    })
    const validationGate = new Promise<void>((resolve) => {
      finishSuccessorValidation = resolve
    })
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => {
        if (
          blockSuccessor &&
          currentRequest.trigger === ConversationContinuationTrigger.ContinueSteer &&
          !context.hasLiveStream
        ) {
          blockSuccessor = false
          successorValidationStarted()
          await validationGate
        }
        return validation(currentRequest, context.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(subscriber, request('first'))
    await service.dispatch(subscriber, request('queued'))
    first.controller.close()
    await validationStarted

    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
    expect(service.hasLiveConversation(ref)).toBe(true)
    const racingSubmit = service.dispatch(subscriber, request('racing-submit'))
    finishSuccessorValidation()

    await expect(racingSubmit).resolves.toMatchObject({ mode: ConversationOpenMode.Injected })
    expect(provider.commitIntent).toHaveBeenCalledTimes(4)
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    expect(service.inspect(ref).inbox.nextTurn).toHaveLength(1)

    service.stop(ref, 'test-cleanup')
    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('drops a steer landing after abort() but before the loop settles, even after a prior clean turn', async () => {
    const clean = controlledStream()
    const active = controlledStream()
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const openStream = vi.fn().mockResolvedValueOnce(clean.stream).mockResolvedValueOnce(active.stream)
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(subscriber, request('clean'))
    clean.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    await service.dispatch(subscriber, request('active'))
    await service.dispatch(subscriber, request('late steer'))

    expect(service.abort(ref, 'user-stop')).toBe(true)
    active.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(provider.commitIntent).toHaveBeenCalledTimes(3)
    expect(openStream).toHaveBeenCalledTimes(2)
    expect(service.inspect(ref).inbox.nextTurn).toEqual([])
  })

  it('retains a committed successor while paused and dispatches it once after the last hold', async () => {
    const subscriber = listener()
    const first = controlledStream()
    const successor = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(successor.stream)
      )
    })

    await service.dispatch(subscriber, request('first'))
    await service.dispatch(subscriber, request('queued'))
    const hold = service.pause('backup')
    first.controller.close()

    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
    expect(provider.commitIntent).toHaveBeenCalledTimes(2)
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({ status: ConversationStatus.Done })

    hold.dispose()
    await vi.waitFor(() => expect(provider.commitIntent).toHaveBeenCalledTimes(3))
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)

    successor.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('drains terminal descendants to a fixed point before a paused snapshot may proceed', async () => {
    let finishCleanup!: () => void
    const cleanupRun = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    const cleanup: StreamCleanupPort = {
      id: 'cleanup-1',
      onTopicQuiesced: vi.fn(() => cleanupRun)
    }
    const subscriber = listener()
    const controlled = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false, { cleanup }))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await service.dispatch(subscriber, request())
    const hold = service.pause('backup')
    controlled.controller.close()
    const draining = service.drainInFlight({ timeoutMs: 5_000 })

    await vi.waitFor(() => expect(cleanup.onTopicQuiesced).toHaveBeenCalledOnce())
    let drained = false
    void draining.then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    finishCleanup()
    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('drains Actor-owned topic naming work before a paused snapshot may proceed', async () => {
    let finishNaming!: () => void
    const namingRun = new Promise<void>((resolve) => {
      finishNaming = resolve
    })
    let namingStarted = false
    const namingTasks: ConversationNamingTaskExecutor = {
      executePostCommit: () => {
        namingStarted = true
        return namingRun
      },
      executeAfterPersist: async () => {}
    }
    const controlled = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() =>
        committed(false, {
          postCommitTask: {
            kind: ConversationPostCommitTaskKind.RenameChatFromFirstUser,
            topicId: ref.id,
            userMessageId: 'user-1'
          }
        })
      )
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream),
      namingTasks
    })

    await service.dispatch(listener(), request())
    await vi.waitFor(() => expect(namingStarted).toBe(true))
    const hold = service.pause('backup')
    const draining = service.drainInFlight({ timeoutMs: 5_000 })
    controlled.controller.close()

    let drained = false
    void draining.then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    finishNaming()
    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('rejects autonomous admission while a pause barrier is active', () => {
    const service = new ConversationRuntimeService({ providers: [] })
    const hold = service.pause('backup')

    expect(service.startAgentAutonomous('session-1', toAgentRuntimeSegmentId('autonomous-segment'), false)).toBe(false)

    hold.dispose()
  })

  it('rejects an autonomous history commit queued before the pause barrier begins', async () => {
    const service = new ConversationRuntimeService({ providers: [] })
    const conversation = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const input = {
      id: toConversationInputId('runtime-input-1'),
      historyNodeId: 'autonomous:runtime-input-1',
      provenance: ConversationInputProvenance.Runtime,
      responder: ConversationResponderKind.Headless
    }
    const scheduled = (
      service as unknown as {
        scheduleAutonomousTurn: (
          ref: typeof conversation,
          value: typeof input,
          effectId: ReturnType<typeof toConversationEffectId>
        ) => Promise<void>
      }
    ).scheduleAutonomousTurn(conversation, input, toConversationEffectId('suspend-1'))
    const hold = service.pause('backup')

    await expect(scheduled).rejects.toThrow('write-quiesced')
    expect(services.agentConnection.describeConversationAutonomous).not.toHaveBeenCalled()

    hold.dispose()
  })

  it('flushes a deferred foreground resume only after the last pause hold releases', async () => {
    const service = new ConversationRuntimeService({ providers: [] })
    const conversation = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const internals = service as unknown as {
      actorFor: (ref: typeof conversation) => ConversationActor
      executionResources: {
        start: (effect: unknown, sink: unknown) => void
        suspend: (effect: unknown) => boolean
        resumeSuspended: (effect: unknown) => void
        discardRuntimeBuffer: (effect: unknown) => void
      }
    }
    vi.spyOn(internals.executionResources, 'start').mockImplementation(() => {})
    vi.spyOn(internals.executionResources, 'suspend').mockReturnValue(true)
    const resume = vi.spyOn(internals.executionResources, 'resumeSuspended').mockImplementation(() => {})
    const discard = vi.spyOn(internals.executionResources, 'discardRuntimeBuffer').mockImplementation(() => {})
    const actor = internals.actorFor(conversation)
    actor.openTurn(
      [
        {
          id: toConversationInputId('foreground-input'),
          historyNodeId: 'foreground-input',
          provenance: ConversationInputProvenance.Renderer,
          responder: ConversationResponderKind.Interactive
        }
      ],
      [
        {
          id: toConversationExecutionId('foreground-execution'),
          outputNodeId: 'foreground-assistant',
          driver: ConversationExecutionDriverKind.Agent,
          modelId,
          startEffectId: toConversationEffectId('foreground-run')
        }
      ],
      { turnId: toConversationTurnId('foreground-turn') }
    )
    actor.requestRuntimePreemption(
      {
        id: toConversationInputId('runtime-input'),
        historyNodeId: 'runtime-input',
        provenance: ConversationInputProvenance.Runtime,
        responder: ConversationResponderKind.Headless
      },
      toAgentRuntimeSegmentId('runtime-segment')
    )
    const preempting = actor.inspect()
    if (preempting.phase !== ConversationPhase.Running || preempting.runMode !== ConversationRunMode.Preempting) {
      throw new Error('runtime preemption did not reach the commit boundary')
    }
    const first = service.pause('backup-1')
    const second = service.pause('backup-2')

    actor.failRuntimeTurnCommit(preempting.suspendEffectId)
    expect(discard).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    await expect(service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })

    first.dispose()
    await Promise.resolve()
    expect(resume).not.toHaveBeenCalled()
    second.dispose()
    await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce())
  })

  it('does not let an old turn cleanup overwrite a newer turn status', async () => {
    let finishCleanup!: () => void
    const cleanupRun = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    const cleanup: StreamCleanupPort = {
      id: 'cleanup-old-turn',
      onTopicQuiesced: vi.fn(() => cleanupRun)
    }
    const subscriber = listener()
    const first = controlledStream()
    const second = controlledStream()
    let commitCount = 0
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false, { cleanup: commitCount++ === 0 ? cleanup : undefined }))
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(
        vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
      )
    })

    await service.dispatch(subscriber, request('first'))
    first.controller.close()
    await vi.waitFor(() => expect(cleanup.onTopicQuiesced).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))

    await service.dispatch(subscriber, request('second'))
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)
    finishCleanup()
    await Promise.resolve()
    await Promise.resolve()

    expect(services.cache.setShared).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ status: ConversationStatus.Pending })
    )

    second.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('rejects an invalid admission preview before the history commit can write rows', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => ({
        ...validation(req, ctx.hasLiveStream),
        executionModelIds: [modelId]
      })),
      commitIntent: vi.fn(() => committed(false))
    }
    const controlled = controlledStream()
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await service.dispatch(subscriber, request('first'))
    await expect(service.dispatch(subscriber, request('second'))).rejects.toThrow(
      'Active input cannot commit execution skeletons'
    )
    expect(provider.commitIntent).toHaveBeenCalledOnce()

    service.stop(ref, 'test-cleanup')
  })

  it('leaves the aggregate unchanged when the synchronous history transaction fails', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => {
        throw new Error('sqlite transaction failed')
      })
    }
    const service = new ConversationRuntimeService({ providers: [provider] })

    await expect(service.dispatch(subscriber, request())).rejects.toThrow('sqlite transaction failed')
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
  })

  it('persists paused exactly once when Stop lands after durable acknowledgement', async () => {
    let finishPreparation!: (value: ConversationExecutionContext) => void
    const preparation = new Promise<ConversationExecutionContext>((resolve) => {
      finishPreparation = resolve
    })
    const subscriber = listener()
    const persistence = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false, { persistence, prepareExecutionContext: () => preparation }))
    }
    const service = new ConversationRuntimeService({ providers: [provider] })

    await service.dispatch(subscriber, request())
    service.stop(ref, 'user-stop')
    finishPreparation({
      conversation: ref,
      models: [
        {
          modelId,
          request: {
            chatId: ref.id,
            trigger: ConversationOpenTrigger.SubmitMessage,
            uniqueModelId: modelId,
            messageId: 'assistant-1',
            messages: []
          }
        }
      ]
    })

    await vi.waitFor(() => expect(persistence.onPaused).toHaveBeenCalledOnce())
    expect(persistence.onError).not.toHaveBeenCalled()
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
    expect(vi.mocked(persistence.onPaused).mock.calls[0]?.[0]).toMatchObject({
      status: ConversationOutcomeKind.Paused
    })
  })

  it('serializes a durable approval decision and its continuation in one actor command', async () => {
    const subscriber = listener()
    const controlled = controlledStream()
    const commitInteractionDecision = vi.fn(() => ({ kind: ConversationInteractionCommitResultKind.Ready as const }))
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false)),
      commitInteractionDecision
    }
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(async () => controlled.stream)
    })

    await expect(
      service.respondChatToolApproval(ref, 'assistant-1', { approvalId: 'approval-1', approved: true }, subscriber)
    ).resolves.toBe(true)

    expect(commitInteractionDecision).toHaveBeenCalledWith('assistant-1', {
      approvalId: 'approval-1',
      approved: true
    })
    expect(provider.commitIntent).toHaveBeenCalledOnce()
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)

    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('refuses to inject a prepared turn onto a live topic (approval continue-conversation race)', async () => {
    const first = controlledStream()
    const continuation = controlledStream()
    const subscriber = listener()
    let approvalValidationStarted!: () => void
    let finishApprovalValidation!: () => void
    const approvalValidation = new Promise<void>((resolve) => {
      finishApprovalValidation = resolve
    })
    const validationStarted = new Promise<void>((resolve) => {
      approvalValidationStarted = resolve
    })
    const commitInteractionDecision = vi.fn(() => ({
      kind: ConversationInteractionCommitResultKind.Ready as const
    }))
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (currentRequest, context) => {
        if (currentRequest.trigger === ConversationContinuationTrigger.ContinueInteraction) {
          approvalValidationStarted()
          await approvalValidation
        }
        return validation(currentRequest, context.hasLiveStream)
      }),
      commitIntent: vi.fn((currentValidation) => committed(currentValidation.context.hasLiveStream)),
      commitInteractionDecision
    }
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(continuation.stream)
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(subscriber, request('first'))
    first.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as UIMessageChunk)
    first.controller.close()
    await vi.waitFor(() => {
      const state = service.inspect(ref)
      expect(state.phase).toBe(ConversationPhase.Running)
      if (state.phase === ConversationPhase.Running) {
        expect([...state.turn.executions.values()][0]?.phase).toBe(ConversationExecutionPhase.WaitingInteraction)
      }
    })

    const approval = service.respondChatToolApproval(
      ref,
      'assistant-1',
      { approvalId: 'approval-1', approved: true },
      subscriber
    )
    await validationStarted
    const competingSubmit = service.dispatch(subscriber, request('competing-submit'))
    finishApprovalValidation()

    await expect(approval).resolves.toBe(true)
    await expect(competingSubmit).resolves.toMatchObject({ mode: ConversationOpenMode.Injected })
    expect(openStream).toHaveBeenCalledTimes(2)
    const state = service.inspect(ref)
    expect(state.phase).toBe(ConversationPhase.Running)
    expect(state.inbox.nextTurn).toHaveLength(1)

    service.stop(ref, 'test-cleanup')
    continuation.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('reconciles a duplicate durable approval decision with the still-waiting aggregate', async () => {
    const subscriber = listener()
    const first = controlledStream()
    const continuation = controlledStream()
    const commitInteractionDecision = vi.fn(() => ({
      kind: ConversationInteractionCommitResultKind.Duplicate as const,
      continuation: ConversationInteractionCommitResultKind.Ready as const
    }))
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateIntent: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitIntent: vi.fn(() => committed(false)),
      commitInteractionDecision
    }
    const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(continuation.stream)
    const service = new ConversationRuntimeService({
      providers: [provider],
      executionManager: new AiExecutionManager(openStream)
    })

    await service.dispatch(subscriber, request())
    first.controller.enqueue({
      type: 'tool-approval-request',
      approvalId: 'approval-1',
      toolCallId: 'tool-1'
    } as UIMessageChunk)
    first.controller.close()
    await vi.waitFor(() => {
      const state = service.inspect(ref)
      expect(state.phase).toBe(ConversationPhase.Running)
      if (state.phase === ConversationPhase.Running) {
        expect([...state.turn.executions.values()][0]?.phase).toBe(ConversationExecutionPhase.WaitingInteraction)
      }
    })
    expect(cacheValues.get('conversation.statuses.chat:topic-1')).toMatchObject({
      status: ConversationStatus.AwaitingInteraction,
      activeExecutions: [expect.objectContaining({ outputNodeId: 'assistant-1' })],
      awaitingInteractionExecutions: [expect.objectContaining({ outputNodeId: 'assistant-1' })]
    })

    await expect(
      service.respondChatToolApproval(ref, 'assistant-1', { approvalId: 'approval-1', approved: true }, subscriber)
    ).resolves.toBe(true)
    const resumed = service.inspect(ref)
    expect(resumed.phase).toBe(ConversationPhase.Running)
    if (resumed.phase === ConversationPhase.Running) {
      expect([...resumed.turn.executions.values()][0]?.phase).toBe(ConversationExecutionPhase.Starting)
      expect(resumed.turn.interactions.size).toBe(0)
    }

    continuation.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })
})
