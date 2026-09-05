import { BaseService } from '@main/core/lifecycle/BaseService'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import { isGatewayRoutableModel } from '@shared/utils/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ImageTransportRegistryModule from '../provider/custom/imageTransportRegistry'
import type * as ListModelsModule from '../provider/listModels'
import { makeProvider } from './fixtures/provider'

const mockGenerateImage = vi.fn()
const mockAgentGenerate = vi.fn()
const mockCreateAgent = vi.fn()
const mockRerank = vi.fn()
const mockEmbedMany = vi.fn()
const mockDownloadImageAsBase64 = vi.fn()
const mockApplicationGet = vi.fn()
const mockAssistantGetById = vi.fn()
const mockMessageGetById = vi.fn()
const mockMessageUpdate = vi.fn()
const mockMessageApplyApproval = vi.fn()
const mockProviderGetByProviderId = vi.fn()
const mockProviderGetRotatedApiKey = vi.fn()
const mockProviderResolveApiKey = vi.fn()
const mockModelGetByKey = vi.fn()
const mockCreateRetryableWrap = vi.fn((options?: unknown): ((model: unknown) => unknown) | undefined => {
  void options
  return undefined
})
const mockBuildFallbackModels = vi.fn((options?: unknown) => {
  void options
  return [] as unknown[]
})
const mockReadRetryPolicy = vi.fn(() => ({
  enabled: true,
  maxAttempts: 3,
  backoffEnabled: true,
  fallbackModelIds: ['fallback::model']
}))
const mockGetImageGenerationSupport = vi.fn()
const mockResolveImageTransport = vi.fn()
const mockListProviderRegistryModels = vi.fn()
const mockListModelsFromProvider = vi.fn()
const mockInstallBuiltinSkills = vi.fn()
const mockReconcileSkills = vi.fn()
const mockRegisterBuiltinTools = vi.fn()
const mockInstallProviderUserAgentInterceptor = vi.fn(() => vi.fn())
const mockRecordRequest = vi.fn()
const mockAddFileRefsTx = vi.fn()

