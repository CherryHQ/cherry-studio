/**
 * Write-quiesce contracts retained from AiStreamManager after ConversationRuntime
 * became the admission and persistence owner.
 */

import { BaseService } from '@main/core/lifecycle'
import {
  ConversationActiveNodeMove,
  ConversationBlockReason,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  type ConversationRef
} from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AiExecutionManager,
  type ConversationNamingTaskExecutor,
  ConversationPhase,
  ConversationRuntimeService,
  PromptStreamManager
} from '../../conversation'
import type {
  CommittedConversationIntent,
  ConversationHistoryPort,
  MainDispatchRequest,
  StreamCleanupPort,
  StreamListener,
  ValidatedConversationIntent
} from '..'
import {
  ConversationAfterPersistTaskKind,
  ConversationExecutionDriverBindingKind,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  ConversationPostCommitTaskKind,
  ConversationTerminalPersistenceKind
} from '../context/ConversationHistoryPort'

const services = vi.hoisted(() => ({
  cache: { getShared: vi.fn(), setShared: vi.fn() },
  agentConnection: { prepareConversationAutonomous: vi.fn() },
  ai: { streamText: vi.fn() }
}))

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'AgentConnectionManager') return services.agentConnection
      if (name === 'AiService') return services.ai
      return services.cache
    })
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
const chatRef = { kind: ConversationKind.Chat, id: 'topic-1' } as const
const agentRef = { kind: ConversationKind.Agent, id: 'session-1' } as const

function streamListener(id = 'listener-1'): StreamListener {
  return {
    id,
    onChunk: vi.fn(),
    onDone: vi.fn(),
    onPaused: vi.fn(),
    onError: vi.fn(),
    isAlive: () => true
  }
}

function controlledStream(): {
  stream: ReadableStream<UIMessageChunk>
  controller: ReadableStreamDefaultController<UIMessageChunk>
} {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value
    }
  })
  return { stream, controller }
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function tracked<T>(promise: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let isSettled = false
  const observed = promise.finally(() => {
    isSettled = true
  })
  return { promise: observed, settled: () => isSettled }
}

function request(ref: ConversationRef, text = 'hello'): MainDispatchRequest {
  return {
    trigger: ConversationOpenTrigger.SubmitMessage,
    conversation: ref,
    userMessageParts: [{ type: 'text', text }]
  }
}

function validated(req: MainDispatchRequest, hasLiveStream: boolean): ValidatedConversationIntent {
  return {
    kind:
      req.conversation.kind === ConversationKind.Agent
        ? ConversationHistoryAdapterKind.Agent
        : ConversationHistoryAdapterKind.PersistentChat,
    request: req,
    context: { hasLiveStream },
    executionModelIds: hasLiveStream ? [] : [modelId],
    resolvedModels: [],
    inputModelId: modelId,
    ...(req.conversation.kind === ConversationKind.Agent ? { agent: {} as never } : {})
  } as ValidatedConversationIntent
}

