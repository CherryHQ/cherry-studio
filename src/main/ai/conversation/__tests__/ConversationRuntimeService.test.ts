import { BaseService } from '@main/core/lifecycle'
import {
  ConversationAttachStatus,
  ConversationExecutionAttachState,
  ConversationExecutionPhase,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  ConversationOutcomeKind,
  ConversationPhase,
  ConversationStatus,
  ConversationStreamTerminalStatus
} from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CommittedDispatch,
  ConversationHistoryPort,
  MainDispatchRequest,
  StreamCleanupPort,
  StreamListener,
  ValidatedDispatch
} from '../../streamManager'
import {
  ConversationHistoryAdapterKind,
  ConversationInteractionCommitResultKind
} from '../../streamManager/context/ConversationHistoryPort'
import { AiExecutionManager, ConversationRuntimeService } from '..'

const services = vi.hoisted(() => ({
  cache: { getShared: vi.fn(), setShared: vi.fn() },
  agentConnection: { prepareConversationAutonomous: vi.fn() }
}))
vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => (name === 'AgentConnectionManager' ? services.agentConnection : services.cache))
  }
}))

const modelId = createUniqueModelId('provider', 'model')
const ref = { kind: ConversationKind.Chat, id: 'topic-1' } as const

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

function validation(req: MainDispatchRequest, hasLiveStream: boolean): ValidatedDispatch {
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
  subscriber: StreamListener,
  hasLiveStream: boolean,
  options: {
    prepareExecutionContext?: CommittedDispatch['prepareExecutionContext']
    persistence?: StreamListener
    cleanup?: StreamCleanupPort
  } = {}
): CommittedDispatch {
  if (hasLiveStream) {
    return {
      reservation: {
        conversation: ref,
        models: [],
        listeners: [subscriber],
        persistencePorts: [],
        cleanupPorts: [],
        pendingSteerUserMessageId: 'user-2',
        reservedMessages: [{ id: 'user-2', role: 'user', parts: [] }]
      },
      prepareExecutionContext: async () => ({ conversation: ref, models: [] })
    }
  }
  const persistence = options.persistence ?? listener()
  return {
    reservation: {
      conversation: ref,
      models: [{ modelId, outputNodeId: 'assistant-1' }],
      listeners: [subscriber],
      persistencePorts: [persistence],
      cleanupPorts: options.cleanup ? [options.cleanup] : [],
      reservedMessages: [
        { id: 'user-1', role: 'user', parts: [] },
        { id: 'assistant-1', role: 'assistant', parts: [] }
      ]
    },
    prepareExecutionContext:
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
  }
}

describe('ConversationRuntimeService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
  })

  it('acknowledges the durable skeleton before asynchronous execution preparation finishes', async () => {
    let finishPreparation!: (value: Awaited<ReturnType<CommittedDispatch['prepareExecutionContext']>>) => void
    const preparation = new Promise<Awaited<ReturnType<CommittedDispatch['prepareExecutionContext']>>>((resolve) => {
      finishPreparation = resolve
    })
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => committed(subscriber, false, { prepareExecutionContext: () => preparation }))
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

    finishPreparation(await committed(subscriber, false).prepareExecutionContext(new AbortController().signal))
    controlled.controller.close()
    await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
  })

  it('attaches with an atomic live snapshot and an explicit settled terminal', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => committed(subscriber, false))
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
      validateDispatch: vi.fn(async (req, ctx) => {
        await blocked
        return validation(req, ctx.hasLiveStream)
      }),
      commitDispatch: vi.fn(() => committed(subscriber, false))
    }
    const service = new ConversationRuntimeService({ providers: [provider] })

    const opening = service.dispatch(subscriber, request())
    await vi.waitFor(() => expect(provider.validateDispatch).toHaveBeenCalledOnce())
    service.stop(ref, 'user-stop')
    finishValidation()

    await expect(opening).rejects.toThrow('superseded')
    expect(provider.commitDispatch).not.toHaveBeenCalled()
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
  })

  it('turns a post-ack context failure into one durable Error terminal', async () => {
    const subscriber = listener()
    const persistence = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() =>
        committed(subscriber, false, {
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
      validateDispatch: vi.fn(async (req, ctx) => {
        contexts.push(ctx.hasLiveStream)
        return validation(req, ctx.hasLiveStream)
      }),
      commitDispatch: vi.fn((currentSubscriber, currentValidation) =>
        committed(currentSubscriber, currentValidation.context.hasLiveStream)
      )
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

  it('retains a committed successor while paused and dispatches it once after the last hold', async () => {
    const subscriber = listener()
    const first = controlledStream()
    const successor = controlledStream()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn((currentSubscriber, currentValidation) =>
        committed(currentSubscriber, currentValidation.context.hasLiveStream)
      )
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
    expect(provider.commitDispatch).toHaveBeenCalledTimes(2)

    hold.dispose()
    await vi.waitFor(() => expect(provider.commitDispatch).toHaveBeenCalledTimes(3))
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
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => committed(subscriber, false, { cleanup }))
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
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => committed(subscriber, false, { cleanup: commitCount++ === 0 ? cleanup : undefined }))
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
      validateDispatch: vi.fn(async (req, ctx) => ({
        ...validation(req, ctx.hasLiveStream),
        executionModelIds: [modelId]
      })),
      commitDispatch: vi.fn(() => committed(subscriber, false))
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
    expect(provider.commitDispatch).toHaveBeenCalledOnce()

    service.stop(ref, 'test-cleanup')
  })

  it('leaves the aggregate unchanged when the synchronous history transaction fails', async () => {
    const subscriber = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => {
        throw new Error('sqlite transaction failed')
      })
    }
    const service = new ConversationRuntimeService({ providers: [provider] })

    await expect(service.dispatch(subscriber, request())).rejects.toThrow('sqlite transaction failed')
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle)
  })

  it('persists paused exactly once when Stop lands after durable acknowledgement', async () => {
    let finishPreparation!: (value: Awaited<ReturnType<CommittedDispatch['prepareExecutionContext']>>) => void
    const preparation = new Promise<Awaited<ReturnType<CommittedDispatch['prepareExecutionContext']>>>((resolve) => {
      finishPreparation = resolve
    })
    const subscriber = listener()
    const persistence = listener()
    const provider: ConversationHistoryPort = {
      name: 'test-chat',
      isPersistentConversation: true,
      canHandle: () => true,
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() =>
        committed(subscriber, false, { persistence, prepareExecutionContext: () => preparation })
      )
    }
    const service = new ConversationRuntimeService({ providers: [provider] })

    await service.dispatch(subscriber, request())
    service.stop(ref, 'user-stop')
    finishPreparation(await committed(subscriber, false).prepareExecutionContext(new AbortController().signal))

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
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => committed(subscriber, false)),
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
    expect(provider.commitDispatch).toHaveBeenCalledOnce()
    expect(service.inspect(ref).phase).toBe(ConversationPhase.Running)

    controlled.controller.close()
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
      validateDispatch: vi.fn(async (req, ctx) => validation(req, ctx.hasLiveStream)),
      commitDispatch: vi.fn(() => committed(subscriber, false)),
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
