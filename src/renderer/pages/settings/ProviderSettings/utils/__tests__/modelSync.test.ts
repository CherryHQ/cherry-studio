import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ENDPOINT_TYPE, MODEL_CAPABILITY, type Model } from '@shared/data/types/model'

import { fetchResolvedProviderModels, resolveCreateModelEndpointTypes, toCreateModelDto } from '../modelSync'

const { dataApiGetMock } = vi.hoisted(() => ({ dataApiGetMock: vi.fn() }))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: dataApiGetMock,
    post: vi.fn()
  }
}))

// listModels goes through ipcApi.request('ai.provider.model.list', …) now (Main IPC).
const { listModelsMock } = vi.hoisted(() => ({ listModelsMock: vi.fn() }))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, input: unknown) => listModelsMock(input) }
}))

beforeEach(() => {
  vi.clearAllMocks()
  dataApiGetMock.mockResolvedValue([])
  listModelsMock.mockResolvedValue({ models: [] })
})

describe('fetchResolvedProviderModels', () => {
  const nativeModel: Model = {
    id: 'ollama::qwen3.8:27b',
    providerId: 'ollama',
    apiModelId: 'qwen3.8:27b',
    name: 'qwen3.8:27b',
    capabilities: [MODEL_CAPABILITY.REASONING],
    endpointTypes: [ENDPOINT_TYPE.OLLAMA_CHAT],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    reasoning: {
      controls: [{ kind: 'effort', values: ['none', 'low', 'medium', 'xhigh'] }],
      selectableEfforts: ['none', 'low', 'medium', 'xhigh'],
      defaultEffort: 'medium'
    }
  }

  it('preserves native levels through registry enrichment and the creation DTO', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [nativeModel] })
    dataApiGetMock.mockResolvedValueOnce([
      {
        ...nativeModel,
        presetModelId: 'qwen3-8-27b',
        reasoning: {
          controls: [{ kind: 'toggle' }],
          selectableEfforts: ['none', 'auto']
        }
      }
    ])

    const listing = await fetchResolvedProviderModels('ollama')
    const dto = toCreateModelDto('ollama', listing.models[0])

    expect(listing.models[0].reasoning).toEqual(nativeModel.reasoning)
    expect(dto).toMatchObject({ reasoning: nativeModel.reasoning, capabilities: [MODEL_CAPABILITY.REASONING] })
    expect(listing.discoveredReasoning).toEqual([
      {
        id: nativeModel.id,
        reasoning: nativeModel.reasoning,
        capabilities: nativeModel.capabilities
      }
    ])
  })

  it('does not mark registry fallback as native metadata when show has no thinking declaration', async () => {
    listModelsMock.mockResolvedValueOnce({ models: [{ ...nativeModel, reasoning: undefined }] })
    dataApiGetMock.mockResolvedValueOnce([nativeModel])
    const listing = await fetchResolvedProviderModels('ollama')
    expect(listing.models[0].reasoning).toEqual(nativeModel.reasoning)
    expect(listing.discoveredReasoning).toBeUndefined()
  })

  it('preserves explicit no-thinking metadata against a thinking catalog model', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          ...nativeModel,
          capabilities: [],
          reasoning: { controls: [], selectableEfforts: [] }
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([nativeModel])
    const { models } = await fetchResolvedProviderModels('ollama')
    expect(models[0].reasoning?.selectableEfforts).toEqual([])
    expect(toCreateModelDto('ollama', models[0]).capabilities).toEqual([])
  })
  it('throws when upstream model listing fails instead of returning an empty list', async () => {
    const apiKey = 'sk-should-not-reach-logs'
    const loggerErrorSpy = vi.spyOn(mockRendererLoggerService, 'error').mockImplementation(() => {})
    listModelsMock.mockRejectedValueOnce(new Error(`upstream failed for ${apiKey}`))

    try {
      await expect(fetchResolvedProviderModels('openai')).rejects.toThrow(`upstream failed for ${apiKey}`)

      expect(listModelsMock).toHaveBeenCalledWith({
        providerId: 'openai',
        throwOnError: true
      })
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to fetch and resolve provider models', {
        providerId: 'openai',
        errorType: 'Error'
      })
      expect(JSON.stringify(loggerErrorSpy.mock.calls)).not.toContain(apiKey)
    } finally {
      loggerErrorSpy.mockRestore()
    }
  })

  it('keeps endpoint types returned by the provider when registry metadata also has endpoint types', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'new-api::agent/deepseek-v3.2',
          providerId: 'new-api',
          apiModelId: 'agent/deepseek-v3.2',
          name: 'agent/deepseek-v3.2',
          endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'new-api::agent/deepseek-v3.2',
        providerId: 'new-api',
        apiModelId: 'agent/deepseek-v3.2',
        name: 'DeepSeek V3.2',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      }
    ])

    const { models } = await fetchResolvedProviderModels('new-api')

    expect(models[0]).toMatchObject({
      name: 'DeepSeek V3.2',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
  })

  it('uses registry reasoning controls while preserving discovered thinking support', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'ollama::qwen3:32b',
          providerId: 'ollama',
          apiModelId: 'qwen3:32b',
          name: 'qwen3:32b',
          capabilities: [MODEL_CAPABILITY.REASONING]
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'ollama::qwen3:32b',
        providerId: 'ollama',
        apiModelId: 'qwen3:32b',
        presetModelId: 'qwen3-32b',
        name: 'Qwen3 32B',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
        reasoning: {
          controls: [{ kind: 'budget', min: 1024, max: 38_912 }, { kind: 'toggle' }],
          selectableEfforts: ['none', 'low', 'medium', 'high']
        }
      }
    ])

    const {
      models: [model]
    } = await fetchResolvedProviderModels('ollama')

    expect(model).toMatchObject({
      name: 'Qwen3 32B',
      presetModelId: 'qwen3-32b',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'budget', min: 1024, max: 38_912 }, { kind: 'toggle' }],
        selectableEfforts: ['none', 'low', 'medium', 'high']
      }
    })
  })

  it('uses the resolved friendly name when the provider only echoes the raw id', async () => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'dashscope::qwen1.5-1.8b-chat',
          providerId: 'dashscope',
          apiModelId: 'qwen1.5-1.8b-chat',
          name: 'qwen1.5-1.8b-chat'
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'dashscope::qwen1.5-1.8b-chat',
        providerId: 'dashscope',
        apiModelId: 'qwen1.5-1.8b-chat',
        name: 'Qwen1.5 1.8b Chat'
      }
    ])

    const { models } = await fetchResolvedProviderModels('dashscope')

    expect(models[0].name).toBe('Qwen1.5 1.8b Chat')
  })

  it.each([
    { kind: 'custom', presetModelId: undefined },
    { kind: 'preset', presetModelId: 'custom-model' }
  ])('keeps a provider display name for a $kind model', async ({ presetModelId }) => {
    listModelsMock.mockResolvedValueOnce({
      models: [
        {
          id: 'custom::custom-model',
          providerId: 'custom',
          apiModelId: 'custom-model',
          name: 'Provider Display Name'
        }
      ]
    })
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'custom::custom-model',
        providerId: 'custom',
        apiModelId: 'custom-model',
        presetModelId,
        name: 'Custom Model'
      }
    ])

    const { models } = await fetchResolvedProviderModels('custom')

    expect(models[0].name).toBe('Provider Display Name')
  })
})

