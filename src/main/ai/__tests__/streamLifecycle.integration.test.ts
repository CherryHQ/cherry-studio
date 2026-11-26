import { createAnthropic } from '@ai-sdk/anthropic'
import { defaultServiceInstances } from '@test-mocks/main/application'
import { ToolLoopAgent, type UIMessageChunk } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'

import type * as CustomFetch from '../utils/customFetch'
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

let tracingEnabled = false
let liveBodies = 0
let fetches = 0
let cancellationStarted = 0
let cancellationGate: Promise<void> = Promise.resolve()
let releaseCancellation = () => {}
const controllers: ReadableStreamDefaultController<Uint8Array>[] = []
const frames = [
  {
    type: 'message_start',
    message: {
      id: 'A',
      type: 'message',
      role: 'assistant',
      model: 'claude',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 }
    }
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'before' } },
  {
    type: 'message_start',
    message: {
      id: 'B',
      type: 'message',
      role: 'assistant',
      model: 'claude',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 }
    }
  }
]
const fixtureFetch: typeof fetch = async () => {
  fetches++
  liveBodies++
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllers.push(controller)
      controller.enqueue(
        new TextEncoder().encode(
          frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join('')
        )
      )
    },
    async cancel() {
      cancellationStarted++
      await cancellationGate
      liveBodies--
    }
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}
vi.mock('../utils/customFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof CustomFetch>()),
  customFetch: (...args: Parameters<typeof fetch>) => fixtureFetch(...args)
}))

function createManager() {
  BaseService.resetInstances()
  const Ctor = AiStreamManager as unknown as new (config: {
    gracePeriodMs: number
  }) => InstanceType<typeof AiStreamManager>
  return new Ctor({ gracePeriodMs: 0 })
}
const { AiService } = await import('../AiService')
const { AiStreamManager } = await import('../streamManager/AiStreamManager')

describe('failed response transport lifecycle', () => {
  beforeEach(() => {
    tracingEnabled = false
    liveBodies = 0
    fetches = 0
    cancellationStarted = 0
    cancellationGate = Promise.resolve()
    releaseCancellation = () => {}
    controllers.length = 0
    const aiService = new (AiService as any)()
    fakeApplicationGet.mockImplementation((name: string) => {
      if (name === 'AiService') return aiService
      if (name === 'RuntimeActivityService') return defaultServiceInstances.RuntimeActivityService
      if (name === 'CacheService') return fakeCacheService
      if (name === 'PreferenceService')
        return { get: (key: string) => key === 'app.developer_mode.enabled' && tracingEnabled }
      if (name === 'AgentSessionRuntimeService') return { willContinueTopic: () => false }
      if (name === 'TraceStorageService') return { saveSpans: async () => undefined }
      if (name === 'AnalyticsService') return { trackTokenUsage: vi.fn() }
      throw new Error(`Unexpected application service: ${name}`)
    })
    mockCreateAgent.mockImplementation(
      async ({ providerSettings }: any) =>
        new ToolLoopAgent({
          model: createAnthropic({ apiKey: 'test', fetch: providerSettings.fetch })('claude-sonnet-5')
        })
    )
  })
  afterEach(() => {
    releaseCancellation()
    for (const controller of controllers) {
      try {
        controller.close()
      } catch {}
    }
    vi.restoreAllMocks()
  })
  it.each([false, true])(
    'terminates the old body before admitting another request (HTTP tracing: %s)',
    async (tracing) => {
      tracingEnabled = tracing
      const manager = createManager()
      const listener = new FakeListener()
      const send = (topicId: string) =>
        manager.send({
          topicId,
          models: [
            {
              modelId: fakeModel.id,
              request: {
                conversation: { id: topicId, topicId },
                trigger: 'submit-message',
                uniqueModelId: fakeModel.id,
                requestOptions: { maxRetries: 0 },
                messages: [{ id: 'user', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]
              }
            }
          ],
          listeners: [listener]
        })
      cancellationGate = new Promise<void>((resolve) => {
        releaseCancellation = resolve
      })
      send('first')
      await vi.waitFor(() => expect(cancellationStarted).toBe(1))
      expect(listener.errorResults).toHaveLength(0)
      expect(listener.doneResults).toHaveLength(0)
      expect(() => send('first')).toThrow('TOPIC_BUSY')
      expect(fetches).toBe(1)
      releaseCancellation()
      await vi.waitFor(() => expect(listener.errorResults).toHaveLength(1))
      expect(listener.errorResults[0].finalMessage.parts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'text', text: 'before' })])
      )
      expect(listener.errorResults[0].finalMessage.parts.filter((part: any) => part.type === 'text')).toEqual([
        expect.objectContaining({ type: 'text', text: 'before' })
      ])
      expect(listener.chunks.some((chunk) => chunk.type === 'finish')).toBe(false)
      const afterFailure = liveBodies
      send('first')
      await vi.waitFor(() => expect(listener.errorResults).toHaveLength(2))
      expect([afterFailure, liveBodies]).toEqual([0, 0])
    }
  )
})
