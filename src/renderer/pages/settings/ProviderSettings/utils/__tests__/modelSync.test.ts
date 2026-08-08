import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
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
    listModelsMock.mockRejectedValueOnce(new Error('upstream failed'))

    await expect(fetchResolvedProviderModels('openai')).rejects.toThrow('upstream failed')

    expect(listModelsMock).toHaveBeenCalledWith({
      providerId: 'openai',
      throwOnError: true
    })
  })

  it('keeps endpoint types returned by the provider when registry metadata also has endpoint types', async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        id: 'new-api::agent/deepseek-v3.2',
        providerId: 'new-api',
        apiModelId: 'agent/deepseek-v3.2',
        name: 'agent/deepseek-v3.2',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      }
    ])
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'new-api::agent/deepseek-v3.2',
        providerId: 'new-api',
        apiModelId: 'agent/deepseek-v3.2',
        name: 'DeepSeek V3.2',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      }
    ])

    const models = await fetchResolvedProviderModels('new-api')

    expect(models[0]).toMatchObject({
      name: 'DeepSeek V3.2',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
  })

  it('keeps provider-declared Ollama reasoning while enriching other registry metadata', async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        id: 'ollama::qwen3:32b',
        providerId: 'ollama',
        apiModelId: 'qwen3:32b',
        name: 'qwen3:32b',
        capabilities: [MODEL_CAPABILITY.REASONING],
        reasoning: {
          controls: [{ kind: 'toggle' }],
          selectableEfforts: ['none', 'auto']
        }
      }
    ])
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'ollama::qwen3:32b',
        providerId: 'ollama',
        apiModelId: 'qwen3:32b',
        presetModelId: 'qwen3-32b',
        name: 'Qwen3 32B',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        reasoning: {
          controls: [{ kind: 'budget', min: 1024, max: 38_912 }, { kind: 'toggle' }],
          selectableEfforts: ['none', 'low', 'medium', 'high']
        }
      }
    ])

    const [model] = await fetchResolvedProviderModels('ollama')

    expect(model).toMatchObject({
      presetModelId: 'qwen3-32b',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      },
      providerDeclaredReasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      }
    })
  })

  it('uses the resolved friendly name when the provider only echoes the raw id', async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        id: 'dashscope::qwen1.5-1.8b-chat',
        providerId: 'dashscope',
        apiModelId: 'qwen1.5-1.8b-chat',
        name: 'qwen1.5-1.8b-chat'
      }
    ])
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'dashscope::qwen1.5-1.8b-chat',
        providerId: 'dashscope',
        apiModelId: 'qwen1.5-1.8b-chat',
        name: 'Qwen1.5 1.8b Chat'
      }
    ])

    const models = await fetchResolvedProviderModels('dashscope')

    expect(models[0].name).toBe('Qwen1.5 1.8b Chat')
  })

  it('keeps a provider display name for an unmatched custom model', async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        id: 'custom::custom-model',
        providerId: 'custom',
        apiModelId: 'custom-model',
        name: 'Provider Display Name'
      }
    ])
    dataApiGetMock.mockResolvedValueOnce([
      {
        id: 'custom::custom-model',
        providerId: 'custom',
        apiModelId: 'custom-model',
        name: 'Custom Model'
      }
    ])

    const models = await fetchResolvedProviderModels('custom')

    expect(models[0].name).toBe('Provider Display Name')
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

  it('does not forward model capabilities in the create DTO (resolved server-side from the registry)', () => {
    const dto = toCreateModelDto('ppio', {
      id: 'ppio::bge-reranker-v2-m3' as UniqueModelId,
      providerId: 'ppio',
      apiModelId: 'bge-reranker-v2-m3',
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

  it('forwards a provider-declared reasoning capability when reasoning metadata is present', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::acme-thinker:latest' as UniqueModelId,
      providerId: 'ollama',
      apiModelId: 'acme-thinker:latest',
      name: 'Acme Thinker',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      },
      providerDeclaredReasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      },
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    expect(dto.capabilities).toEqual([MODEL_CAPABILITY.REASONING])
    expect(dto.reasoning).toEqual({
      controls: [{ kind: 'toggle' }],
      selectableEfforts: ['none', 'auto']
    })
  })

  it('keeps registry capabilities inherited for a preset-backed model with provider reasoning', () => {
    const dto = toCreateModelDto('ollama', {
      id: 'ollama::qwen3:32b' as UniqueModelId,
      providerId: 'ollama',
      apiModelId: 'qwen3:32b',
      presetModelId: 'qwen3-32b',
      name: 'Qwen3 32B',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      },
      providerDeclaredReasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      },
      supportsStreaming: true,
      isEnabled: true,
      isHidden: false
    } as Model)

    expect(dto.capabilities).toBeUndefined()
    expect(dto.reasoning?.controls).toEqual([{ kind: 'toggle' }])
  })
})
