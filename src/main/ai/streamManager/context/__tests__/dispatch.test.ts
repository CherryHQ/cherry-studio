import { AgentSessionWorkspaceError } from '@main/ai/runtime/agentSessionWorkspace'
import { BaseService } from '@main/core/lifecycle'
import {
  ConversationActiveNodeMove,
  ConversationBlockReason,
  ConversationContinuationTrigger,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  ConversationPhase,
  type ConversationRef
} from '@shared/ai/conversation'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiExecutionManager, ConversationRuntimeService } from '../../../conversation'
import type {
  CommittedConversationIntent,
  ConversationHistoryPort,
  MainDispatchRequest,
  StreamListener,
  ValidatedConversationIntent
} from '../..'
import {
  ConversationExecutionDriverBindingKind,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  ConversationTerminalPersistenceKind
} from '../ConversationHistoryPort'

const mocks = vi.hoisted(() => ({
  cache: { getShared: vi.fn(), setShared: vi.fn() },
  agentConnection: {
    redirectConversationInput: vi.fn(() => false),
    discardAutonomousBuffer: vi.fn()
  },
  getSessionMessage: vi.fn((sessionId: string, id: string) => ({
    id,
    sessionId,
    role: 'user',
    data: { parts: [] },
    status: 'success',
    delivery: null
  })),
  namingWrites: new Map<string, Promise<void>>()
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'AgentConnectionManager') return mocks.agentConnection
      return mocks.cache
    })
  }
}))

vi.mock('@main/data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getSessionMessage: mocks.getSessionMessage }
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { inFlightWrites: () => mocks.namingWrites }
}))

const MODEL_A = createUniqueModelId('provider', 'model-a')
const MODEL_B = createUniqueModelId('provider', 'model-b')

