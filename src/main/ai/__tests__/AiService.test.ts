import { BaseService } from '@main/core/lifecycle/BaseService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateImage = vi.fn()
const mockDownloadImageAsBase64 = vi.fn()
const { mockGetAssistantById, mockGetModelByKey, mockGetProviderByProviderId, mockListModelsFromProvider } = vi.hoisted(
  () => ({
    mockGetAssistantById: vi.fn(),
    mockGetModelByKey: vi.fn(),
    mockGetProviderByProviderId: vi.fn(),
    mockListModelsFromProvider: vi.fn()
  })
)

vi.mock('@data/services/AssistantService', () => ({
  assistantDataService: {
    getById: (...args: unknown[]) => mockGetAssistantById(...args)
  }
}))

vi.mock('@main/data/services/ModelService', () => ({
  modelService: {
    getByKey: (...args: unknown[]) => mockGetModelByKey(...args)
  }
}))

vi.mock('@main/services/agents/services/channels/ChannelAdapter', () => ({
  downloadImageAsBase64: (...args: unknown[]) => mockDownloadImageAsBase64(...args)
}))

vi.mock('@cherrystudio/ai-core', () => ({
  createAgent: vi.fn(),
  embedMany: vi.fn(),
  generateImage: (...args: unknown[]) => mockGenerateImage(...args)
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: (...args: unknown[]) => mockGetProviderByProviderId(...args)
  }
}))

vi.mock('../provider/listModels', () => ({
  listModels: (...args: unknown[]) => mockListModelsFromProvider(...args)
}))

const { AiService, stripRuntimeAssistantFromRendererRequest } = await import('../AiService')
const { makeProvider } = await import('./fixtures')

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
  })

  // image-request abort lifecycle moved to imageRequestRegistry.test.ts —
  // the service no longer owns that state, so its tests live with the
  // registry instead of with the AiService surface.

  it('normalizes base64 and url images from ai-core generateImage', async () => {
    const service = createService()
    vi.spyOn(service as never, 'buildAgentParamsFor').mockResolvedValue({
      sdkConfig: {
        providerId: 'test-provider',
        providerSettings: {},
        modelId: 'test-model'
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

    const result = await service.generateImage({
      uniqueModelId: 'test-provider::test-model',
      prompt: 'draw a cat',
      n: 2,
      size: '1024x1024',
      negativePrompt: 'blurry',
      seed: 7,
      quality: 'high',
      numInferenceSteps: 30,
      guidanceScale: 4.5,
      promptEnhancement: true,
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
        negativePrompt: 'blurry',
        seed: 7,
        quality: 'high',
        numInferenceSteps: 30,
        guidanceScale: 4.5,
        promptEnhancement: true
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

    expect(result).toEqual({
      images: [{ kind: 'base64', data: 'data:image/png;base64,abc123', mediaType: 'image/png' }]
    })
  })

  it('lists models directly by providerId without requiring a model id', async () => {
    const service = createService()
    const provider = makeProvider({ id: 'openai' })
    const models = [{ id: 'openai::gpt-4o', providerId: 'openai', apiModelId: 'gpt-4o' }]
    mockGetProviderByProviderId.mockResolvedValue(provider)
    mockListModelsFromProvider.mockResolvedValue(models)

    await expect(service.listModels({ providerId: 'openai', throwOnError: true })).resolves.toBe(models)

    expect(mockGetProviderByProviderId).toHaveBeenCalledWith('openai')
    expect(mockListModelsFromProvider).toHaveBeenCalledWith(provider, undefined, { throwOnError: true })
  })

  it('strips renderer-supplied runtimeAssistant from public IPC requests', () => {
    const request = {
      uniqueModelId: 'openai::gpt-4o',
      runtimeAssistant: {
        id: 'default',
        prompt: 'renderer supplied prompt'
      }
    }

    expect(stripRuntimeAssistantFromRendererRequest(request)).toStrictEqual({
      uniqueModelId: 'openai::gpt-4o'
    })
    expect(request.runtimeAssistant.prompt).toBe('renderer supplied prompt')
  })

  it('uses a stream-manager resolved runtime assistant without reloading it by id', async () => {
    const service = createService()
    const provider = makeProvider({ id: 'openai' })
    const model = { id: 'openai::gpt-4o', providerId: 'openai', apiModelId: 'gpt-4o' }
    const runtimeAssistant = {
      id: 'default',
      name: 'Default',
      prompt: 'Use this default prompt.',
      emoji: ':)',
      description: '',
      settings: {
        temperature: 0.2,
        enableTemperature: true,
        topP: 1,
        enableTopP: false,
        maxTokens: 4096,
        enableMaxTokens: false,
        streamOutput: true,
        reasoning_effort: 'default',
        mcpMode: 'auto',
        toolUseMode: 'function',
        maxToolCalls: 20,
        enableMaxToolCalls: true,
        enableWebSearch: false,
        customParameters: []
      },
      modelId: 'openai::gpt-4o',
      modelName: null,
      mcpServerIds: [],
      knowledgeBaseIds: [],
      tags: [],
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }
    mockGetProviderByProviderId.mockResolvedValue(provider)
    mockGetModelByKey.mockResolvedValue(model)

    const result = await (service as any).getProviderAndModel({
      assistantId: 'default',
      runtimeAssistant,
      uniqueModelId: 'openai::gpt-4o'
    })

    expect(result.assistant).toBe(runtimeAssistant)
    expect(mockGetAssistantById).not.toHaveBeenCalled()
    expect(mockGetProviderByProviderId).toHaveBeenCalledWith('openai')
    expect(mockGetModelByKey).toHaveBeenCalledWith('openai', 'gpt-4o')
  })
})
