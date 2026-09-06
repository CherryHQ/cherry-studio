import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  fetchProviderCatalogModels,
  fetchResolvedProviderModels,
  resolveCreateModelEndpointTypes,
  toCreateModelDto
} from '../modelSync'

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
  listModelsMock.mockResolvedValue([])
})

describe('fetchResolvedProviderModels', () => {
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

  it('returns the complete models owned by Main without a renderer-side resolve request', async () => {
    const model: Model = {
      id: 'openai::gpt-4o-mini',
      providerId: 'openai',
      apiModelId: 'gpt-4o-mini',
      presetModelId: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      capabilities: [],
      supportsStreaming: true,
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.135 },
        output: { currency: 'USD', perMillionTokens: 0.54 }
      },
      isEnabled: true,
      isHidden: false
    }
    listModelsMock.mockResolvedValueOnce([model])

    await expect(fetchResolvedProviderModels('openai')).resolves.toEqual([model])
    expect(dataApiGetMock).not.toHaveBeenCalled()
  })
})

describe('fetchProviderCatalogModels', () => {
  it('reads models from the canonical provider preset projection', async () => {
    const models = [{ id: 'openai::gpt-4o', providerId: 'openai', name: 'GPT-4o' }]
    dataApiGetMock.mockResolvedValueOnce({ models })

    await expect(fetchProviderCatalogModels('openai')).resolves.toBe(models)
    expect(dataApiGetMock).toHaveBeenCalledWith('/providers/openai/preset', {
      query: { fields: 'models' }
    })
  })
})

describe('resolveCreateModelEndpointTypes', () => {
  it('keeps endpoint types from the resolved model metadata', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
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
          modelListApi: { type: 'new-api' },
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
          modelListApi: { type: 'new-api' }
        },
        {}
      )
    ).toBeUndefined()
  })

  it('does not add endpoint types for regular providers', () => {
    expect(
      resolveCreateModelEndpointTypes(
        {
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

  it('does not persist provider-reported pricing as a user override', () => {
    const pricing = {
      input: { currency: 'USD' as const, perMillionTokens: 0.135 },
      output: { currency: 'USD' as const, perMillionTokens: 0.54 }
    }
    const dto = toCreateModelDto('aihubmix', {
      id: 'aihubmix::gpt-4o-mini' as UniqueModelId,
      providerId: 'aihubmix',
      apiModelId: 'gpt-4o-mini',
      name: 'GPT-4o mini',
      pricing
    } as Model)

    expect(dto.pricing).toBeUndefined()
  })

  it('does not forward capabilities for a preset-backed model', () => {
    const dto = toCreateModelDto('ppio', {
      id: 'ppio::bge-reranker-v2-m3' as UniqueModelId,
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
    } as Model)

    expect(dto.capabilities).toBeUndefined()
    expect(dto).toMatchObject({
      providerId: 'ppio',
      modelId: 'bge-reranker-v2-m3',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  })

  it('forwards all discovered capabilities for a custom model', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme-thinker:latest' as UniqueModelId,
      providerId: 'ollama',
      apiModelId: 'acme-thinker:latest',
      name: 'Acme Thinker',
      capabilities: [MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    expect(dto.capabilities).toEqual([MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.FUNCTION_CALL])
  })

  it('persists a discovered context window so the runtime can send num_ctx', () => {
    // Ollama's window is read from /api/show at listing time, not supplied by the registry;
    // dropping it here leaves the stored row without one and num_ctx is never sent (#18643).
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b' as UniqueModelId,
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      name: 'qwen3:32b',
      capabilities: [],
      contextWindow: 40960,
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    expect(dto.contextWindow).toBe(40960)
  })

  it('omits contextWindow when the model has none', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme:latest' as UniqueModelId,
      providerId: 'ollama',
      apiModelId: 'acme:latest',
      name: 'acme:latest',
      capabilities: [],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    expect(dto).not.toHaveProperty('contextWindow')
  })

  it('keeps registry capabilities inherited for a preset-backed thinking model', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b' as UniqueModelId,
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      presetModelId: 'qwen3-32b',
      name: 'Qwen3 32B',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    expect(dto.capabilities).toBeUndefined()
  })
})