function listener(): StreamListener {
  return {
    id: 'wc:1',
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
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

function request(
  conversation: ConversationRef,
  options: {
    text?: string
    reasoningEffort?: ReasoningEffortOption
    fastMode?: boolean
    headless?: boolean
  } = {}
): MainDispatchRequest {
  return {
    trigger: ConversationOpenTrigger.SubmitMessage,
    conversation,
    userMessageParts: [{ type: 'text', text: options.text ?? 'hello' }],
    reasoningEffort: options.reasoningEffort,
    fastMode: options.fastMode,
    headless: options.headless
  }
}

function validation(
  req: MainDispatchRequest,
  hasLiveStream: boolean,
  models: readonly UniqueModelId[] = hasLiveStream ? [] : [MODEL_A]
): ValidatedConversationIntent {
  return {
    kind: ConversationHistoryAdapterKind.PersistentChat,
    request: req,
    context: { hasLiveStream },
    executionModelIds: models,
    resolvedModels: [],
    inputModelId: models[0] ?? MODEL_A
  }
}

function committed(
  req: MainDispatchRequest,
  hasLiveStream: boolean,
  models: readonly UniqueModelId[] = hasLiveStream ? [] : [MODEL_A]
): CommittedConversationIntent {
  const userMessageParts = req.trigger === ConversationOpenTrigger.SubmitMessage ? req.userMessageParts : []
  const reasoningEffort = 'reasoningEffort' in req ? req.reasoningEffort : undefined
  const fastMode = 'fastMode' in req && req.fastMode === true
  if (hasLiveStream) {
    return {
      conversation: req.conversation,
      input: {
        historyNodeId: 'user-queued',
        pendingSteerReasoningEffort: reasoningEffort,
        pendingSteerFastMode: fastMode
      },
      executions: [],
      reservedMessages: [{ id: 'user-queued', role: 'user', parts: userMessageParts }],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: []
    }
  }
  return {
    conversation: req.conversation,
    input: { historyNodeId: 'user-committed' },
    executions: models.map((modelId, index) => {
      const outputNodeId = `assistant-${index + 1}`
      return {
        modelId,
        outputNodeId,
        preparation: {
          kind: ConversationExecutionPreparationKind.TemporaryChat as const,
          conversation: req.conversation,
          modelId,
          outputNodeId,
          messages: [],
          fastMode: false
        },
        preparationIndex: 0,
        persistence: {
          kind: ConversationTerminalPersistenceKind.TemporaryChat as const,
          topicId: req.conversation.id,
          modelId,
          messageId: outputNodeId
        },
        driver: { kind: ConversationExecutionDriverBindingKind.Chat as const }
      }
    }),
    reservedMessages: [
      { id: 'user-committed', role: 'user' as const, parts: userMessageParts },
      ...models.map((_, index) => ({ id: `assistant-${index + 1}`, role: 'assistant' as const, parts: [] }))
    ],
    activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
    postCommitTasks: []
  }
}

function provider(
  canHandle: (conversation: ConversationRef) => boolean,
  hooks: {
    validate?: ConversationHistoryPort['validateIntent']
    commit?: ConversationHistoryPort['commitIntent']
  } = {}
): ConversationHistoryPort & {
  validateIntent: ReturnType<typeof vi.fn>
  commitIntent: ReturnType<typeof vi.fn>
} {
  const validateIntent = vi.fn(
    hooks.validate ??
      (async (req: MainDispatchRequest, context: { hasLiveStream: boolean }) => validation(req, context.hasLiveStream))
  )
  const commitIntent = vi.fn(
    hooks.commit ??
      ((current: ValidatedConversationIntent, context: { hasLiveStream: boolean }) =>
        committed(current.request, context.hasLiveStream, current.executionModelIds))
  )
  return {
    name: 'test-history',
    isPersistentConversation: true,
    canHandle,
    validateIntent,
    commitIntent,
    prepareExecutionContext: async (descriptor, signal) => {
      signal.throwIfAborted()
      if (descriptor.kind !== ConversationExecutionPreparationKind.TemporaryChat) {
        throw new Error(`Unexpected test descriptor ${descriptor.kind}`)
      }
      return {
        conversation: descriptor.conversation,
        models: [
          {
            modelId: descriptor.modelId,
            request: {
              chatId: descriptor.conversation.id,
              trigger: ConversationOpenTrigger.SubmitMessage,
              uniqueModelId: descriptor.modelId,
              messageId: descriptor.outputNodeId,
              messages: [...descriptor.messages]
            }
          }
        ]
      }
    },
    persistTerminal: async () => {}
  } as never
}

function service(providers: readonly ConversationHistoryPort[], streams = [controlledStream()]) {
  const remaining = [...streams]
  const open = vi.fn(async () => remaining.shift()?.stream ?? new ReadableStream<UIMessageChunk>({}))
  return {
    runtime: new ConversationRuntimeService({ providers, executionManager: new AiExecutionManager(open) }),
    open
  }
}

describe('ConversationRuntimeService.dispatch — steer and ownership', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.namingWrites.clear()
  })

  it('persists a live chat submit as a steer and enqueues it (no abort, stream stays live)', async () => {
    const ref = { kind: ConversationKind.Chat, id: 'topic-1' } as const
    const contexts: boolean[] = []
    const history = provider(() => true, {
      validate: async (req, context) => {
        contexts.push(context.hasLiveStream)
        return validation(req, context.hasLiveStream)
      }
    })
    const { runtime } = service([history])

    await runtime.dispatch(listener(), request(ref, { text: 'first' }))
    const result = await runtime.dispatch(listener(), request(ref, { text: 'steer', reasoningEffort: 'high' }))

    expect(result).toMatchObject({ mode: ConversationOpenMode.Injected, reservedMessages: [{ id: 'user-queued' }] })
    expect(contexts).toEqual([false, true])
    expect(runtime.inspect(ref).inbox.nextTurn).toHaveLength(1)
    expect(runtime.inspect(ref).phase).toBe(ConversationPhase.Running)
  })

  it('carries Fast into a queued steer continuation', async () => {
    const ref = { kind: ConversationKind.Chat, id: 'topic-fast' } as const
    const first = controlledStream()
    const second = controlledStream()
    const history = provider(() => true)
    const { runtime } = service([history], [first, second])

    await runtime.dispatch(listener(), request(ref, { text: 'first' }))
    await runtime.dispatch(listener(), request(ref, { text: 'steer', reasoningEffort: 'high', fastMode: true }))
    first.controller.close()

    await vi.waitFor(() =>
      expect(history.validateIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: ConversationContinuationTrigger.ContinueSteer,
          reasoningEffort: 'high',
          fastMode: true
        }),
        expect.objectContaining({ hasLiveStream: false }),
        expect.any(AbortSignal)
      )
    )
    second.controller.close()
  })

  it('does not enqueue a steer for a non-live chat submit (normal turn opens models)', async () => {
    const ref = { kind: ConversationKind.Chat, id: 'topic-2' } as const
    const history = provider(() => true)
    const { runtime, open } = service([history])

    const result = await runtime.dispatch(listener(), request(ref))

    expect(result).toMatchObject({ mode: ConversationOpenMode.Started })
    expect(runtime.inspect(ref).inbox.nextTurn).toEqual([])
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce())
  })

  it('snapshots temporary ownership at admission', async () => {
    const ref = { kind: ConversationKind.Chat, id: 'temporary-1' } as const
    let temporaryOwns = true
    let finishValidation!: () => void
    const blocked = new Promise<void>((resolve) => {
      finishValidation = resolve
    })
    const temporary = provider(() => temporaryOwns, {
      validate: async (req, context) => {
        await blocked
        return validation(req, context.hasLiveStream)
      }
    })
    const persistent = provider(() => !temporaryOwns)
    const { runtime } = service([temporary, persistent])

    const opening = runtime.dispatch(listener(), request(ref))
    await vi.waitFor(() => expect(temporary.validateIntent).toHaveBeenCalledOnce())
    temporaryOwns = false
    finishValidation()
    await expect(opening).resolves.toMatchObject({ mode: ConversationOpenMode.Started })

    expect(temporary.commitIntent).toHaveBeenCalledOnce()
    expect(persistent.commitIntent).not.toHaveBeenCalled()
  })

  it('never classifies an Agent follow-up as a Chat steer', async () => {
    const ref = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const history = provider((conversation) => conversation.kind === ConversationKind.Agent)
    const { runtime } = service([history])

    await runtime.dispatch(listener(), request(ref, { text: 'first', headless: true }))
    const result = await runtime.dispatch(listener(), request(ref, { text: 'follow-up', headless: true }))

    expect(result).toMatchObject({ mode: ConversationOpenMode.Injected })
    expect(runtime.inspect(ref).inbox.nextTurn).toHaveLength(1)
    expect(runtime.inspect(ref).inbox.nextStep).toEqual([])
  })

  it('returns mode:blocked without committing when validation throws a workspace error', async () => {
    const ref = { kind: ConversationKind.Agent, id: 'session-workspace' } as const
    const history = provider(() => true, {
      validate: async () => Promise.reject(new AgentSessionWorkspaceError('workspace missing'))
    })
    const { runtime, open } = service([history])

    await expect(runtime.dispatch(listener(), request(ref))).resolves.toMatchObject({
      mode: ConversationOpenMode.Blocked,
      reason: ConversationBlockReason.AgentSessionWorkspace,
      message: 'workspace missing'
    })
    expect(history.commitIntent).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('rethrows a non-workspace validation error and does not commit', async () => {
    const ref = { kind: ConversationKind.Agent, id: 'session-error' } as const
    const history = provider(() => true, { validate: async () => Promise.reject(new Error('boom')) })
    const { runtime, open } = service([history])

    await expect(runtime.dispatch(listener(), request(ref))).rejects.toThrow('boom')
    expect(history.commitIntent).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('validates multi-model placeholders before registering resources', async () => {
    const ref = { kind: ConversationKind.Chat, id: 'topic-3' } as const
    const history = provider(() => true, {
      validate: async (req, context) => validation(req, context.hasLiveStream, [MODEL_A, MODEL_B]),
      commit: (current, context) => committed(current.request, context.hasLiveStream, [MODEL_A])
    })
    const { runtime, open } = service([history])

    await expect(runtime.dispatch(listener(), request(ref))).rejects.toThrow(
      'History adapter changed the execution count after admission preview'
    )
    expect(open).not.toHaveBeenCalled()
  })

  it('opens a regenerate turn when an explicit append target settles during validation', async () => {
    const ref = { kind: ConversationKind.Chat, id: 'topic-append' } as const
    const first = controlledStream()
    const second = controlledStream()
    let finishAppendValidation!: () => void
    const appendValidation = new Promise<void>((resolve) => {
      finishAppendValidation = resolve
    })
    const history = provider(() => true, {
      validate: async (req, context) => {
        if (req.trigger === ConversationOpenTrigger.AppendModel) await appendValidation
        return validation(req, context.hasLiveStream, [MODEL_B])
      },
      commit: (current, context) => committed(current.request, context.hasLiveStream, current.executionModelIds)
    })
    const { runtime, open } = service([history], [first, second])

    await runtime.dispatch(listener(), request(ref))
    const append = runtime.dispatch(listener(), {
      trigger: ConversationOpenTrigger.AppendModel,
      conversation: ref,
      parentAnchorId: 'user-1',
      appendToLiveGroupMessageId: 'assistant-1',
      mentionedModelIds: [MODEL_B]
    })
    await vi.waitFor(() => expect(history.validateIntent).toHaveBeenCalledTimes(2))
    first.controller.close()
    await vi.waitFor(() => expect(runtime.inspect(ref).phase).toBe(ConversationPhase.Idle))
    finishAppendValidation()

    await expect(append).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
    expect(history.commitIntent).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledTimes(2)
    second.controller.close()
  })
})