function committedIntent(
  validation: ValidatedConversationIntent,
  options: {
    cleanup?: StreamCleanupPort
    postCommitTask?: CommittedConversationIntent['postCommitTasks'][number]
    afterPersistTask?: NonNullable<CommittedConversationIntent['executions'][number]['afterPersist']>
  } = {}
): CommittedConversationIntent {
  const ref = validation.request.conversation
  if (validation.context.hasLiveStream) {
    return {
      conversation: ref,
      input: { historyNodeId: `${ref.id}-queued-user` },
      executions: [],
      reservedMessages: [{ id: `${ref.id}-queued-user`, role: 'user', parts: [] }],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: []
    }
  }
  const outputNodeId = `${ref.id}-assistant`
  return {
    conversation: ref,
    input: { historyNodeId: `${ref.id}-user` },
    executions: [
      {
        modelId,
        outputNodeId,
        preparation: {
          kind: ConversationExecutionPreparationKind.TemporaryChat,
          conversation: ref,
          modelId,
          outputNodeId,
          messages: [{ id: `${ref.id}-user`, role: 'user', parts: [] }],
          fastMode: false
        },
        preparationIndex: 0,
        persistence: {
          kind: ConversationTerminalPersistenceKind.TemporaryChat,
          topicId: ref.id,
          modelId,
          messageId: outputNodeId
        },
        ...(options.afterPersistTask ? { afterPersist: options.afterPersistTask } : {}),
        driver: { kind: ConversationExecutionDriverBindingKind.Chat }
      }
    ],
    reservedMessages: [
      { id: `${ref.id}-user`, role: 'user', parts: [] },
      { id: outputNodeId, role: 'assistant', parts: [] }
    ],
    activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
    postCommitTasks: [
      ...(options.cleanup
        ? [{ kind: ConversationPostCommitTaskKind.RegisterTraceFlush as const, conversationId: options.cleanup.id }]
        : []),
      ...(options.postCommitTask ? [options.postCommitTask] : [])
    ]
  }
}

function provider(
  options: {
    beforeValidation?: () => Promise<void>
    cleanup?: StreamCleanupPort
    postCommitTask?: CommittedConversationIntent['postCommitTasks'][number]
    afterPersistTask?: NonNullable<CommittedConversationIntent['executions'][number]['afterPersist']>
  } = {}
): ConversationHistoryPort {
  return {
    name: 'pause-contract-history',
    isPersistentConversation: true,
    canHandle: () => true,
    validateIntent: vi.fn(async (req, context, signal) => {
      await options.beforeValidation?.()
      signal.throwIfAborted()
      return validated(req, context.hasLiveStream)
    }),
    commitIntent: vi.fn((validation) => committedIntent(validation, options)),
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
  }
}

async function waitForIdle(service: ConversationRuntimeService, ref: ConversationRef): Promise<void> {
  await vi.waitFor(() => expect(service.inspect(ref).phase).toBe(ConversationPhase.Idle))
}