vi.mock('@application', () => ({
  application: {
    get: mockApplicationGet,
    getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`))
  }
}))

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: {
    getById: (...args: unknown[]) => mockAssistantGetById(...args)
  }
}))

vi.mock('@data/services/JobService', () => ({
  jobService: {
    addFileRefsTx: (...args: unknown[]) => mockAddFileRefsTx(...args)
  }
}))

vi.mock('@main/utils/builtinSkills', () => ({
  installBuiltinSkills: (...args: unknown[]) => mockInstallBuiltinSkills(...args)
}))

vi.mock('../skills/SkillService', () => ({
  skillService: {
    reconcileSkills: (...args: unknown[]) => mockReconcileSkills(...args)
  }
}))

vi.mock('../tools/adapters/aiSdk/builtin/registerBuiltinTools', () => ({
  registerBuiltinTools: (...args: unknown[]) => mockRegisterBuiltinTools(...args)
}))

vi.mock('../utils/customFetch', () => ({
  installProviderUserAgentInterceptor: () => mockInstallProviderUserAgentInterceptor(),
  // The inline health-check probe resolves the real provider config, which
  // defaults providerSettings.fetch to customFetch — a stub keeps it inert.
  customFetch: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: (...args: unknown[]) => mockProviderGetByProviderId(...args),
    getRotatedApiKey: (...args: unknown[]) => mockProviderGetRotatedApiKey(...args),
    resolveApiKey: (...args: unknown[]) => mockProviderResolveApiKey(...args)
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: (...args: unknown[]) => mockModelGetByKey(...args)
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    getImageGenerationSupport: (...args: unknown[]) => mockGetImageGenerationSupport(...args),
    listProviderRegistryModels: (...args: unknown[]) => mockListProviderRegistryModels(...args)
  }
}))

// Inline health-check probes resolve the transport through this module. Keep
// `hasImageTransport` real (routing tests depend on the true registry) and stub
// only the transport resolution so submit never reaches the network.
vi.mock('../provider/custom/imageTransportRegistry', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageTransportRegistryModule>()
  return {
    ...actual,
    resolveImageTransport: (...args: unknown[]) => mockResolveImageTransport(...args)
  }
})

vi.mock('../provider/listModels', async (importOriginal) => {
  const actual = await importOriginal<typeof ListModelsModule>()
  return {
    ...actual,
    listModels: (...args: unknown[]) => mockListModelsFromProvider(...args)
  }
})
vi.mock('@main/utils/downloadAsBase64', () => ({
  downloadImageAsBase64: (...args: unknown[]) => mockDownloadImageAsBase64(...args)
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    getById: mockMessageGetById,
    update: mockMessageUpdate,
    applyToolApprovalDecisions: mockMessageApplyApproval
  }
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: (...args: unknown[]) => mockCreateAgent(...args),
  definePlugin: (plugin: unknown) => plugin,
  embedMany: async (...args: unknown[]) => {
    const result = await mockEmbedMany(...args)
    const params = args[2] as { onProviderCall?: (event: unknown) => void }
    params.onProviderCall?.({
      modality: 'embedding',
      requestId: 'ai-core:embedding:test',
      providerId: args[0],
      modelId: 'test-embedding-model',
      usage: result.usage,
      metrics: { timeCompletionMs: 10 },
      completedAt: 100
    })
    return result
  },
  generateImage: async (...args: unknown[]) => {
    const result = await mockGenerateImage(...args)
    const params = args[2] as { onProviderCall?: (event: unknown) => void }
    params.onProviderCall?.({
      modality: 'image',
      requestId: 'ai-core:image:test',
      providerId: args[0],
      modelId: 'test-model',
      imageCount: result.images?.length ?? 0,
      metrics: { timeCompletionMs: 10 },
      completedAt: 100
    })
    return result
  },
  rerank: async (...args: unknown[]) => {
    const result = await mockRerank(...args)
    const params = args[2] as { onProviderCall?: (event: unknown) => void }
    params.onProviderCall?.({
      modality: 'rerank',
      requestId: 'ai-core:rerank:test',
      providerId: args[0],
      modelId: 'test-reranker',
      metrics: { timeCompletionMs: 10 },
      completedAt: 100
    })
    return result
  }
}))

vi.mock('@main/data/services/AiUsageRecordService', async (importActual) => {
  const actual = (await importActual()) as object
  return {
    ...actual,
    aiUsageRecordService: {
      recordInvocation: (...args: unknown[]) => mockRecordRequest(...args)
    }
  }
})

vi.mock('../runtime/aiSdk/retry/createRetryableWrap', () => ({
  createRetryableWrap: (options: unknown) => mockCreateRetryableWrap(options)
}))

vi.mock('../runtime/aiSdk/retry/buildFallbackModels', () => ({
  buildFallbackModels: (options: unknown) => mockBuildFallbackModels(options)
}))

vi.mock('../runtime/aiSdk/retry/retryPolicy', () => ({
  readRetryPolicy: () => mockReadRetryPolicy()
}))

const { listModels: listModelsFromProviderActual } =
  await vi.importActual<typeof ListModelsModule>('../provider/listModels')
const { AiService, imageInputEntryParams, resolveRequiredNativeFileSupport } = await import('../AiService')
const { messageService } = await import('@main/data/services/MessageService')

/**
 * Instantiate `AiService` directly (without going through the lifecycle
 * container) so unit tests can drive its methods in isolation.
 */
function createService(): InstanceType<typeof AiService> {
  BaseService.resetInstances()
  return new (AiService as any)()
}

describe('AiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateAgent.mockReset()
    mockAssistantGetById.mockReturnValue(undefined)
    mockReadRetryPolicy.mockReturnValue({
      enabled: true,
      maxAttempts: 3,
      backoffEnabled: true,
      fallbackModelIds: ['fallback::model']
    })
    mockAgentGenerate.mockResolvedValue({
      text: 'ok',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} },
      steps: []
    })
    mockCreateAgent.mockResolvedValue({ generate: mockAgentGenerate })
    mockProviderGetRotatedApiKey.mockReturnValue('test-key')
    mockProviderResolveApiKey.mockImplementation((_id: string, override?: string) => ({
      value: override ?? 'test-key',
      apiKeySelection: { attribution: override ? ('matched' as const) : ('unknown' as const) }
    }))
    mockProviderGetByProviderId.mockReturnValue({
      id: 'test-provider',
      name: 'Test Provider',
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      settings: {},
      isEnabled: true
    })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-model',
      providerId: 'test-provider',
      apiModelId: 'test-model',
      name: 'Test Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })
    // Default: resolve, like the real usage-record store's best-effort contract. Individual
    // tests override with mockRejectedValueOnce to exercise the failure path.
    mockRecordRequest.mockResolvedValue(undefined)
  })

  it('routes agent-session runtime requests directly to the runtime service', async () => {
    const service = createService()
    const stream = new ReadableStream()
    const openTurnStream = vi.fn(() => stream)
    mockApplicationGet.mockReturnValue({ openTurnStream })

    await expect(
      service.streamText({
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        runtime: { kind: 'agent-session', sessionId: 'session-1', turnId: 'turn-1' },
        requestOptions: { signal: new AbortController().signal }
      } as any)
    ).resolves.toBe(stream)

    expect(mockApplicationGet).toHaveBeenCalledWith('AgentSessionRuntimeService')
    expect(openTurnStream).toHaveBeenCalledWith({
      sessionId: 'session-1',
      turnId: 'turn-1',
      signal: expect.any(AbortSignal)
    })
  })

  it('rejects agent-session streams that do not carry a runtime request', async () => {
    const service = createService()
    const buildAgentParamsFor = vi.spyOn(service as any, 'buildAgentParamsFor')

    await expect(
      service.streamText({
        chatId: 'agent-session:session-1',
        trigger: 'submit-message',
        requestOptions: { signal: new AbortController().signal }
      } as any)
    ).rejects.toThrow('requires an agent-session runtime request')

    expect(buildAgentParamsFor).not.toHaveBeenCalled()
    expect(mockApplicationGet).not.toHaveBeenCalled()
  })

  it('detects only native attachment shapes that the primary model preserves', () => {
    const primarySupport = { image: true, pdf: true, audio: false, video: true }
    const messages = [
      {
        parts: [
          { type: 'file', mediaType: 'image/png' },
          { type: 'file', mediaType: 'application/pdf' },
          { type: 'file', mediaType: 'audio/mpeg' },
          { type: 'file', mediaType: 'video/mp4' }
        ]
      },
      { content: [{ type: 'image' }] }
    ]

    expect(resolveRequiredNativeFileSupport(messages, primarySupport)).toEqual({
      image: true,
      pdf: true,
      audio: false,
      video: true
    })
  })

  it('flushes accumulated token analytics once when an agent run errors', async () => {
    const service = createService()
    const trackTokenUsage = vi.fn()
    mockApplicationGet.mockReturnValue({ trackTokenUsage })
    const hooks = (service as any).analyticsHookPart({
      id: 'test-model',
      providerId: 'test-provider',
      apiModelId: 'test-api-model'
    })

    await hooks.onStepFinish({
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
        inputTokenDetails: {},
        outputTokenDetails: {}
      }
    })
    await hooks.onError({ error: new Error('terminal tool failure') })
    await hooks.onFinish()

    expect(mockApplicationGet).toHaveBeenCalledWith('AnalyticsService')
    expect(trackTokenUsage).toHaveBeenCalledOnce()
    expect(trackTokenUsage).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'test-api-model',
      input_tokens: 3,
      output_tokens: 5,
      source: 'chat'
    })
  })

  it('flushes accumulated token analytics when a completed step is followed by cancellation', async () => {
    const service = createService()
    const trackTokenUsage = vi.fn()
    mockApplicationGet.mockReturnValue({ trackTokenUsage })
    const hooks = (service as any).analyticsHookPart({
      id: 'test-model',
      providerId: 'test-provider',
      apiModelId: 'test-api-model'
    })

    await hooks.onStepFinish({
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
        inputTokenDetails: {},
        outputTokenDetails: {}
      }
    })
    await hooks.onAbort()
    await hooks.onFinish()

    expect(mockApplicationGet).toHaveBeenCalledWith('AnalyticsService')
    expect(trackTokenUsage).toHaveBeenCalledOnce()
    expect(trackTokenUsage).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'test-api-model',
      input_tokens: 3,
      output_tokens: 5,
      source: 'chat'
    })
  })

  it('reports explicitly classified token analytics as agent usage', async () => {
    const service = createService()
    const trackTokenUsage = vi.fn()
    mockApplicationGet.mockReturnValue({ trackTokenUsage })
    const hooks = (service as any).analyticsHookPart(
      {
        id: 'test-model',
        providerId: 'test-provider',
        apiModelId: 'test-api-model'
      },
      'agent'
    )

    await hooks.onStepFinish({
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        totalTokens: 8,
        inputTokenDetails: {},
        outputTokenDetails: {}
      }
    })
    await hooks.onFinish()

    expect(trackTokenUsage).toHaveBeenCalledWith({
      provider: 'test-provider',
      model: 'test-api-model',
      input_tokens: 3,
      output_tokens: 5,
      source: 'agent'
    })
  })

  it('normalizes base64 and url images from ai-core generateImage', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
      },
      model: {
        id: 'test-provider::test-model',
        providerId: 'test-provider',
        modelId: 'test-model',
        pricing: { input: { perMillionTokens: null }, output: { perMillionTokens: null }, perImage: { price: 0.05 } }
      }
    } as never)

    mockGenerateImage.mockResolvedValue({
      images: [{ base64: 'abc123', mediaType: 'image/png' }, { nonsense: true }],
      providerMetadata: {
        testProvider: {
          images: [{ url: 'https://example.com/image.png' }]
        }
      }
    })

    mockDownloadImageAsBase64.mockResolvedValue({
      data: 'url-base64',
      media_type: 'image/jpeg'
    })

    const fileEntry = { id: 'file-1', origin: 'internal', ext: 'png', name: 'img', size: 3, createdAt: 0 }
    const createInternalEntry = vi.fn().mockResolvedValue(fileEntry)
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'FileManager' ? { createInternalEntry } : undefined
    )

    const result = await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      cleanupPolicy: 'delete_when_unreferenced',
      prompt: 'draw a cat',
      // Canonical paramValues bag (`numImages`, not `n`); main re-derives the
      // wire shape. Only n/size/seed/aspectRatio are AI SDK native options; the
      // knobs (negativePrompt/quality/…) ride in `providerOptions[id]` (wire-named).
      paramValues: {
        numImages: 2,
        size: '1024x1024',
        aspectRatio: '9:19.5',
        negativePrompt: 'blurry',
        seed: 7,
        quality: 'high',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true
      },
      requestOptions: { signal: new AbortController().signal }
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-model',
        prompt: 'draw a cat',
        n: 2,
        size: '1024x1024',
        aspectRatio: '9:19.5',
        seed: 7,
        maxRetries: 0,
        providerOptions: {
          'test-provider': {
            negative_prompt: 'blurry',
            seed: 7,
            quality: 'high',
            num_inference_steps: 30,
            guidance_scale: 4.5,
            prompt_enhancement: true
          }
        }
      })
    )

    const callOptions = mockGenerateImage.mock.calls[0]?.[2]
    expect(callOptions.experimental_download).toBeTypeOf('function')

    const downloaded = await callOptions.experimental_download([
      {
        url: new URL('https://example.com/image.png'),
        isUrlSupportedByModel: false
      }
    ])

    expect(mockDownloadImageAsBase64).toHaveBeenCalledWith('https://example.com/image.png')
    expect(downloaded).toEqual([
      {
        data: Buffer.from('url-base64', 'base64'),
        mediaType: 'image/jpeg'
      }
    ])

    expect(createInternalEntry).toHaveBeenCalledWith({
      source: 'base64',
      data: 'data:image/png;base64,abc123',
      cleanupPolicy: 'delete_when_unreferenced'
    })
    expect(result).toEqual({ files: [fileEntry] })
  })

  it("omits the SDK size for the 'auto' sentinel AND when no size is given (no 1024x1024 default)", async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
      }
    } as never)

    mockGenerateImage.mockResolvedValue({ images: [] })
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'FileManager' ? { createInternalEntry: vi.fn() } : undefined
    )

    await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      cleanupPolicy: 'delete_when_unreferenced',
      prompt: 'draw a cat',
      paramValues: { size: 'auto' }
    })
    expect(mockGenerateImage.mock.calls[0]?.[2] as Record<string, unknown>).not.toHaveProperty('size')

    // No size at all → omitted too (the provider/server applies its own default),
    // rather than the old forced 1024x1024.
    await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      cleanupPolicy: 'delete_when_unreferenced',
      prompt: 'draw a cat',
      paramValues: {}
    })
    expect(mockGenerateImage.mock.calls[1]?.[2] as Record<string, unknown>).not.toHaveProperty('size')
  })

  it('routes silicon through the WireProfile engine, producing the same providerOptions.silicon', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'silicon', providerSettings: {}, modelId: 'Kwai-Kolors/Kolors' }
    } as never)

    mockGenerateImage.mockResolvedValue({ images: [] })
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'FileManager' ? { createInternalEntry: vi.fn() } : undefined
    )

    await service.generateImage({
      uniqueModelId: 'silicon::Kwai-Kolors/Kolors',
      cleanupPolicy: 'delete_when_unreferenced',
      prompt: 'a fox',
      // numImages is native (→ imageParams.n); the rest form the silicon vendor body.
      paramValues: {
        numImages: 2,
        seed: 42,
        negativePrompt: 'low quality',
        numInferenceSteps: 25,
        guidanceScale: 4.5,
        cfg: 7.5
      }
    })

    expect(mockGenerateImage).toHaveBeenCalledWith(
      'silicon',
      {},
      expect.objectContaining({
        n: 2,
        // Byte-identical to the old buildImageProviderOptions diffusion bag.
        providerOptions: {
          silicon: { negative_prompt: 'low quality', seed: 42, num_inference_steps: 25, guidance_scale: 4.5, cfg: 7.5 }
        }
      })
    )
  })

  // The direct (non-job) image path observes the actual ImageModel doGenerate
  // call in aiCore. These tests pin both the usage payload and the fact that
  // local persistence happens after the provider output has been recorded.
  describe('generateImage — AI usage record (direct path)', () => {
    function stubDirectImage(service: InstanceType<typeof AiService>) {
      vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
        sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-model' },
        model: { id: 'test-provider::test-model', providerId: 'test-provider' }
      } as never)
      mockGenerateImage.mockResolvedValue({ images: [{ base64: 'abc123', mediaType: 'image/png' }] })
      const fileEntry = { id: 'file-1', origin: 'internal', ext: 'png', name: 'img', size: 3, createdAt: 0 }
      mockApplicationGet.mockImplementation((name: string) =>
        name === 'FileManager' ? { createInternalEntry: vi.fn().mockResolvedValue(fileEntry) } : undefined
      )
      return fileEntry
    }

    it('records the provider output count with modality "image"', async () => {
      const service = createService()
      stubDirectImage(service)

      await service.generateImage({
        uniqueModelId: 'test-provider::test-model',
        prompt: 'draw a cat',
        cleanupPolicy: 'delete_when_unreferenced',
        paramValues: {}
      })

      expect(mockRecordRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ modelId: 'test-model' }),
          modality: 'image',
          imageCount: 1
        })
      )
    })

    it('records the provider output before local file persistence can fail', async () => {
      const service = createService()
      mockAssistantGetById.mockReturnValue({
        id: 'assistant-1',
        name: 'Image Assistant',
        emoji: '🎨'
      })
      vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
        sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-model' },
        model: { id: 'test-provider::test-model', providerId: 'test-provider' },
        assistant: { id: 'assistant-1', name: 'Image Assistant', emoji: '🎨' }
      } as never)
      mockGenerateImage.mockResolvedValue({
        images: [
          { base64: 'first', mediaType: 'image/png' },
          { base64: 'second', mediaType: 'image/png' }
        ]
      })
      const createInternalEntry = vi.fn().mockRejectedValue(new Error('disk full'))
      mockApplicationGet.mockImplementation((name: string) =>
        name === 'FileManager' ? { createInternalEntry } : undefined
      )

      await expect(
        service.generateImage({
          uniqueModelId: 'test-provider::test-model',
          assistantId: 'assistant-1',
          prompt: 'draw a cat',
          cleanupPolicy: 'delete_when_unreferenced',
          paramValues: {}
        })
      ).rejects.toThrow('disk full')

      expect(mockRecordRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          modality: 'image',
          imageCount: 2,
          context: expect.objectContaining({
            source: { type: 'assistant', id: 'assistant-1', name: 'Image Assistant', icon: '🎨' }
          })
        })
      )
      expect(mockRecordRequest.mock.invocationCallOrder[0]).toBeLessThan(
        createInternalEntry.mock.invocationCallOrder[0]
      )
    })
  })

  // `embedMany`'s usage-record write had zero coverage before this: neither the payload
  // shape (modality/token count) nor the failure-must-not-disrupt-the-request
  // contract was tested.
  describe('embedMany — AI usage record', () => {
    function stubEmbedding(service: InstanceType<typeof AiService>) {
      vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
        sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-embedding-model' },
        credentialReceipt: {
          attribution: 'explicit',
          id: 'key-a',
          label: 'Primary',
          masked: 'sk-a****aaaa'
        },
        provider: {
          id: 'test-provider',
          name: 'Test Provider',
          reportsActualCost: false
        },
        model: {
          id: 'test-provider::test-embedding-model',
          providerId: 'test-provider',
          name: 'Test Embedding Model'
        },
        assistant: { id: 'assistant-1', name: 'Embedding Assistant', emoji: '📚' }
      } as never)
      mockEmbedMany.mockResolvedValue({ embeddings: [[0.1, 0.2]], usage: { tokens: 42 } })
    }

    it('records the usage entry with modality "embedding" and the token count', async () => {
      const service = createService()
      stubEmbedding(service)

      await service.embedMany({ uniqueModelId: 'test-provider::test-embedding-model', values: ['hello'] })

      expect(mockRecordRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'ai-core:embedding:test',
          context: expect.objectContaining({
            credentialReceipt: {
              attribution: 'explicit',
              id: 'key-a',
              label: 'Primary',
              masked: 'sk-a****aaaa'
            },
            source: { type: 'assistant', id: 'assistant-1', name: 'Embedding Assistant', icon: '📚' }
          }),
          modality: 'embedding',
          usage: { inputTokens: 42, totalTokens: 42 }
        })
      )
    })

    it('records an embedding request when the provider explicitly reports zero tokens', async () => {
      const service = createService()
      stubEmbedding(service)
      mockEmbedMany.mockResolvedValue({ embeddings: [[0.1, 0.2]], usage: { tokens: 0 } })

      await service.embedMany({ uniqueModelId: 'test-provider::test-embedding-model', values: ['hello'] })

      expect(mockRecordRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          modality: 'embedding',
          usage: { inputTokens: 0, totalTokens: 0 }
        })
      )
    })
  })
})

describe('AiService.onInit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'JobManager' ? { registerHandler: vi.fn() } : undefined
    )
    mockReconcileSkills.mockResolvedValue(undefined)
  })

  it('installs built-in skills before reconciling skills, without blocking init', async () => {
    const calls: string[] = []
    mockInstallBuiltinSkills.mockImplementation(async () => {
      calls.push('installBuiltinSkills')
    })
    mockReconcileSkills.mockImplementation(async () => {
      calls.push('reconcileSkills')
    })
    const service = createService()

    // Fire-and-forget: _doInit resolves without waiting on this chain.
    await service._doInit()
    await vi.waitFor(() => expect(mockReconcileSkills).toHaveBeenCalled())

    expect(calls).toEqual(['installBuiltinSkills', 'reconcileSkills'])
  })

  it('logs and continues to reconcile when installBuiltinSkills rejects', async () => {
    mockInstallBuiltinSkills.mockRejectedValue(new Error('disk full'))
    const service = createService()

    await expect(service._doInit()).resolves.toBeUndefined()
    await vi.waitFor(() => expect(mockReconcileSkills).toHaveBeenCalled())
  })
})

describe('AiService tool approval', () => {
  /** A fake renderer event whose `sender` satisfies `WebContentsListener`'s constructor. */
  function fakeEvent() {
    return {
      sender: {
        id: 1,
        once: vi.fn(),
        isDestroyed: () => false,
        send: vi.fn()
      }
    } as never
  }

  /** A minimal `approval-requested` tool UI part (passes `isToolUIPart`). */
  function pendingToolPart(approvalId: string, toolName = 'mcp_write') {
    return {
      type: `tool-${toolName}`,
      toolCallId: `tc-${approvalId}`,
      state: 'approval-requested',
      input: {},
      approval: { id: approvalId }
    }
  }

  function approvalMutationResult(
    parts: unknown[],
    appliedApprovalIds: string[] = [],
    alreadySettledApprovalIds: string[] = []
  ) {
    return { parts, appliedApprovalIds, alreadySettledApprovalIds }
  }

  /**
   * The `ai.tool.respond_approval` flow lives in `AiService.respondToolApproval(payload, senderWc)`
   * (the IpcApi handler in `handlers/ai.ts` resolves the WebContents from `ctx.senderId` and calls
   * it). Adapt to the old `(event, payload)` call shape so the cases below read unchanged.
   */
  function getApprovalHandler() {
    const service = createService()
    return (
      event: { sender: Electron.WebContents },
      payload: {
        approvalId: string
        approved: boolean
        reason?: string
        updatedInput?: Record<string, unknown>
        topicId?: string
        anchorId?: string
      }
    ) => service.respondToolApproval(payload, event.sender)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('takes the Claude-Agent fast-path when the live registry dispatches the decision', async () => {
    const respondToolApproval = vi.fn(() => true)
    const dispatch = vi.fn()
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })
    const getById = vi.spyOn(messageService, 'getById')

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'agent-approval-1',
      approved: true
    })

    expect(result).toEqual({ ok: true })
    expect(respondToolApproval).toHaveBeenCalledWith(
      'agent-approval-1',
      {
        approved: true,
        reason: undefined,
        updatedInput: undefined
      },
      undefined
    )
    // Fast-path short-circuits before any DB read or continue dispatch.
    expect(getById).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when there is no live entry and no anchor context', async () => {
    const respondToolApproval = vi.fn(() => false)
    mockApplicationGet.mockImplementation((name: string) =>
      name === 'AgentSessionRuntimeService' ? { respondToolApproval } : undefined
    )
    const getById = vi.spyOn(messageService, 'getById')

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'orphan-approval-1',
      approved: true
      // no topicId / anchorId
    })

    expect(result).toEqual({ ok: false })
    expect(getById).not.toHaveBeenCalled()
  })

  it('applies the decision atomically and dispatches continue-conversation when nothing is left pending', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // The serialized atomic mutation returns the committed parts with the decision applied; the
    // handler computes "still pending" from THESE committed parts, not a local stale copy.
    const committed = [
      { type: 'text', text: 'hello' },
      { ...pendingToolPart('mcp-approval-1'), state: 'approval-responded', input: { command: 'pwd' } }
    ]
    const apply = vi
      .spyOn(messageService, 'applyToolApprovalDecisions')
      .mockReturnValue(approvalMutationResult(committed, ['mcp-approval-1']) as never)

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      updatedInput: { command: 'pwd' },
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    // The decision goes through the serialized read-modify-write, not an ad-hoc getById+update.
    expect(apply).toHaveBeenCalledWith('anchor-1', [
      { approvalId: 'mcp-approval-1', approved: true, updatedInput: { command: 'pwd' } }
    ])
    // Nothing left pending → resume via continue-conversation.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'continue-conversation',
        topicId: 'topic-1',
        parentAnchorId: 'anchor-1',
        approvalDecisions: [{ approvalId: 'mcp-approval-1', approved: true, updatedInput: { command: 'pwd' } }]
      })
    )
  })

  it('skips the continuation (ok:false) when there is no caller window to stream it to', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })
    const committed = [{ ...pendingToolPart('mcp-approval-1'), state: 'approval-responded' }]
    vi.spyOn(messageService, 'applyToolApprovalDecisions').mockReturnValue(
      approvalMutationResult(committed, ['mcp-approval-1']) as never
    )

    // No managed window → senderWc undefined: the continuation has nothing to surface on.
    const handler = getApprovalHandler()
    const result = await handler({ sender: undefined } as never, {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: false })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses (ok:false) without mutating the row when a stream is still live on the topic', async () => {
    // The approval card is clickable the moment the chunk arrives (live overlay), so a response can
    // land while a sibling exec / another continuation is still live. Dispatching continue-conversation
    // then would hit send()'s inject path and silently swallow the approved turn. Gate it: refuse
    // before touching the row, so the card stays actionable and the renderer can retry post-settle.
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    const hasLiveStream = vi.fn(() => true)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream }
      return undefined
    })
    const apply = vi.spyOn(messageService, 'applyToolApprovalDecisions')

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: false })
    expect(hasLiveStream).toHaveBeenCalledWith('topic-1')
    // Row is NOT mutated and no continuation is dispatched.
    expect(apply).not.toHaveBeenCalled()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('still dispatches when the committed parts report nothing pending (overlay-only decision)', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // Overlay-only: the target part isn't on the row, so the committed parts carry no pending approval.
    const apply = vi
      .spyOn(messageService, 'applyToolApprovalDecisions')
      .mockReturnValue(approvalMutationResult([{ type: 'text', text: 'hello' }]) as never)

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-missing',
      approved: false,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledWith('anchor-1', [{ approvalId: 'mcp-approval-missing', approved: false }])
    // The decision still rides the continue dispatch idempotently.
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        trigger: 'continue-conversation',
        approvalDecisions: [{ approvalId: 'mcp-approval-missing', approved: false }]
      })
    )
  })

  it('does not finalize while another approval on the turn is still pending', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // Committed parts: this approval decided, but a sibling is still approval-requested.
    vi.spyOn(messageService, 'applyToolApprovalDecisions').mockReturnValue(
      approvalMutationResult(
        [
          { ...pendingToolPart('mcp-approval-1'), state: 'approval-responded' },
          pendingToolPart('mcp-approval-2', 'mcp_read')
        ],
        ['mcp-approval-1']
      ) as never
    )

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    // The still-pending sibling gates the resume.
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('ignores duplicate already-settled approval responses without dispatching another continuation', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    const apply = vi
      .spyOn(messageService, 'applyToolApprovalDecisions')
      .mockReturnValue(
        approvalMutationResult(
          [{ ...pendingToolPart('mcp-approval-1'), state: 'approval-responded' }],
          [],
          ['mcp-approval-1']
        ) as never
      )

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'anchor-1'
    })

    expect(result).toEqual({ ok: true })
    expect(apply).toHaveBeenCalledWith('anchor-1', [{ approvalId: 'mcp-approval-1', approved: true }])
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns { ok: false } when the anchor message is missing or deleted', async () => {
    const respondToolApproval = vi.fn(() => false)
    const dispatch = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'AgentSessionRuntimeService') return { respondToolApproval }
      if (name === 'AiStreamManager') return { dispatch, hasLiveStream: () => false }
      return undefined
    })

    // A stale click on a deleted message: the atomic mutation reports the anchor is gone (null).
    const apply = vi.spyOn(messageService, 'applyToolApprovalDecisions').mockReturnValue(null)

    const handler = getApprovalHandler()
    const result = await handler(fakeEvent(), {
      approvalId: 'mcp-approval-1',
      approved: true,
      topicId: 'topic-1',
      anchorId: 'deleted-anchor'
    })

    // Resolves gracefully through the documented result shape instead of throwing.
    expect(result).toEqual({ ok: false })
    expect(apply).toHaveBeenCalledWith('deleted-anchor', [{ approvalId: 'mcp-approval-1', approved: true }])
    expect(dispatch).not.toHaveBeenCalled()
  })

  // Payload validation (empty `approvalId`, missing `approved`) now lives in the IpcApi router's
  // zod parse of `ai.tool.respond_approval`, not in `respondToolApproval` — so the invalid-payload
  // case is no longer unit-tested here (a thin schema contract; see ipc-usage.md "Testing").

  it('routes rerank requests through ai-core rerank', async () => {
    const service = createService()
    const abortController = new AbortController()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-reranker'
      },
      options: {
        headers: { 'x-test': 'yes' },
        maxRetries: 0
      },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: {
        id: 'test-provider',
        name: 'Test Provider',
        reportsActualCost: false
      },
      model: {
        id: 'test-provider::test-reranker',
        providerId: 'test-provider',
        name: 'Test Reranker'
      }
    } as never)

    mockRerank.mockResolvedValue({
      ranking: [
        { originalIndex: 1, score: 0.9, document: 'beta' },
        { originalIndex: 0, score: 0.2, document: 'alpha' }
      ]
    })

    await expect(
      service.rerank({
        uniqueModelId: 'test-provider::test-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 2,
        requestOptions: {
          headers: { 'x-test': 'yes' },
          maxRetries: 0,
          signal: abortController.signal
        }
      })
    ).resolves.toEqual({
      ranking: [
        { originalIndex: 1, score: 0.9 },
        { originalIndex: 0, score: 0.2 }
      ]
    })

    expect(mockRerank).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-reranker',
        query: 'hello',
        documents: ['alpha', 'beta'],
        topN: 2,
        headers: { 'x-test': 'yes' },
        maxRetries: 0,
        abortSignal: abortController.signal
      })
    )
    expect(mockRecordRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'ai-core:rerank:test',
        modality: 'rerank',
        metrics: { timeCompletionMs: 10 }
      })
    )
  })

  it('caps embedMany parallelism and derives maxRetries from the retry preference', async () => {
    const service = createService()
    vi.spyOn(service as never, 'trackUsage').mockReturnValue(undefined as never)
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-embed' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-embed', name: 'Test Embed' }
    } as never)
    mockReadRetryPolicy.mockReturnValue({
      enabled: true,
      maxAttempts: 3,
      backoffEnabled: false,
      fallbackModelIds: []
    })
    mockEmbedMany.mockResolvedValue({ embeddings: [[0.1]], usage: { tokens: 4 } })

    await service.embedMany({ uniqueModelId: 'test-provider::test-embed', values: ['a', 'b'] })

    expect(mockEmbedMany).toHaveBeenCalledWith(
      'test-provider',
      {},
      expect.objectContaining({
        model: 'test-embed',
        values: ['a', 'b'],
        maxParallelCalls: 5,
        maxRetries: 3
      })
    )
    // ai-retry no longer wraps the embedding model — the SDK's built-in retry owns it.
    expect(mockEmbedMany.mock.calls[0][2]).not.toHaveProperty('wrapModel')
  })

  it('keeps embedMany at the AI SDK default (maxRetries 2) when retry is disabled', async () => {
    // Regression: default-config embedding must NOT drop from the SDK's 2
    // retries to 0 — this PR adds retry behavior, it never removes it.
    const service = createService()
    vi.spyOn(service as never, 'trackUsage').mockReturnValue(undefined as never)
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-embed' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-embed', name: 'Test Embed' }
    } as never)
    mockReadRetryPolicy.mockReturnValue({
      enabled: false,
      maxAttempts: 3,
      backoffEnabled: false,
      fallbackModelIds: []
    })
    mockEmbedMany.mockResolvedValue({ embeddings: [[0.1]], usage: { tokens: 1 } })

    await service.embedMany({ uniqueModelId: 'test-provider::test-embed', values: ['a'] })

    expect(mockEmbedMany.mock.calls[0][2]).toEqual(expect.objectContaining({ maxRetries: 2 }))
    expect(mockEmbedMany.mock.calls[0][2]).not.toHaveProperty('maxParallelCalls')
  })

  it('derives rerank maxRetries from the retry preference (0 when disabled)', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-reranker' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-reranker', name: 'Test Reranker' },
      options: {}
    } as never)
    // Retry enabled with 4 retries → rerank passes maxRetries: 4.
    mockReadRetryPolicy.mockReturnValue({
      enabled: true,
      maxAttempts: 4,
      backoffEnabled: false,
      fallbackModelIds: []
    })
    mockRerank.mockResolvedValue({ ranking: [{ originalIndex: 0, score: 1 }] })

    await service.rerank({ uniqueModelId: 'test-provider::test-reranker', query: 'q', documents: ['a'] })

    expect(mockRerank.mock.calls[0][2]).toEqual(expect.objectContaining({ maxRetries: 4 }))
  })

  it('keeps rerank retries disabled when the retry feature is disabled', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-reranker' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-reranker', name: 'Test Reranker' },
      options: {}
    } as never)
    mockReadRetryPolicy.mockReturnValue({
      enabled: false,
      maxAttempts: 3,
      backoffEnabled: false,
      fallbackModelIds: []
    })
    mockRerank.mockResolvedValue({ ranking: [{ originalIndex: 0, score: 1 }] })

    await service.rerank({ uniqueModelId: 'test-provider::test-reranker', query: 'q', documents: ['a'] })

    expect(mockRerank.mock.calls[0][2]).toEqual(expect.objectContaining({ maxRetries: 0 }))
  })

  it('disables the chat retry wrapper when requestOptions.maxRetries is 0', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-model' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-model', name: 'Test Model', capabilities: [] },
      tools: undefined,
      plugins: [],
      system: undefined,
      options: {},
      hookParts: [],
      assistant: undefined,
      nativeFileSupport: { image: false, pdf: false, audio: false, video: false },
      fileAttachments: []
    } as never)

    await service.streamText({
      chatId: 'topic-1',
      trigger: 'submit-message',
      messages: [],
      requestOptions: { maxRetries: 0, signal: new AbortController().signal }
    } as never)

    // Explicit per-request maxRetries:0 → no ai-retry wrapper / no fallback build.
    expect(mockCreateRetryableWrap).not.toHaveBeenCalled()
    expect(mockBuildFallbackModels).not.toHaveBeenCalled()
  })

  it('builds the chat retry wrapper when no explicit maxRetries override is given', async () => {
    const service = createService()
    mockReadRetryPolicy.mockReturnValue({
      enabled: true,
      maxAttempts: 3,
      backoffEnabled: true,
      fallbackModelIds: ['fallback::model']
    })
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-model' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-model', name: 'Test Model', capabilities: [] },
      tools: undefined,
      plugins: [],
      system: undefined,
      options: {},
      hookParts: [],
      assistant: undefined,
      nativeFileSupport: { image: true, pdf: false, audio: false, video: false },
      fileAttachments: []
    } as never)

    await service.streamText({
      chatId: 'topic-1',
      trigger: 'submit-message',
      messages: [],
      requestOptions: { signal: new AbortController().signal }
    } as never)

    expect(mockCreateRetryableWrap).toHaveBeenCalledTimes(1)
    expect(mockBuildFallbackModels).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryUniqueModelId: 'test-provider::test-model',
        primaryHasTools: false,
        requiredNativeFileSupport: { image: false, pdf: false, audio: false, video: false },
        retryPolicy: expect.objectContaining({ enabled: true, maxAttempts: 3 })
      })
    )
    expect(mockCreateRetryableWrap).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbacks: [],
        retryPolicy: expect.objectContaining({ enabled: true, maxAttempts: 3 }),
        onRetryEvent: expect.any(Function)
      })
    )
  })

  it('honors maxRetries: 0 for generateText without building fallbacks', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-model' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-model', name: 'Test Model', capabilities: [] },
      tools: undefined,
      plugins: [],
      system: undefined,
      options: {},
      hookParts: [],
      assistant: undefined,
      nativeFileSupport: { image: false, pdf: false, audio: false, video: false }
    } as never)

    await service.generateText({
      uniqueModelId: 'test-provider::test-model',
      prompt: 'hello',
      requestOptions: { maxRetries: 0 }
    } as never)

    expect(mockCreateRetryableWrap).not.toHaveBeenCalled()
    expect(mockBuildFallbackModels).not.toHaveBeenCalled()
  })

  it('wires retry policy and native requirements into generateText fallbacks', async () => {
    const service = createService()
    mockCreateRetryableWrap.mockReturnValue(((model: unknown) => model) as never)
    mockReadRetryPolicy.mockReturnValue({
      enabled: true,
      maxAttempts: 3,
      backoffEnabled: true,
      fallbackModelIds: ['fallback::model']
    })
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: { providerId: 'test-provider', providerSettings: {}, modelId: 'test-model' },
      credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'sk-a****aaaa' },
      provider: { id: 'test-provider', name: 'Test Provider', reportsActualCost: false },
      model: { id: 'test-provider::test-model', name: 'Test Model', capabilities: [] },
      tools: { search: {} },
      plugins: [],
      system: undefined,
      options: {},
      hookParts: [],
      assistant: undefined,
      nativeFileSupport: { image: true, pdf: false, audio: false, video: false }
    } as never)

    await service.generateText({
      uniqueModelId: 'test-provider::test-model',
      messages: [{ role: 'user', content: [{ type: 'image', image: new Uint8Array() }] }]
    } as never)

    expect(mockBuildFallbackModels).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryUniqueModelId: 'test-provider::test-model',
        primaryHasTools: true,
        requiredNativeFileSupport: { image: true, pdf: false, audio: false, video: false },
        retryPolicy: expect.objectContaining({ enabled: true, maxAttempts: 3 })
      })
    )
    expect(mockCreateRetryableWrap).toHaveBeenCalledWith(
      expect.objectContaining({ fallbacks: [], retryPolicy: expect.objectContaining({ enabled: true }) })
    )
    expect(mockCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentSettings: expect.objectContaining({ maxRetries: 0 }) })
    )
    mockCreateRetryableWrap.mockReturnValue(undefined)
  })

  it('checks rerank models with rerank before embedding or text generation', async () => {
    const service = createService()
    const rerankSpy = vi.spyOn(service, 'rerank').mockResolvedValue({ ranking: [{ originalIndex: 0, score: 1 }] })
    const embedSpy = vi.spyOn(service, 'embedMany')
    const generateSpy = vi.spyOn(service, 'generateText')

    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-reranker',
      providerId: 'test-provider',
      apiModelId: 'test-reranker',
      name: 'Test Reranker',
      capabilities: [MODEL_CAPABILITY.RERANK, MODEL_CAPABILITY.EMBEDDING],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({
      uniqueModelId: 'test-provider::test-reranker'
    })

    expect(rerankSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'test',
        documents: ['test'],
        topN: 1
      })
    )
    expect(embedSpy).not.toHaveBeenCalled()
    expect(generateSpy).not.toHaveBeenCalled()
  })

  it('checks NewAPI chat models advertised with embeddings through text generation', async () => {
    const provider = makeProvider({
      id: 'new-api',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-api.example.com/v1' },
        [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { baseUrl: 'https://new-api.example.com/v1' }
      }
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'deepseek-v4-flash',
              supported_endpoint_types: ['embeddings', 'openai']
            }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    )

    try {
      const [listedModel] = await listModelsFromProviderActual(provider)
      expect(listedModel).toMatchObject({
        apiModelId: 'deepseek-v4-flash',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_EMBEDDINGS],
        capabilities: []
      })
      expect(isGatewayRoutableModel(listedModel as Model)).toBe(true)

      const service = createService()
      const embedSpy = vi.spyOn(service, 'embedMany').mockResolvedValue({ embeddings: [[1]] })
      const generateSpy = vi.spyOn(service, 'generateText').mockResolvedValue({ text: 'ok' })
      mockModelGetByKey.mockReturnValue({
        ...listedModel,
        capabilities: [MODEL_CAPABILITY.EMBEDDING]
      })

      await service.checkModel({ uniqueModelId: 'new-api::deepseek-v4-flash' })

      expect(embedSpy).not.toHaveBeenCalled()
      expect(generateSpy).toHaveBeenCalledWith(expect.objectContaining({ system: 'test', prompt: 'hi' }))
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('passes the selected API key override into text health checks', async () => {
    const service = createService()
    const generateSpy = vi.spyOn(service, 'generateText').mockResolvedValue({ text: 'ok' })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-model',
      providerId: 'test-provider',
      apiModelId: 'test-model',
      name: 'Test Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({
      uniqueModelId: 'test-provider::test-model',
      apiKeyOverride: 'sk-selected'
    })

    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyOverride: 'sk-selected',
        system: 'test',
        prompt: 'hi'
      })
    )
  })

  it('disables reasoning on the text-generation probe', async () => {
    const service = createService()
    const generateSpy = vi.spyOn(service, 'generateText').mockResolvedValue({ text: 'ok' })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-model',
      providerId: 'test-provider',
      apiModelId: 'test-model',
      name: 'Test Model',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({ uniqueModelId: 'test-provider::test-model' })

    expect(generateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'test',
        prompt: 'hi',
        reasoningEffort: 'none'
      })
    )
  })

  it('checks embedding models with the normal embedding path', async () => {
    const service = createService()
    const embedSpy = vi.spyOn(service, 'embedMany').mockResolvedValue({ embeddings: [[1]] })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-embedding',
      providerId: 'test-provider',
      apiModelId: 'test-embedding',
      name: 'Test Embedding',
      capabilities: [MODEL_CAPABILITY.EMBEDDING],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({
      uniqueModelId: 'test-provider::test-embedding'
    })

    expect(embedSpy).toHaveBeenCalledWith(expect.objectContaining({ values: ['test'] }))
  })

  it('checks image-only models through the image endpoint, not chat', async () => {
    const service = createService()
    const imageSpy = vi.spyOn(service, 'generateImage').mockResolvedValue({ files: [] })
    const generateSpy = vi.spyOn(service, 'generateText').mockResolvedValue({ text: 'ok' })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-image',
      providerId: 'test-provider',
      apiModelId: 'test-image',
      name: 'Test Image',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({ uniqueModelId: 'test-provider::test-image' })

    expect(imageSpy).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.any(String) }))
    expect(generateSpy).not.toHaveBeenCalled()
  })

  it('checks chat models that can also generate images through text generation', async () => {
    const service = createService()
    const imageSpy = vi.spyOn(service, 'generateImage').mockResolvedValue({ files: [] })
    const generateSpy = vi.spyOn(service, 'generateText').mockResolvedValue({ text: 'ok' })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-multimodal',
      providerId: 'test-provider',
      apiModelId: 'test-multimodal',
      name: 'Test Multimodal',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({ uniqueModelId: 'test-provider::test-multimodal' })

    expect(generateSpy).toHaveBeenCalled()
    expect(imageSpy).not.toHaveBeenCalled()
  })

  // Edit-only image models (qwen-image-edit / wan2.5-i2i / qwen-mt-image …) serve no
  // `generate` mode — the bare default leaves the job path without a transport
  // descriptor and the check failed before any provider request.
  it('probes edit-only image models with their declared mode, an inline input image, and materialized param defaults', async () => {
    const service = createService()
    const imageSpy = vi.spyOn(service, 'generateImage').mockResolvedValue({ files: [] })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-edit-image',
      providerId: 'test-provider',
      apiModelId: 'test-edit-image',
      name: 'Test Edit Image',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })
    // Defaults must be materialized main-side: qwen-mt-image's source/target langs and
    // wanx2.1-imageedit's function are REQUIRED vendor params the transport omits
    // when the bag is empty, so a bare `paramValues: {}` probe still fails server-side.
    mockGetImageGenerationSupport.mockReturnValueOnce({
      modes: {
        edit: {
          supports: {
            addWatermark: { default: false, type: 'switch' },
            sourceLang: { default: 'auto', options: ['auto', 'en'], type: 'enum' },
            targetLang: { default: 'en', options: ['en', 'zh'], type: 'enum' }
          },
          vendorTransport: { endpoint: '/api/v1/services/aigc/image2image/image-synthesis' }
        }
      }
    })

    await service.checkModel({ uniqueModelId: 'test-provider::test-edit-image' })

    expect(mockGetImageGenerationSupport).toHaveBeenCalledWith('test-provider', 'test-edit-image')
    expect(imageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'edit',
        inputImages: [expect.stringContaining('data:image/png;base64,')],
        paramValues: { addWatermark: false, sourceLang: 'auto', targetLang: 'en' }
      })
    )
  })

  // Transport models route their job through a handler that re-selects a serving
  // key, dropping the health check's apiKeyOverride — the probe could run with a
  // different rotated credential than the one being reported. The check probes
  // inline instead, resolving the config WITH the caller's key.
  it('probes transport image models inline with the caller API-key override', async () => {
    const service = createService()
    mockProviderGetByProviderId.mockReturnValueOnce(makeProvider({ id: 'ppio', name: 'PPIO' }))
    mockModelGetByKey.mockReturnValue({
      id: 'ppio::qwen-image-edit',
      providerId: 'ppio',
      apiModelId: 'qwen-image-edit',
      name: 'Qwen Image Edit',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })
    mockGetImageGenerationSupport.mockReturnValueOnce({
      modes: {
        edit: {
          supports: { sourceLang: { default: 'auto', options: ['auto', 'en'], type: 'enum' } },
          vendorTransport: { endpoint: '/api/v1/services/aigc/multimodal-generation/generation', isSync: true }
        }
      }
    })
    const submit = vi.fn().mockResolvedValue({ imageUrls: ['https://example.test/img.png'] })
    mockResolveImageTransport.mockReturnValueOnce({ submit })

    await service.checkModel({
      uniqueModelId: 'ppio::qwen-image-edit',
      apiKeyOverride: 'sk-selected'
    })

    expect(mockProviderResolveApiKey).toHaveBeenCalledWith('ppio', 'sk-selected')
    expect(mockResolveImageTransport).toHaveBeenCalledWith('ppio', 'qwen-image-edit', expect.anything())
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'qwen-image-edit',
        modelDescriptor: {
          id: 'qwen-image-edit',
          endpoint: '/api/v1/services/aigc/multimodal-generation/generation',
          isSync: true,
          mode: 'edit'
        },
        providerParams: { sourceLang: 'auto' },
        files: [{ type: 'file', mediaType: 'image/png', data: expect.any(String) }]
      })
    )
  })

  it('keeps generate-capable image probes mode-less', async () => {
    const service = createService()
    const imageSpy = vi.spyOn(service, 'generateImage').mockResolvedValue({ files: [] })
    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-image',
      providerId: 'test-provider',
      apiModelId: 'test-image',
      name: 'Test Image',
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })
    mockGetImageGenerationSupport.mockReturnValueOnce({
      modes: {
        generate: {
          supports: { numImages: { default: 1, max: 4, min: 1, type: 'range' } },
          vendorTransport: { endpoint: '/v1/images/generations' }
        }
      }
    })

    await service.checkModel({ uniqueModelId: 'test-provider::test-image' })

    expect(imageSpy).toHaveBeenCalledWith(expect.not.objectContaining({ mode: expect.anything() }))
    expect(imageSpy).toHaveBeenCalledWith(expect.not.objectContaining({ inputImages: expect.anything() }))
    // Generate-capable models still materialize their generate-mode defaults.
    expect(imageSpy).toHaveBeenCalledWith(expect.objectContaining({ paramValues: { numImages: 1 } }))
  })

  it('fails rerank health checks when the probe returns an empty ranking', async () => {
    const service = createService()
    vi.spyOn(service, 'rerank').mockResolvedValue({ ranking: [] })

    mockModelGetByKey.mockReturnValue({
      id: 'test-provider::test-reranker',
      providerId: 'test-provider',
      apiModelId: 'test-reranker',
      name: 'Test Reranker',
      capabilities: [MODEL_CAPABILITY.RERANK],
      supportsStreaming: false,
      isEnabled: true,
      isHidden: false
    })

    await expect(
      service.checkModel({
        uniqueModelId: 'test-provider::test-reranker'
      })
    ).rejects.toThrow('Rerank health check returned empty ranking')
  })

  it('uses lightweight /api/show probe for Ollama providers', async () => {
    const service = createService()
    const generateSpy = vi.spyOn(service, 'generateText')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    mockProviderGetByProviderId.mockReturnValue({
      id: 'ollama',
      presetProviderId: 'ollama',
      name: 'Ollama',
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      settings: {},
      isEnabled: true,
      endpointConfigs: {
        'ollama-chat': { baseUrl: 'http://localhost:11434' }
      },
      defaultChatEndpoint: 'ollama-chat'
    })
    mockModelGetByKey.mockReturnValue({
      id: 'ollama::llama3',
      providerId: 'ollama',
      apiModelId: 'llama3',
      name: 'Llama 3',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    const result = await service.checkModel({ uniqueModelId: 'ollama::llama3' })

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/show',
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
        body: JSON.stringify({ model: 'llama3' })
      })
    )
    expect(generateSpy).not.toHaveBeenCalled()
    expect(result.latency).toBeGreaterThanOrEqual(0)
  })

  it('passes apiKeyOverride into the Ollama probe', async () => {
    const service = createService()
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))

    mockProviderGetByProviderId.mockReturnValue({
      id: 'ollama',
      presetProviderId: 'ollama',
      name: 'Ollama',
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      settings: {},
      isEnabled: true,
      endpointConfigs: {
        'ollama-chat': { baseUrl: 'http://localhost:11434' }
      },
      defaultChatEndpoint: 'ollama-chat'
    })
    mockModelGetByKey.mockReturnValue({
      id: 'ollama::llama3',
      providerId: 'ollama',
      apiModelId: 'llama3',
      name: 'Llama 3',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    await service.checkModel({
      uniqueModelId: 'ollama::llama3',
      apiKeyOverride: 'sk-selected'
    })

    expect(mockProviderResolveApiKey).toHaveBeenCalledWith('ollama', 'sk-selected')
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit]
    expect(url).toContain('/api/show')
    expect(new Headers(init.headers).get('x-api-key')).toBe('sk-selected')
  })

  it('surfaces Ollama string error from /api/show', async () => {
    const service = createService()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'model "nope" not found' }), { status: 404 })
    )

    mockProviderGetByProviderId.mockReturnValue({
      id: 'ollama',
      presetProviderId: 'ollama',
      name: 'Ollama',
      apiKeys: [],
      authType: 'api-key',
      reportsActualCost: false,
      settings: {},
      isEnabled: true,
      endpointConfigs: {
        'ollama-chat': { baseUrl: 'http://localhost:11434' }
      },
      defaultChatEndpoint: 'ollama-chat'
    })
    mockModelGetByKey.mockReturnValue({
      id: 'ollama::nope',
      providerId: 'ollama',
      apiModelId: 'nope',
      name: 'Nope',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    await expect(service.checkModel({ uniqueModelId: 'ollama::nope' })).rejects.toThrow('model "nope" not found')
  })
})

describe('imageInputEntryParams', () => {
  it('maps a base64 data URL to a base64 entry', () => {
    expect(imageInputEntryParams('data:image/png;base64,AAAA')).toEqual({
      source: 'base64',
      data: 'data:image/png;base64,AAAA',
      cleanupPolicy: 'delete_when_unreferenced'
    })
  })

  it('maps an http(s) URL to a url entry (preserves the inputImages URL contract)', () => {
    expect(imageInputEntryParams('https://cdn.example.com/in.png')).toEqual({
      source: 'url',
      url: 'https://cdn.example.com/in.png',
      cleanupPolicy: 'delete_when_unreferenced'
    })
  })
})

describe('AiService.generateImage — custom async transport (job path)', () => {
  beforeEach(() => {
    mockAddFileRefsTx.mockReset()
  })

  // Force the job branch by resolving to a custom-transport provider id; real
  // hasImageTransport('ppio', …) routes through generateImageViaJob before
  // buildAgentParamsFor can select and rotate a serving key.
  function stubResolution(service: InstanceType<typeof AiService>) {
    mockProviderGetByProviderId.mockReturnValue({ id: 'ppio' })
    mockModelGetByKey.mockReturnValue({
      id: 'ppio::qwen-image',
      providerId: 'ppio',
      apiModelId: 'qwen-image'
    })
    mockAssistantGetById.mockReturnValue({
      id: 'assistant-1',
      name: 'Image Assistant',
      emoji: '🎨'
    })
    return vi
      .spyOn(service as never, 'buildAgentParamsFor')
      .mockRejectedValue(new Error('job path must not select a serving key before execution'))
  }

  it('forwards the vendor knobs to the transport via providerParams (camelCase)', async () => {
    // Regression guard: negativePrompt / numInferenceSteps / guidanceScale are NOT
    // AI SDK native options — they must reach the transport in `providerParams`
    // (the canonical camelCase vendorBag), not get dropped into `structured`.
    // The boundary tests hand-build providerParams, so only this split→transport
    // assertion catches a mis-classified native binding.
    const service = createService()
    stubResolution(service)
    const enqueue = vi.fn().mockReturnValue({
      id: 'job-1',
      snapshot: {},
      finished: Promise.resolve({ status: 'completed', output: { files: [] }, error: null })
    })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') return { createInternalEntry: vi.fn(), permanentDelete: vi.fn() }
      if (name === 'JobManager') return { enqueue, enqueueTx: (...a: any[]) => enqueue(...a.slice(1)), cancel: vi.fn() }
      if (name === 'DbService')
        return { withWriteTx: (fn: any) => fn({ insert: () => ({ values: () => ({ run: vi.fn() }) }) }) }
      return undefined
    })

    await service.generateImage({
      uniqueModelId: 'ppio::qwen-image',
      cleanupPolicy: 'delete_when_unreferenced',
      prompt: 'a cat',
      paramValues: {
        numImages: 1,
        size: '1024x1024',
        seed: 9,
        negativePrompt: 'blurry',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptExtend: true
      },
      requestOptions: { signal: new AbortController().signal }
    })

    expect(enqueue).toHaveBeenCalledWith(
      'image-generation.generate',
      expect.objectContaining({
        n: 1,
        size: '1024x1024',
        seed: 9,
        // native n/size/seed travel as payload fields; the knobs ride the bag
        providerParams: { negativePrompt: 'blurry', numInferenceSteps: 30, guidanceScale: 4.5, promptExtend: true }
      })
    )
  })

  it('derives modelDescriptor { id, endpoint, isSync, mode } from the registry vendorTransport (non-default mode)', async () => {
    // Async PPIO/DashScope jobs resume against the endpoint / response-family carried
    // in the payload; guard that a non-default mode routes through ITS OWN
    // vendorTransport and the derived descriptor reaches the enqueued job. Without
    // this, a restart-resume (or an edit-mode job) would hit the wrong endpoint.
    const service = createService()
    stubResolution(service)
    mockGetImageGenerationSupport.mockReturnValueOnce({
      modes: {
        edit: { vendorTransport: { endpoint: '/v1/models/qianfan/qwen-image-edit/predictions', isSync: false } }
      }
    })
    const enqueue = vi.fn().mockReturnValue({
      id: 'job-1',
      snapshot: {},
      finished: Promise.resolve({ status: 'completed', output: { files: [] }, error: null })
    })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') return { createInternalEntry: vi.fn(), permanentDelete: vi.fn() }
      if (name === 'JobManager') return { enqueue, enqueueTx: (...a: any[]) => enqueue(...a.slice(1)), cancel: vi.fn() }
      if (name === 'DbService')
        return { withWriteTx: (fn: any) => fn({ insert: () => ({ values: () => ({ run: vi.fn() }) }) }) }
      return undefined
    })

    await service.generateImage({
      uniqueModelId: 'ppio::qwen-image',
      cleanupPolicy: 'delete_when_unreferenced',
      prompt: 'a cat',
      mode: 'edit',
      paramValues: {},
      requestOptions: { signal: new AbortController().signal }
    })

    // The descriptor is derived from the registry (main-hosted), keyed by the
    // resolved mode — NOT laundered through paramValues.
    expect(mockGetImageGenerationSupport).toHaveBeenCalledWith('ppio', 'qwen-image')
    expect(enqueue).toHaveBeenCalledWith(
      'image-generation.generate',
      expect.objectContaining({
        modelDescriptor: {
          id: 'qwen-image',
          endpoint: '/v1/models/qianfan/qwen-image-edit/predictions',
          isSync: false,
          mode: 'edit'
        }
      })
    )
  })

  it('maps a failed job snapshot to a thrown error', async () => {
    const service = createService()
    stubResolution(service)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager')
        return { createInternalEntry: vi.fn(), permanentDelete: vi.fn().mockResolvedValue(undefined) }
      if (name === 'JobManager') {
        return {
          enqueueTx: () => ({
            id: 'job-1',
            snapshot: {},
            finished: Promise.resolve({ status: 'failed', output: null, error: { message: 'vendor exploded' } })
          }),
          cancel: vi.fn()
        }
      }
      if (name === 'DbService')
        return { withWriteTx: (fn: any) => fn({ insert: () => ({ values: () => ({ run: vi.fn() }) }) }) }
      return undefined
    })

    await expect(
      service.generateImage({
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'a cat',
        paramValues: {},
        cleanupPolicy: 'delete_when_unreferenced'
      })
    ).rejects.toThrow('vendor exploded')
  })

  it('cancels the job and throws AbortError when the request is aborted', async () => {
    const service = createService()
    stubResolution(service)
    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn().mockResolvedValue({ outcome: 'cancelled' })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager')
        return { createInternalEntry: vi.fn(), permanentDelete: vi.fn().mockResolvedValue(undefined) }
      if (name === 'JobManager') {
        return {
          enqueueTx: () => ({
            id: 'job-1',
            snapshot: {},
            finished: Promise.resolve({ status: 'cancelled', output: null, error: null })
          }),
          cancel
        }
      }
      if (name === 'DbService')
        return { withWriteTx: (fn: any) => fn({ insert: () => ({ values: () => ({ run: vi.fn() }) }) }) }
      return undefined
    })

    await expect(
      service.generateImage({
        uniqueModelId: 'ppio::qwen-image',
        cleanupPolicy: 'delete_when_unreferenced',
        prompt: 'a cat',
        paramValues: {},
        requestOptions: { signal: controller.signal }
      })
    ).rejects.toThrow(/abort/i)
    expect(cancel).toHaveBeenCalledWith('job-1', expect.any(String))
  })

  it('enqueues the job, returns its output files, and classifies the temp input copy for GC reclaim', async () => {
    const service = createService()
    stubResolution(service)

    // Distinct ids per create so the input and mask rows are told apart below.
    const createInternalEntry = vi.fn().mockResolvedValueOnce({ id: 'in-1' }).mockResolvedValueOnce({ id: 'mask-1' })
    const outputFiles = [{ id: 'out-1', origin: 'internal', ext: 'png', name: 'img', size: 3, createdAt: 0 }]
    const enqueue = vi.fn().mockReturnValue({
      id: 'job-1',
      snapshot: {},
      finished: Promise.resolve({ status: 'completed', output: { files: outputFiles }, error: null })
    })
    const tx = {}
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') return { createInternalEntry }
      if (name === 'JobManager') return { enqueue, enqueueTx: (...a: any[]) => enqueue(...a.slice(1)), cancel: vi.fn() }
      if (name === 'DbService') return { withWriteTx: (fn: any) => fn(tx) }
      return undefined
    })

    const result = await service.generateImage({
      uniqueModelId: 'ppio::qwen-image',
      // Carries the assistant so the payload's `source` snapshot resolves — the
      // job path must still attribute usage to its caller.
      assistantId: 'assistant-1',
      prompt: 'a cat',
      paramValues: {},
      inputImages: ['data:image/png;base64,AAAA'],
      mask: 'data:image/png;base64,BBBB',
      cleanupPolicy: 'delete_when_unreferenced',
      requestOptions: { signal: new AbortController().signal }
    })

    expect(enqueue).toHaveBeenCalledWith(
      'image-generation.generate',
      expect.objectContaining({
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'a cat',
        inputFileIds: ['in-1'],
        maskFileId: 'mask-1',
        source: { type: 'assistant', id: 'assistant-1', name: 'Image Assistant', icon: '🎨' }
      })
    )
    expect(result).toEqual({ files: outputFiles })
    // No FileManager ref holds the temp input copy — it must be classified
    // 'delete_when_unreferenced' so the cleanup pass reclaims it instead of
    // relying on an ad-hoc delete.
    expect(createInternalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ cleanupPolicy: 'delete_when_unreferenced' })
    )
    // AiService owns the image job's scratch-input resource semantics. It uses
    // the handle id returned by enqueueTx and writes both roles through
    // JobService in the exact same transaction.
    expect(mockAddFileRefsTx).toHaveBeenCalledWith(tx, [
      { fileEntryId: 'in-1', sourceId: 'job-1', role: 'input' },
      { fileEntryId: 'mask-1', sourceId: 'job-1', role: 'mask' }
    ])
  })

  it('never stamps the caller output policy on the temp input / mask copies', async () => {
    // Regression: the builtin chat tool sends cleanupPolicy 'manual' for its *outputs*
    // (they carry no ref yet — #17169). That must not reach the job's input/mask scratch
    // copies: a zero-ref 'manual' entry is skipped by findCleanupCandidates and only
    // reported (never deleted) by the orphan sweep, so pruning the job row would strand
    // one copy per generation forever.
    const service = createService()
    stubResolution(service)

    const createInternalEntry = vi.fn().mockResolvedValue({ id: 'in-1' })
    const enqueue = vi.fn().mockReturnValue({
      id: 'job-1',
      snapshot: {},
      finished: Promise.resolve({ status: 'completed', output: { files: [] }, error: null })
    })
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') return { createInternalEntry }
      if (name === 'JobManager') return { enqueue, enqueueTx: (...a: any[]) => enqueue(...a.slice(1)), cancel: vi.fn() }
      if (name === 'DbService')
        return { withWriteTx: (fn: any) => fn({ insert: () => ({ values: () => ({ run: vi.fn() }) }) }) }
      return undefined
    })

    await service.generateImage({
      uniqueModelId: 'ppio::qwen-image',
      prompt: 'edit',
      paramValues: {},
      inputImages: ['data:image/png;base64,AAAA'],
      mask: 'data:image/png;base64,BBBB',
      cleanupPolicy: 'manual'
    })

    // Both scratch copies (input + mask) stay reclaimable once the job row is pruned.
    expect(createInternalEntry).toHaveBeenCalledTimes(2)
    for (const [params] of createInternalEntry.mock.calls) {
      expect(params).toMatchObject({ cleanupPolicy: 'delete_when_unreferenced' })
    }
    // The caller's policy still governs the outputs the handler persists.
    expect(enqueue).toHaveBeenCalledWith(
      'image-generation.generate',
      expect.objectContaining({ cleanupPolicy: 'manual' })
    )
  })

  it('cleans up already-created temp input entries when setup fails before enqueue', async () => {
    const service = createService()
    stubResolution(service)
    const permanentDelete = vi.fn().mockResolvedValue(undefined)
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager') {
        return { createInternalEntry: vi.fn().mockResolvedValue({ id: 'in-1' }), permanentDelete }
      }
      // enqueueTx fails after the temp input entry was already created → the entry is in
      // no payload, so generateImageViaJob's setup catch must delete it.
      if (name === 'JobManager')
        return {
          enqueueTx: () => {
            throw new Error('enqueue boom')
          },
          cancel: vi.fn()
        }
      if (name === 'DbService')
        return { withWriteTx: (fn: any) => fn({ insert: () => ({ values: () => ({ run: vi.fn() }) }) }) }
      return undefined
    })

    await expect(
      service.generateImage({
        uniqueModelId: 'ppio::qwen-image',
        cleanupPolicy: 'delete_when_unreferenced',
        prompt: 'edit',
        paramValues: {},
        inputImages: ['data:image/png;base64,AAAA']
      }),
      expect.anything()
    ).rejects.toThrow('enqueue boom')
    expect(permanentDelete).toHaveBeenCalledWith('in-1')
  })

  it('reclaims the temp inputs when registering the job refs fails', async () => {
    const service = createService()
    stubResolution(service)
    const permanentDelete = vi.fn().mockResolvedValue(undefined)
    const enqueueTx = vi.fn().mockReturnValue({
      id: 'job-1',
      snapshot: {},
      finished: new Promise(() => {})
    })
    mockAddFileRefsTx.mockImplementationOnce(() => {
      throw new Error('ref insert boom')
    })
    // AiService composes the ref write with enqueueTx inside withWriteTx. If
    // the resource-owner write fails, the transaction throws and the setup
    // catch must reclaim the scratch copy created before the transaction.
    mockApplicationGet.mockImplementation((name: string) => {
      if (name === 'FileManager')
        return { createInternalEntry: vi.fn().mockResolvedValue({ id: 'in-1' }), permanentDelete }
      if (name === 'JobManager') return { enqueueTx, cancel: vi.fn() }
      if (name === 'DbService') return { withWriteTx: (fn: any) => fn({}) }
      return undefined
    })

    await expect(
      service.generateImage({
        uniqueModelId: 'ppio::qwen-image',
        prompt: 'edit',
        paramValues: {},
        inputImages: ['data:image/png;base64,AAAA'],
        cleanupPolicy: 'delete_when_unreferenced'
      })
    ).rejects.toThrow('ref insert boom')
    expect(permanentDelete).toHaveBeenCalledWith('in-1')
  })
})

describe('AiService.listModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the shipped registry catalog for a registry-sourced provider without calling the API', async () => {
    const service = createService()
    const registryModels = [{ id: 'claude-code::haiku' }, { id: 'claude-code::sonnet' }]
    mockProviderGetByProviderId.mockReturnValue({ id: 'claude-code', modelListSource: 'registry' })
    mockListProviderRegistryModels.mockReturnValue(registryModels)

    const result = await service.listModels({ providerId: 'claude-code' })

    expect(result).toBe(registryModels)
    expect(mockListProviderRegistryModels).toHaveBeenCalledWith({
      providerId: 'claude-code',
      presetProviderId: null
    })
    expect(mockListModelsFromProvider).not.toHaveBeenCalled()
  })

  it('pulls the model list over the API for an api-sourced provider, returning it as-is when the registry adds nothing', async () => {
    const service = createService()
    const provider = { id: 'openai', modelListSource: 'api' }
    const apiModels = [{ id: 'openai::gpt-4o-mini', apiModelId: 'gpt-4o-mini' }]
    mockProviderGetByProviderId.mockReturnValue(provider)
    mockListModelsFromProvider.mockResolvedValue(apiModels)
    mockListProviderRegistryModels.mockReturnValue([])

    const result = await service.listModels({ providerId: 'openai' })

    expect(result).toBe(apiModels)
    expect(mockListModelsFromProvider).toHaveBeenCalledWith(provider, undefined, {
      throwOnError: undefined
    })
    expect(mockListProviderRegistryModels).toHaveBeenCalledWith({
      providerId: 'openai',
      presetProviderId: null
    })
  })

  it('does not impose a service-level timeout on model listing', async () => {
    vi.useFakeTimers()
    const service = createService()
    const provider = { id: 'openai', modelListSource: 'api' }
    const apiModels = [{ id: 'openai::slow-model', apiModelId: 'slow-model' }]
    mockProviderGetByProviderId.mockReturnValue(provider)
    mockListModelsFromProvider.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(apiModels), 31_000))
    )
    mockListProviderRegistryModels.mockReturnValue([])

    const result = expect(service.listModels({ providerId: 'openai', throwOnError: true })).resolves.toEqual(apiModels)

    await vi.advanceTimersByTimeAsync(31_000)
    await result

    expect(mockListProviderRegistryModels).toHaveBeenCalledTimes(1)
  })

  it('appends registry-only models the API never returns, deduping enrichment twins by bare id (publisher prefix)', async () => {
    const service = createService()
    const provider = { id: 'ppio', modelListSource: 'api' }
    // Live /models returns the chat model with a flat id.
    const apiModels = [{ id: 'ppio::qwen3-235b-a22b-thinking-2507', apiModelId: 'qwen3-235b-a22b-thinking-2507' }]
    mockProviderGetByProviderId.mockReturnValue(provider)
    mockListModelsFromProvider.mockResolvedValue(apiModels)
    mockListProviderRegistryModels.mockReturnValue([
      // Same model as the API's, but registry keeps the publisher prefix → must dedup, not double-list.
      { id: 'ppio::qwen', apiModelId: 'qwen/qwen3-235b-a22b-thinking-2507', name: 'Qwen3 235B A22B Thinking' },
      // Vendor-exclusive image model the API never lists → must be appended.
      { id: 'ppio::z-image-turbo', apiModelId: 'z-image-turbo', name: 'Z-Image Turbo' }
    ])

    const result = await service.listModels({ providerId: 'ppio' })

    expect(result.map((m) => m.apiModelId)).toEqual(['qwen3-235b-a22b-thinking-2507', 'z-image-turbo'])
  })
})
