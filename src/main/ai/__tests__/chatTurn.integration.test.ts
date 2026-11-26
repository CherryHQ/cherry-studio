import type { LanguageModelV3Prompt, LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { defaultServiceInstances } from '@test-mocks/main/application'
import {
  APICallError,
  InvalidResponseDataError,
  stepCountIs,
  tool,
  ToolLoopAgent,
  type ModelMessage,
  type ToolLoopAgentSettings,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk
} from 'ai'
import { convertArrayToReadableStream, MockLanguageModelV3 } from 'ai/test'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { BaseService } from '@main/core/lifecycle/BaseService'

import { Agent } from '../runtime/aiSdk/Agent'
import { markTrustedLocalToolTerminalFailure } from '../runtime/aiSdk/loop/localToolTerminalOutcome'
import type { WrapLanguageModel } from '../runtime/aiSdk/retry/createRetryableWrap'
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
let activeModel = fakeModel

vi.mock('@application', () => ({
  application: { get: (name: string) => fakeApplicationGet(name) }
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
  createExecutor: async () => {
    const agent = await mockCreateAgent()
    return {
      streamText: ({ messages, abortSignal }: { messages: ModelMessage[]; abortSignal?: AbortSignal }) =>
        agent.stream({ messages, abortSignal })
    }
  },
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
  modelService: { getByKey: () => activeModel }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    resolveReasoningProfile: () => ({ support: undefined, wire: undefined }),
    resolveServiceTierControl: () => undefined,
    isRegistryProvider: () => false
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

function useSdkModel(doStream: NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>['doStream']) {
  const model = new MockLanguageModelV3({ doStream })
  mockCreateAgent.mockImplementation(
    async ({
      wrapModel,
      agentSettings
    }: {
      wrapModel?: WrapLanguageModel
      agentSettings?: Omit<ToolLoopAgentSettings<never, ToolSet, never>, 'model'>
    } = {}) => new ToolLoopAgent({ ...agentSettings, model: wrapModel?.(model) ?? model })
  )
}

function providerStream(parts: LanguageModelV3StreamPart[], reason: 'tool-calls' | 'stop' = 'stop') {
  return {
    stream: convertArrayToReadableStream<LanguageModelV3StreamPart>([
      ...parts,
      {
        type: 'finish',
        finishReason: { unified: reason, raw: reason },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined }
        }
      }
    ])
  }
}

function imageBytes(prompt: LanguageModelV3Prompt): Buffer[][] {
  const bytes = (data: string | Uint8Array | URL) =>
    typeof data === 'string' ? [Buffer.from(data, 'base64')] : data instanceof Uint8Array ? [Buffer.from(data)] : []
  return prompt
    .filter((message) => message.role !== 'system')
    .map(({ content }) =>
      content.flatMap((part) => {
        if (part.type === 'file' && part.mediaType.startsWith('image/')) return bytes(part.data)
        if (part.type === 'tool-result' && part.output.type === 'content') {
          return part.output.value.flatMap((item) => (item.type === 'image-data' ? bytes(item.data) : []))
        }
        return []
      })
    )
}

function sdkErrorStream(chunks: UIMessageChunk[], error: Error) {
  return {
    toUIMessageStream: ({ onError }: { onError: (error: unknown) => string }) =>
      new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk)
          controller.enqueue({ type: 'error', errorText: onError(error) })
          controller.close()
        }
      }),
    steps: Promise.resolve([]),
    finishReason: Promise.resolve('error')
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
  const sleepHolds = new Set<symbol>()

  afterEach(async () => {
    await vi.waitFor(() => expect(sleepHolds.size).toBe(0))
    vi.restoreAllMocks()
  })
  beforeEach(() => {
    BaseService.resetInstances()
    activeModel = fakeModel
    vi.clearAllMocks()
    sleepHolds.clear()
    vi.spyOn(defaultServiceInstances.RuntimeActivityService, 'begin').mockImplementation(() => {
      const token = Symbol()
      sleepHolds.add(token)
      return {
        dispose: vi.fn(() => {
          sleepHolds.delete(token)
        })
      }
    })
    sharedCache.clear()
    cacheWrites.length = 0
    const aiService = new (AiService as any)()
    fakeApplicationGet.mockImplementation((name: string) => {
      if (name === 'AiService') return aiService
      if (name === 'RuntimeActivityService') return defaultServiceInstances.RuntimeActivityService
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
            conversation: { id: topicId, topicId },
            trigger: 'submit-message',
            messageId: 'assistant-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Say hello' }] }]
          }
        }
      ],
      listeners: [listener]
    })

    expect(sleepHolds.size).toBe(1)
    await vi.waitFor(() => expect(listener.doneResults).toHaveLength(1))

    expect(listener.chunks.map((chunk) => chunk.type)).toEqual(chunks.map((chunk) => chunk.type))
    expect(listener.sources).toEqual(chunks.map(() => modelId))
    expect(listener.errorResults).toEqual([])

    if (!terminalSnapshot) {
      throw new Error('Expected the terminal snapshot to be available during onDone')
    }
    const snapshot = terminalSnapshot
    expect(snapshot.status).toBe('done')
    expect(listener.doneResults[0].finalMessage).toEqual(snapshot.executions[0].finalMessage)

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
            conversation: { id: topicId, topicId },
            trigger: 'submit-message',
            messageId: 'assistant-tool-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Search the project' }] }]
          }
        }
      ],
      listeners: [listener]
    })

    expect(sleepHolds.size).toBe(1)
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
            conversation: { id: topicId, topicId },
            trigger: 'submit-message',
            messageId: 'assistant-error-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Search the project' }] }]
          }
        }
      ],
      listeners: [listener]
    })

    expect(sleepHolds.size).toBe(1)
    await vi.waitFor(() => expect(listener.errorResults).toHaveLength(1))

    expect(listener.doneResults).toEqual([])
    expect(listener.chunks.map((chunk) => chunk.type)).not.toContain('finish')
    expect(listener.errorResults[0].error).toMatchObject({
      name: 'ToolLoopTerminalError',
      i18nKey: 'web_search_provider_unavailable'
    })
  })

  it('preserves partial content and identifies a stream that ends without a finish reason', async () => {
    const chunks = [
      { type: 'start', messageId: 'assistant-missing-finish-1' },
      { type: 'start-step' },
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Partial response' },
      { type: 'text-end', id: 'text-1' }
    ] as UIMessageChunk[]
    const error = new InvalidResponseDataError({
      data: undefined,
      message: 'Response stream ended without a finish reason.'
    })
    mockCreateAgent.mockResolvedValue({ stream: vi.fn().mockResolvedValue(sdkErrorStream(chunks, error)) })

    const manager = createManager()
    const topicId = 'chat-integration-missing-finish-1'
    const listener = new FakeListener()
    const modelId = 'test-provider::test-model' as const

    manager.send({
      topicId,
      models: [
        {
          modelId,
          request: {
            conversation: { id: topicId, topicId },
            trigger: 'submit-message',
            messageId: 'assistant-missing-finish-1',
            uniqueModelId: modelId,
            messages: [{ id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Reply partially' }] }]
          }
        }
      ],
      listeners: [listener]
    })

    expect(sleepHolds.size).toBe(1)
    await vi.waitFor(() => expect(listener.errorResults).toHaveLength(1))

    expect(listener.doneResults).toEqual([])
    expect(listener.errorResults[0].error).toMatchObject({
      name: 'MissingFinishReasonError',
      i18nKey: 'missing_finish_reason',
      providerId: 'test-provider',
      modelId: 'test-model'
    })
    expect(listener.errorResults[0].finalMessage.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'Partial response' })])
    )
  })
  it('keeps background streams awake until completion or cancellation without releasing sibling holds', async () => {
    const streams: ReadableStreamDefaultController<UIMessageChunk>[] = []
    mockCreateAgent.mockResolvedValue({
      stream: async ({ abortSignal }: { abortSignal: AbortSignal }) => ({
        toUIMessageStream: () =>
          new ReadableStream<UIMessageChunk>({
            start(controller) {
              streams.push(controller)
              abortSignal.addEventListener('abort', () => controller.close(), { once: true })
              controller.enqueue({ type: 'start', messageId: `assistant-${streams.length}` })
            }
          }),
        steps: Promise.resolve([])
      })
    })
    const manager = createManager()
    for (const topicId of ['first', 'second']) {
      manager.send({
        topicId,
        models: [
          {
            modelId: fakeModel.id,
            request: {
              conversation: { id: topicId, topicId },
              trigger: 'submit-message',
              uniqueModelId: fakeModel.id,
              messages: []
            }
          }
        ],
        listeners: []
      })
    }
    await vi.waitFor(() => expect(streams).toHaveLength(2))
    expect(sleepHolds.size).toBe(2)
    streams[0].enqueue({ type: 'finish', finishReason: 'stop' })
    streams[0].close()
    await vi.waitFor(() => expect(sleepHolds.size).toBe(1))
    expect(manager.inspect('second')?.status).toBe('streaming')
    await manager.abortAndDrain('second', 'user-requested')
    expect(sleepHolds.size).toBe(0)
  })

  it('releases the hold when stream preparation rejects', async () => {
    const aiService = fakeApplicationGet('AiService') as InstanceType<typeof AiService>
    vi.spyOn(aiService, 'streamText').mockRejectedValue(new Error('Cannot resolve model'))
    const manager = createManager()
    const listener = new FakeListener()
    manager.send({
      topicId: 'setup-failure',
      models: [
        {
          modelId: fakeModel.id,
          request: {
            conversation: { id: 'setup-failure', topicId: 'setup-failure' },
            trigger: 'submit-message',
            messages: []
          }
        }
      ],
      listeners: [listener]
    })
    expect(sleepHolds.size).toBe(1)
    await vi.waitFor(() => expect(listener.errorResults).toHaveLength(1))
    expect(listener.errorResults[0].error.message).toBe('Cannot resolve model')
  })

  it.each([
    { name: 'reduces history and completes the reply', currentCount: 1, callerOwnsContext: false },
    { name: 'preserves caller-owned history', currentCount: 1, callerOwnsContext: true },
    {
      name: 'keeps current attachments including a legacy inline image and preserves the provider diagnosis',
      currentCount: 4,
      callerOwnsContext: false
    }
  ])('$name', async ({ currentCount, callerOwnsContext }) => {
    activeModel = makeModel({ ...fakeModel, inputModalities: ['text', 'image'] })
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#112233' } })
      .jpeg()
      .toBuffer()
    const image = Buffer.concat([jpeg, Buffer.alloc(8_000_000 - jpeg.length)])
    const url = `data:image/jpeg;base64,${image.toString('base64')}`
    const uppercaseUrl = `DATA:image/jpeg;base64,${image.toString('base64')}`
    const attachment = { type: 'file', mediaType: 'image/jpeg', url } as const
    const messages: UIMessage[] = [
      { id: 'u1', role: 'user', parts: new Array(3).fill(attachment) },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Answer 1' }] },
      {
        id: 'u2',
        role: 'user',
        parts: Array.from({ length: currentCount }, (_, index) => {
          if (currentCount <= 1) return attachment
          if (index === 0) return { type: 'file', mediaType: 'application/octet-stream', url: uppercaseUrl } as const
          if (index === 1) return { ...attachment, mediaType: 'application/octet-stream' } as const
          return attachment
        })
      }
    ]
    let wireImages: Buffer[][] = []
    let wireImageBytes = 0
    useSdkModel(async ({ prompt }) => {
      wireImages = imageBytes(prompt.filter((message) => message.role === 'user'))
      wireImageBytes = wireImages.flat().reduce((sum, bytes) => sum + bytes.length, 0)
      if (wireImageBytes > 30_000_000) {
        throw new APICallError({
          message: 'Downloaded image content cannot exceed 30MB',
          statusCode: 413,
          url: 'https://openrouter.ai/api/v1/chat/completions',
          requestBodyValues: {
            messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } }] }]
          }
        })
      }
      return providerStream([
        { type: 'text-start', id: 'text-1' },
        { type: 'text-delta', id: 'text-1', delta: 'Within budget reply' },
        { type: 'text-end', id: 'text-1' }
      ])
    })

    const manager = createManager()
    const topicId = 'image-budget'
    const messageId = 'image-budget-reply'
    const listener = new FakeListener()
    manager.send({
      topicId,
      models: [
        {
          modelId: fakeModel.id,
          request: {
            conversation: { id: topicId, topicId },
            trigger: 'submit-message',
            messageId,
            uniqueModelId: fakeModel.id,
            messages,
            ...(callerOwnsContext && { contextOwner: 'caller' as const })
          }
        }
      ],
      listeners: [listener]
    })
    await vi.waitFor(() => expect(listener.doneResults.length + listener.errorResults.length).toBe(1), {
      timeout: 15_000
    })

    expect(wireImages.at(-1)?.map((bytes) => bytes.equals(image))).toEqual(new Array(currentCount).fill(true))
    const original = messages[0].parts[0]
    expect(original.type === 'file' && original.url === url).toBe(true)
    if (currentCount > 1) {
      expect(messages[2].parts[0]).toEqual({
        type: 'file',
        mediaType: 'application/octet-stream',
        url: uppercaseUrl
      })
    }
    if (callerOwnsContext) {
      expect(wireImages[0].map((bytes) => bytes.length)).toEqual([8_000_000, 8_000_000, 8_000_000])
      expect(listener.chunks.find((part) => part.type === 'data-image-payload-reduced')).toBeUndefined()
      expect(listener.errorResults[0].error.detailI18nKey).toBeUndefined()
    } else if (currentCount > 1) {
      expect(wireImages[0]).toHaveLength(0)
      expect(listener.errorResults[0].error.detailI18nKey).toBe('image_payload_rejection_detail')
      expect(listener.errorResults[0].finalMessage).toMatchObject({ id: messageId })
      expect(listener.errorResults[0].finalMessage.parts).toContainEqual({
        type: 'data-image-payload-reduced',
        id: 'image-payload-reduced',
        data: { reducedCount: 0, omittedCount: 3 }
      })
    } else {
      expect(listener.errorResults).toEqual([])
      expect(wireImageBytes).toBeLessThanOrEqual(30_000_000)
      const omitted = wireImages[0].length === 2
      expect(wireImages[0]).toHaveLength(omitted ? 2 : 3)
      expect(wireImages[0].slice(-2).map((bytes) => bytes.equals(image))).toEqual([true, true])
      if (!omitted) {
        expect(wireImages[0][0].length).toBeLessThan(8_000_000)
        expect(await sharp(wireImages[0][0]).metadata()).toMatchObject({ format: 'jpeg', width: 64 })
      }
      expect(listener.doneResults[0].finalMessage).toMatchObject({ id: messageId })
      const parts: UIMessage['parts'] = listener.doneResults[0].finalMessage.parts
      expect(parts).toContainEqual({ type: 'text', text: 'Within budget reply', state: 'done' })
      expect(parts.filter((part) => part.type === 'data-image-payload-reduced')).toEqual([
        {
          type: 'data-image-payload-reduced',
          id: 'image-payload-reduced',
          data: omitted ? { reducedCount: 0, omittedCount: 1 } : { reducedCount: 1, omittedCount: 0 }
        }
      ])
    }
  })

  it.each([
    { name: 'different', reducedCount: 0, omittedCount: 2 },
    { name: 'equal', reducedCount: 0, omittedCount: 1 }
  ])(
    'appends a reduction notice after an approval resume with $name counts',
    async ({ reducedCount, omittedCount }) => {
      activeModel = makeModel({ ...fakeModel, inputModalities: ['text', 'image'] })
      const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#112233' } })
        .jpeg()
        .toBuffer()
      const attachment = (bytes: number) => ({
        type: 'file' as const,
        mediaType: 'image/jpeg',
        url: `data:image/jpeg;base64,${Buffer.concat([jpeg, Buffer.alloc(bytes - jpeg.length)]).toString('base64')}`
      })
      const previousNotice = {
        type: 'data-image-payload-reduced',
        id: 'image-payload-reduced',
        data: { reducedCount, omittedCount }
      } as const
      const previousText = { type: 'text', text: 'Before approval' } as const
      const resumedAssistant: UIMessage = {
        id: 'resumed-assistant',
        role: 'assistant',
        parts: [
          previousNotice,
          previousText,
          {
            type: 'tool-review',
            toolCallId: 'review-call',
            input: {},
            state: 'approval-responded',
            approval: { id: 'review-approval', approved: false }
          }
        ]
      }
      const current = attachment(30_000_000)
      let wireImages: Buffer[] = []
      useSdkModel(async ({ prompt }) => {
        wireImages = imageBytes(prompt).flat()
        return providerStream([
          { type: 'text-start', id: 'continued' },
          { type: 'text-delta', id: 'continued', delta: 'Continued reply' },
          { type: 'text-end', id: 'continued' }
        ])
      })

      const manager = createManager()
      const topicId = 'image-budget-resume'
      const listener = new FakeListener()
      manager.send({
        topicId,
        models: [
          {
            modelId: fakeModel.id,
            request: {
              conversation: { id: topicId, topicId },
              trigger: 'submit-message',
              messageId: resumedAssistant.id,
              uniqueModelId: fakeModel.id,
              messages: [
                { id: 'u1', role: 'user', parts: [attachment(2_000_000)] },
                { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Earlier reply' }] },
                { id: 'u2', role: 'user', parts: [current] },
                resumedAssistant
              ]
            }
          }
        ],
        listeners: [listener]
      })
      await vi.waitFor(() => expect(listener.doneResults.length + listener.errorResults.length).toBe(1), {
        timeout: 15_000
      })

      expect(listener.errorResults).toEqual([])
      expect(wireImages).toHaveLength(1)
      expect(wireImages[0].length).toBe(30_000_000)
      expect(wireImages[0].toString('base64')).toBe(current.url.slice('data:image/jpeg;base64,'.length))
      const finalMessage: UIMessage = listener.doneResults[0].finalMessage
      expect(finalMessage.id).toBe(resumedAssistant.id)
      expect(finalMessage.parts.slice(0, 3)).toMatchObject([
        previousNotice,
        previousText,
        { type: 'tool-review', state: 'output-denied' }
      ])
      expect(finalMessage.parts.filter((part) => part.type === 'data-image-payload-reduced')).toEqual([
        previousNotice,
        { type: 'data-image-payload-reduced', id: expect.any(String), data: { reducedCount: 0, omittedCount: 1 } }
      ])
      expect(finalMessage.parts).toContainEqual({ type: 'text', text: 'Continued reply', state: 'done' })
    }
  )

  it.each([true, false])(
    'reduces replayed and fresh tool images at the provider (native tool media: %s)',
    async (native) => {
      const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#112233' } })
        .jpeg()
        .toBuffer()
      const toolImage = Buffer.concat([jpeg, Buffer.alloc(2_000_000 - jpeg.length)]).toString('base64')
      const currentImage = Buffer.concat([jpeg, Buffer.alloc(29_000_000 - jpeg.length)])
      const prompts: LanguageModelV3Prompt[] = []
      useSdkModel(async ({ prompt }) => {
        prompts.push(prompt)
        const total = imageBytes(prompt)
          .flat()
          .reduce((sum, image) => sum + image.length, 0)
        if (total > 30_000_000) throw new Error(`Provider rejected ${total} image bytes`)
        return prompts.length === 1
          ? providerStream(
              [{ type: 'tool-call', toolCallId: 'fresh', toolName: 'screenshot', input: '{}' }],
              'tool-calls'
            )
          : providerStream([
              { type: 'text-start', id: 'text-1' },
              { type: 'text-delta', id: 'text-1', delta: 'Complete' },
              { type: 'text-end', id: 'text-1' }
            ])
      })
      const screenshot = tool({
        inputSchema: z.object({}),
        execute: () => toolImage,
        toModelOutput: ({ output }) => ({
          type: 'content',
          value: [
            { type: 'text', text: 'Screenshot' },
            { type: 'image-data', data: output, mediaType: 'image/jpeg' }
          ]
        })
      })
      const agent = new Agent({
        providerId: 'openai',
        providerSettings: {},
        modelId: 'image-budget',
        options: { stopWhen: stepCountIs(3) },
        tools: { screenshot },
        mediaCapabilities: { image: true, audio: false, video: false },
        toolResultMediaCapabilities: { image: native, audio: false, video: false }
      })
      const history: UIMessage = {
        id: 'history',
        role: 'assistant',
        parts: [{ type: 'tool-screenshot', toolCallId: 'old', state: 'output-available', input: {}, output: toolImage }]
      }
      const chunks: UIMessageChunk[] = []
      const stream = agent.stream(
        [
          history,
          {
            id: 'user',
            role: 'user',
            parts: [
              {
                type: 'file',
                url: `data:image/jpeg;base64,${currentImage.toString('base64')}`,
                mediaType: 'image/jpeg'
              }
            ]
          }
        ],
        new AbortController().signal,
        true
      )
      for await (const chunk of stream) chunks.push(chunk)

      expect(chunks).toContainEqual({ type: 'text-delta', id: 'text-1', delta: 'Complete' })
      const notices = chunks.flatMap((chunk) => (chunk.type === 'data-image-payload-reduced' ? [chunk] : []))
      expect(prompts).toHaveLength(2)
      expect(notices).toHaveLength(2)
      expect(new Set(notices.map((notice) => notice.id)).size).toBe(2)
      expect(chunks.find((chunk) => chunk.type === 'tool-output-available')).toMatchObject({ output: toolImage })
      expect(history.parts[0]).toMatchObject({ output: toolImage })

      for (const [index, prompt] of prompts.entries()) {
        const attachments = imageBytes(prompt).flat()
        expect(attachments.reduce((sum, data) => sum + data.length, 0)).toBeLessThanOrEqual(30_000_000)
        expect(attachments.filter((data) => data.equals(currentImage))).toHaveLength(1)
        const toolImages = attachments.filter((data) => !data.equals(currentImage))
        expect(toolImages.length).toBeLessThanOrEqual(index + 1)
        expect(notices[index].data).toEqual({
          reducedCount: toolImages.length,
          omittedCount: index + 1 - toolImages.length
        })
        for (const data of toolImages) {
          expect(data.length).toBeLessThan(2_000_000)
          expect(await sharp(data).metadata()).toMatchObject({ format: 'jpeg', width: 64 })
        }
        for (const id of index ? ['old', 'fresh'] : ['old']) {
          const callIndex = prompt.findIndex(
            (message) =>
              message.role === 'assistant' &&
              message.content.some((part) => part.type === 'tool-call' && part.toolCallId === id)
          )
          expect(callIndex).toBeGreaterThanOrEqual(0)
          expect(prompt[callIndex + 1]).toMatchObject({
            role: 'tool',
            content: [{ type: 'tool-result', toolCallId: id, toolName: 'screenshot' }]
          })
          if (!native) {
            expect(prompt[callIndex + 2]).toMatchObject({
              role: 'user',
              providerOptions: { cherry: { toolResultMedia: true } }
            })
          }
        }
      }
    },
    15_000
  )
})
