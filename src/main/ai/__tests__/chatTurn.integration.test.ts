import { BaseService } from '@main/core/lifecycle/BaseService'
import type { UIMessageChunk } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { markTrustedLocalToolTerminalFailure } from '../runtime/aiSdk/loop/localToolTerminalOutcome'
import { makeModel, makeProvider } from './fixtures'

const mockCreateAgent = vi.fn()
const sharedCache = new Map<string, unknown>()
const cacheWrites: Array<{ key: string; value: unknown }> = []

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
    resolveReasoningProfile: () => ({ support: undefined, wire: undefined })
  },
  projectRuntimeReasoning: vi.fn()
}))

class FakeListener {
  readonly id = 'integration-listener'
  readonly chunks: UIMessageChunk[] = []
  readonly sources: Array<string | undefined> = []
  readonly doneResults: any[] = []
  readonly errorResults: any[] = []
  onDoneImpl?: () => void

  onChunk(chunk: UIMessageChunk, sourceModelId?: string): void {
    this.chunks.push(chunk)
    this.sources.push(sourceModelId)
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

function createManager() {
  BaseService.resetInstances()
  const Ctor = AiStreamManager as unknown as new (config: {
    gracePeriodMs: number
  }) => InstanceType<typeof AiStreamManager>
  return new Ctor({ gracePeriodMs: 0 })
}

const { AiService } = await import('../AiService')
const { AiStreamManager } = await import('../streamManager/AiStreamManager')

describe('chat turn integration trajectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharedCache.clear()
    cacheWrites.length = 0
    const aiService = new (AiService as any)()
    fakeApplicationGet.mockImplementation((name: string) => {
      if (name === 'AiService') return aiService
      if (name === 'CacheService') return fakeCacheService
      if (name === 'PreferenceService') return { get: () => false }
      if (name === 'AgentSessionRuntimeService') return { willContinueTopic: () => false }
      if (name === 'TraceStorageService') return { saveSpans: async () => undefined }
      if (name === 'AnalyticsService') return { trackTokenUsage: vi.fn() }
      throw new Error(`Unexpected application service: ${name}`)
    })
  })

  it('runs a complete SDK chat trajectory through AiService and the stream manager', async () => {
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

    const manager = createManager()
    const topicId = 'chat-integration-1'
    const listener = new FakeListener()
    const modelId = 'test-provider::test-model' as const
    let terminalSnapshot: ReturnType<typeof manager.inspect> | undefined
    listener.onDoneImpl = () => {
      terminalSnapshot = manager.inspect(topicId)
    }

    manager.send({
      topicId,
      models: [
        {
          modelId,
          request: {
            chatId: topicId,
            trigger: 'submit-message',
            messageId: 'assistant-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Say hello' }] }]
          }
        }
      ],
      listeners: [listener]
    })

    await vi.waitFor(() => expect(listener.doneResults).toHaveLength(1))

    expect(mockCreateAgent).toHaveBeenCalledOnce()
    expect(listener.chunks.map((chunk) => chunk.type)).toEqual(chunks.map((chunk) => chunk.type))
    expect(listener.sources).toEqual(chunks.map(() => modelId))
    expect(listener.errorResults).toEqual([])

    if (!terminalSnapshot) {
      throw new Error('Expected the terminal snapshot to be available during onDone')
    }
    const snapshot = terminalSnapshot
    expect(snapshot.status).toBe('done')
    expect(listener.doneResults[0].finalMessage).toEqual(snapshot.executions[0].finalMessage)
    expect(snapshot.executions[0].finalMessage).toMatchObject({ id: 'assistant-1', role: 'assistant' })

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

    const manager = createManager()
    const topicId = 'chat-integration-tool-1'
    const listener = new FakeListener()
    const modelId = 'test-provider::test-model' as const

    manager.send({
      topicId,
      models: [
        {
          modelId,
          request: {
            chatId: topicId,
            trigger: 'submit-message',
            messageId: 'assistant-tool-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Search the project' }] }]
          }
        }
      ],
      listeners: [listener]
    })

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

    const manager = createManager()
    const topicId = 'chat-integration-error-1'
    const listener = new FakeListener()
    const modelId = 'test-provider::test-model' as const

    manager.send({
      topicId,
      models: [
        {
          modelId,
          request: {
            chatId: topicId,
            trigger: 'submit-message',
            messageId: 'assistant-error-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Search the project' }] }]
          }
        }
      ],
      listeners: [listener]
    })

    await vi.waitFor(() => expect(listener.errorResults).toHaveLength(1))

    expect(listener.doneResults).toEqual([])
    expect(listener.chunks.map((chunk) => chunk.type)).not.toContain('finish')
    expect(listener.errorResults[0].error).toMatchObject({
      name: 'ToolLoopTerminalError',
      i18nKey: 'web_search_provider_unavailable'
    })
  })
})