describe('AiStreamManager pause / drainInFlight (write quiesce)', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
  })

  describe('blocked surface while paused', () => {
    it('blocks dispatch — resolves {mode:"blocked", reason:"paused"} without reaching dispatchStreamRequest', async () => {
      const history = provider()
      const service = new ConversationRuntimeService({ providers: [history] })
      service.pause('test: restore')

      await expect(service.dispatch(streamListener(), request(chatRef))).resolves.toEqual({
        mode: ConversationOpenMode.Blocked,
        reason: ConversationBlockReason.Paused
      })
      expect(history.validateIntent).not.toHaveBeenCalled()
      expect(history.commitIntent).not.toHaveBeenCalled()
    })

    it('re-checks the pause flag under the per-topic lock — a dispatch queued behind a live one is still rejected', async () => {
      const validation = deferred()
      const history = provider({ beforeValidation: () => validation.promise })
      const live = controlledStream()
      const service = new ConversationRuntimeService({
        providers: [history],
        executionManager: new AiExecutionManager(async () => live.stream)
      })

      const first = service.dispatch(streamListener('first'), request(chatRef, 'first'))
      const second = service.dispatch(streamListener('second'), request(chatRef, 'second'))
      await vi.waitFor(() => expect(history.validateIntent).toHaveBeenCalledTimes(1))
      const hold = service.pause('test: FIFO race')
      validation.resolve()

      await expect(first).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
      await expect(second).resolves.toEqual({
        mode: ConversationOpenMode.Blocked,
        reason: ConversationBlockReason.Paused
      })
      expect(history.validateIntent).toHaveBeenCalledTimes(1)

      hold.dispose()
      live.controller.close()
      await waitForIdle(service, chatRef)
    })

    it('exempts steer-continuation dispatches — a grandfathered launch still reaches dispatchStreamRequest', async () => {
      const validation = deferred()
      const history = provider({ beforeValidation: () => validation.promise })
      const live = controlledStream()
      const openStream = vi.fn(async () => live.stream)
      const service = new ConversationRuntimeService({
        providers: [history],
        executionManager: new AiExecutionManager(openStream)
      })

      const opening = service.dispatch(streamListener(), request(chatRef))
      await vi.waitFor(() => expect(history.validateIntent).toHaveBeenCalledOnce())
      const hold = service.pause('test: grandfathered admission')
      validation.resolve()

      await expect(opening).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
      await vi.waitFor(() => expect(openStream).toHaveBeenCalledOnce())

      hold.dispose()
      live.controller.close()
      await waitForIdle(service, chatRef)
    })

    it('suppresses a paused startNextChatTurn without consuming the queue head', async () => {
      const history = provider()
      const first = controlledStream()
      const successor = controlledStream()
      const service = new ConversationRuntimeService({
        providers: [history],
        executionManager: new AiExecutionManager(
          vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(successor.stream)
        )
      })

      await service.dispatch(streamListener(), request(chatRef, 'first'))
      await expect(service.dispatch(streamListener(), request(chatRef, 'queued'))).resolves.toMatchObject({
        mode: ConversationOpenMode.Injected
      })
      const hold = service.pause('test: successor suppression')
      first.controller.close()
      await waitForIdle(service, chatRef)

      expect(service.inspect(chatRef).inbox.nextTurn).toHaveLength(1)
      expect(history.commitIntent).toHaveBeenCalledTimes(2)

      hold.dispose()
      await vi.waitFor(() => expect(history.commitIntent).toHaveBeenCalledTimes(3))
      successor.controller.close()
      await waitForIdle(service, chatRef)
    })

    it('rejects a paused startAgentSessionRun before prepareDispatch writes any rows', async () => {
      const history = provider()
      const service = new ConversationRuntimeService({ providers: [history] })
      service.pause('test: agent admission')

      await expect(service.dispatch(streamListener(), request(agentRef))).resolves.toEqual({
        mode: ConversationOpenMode.Blocked,
        reason: ConversationBlockReason.Paused
      })
      expect(history.validateIntent).not.toHaveBeenCalled()
      expect(history.commitIntent).not.toHaveBeenCalled()
    })
  })

  describe('drainInFlight', () => {
    it('returns a clean verdict when nothing is in flight', async () => {
      const service = new ConversationRuntimeService({ providers: [] })
      const hold = service.pause('test: clean drain')

      await expect(service.drainInFlight({ timeoutMs: 200 })).resolves.toEqual({ stragglerIds: [] })
      hold.dispose()
    })

    it('resolves with a verdict (no throw) when called without an active hold', async () => {
      const service = new ConversationRuntimeService({ providers: [] })

      await expect(service.drainInFlight({ timeoutMs: 100 })).resolves.toEqual({ stragglerIds: [] })
    })

    it('waits for a live persistence-bearing stream to settle', async () => {
      const live = controlledStream()
      const service = new ConversationRuntimeService({
        providers: [provider()],
        executionManager: new AiExecutionManager(async () => live.stream)
      })
      await service.dispatch(streamListener(), request(chatRef))
      const hold = service.pause('test: execution drain')

      const drain = tracked(service.drainInFlight({ timeoutMs: 5_000 }))
      await Promise.resolve()
      expect(drain.settled()).toBe(false)

      live.controller.close()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })
      hold.dispose()
    })

    it('waits for an admitted agent dispatch parked in validateSession through stream-registry handoff', async () => {
      const validation = deferred()
      const history = provider({ beforeValidation: () => validation.promise })
      const live = controlledStream()
      const service = new ConversationRuntimeService({
        providers: [history],
        executionManager: new AiExecutionManager(async () => live.stream)
      })
      const dispatch = tracked(service.dispatch(streamListener(), request(agentRef)))
      await vi.waitFor(() => expect(history.validateIntent).toHaveBeenCalledOnce())
      const hold = service.pause('test: validation handoff')
      const drain = tracked(service.drainInFlight({ timeoutMs: 5_000 }))

      validation.resolve()
      await vi.waitFor(() => expect(dispatch.settled()).toBe(true))
      expect(service.inspect(agentRef).phase).toBe(ConversationPhase.Running)
      expect(drain.settled()).toBe(false)

      live.controller.close()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })
      await expect(dispatch.promise).resolves.toMatchObject({ mode: ConversationOpenMode.Started })
      hold.dispose()
    })

    it('excludes prompt streams (no persistence:* listener) from the wait-set', async () => {
      const prompt = controlledStream()
      services.ai.streamText.mockResolvedValueOnce(prompt.stream)
      const promptManager = new PromptStreamManager()
      promptManager.streamPrompt({
        streamId: 'translate-1',
        uniqueModelId: modelId,
        prompt: 'translate',
        listener: streamListener('prompt-listener')
      })
      const service = new ConversationRuntimeService({ providers: [] })
      const hold = service.pause('test: prompt excluded')

      await expect(service.drainInFlight({ timeoutMs: 50 })).resolves.toEqual({ stragglerIds: [] })
      expect(promptManager.hasLiveStreams()).toBe(true)

      prompt.controller.close()
      await vi.waitFor(() => expect(promptManager.hasLiveStreams()).toBe(false))
      hold.dispose()
    })

    it('reports stragglers on timeout without aborting or evicting them', async () => {
      const live = controlledStream()
      const service = new ConversationRuntimeService({
        providers: [provider()],
        executionManager: new AiExecutionManager(async () => live.stream)
      })
      await service.dispatch(streamListener(), request(chatRef))
      const hold = service.pause('test: straggler')

      const verdict = await service.drainInFlight({ timeoutMs: 30 })
      expect(verdict.stragglerIds).toHaveLength(1)
      expect(verdict.stragglerIds[0]).toMatch(/^execution:chat:topic-1\//)
      expect(service.hasLiveConversation(chatRef)).toBe(true)

      live.controller.close()
      await waitForIdle(service, chatRef)
      hold.dispose()
    })

    it('awaits the Actor-owned post-commit naming operation', async () => {
      const naming = deferred()
      const live = controlledStream()
      const namingTasks: ConversationNamingTaskExecutor = {
        executePostCommit: () => naming.promise,
        executeAfterPersist: async () => {}
      }
      const service = new ConversationRuntimeService({
        providers: [
          provider({
            postCommitTask: {
              kind: ConversationPostCommitTaskKind.RenameChatFromFirstUser,
              topicId: chatRef.id,
              userMessageId: 'topic-1-user'
            }
          })
        ],
        executionManager: new AiExecutionManager(async () => live.stream),
        namingTasks
      })
      await service.dispatch(streamListener(), request(chatRef))
      const hold = service.pause('test: naming drain')
      const drain = tracked(service.drainInFlight({ timeoutMs: 5_000 }))

      await Promise.resolve()
      expect(drain.settled()).toBe(false)

      naming.resolve()
      live.controller.close()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })
      hold.dispose()
    })

    it('drains to a fixed point when terminal persistence spawns an Actor-owned naming operation', async () => {
      const live = controlledStream()
      const naming = deferred()
      let afterPersistStarted = false
      const namingTasks: ConversationNamingTaskExecutor = {
        executePostCommit: async () => {},
        executeAfterPersist: () => {
          afterPersistStarted = true
          return naming.promise
        }
      }
      const service = new ConversationRuntimeService({
        providers: [
          provider({
            afterPersistTask: {
              kind: ConversationAfterPersistTaskKind.RenameChatFromSummary,
              topicId: chatRef.id,
              userMessageId: 'topic-1-user'
            }
          })
        ],
        executionManager: new AiExecutionManager(async () => live.stream),
        namingTasks
      })
      await service.dispatch(streamListener(), request(chatRef))
      const hold = service.pause('test: fixed point')
      const drain = tracked(service.drainInFlight({ timeoutMs: 5_000 }))

      live.controller.enqueue({ type: 'start', messageId: 'topic-1-assistant' } as UIMessageChunk)
      live.controller.enqueue({ type: 'text-start', id: 'text-1' })
      live.controller.enqueue({ type: 'text-delta', id: 'text-1', delta: 'complete' })
      live.controller.enqueue({ type: 'text-end', id: 'text-1' })
      live.controller.enqueue({ type: 'finish' } as UIMessageChunk)
      live.controller.close()
      await vi.waitFor(() => expect(afterPersistStarted).toBe(true))
      expect(drain.settled()).toBe(false)

      naming.resolve()
      await expect(drain.promise).resolves.toEqual({ stragglerIds: [] })
      hold.dispose()
    })
  })

  describe('holds and release compensation', () => {
    it('refcounts holds — quiesced until the last hold is disposed', () => {
      const service = new ConversationRuntimeService({ providers: [] })
      const first = service.pause('holder-1')
      const second = service.pause('holder-2')
      expect(service.isWriteQuiesced).toBe(true)

      first.dispose()
      expect(service.isWriteQuiesced).toBe(true)

      second.dispose()
      expect(service.isWriteQuiesced).toBe(false)
    })

    it('dispose is idempotent — double-dispose cannot release another hold', () => {
      const service = new ConversationRuntimeService({ providers: [] })
      const first = service.pause('holder-1')
      const second = service.pause('holder-2')

      first.dispose()
      first.dispose()
      expect(service.isWriteQuiesced).toBe(true)

      second.dispose()
      expect(service.isWriteQuiesced).toBe(false)
    })

    it('re-kicks a suppressed steer continuation exactly once on last-hold release', async () => {
      const history = provider()
      const first = controlledStream()
      const successor = controlledStream()
      const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(successor.stream)
      const service = new ConversationRuntimeService({
        providers: [history],
        executionManager: new AiExecutionManager(openStream)
      })
      await service.dispatch(streamListener(), request(chatRef, 'first'))
      await service.dispatch(streamListener(), request(chatRef, 'queued'))
      const hold = service.pause('test: release kick')
      first.controller.close()
      await waitForIdle(service, chatRef)

      hold.dispose()
      await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
      await Promise.resolve()
      expect(openStream).toHaveBeenCalledTimes(2)

      successor.controller.close()
      await waitForIdle(service, chatRef)
    })

    it('newer hold inherits the suppressed-continuation debt', async () => {
      const history = provider()
      const first = controlledStream()
      const successor = controlledStream()
      const openStream = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(successor.stream)
      const service = new ConversationRuntimeService({
        providers: [history],
        executionManager: new AiExecutionManager(openStream)
      })
      await service.dispatch(streamListener(), request(chatRef, 'first'))
      await service.dispatch(streamListener(), request(chatRef, 'queued'))
      const firstHold = service.pause('holder-A')
      first.controller.close()
      await waitForIdle(service, chatRef)
      const secondHold = service.pause('holder-B')

      firstHold.dispose()
      await Promise.resolve()
      expect(openStream).toHaveBeenCalledTimes(1)
      expect(service.inspect(chatRef).inbox.nextTurn).toHaveLength(1)

      secondHold.dispose()
      await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(2))
      successor.controller.close()
      await waitForIdle(service, chatRef)
    })

    it('fails closed — a dropped (never disposed) hold keeps admission blocked', async () => {
      const history = provider()
      const service = new ConversationRuntimeService({ providers: [history] })
      service.pause('test: dropped hold')

      await expect(service.dispatch(streamListener(), request(chatRef))).resolves.toEqual({
        mode: ConversationOpenMode.Blocked,
        reason: ConversationBlockReason.Paused
      })
      expect(history.commitIntent).not.toHaveBeenCalled()
    })
  })
})