describe('resolveCreateModelEndpointTypes', () => {
  it('keeps endpoint types from the resolved model metadata', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'new-api',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        {
          endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
        }
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_RESPONSES])
  })

  it('uses the provider default endpoint type for new-api compatible providers', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'custom-new-api',
          presetProviderId: 'new-api',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        {}
      )
    ).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
  })

  it('does not invent an endpoint type when the provider has no default endpoint type', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'custom-new-api',
          presetProviderId: 'new-api'
        },
        {}
      )
    ).toBeUndefined()
  })

  it('does not add endpoint types for regular providers', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
          id: 'openai',
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
        },
        {}
      )
    ).toBeUndefined()
  })
})

describe('toCreateModelDto', () => {
  it('writes resolved endpoint types into the create payload', () => {
    expect(
      toCreateModelDto(
        'new-api',
        {
          id: 'new-api::gpt-4o',
          providerId: 'new-api',
          apiModelId: 'gpt-4o',
          name: 'GPT-4o'
        } as any,
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      )
    ).toMatchObject({
      providerId: 'new-api',
      modelId: 'gpt-4o',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  })

  it('does not forward capabilities for a preset-backed model', () => {
    const dto = toCreateModelDto('ppio', {
      id: 'ppio::bge-reranker-v2-m3',
      providerId: 'ppio',
      apiModelId: 'bge-reranker-v2-m3',
      presetModelId: 'bge-reranker-v2-m3',
      name: 'BGE Reranker',
      group: 'rerankers',
      capabilities: [MODEL_CAPABILITY.RERANK, MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.capabilities).toBeUndefined()
    expect(dto).toMatchObject({
      providerId: 'ppio',
      modelId: 'bge-reranker-v2-m3',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  })

  it('forwards all discovered capabilities for a custom model', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme-thinker:latest',
      providerId: 'ollama',
      apiModelId: 'acme-thinker:latest',
      name: 'Acme Thinker',
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.capabilities).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL])
  })

  it('persists a discovered context window so the runtime can send num_ctx', () => {
    // Ollama's window is read from /api/show at listing time, not supplied by the registry;
    // dropping it here leaves the stored row without one and num_ctx is never sent (#18643).
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b',
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      name: 'qwen3:32b',
      capabilities: [],
      contextWindow: 40960,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.contextWindow).toBe(40960)
  })

  it('omits contextWindow when the model has none', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme:latest',
      providerId: 'ollama',
      apiModelId: 'acme:latest',
      name: 'acme:latest',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto).not.toHaveProperty('contextWindow')
  })

  it('keeps registry capabilities inherited for a preset-backed thinking model', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b',
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      presetModelId: 'qwen3-32b',
      name: 'Qwen3 32B',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    })

    expect(dto.capabilities).toBeUndefined()
  })
})
