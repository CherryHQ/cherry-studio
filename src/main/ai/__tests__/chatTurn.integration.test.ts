import { BaseService } from '@main/core/lifecycle/BaseService'
import {
  ConversationActiveNodeMove,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  ConversationPhase,
  type ConversationRef
} from '@shared/ai/conversation'
import { createUniqueModelId } from '@shared/data/types/model'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiService } from '../AiService'
import { AiExecutionManager, ConversationRuntimeService } from '../conversation'
import { markTrustedLocalToolTerminalFailure } from '../runtime/aiSdk/loop/localToolTerminalOutcome'
import {
  type ConversationExecutionPreparationDescriptor,
  type ConversationHistoryPort,
  type MainDispatchRequest,
  type StreamListener
} from '../streamManager'
import {
  ConversationExecutionDriverBindingKind,
  ConversationExecutionPreparationKind,
  ConversationHistoryAdapterKind,
  ConversationTerminalPersistenceKind
} from '../streamManager/context/ConversationHistoryPort'
import { makeModel, makeProvider } from './fixtures'

const mockCreateAgent = vi.fn()
const sharedCache = new Map<string, unknown>()
const cacheWrites: Array<{ key: string; value: unknown }> = []
const namingWrites = new Map<string, Promise<void>>()

const fakeCacheService = {
  getShared: vi.fn((key: string) => sharedCache.get(key)),
  setShared: vi.fn((key: string, value: unknown) => {
    sharedCache.set(key, value)
    cacheWrites.push({ key, value })
  })
}

const fakeApplicationGet = vi.fn()
const fakeProvider = makeProvider({ id: 'test-provider', name: 'Test provider' })
const fakeModel = makeModel({
  id: 'test-provider::test-model',
  providerId: 'test-provider',
  apiModelId: 'test-model',
  name: 'Test model'
})
const modelId = createUniqueModelId('test-provider', 'test-model')

vi.mock('@application', () => ({
  application: { get: (name: string) => fakeApplicationGet(name) }
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
  definePlugin: (plugin: unknown) => plugin
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: () => fakeProvider,
    resolveApiKey: () => ({
      value: 'test-key',
      apiKeySelection: { attribution: 'unknown' }
    }),
    getRotatedApiKey: () => 'test-key'
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: { getByKey: () => fakeModel }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    resolveReasoningProfile: () => ({ support: undefined, wire: undefined }),
    resolveServiceTierControl: () => undefined
  },
  projectRuntimeReasoning: vi.fn()
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: { inFlightWrites: () => namingWrites }
}))

class FakeListener implements StreamListener {
  readonly id = 'integration-listener'
  readonly chunks: UIMessageChunk[] = []
  readonly sources: Array<string | undefined> = []
  readonly doneResults: any[] = []
  readonly errorResults: any[] = []
  onDoneImpl?: () => void

  onChunk(chunk: UIMessageChunk, source?: { modelId?: string }): void {
    this.chunks.push(chunk)
    this.sources.push(source?.modelId)
  }

  onDone(result: any): void {
    this.doneResults.push(result)
    this.onDoneImpl?.()
  }

  onPaused(): void {}

  onError(result: any): void {
    this.errorResults.push(result)
  }

  isAlive(): boolean {
    return true
  }
}

function sdkStream(chunks: UIMessageChunk[], steps: unknown[] = []) {
  return {
    toUIMessageStream: () =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.close()
        }
      }),
    steps: Promise.resolve(steps),
    finishReason: Promise.resolve('stop')
  }
}

function request(ref: ConversationRef): MainDispatchRequest {
  return {
    trigger: ConversationOpenTrigger.SubmitMessage,
    conversation: ref,
    userMessageParts: [{ type: 'text', text: 'Say hello' }],
    headless: false,
    parentAnchorId: undefined,
    mentionedModelIds: [modelId]
  }
}

function historyPort(ref: ConversationRef, assistantMessageId: string): ConversationHistoryPort {
  const preparation: ConversationExecutionPreparationDescriptor = {
    kind: ConversationExecutionPreparationKind.TemporaryChat,
    conversation: ref,
    modelId,
    outputNodeId: assistantMessageId,
    messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Say hello' }] }],
    fastMode: false
  }
  return {
    name: 'integration-history',
    isPersistentConversation: true,
    canHandle: (candidate) => candidate.kind === ref.kind && candidate.id === ref.id,
    validateIntent: async (req, context) => ({
      kind: ConversationHistoryAdapterKind.PersistentChat,
      request: req,
      context,
      executionModelIds: [modelId],
      resolvedModels: [fakeModel],
      inputModelId: modelId
    }),
    commitIntent: () => ({
      conversation: ref,
      input: { historyNodeId: 'user-1' },
      executions: [
        {
          modelId,
          outputNodeId: assistantMessageId,
          preparation,
          preparationIndex: 0,
          persistence: {
            kind: ConversationTerminalPersistenceKind.TemporaryChat,
            topicId: ref.id,
            modelId,
            messageId: assistantMessageId
          },
          driver: { kind: ConversationExecutionDriverBindingKind.Chat }
        }
      ],
      reservedMessages: [
        { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Say hello' }] },
        { id: assistantMessageId, role: 'assistant', parts: [] }
      ],
      activeNodeDecision: { move: ConversationActiveNodeMove.Advance },
      postCommitTasks: []
    }),
    prepareExecutionContext: async () => ({
      conversation: ref,
      models: [
        {
          modelId,
          request: {
            chatId: ref.id,
            trigger: 'submit-message',
            messageId: assistantMessageId,
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Say hello' }] }]
          }
        }
      ]
    }),
    persistTerminal: async () => {}
  }
}

function createRuntime(ref: ConversationRef, assistantMessageId: string) {
  const executionManager = new AiExecutionManager()
  return new ConversationRuntimeService({
    executionManager,
    providers: [historyPort(ref, assistantMessageId)]
  })
}

describe('chat turn integration trajectory', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    sharedCache.clear()
    cacheWrites.length = 0
    namingWrites.clear()
    const aiService = new (AiService as any)()
    fakeApplicationGet.mockImplementation((name: string) => {
      if (name === 'AiService') return aiService
      if (name === 'CacheService') return fakeCacheService
      if (name === 'PreferenceService') return { get: () => false }
      if (name === 'TraceStorageService') return { saveSpans: async () => undefined }
      if (name === 'AnalyticsService') return { trackTokenUsage: vi.fn() }
      throw new Error(`Unexpected application service: ${name}`)
    })
  })

  it('runs a complete SDK chat trajectory through AiService and the Conversation runtime', async () => {
    const chunks = [
      { type: 'start', messageId: 'assistant-1' },
      { type: 'start-step' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello' },
      { type: 'text-delta', id: 'text-1', delta: ' world' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' }
    ] as UIMessageChunk[]
    mockCreateAgent.mockResolvedValue({ stream: vi.fn().mockResolvedValue(sdkStream(chunks)) })

    const ref = { kind: ConversationKind.Chat, id: 'chat-integration-1' } as const
    const runtime = createRuntime(ref, 'assistant-1')
    const listener = new FakeListener()
    let terminalPhase: ConversationPhase | undefined
    listener.onDoneImpl = () => {
      terminalPhase = runtime.inspect(ref).phase
    }

    await expect(runtime.dispatch(listener, request(ref))).resolves.toMatchObject({
      mode: ConversationOpenMode.Started
    })
    await vi.waitFor(() => expect(listener.doneResults).toHaveLength(1))

    expect(mockCreateAgent).toHaveBeenCalledOnce()
    expect(listener.chunks.map((chunk) => chunk.type)).toEqual(chunks.map((chunk) => chunk.type))
    expect(listener.sources).toEqual(chunks.map(() => modelId))
    expect(listener.errorResults).toEqual([])
    expect(listener.doneResults[0].finalMessage).toMatchObject({ id: 'assistant-1', role: 'assistant' })
    expect(terminalPhase).toBe(ConversationPhase.Idle)
    expect(cacheWrites.map(({ value }) => (value as { status: string }).status)).toEqual([
      'pending',
      'streaming',
      'done'
    ])
  })

  it('forwards a tool call and a second completion step through the same chat turn', async () => {
    const chunks = [
      { type: 'start', messageId: 'assistant-tool-1' },
      { type: 'start-step' },
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'search' },
      { type: 'tool-input-available', toolCallId: 'call-1', toolName: 'search', input: { query: 'Cherry Studio' } },
      { type: 'tool-output-available', toolCallId: 'call-1', output: { result: 'found' } },
      { type: 'finish-step' },
      { type: 'start-step' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'I found it.' },
      { type: 'text-end', id: 'text-1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' }
    ] as UIMessageChunk[]
    mockCreateAgent.mockResolvedValue({ stream: vi.fn().mockResolvedValue(sdkStream(chunks)) })

    const ref = { kind: ConversationKind.Chat, id: 'chat-integration-tool-1' } as const
    const runtime = createRuntime(ref, 'assistant-tool-1')
    const listener = new FakeListener()

    await runtime.dispatch(listener, request(ref))
    await vi.waitFor(() => expect(listener.doneResults).toHaveLength(1))

    expect(listener.chunks.map((chunk) => chunk.type)).toEqual(chunks.map((chunk) => chunk.type))
    expect(listener.chunks.filter((chunk) => chunk.type === 'finish-step')).toHaveLength(2)
    expect(listener.chunks.find((chunk) => chunk.type === 'tool-output-available')).toMatchObject({
      toolCallId: 'call-1',
      output: { result: 'found' }
    })
    expect(listener.doneResults[0].finalMessage.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'tool-search' })])
    )
  })

  it('classifies a terminal local-tool failure as an error instead of forwarding finish', async () => {
    const terminalOutput = markTrustedLocalToolTerminalFailure({
      error: 'The configured search provider is unavailable.',
      retryable: false,
      terminal: true,
      userMessage: 'Configure a search provider and try again.',
      i18nKey: 'web_search_provider_unavailable'
    })
    const chunks = [
      { type: 'start', messageId: 'assistant-error-1' },
      { type: 'start-step' },
      { type: 'tool-input-start', toolCallId: 'call-1', toolName: 'search' },
      {
        type: 'tool-output-error',
        toolCallId: 'call-1',
        toolName: 'search',
        input: { query: 'Cherry Studio' },
        errorText: 'The configured search provider is unavailable.'
      },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' }
    ] as UIMessageChunk[]
    mockCreateAgent.mockResolvedValue({
      stream: vi
        .fn()
        .mockResolvedValue(
          sdkStream(chunks, [{ toolResults: [{ toolCallId: 'call-1', toolName: 'search', output: terminalOutput }] }])
        )
    })

    const ref = { kind: ConversationKind.Chat, id: 'chat-integration-error-1' } as const
    const runtime = createRuntime(ref, 'assistant-error-1')
    const listener = new FakeListener()

    await runtime.dispatch(listener, request(ref))
    await vi.waitFor(() => expect(listener.errorResults).toHaveLength(1))

    expect(listener.doneResults).toEqual([])
    expect(listener.chunks.map((chunk) => chunk.type)).not.toContain('finish')
    expect(listener.errorResults[0].error).toMatchObject({
      name: 'ToolLoopTerminalError',
      i18nKey: 'web_search_provider_unavailable'
    })
  })
})
