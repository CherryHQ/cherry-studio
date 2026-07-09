import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, type UniqueModelId } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels, resolveCreateModelEndpointTypes, toCreateModelDto } from '../modelSync'

const { dataApiGetMock } = vi.hoisted(() => ({ dataApiGetMock: vi.fn() }))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: dataApiGetMock,
    post: vi.fn()
  }
}))

// listModels goes through ipcApi.request('ai.list_models', …) now (Main IPC).
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
        id: 'new-api::deepseek-v3.2',
        providerId: 'new-api',
        apiModelId: 'deepseek-v3.2',
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

  it('infers rerank capability for upstream rerank model ids when registry metadata is absent', async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        id: 'voyageai::rerank-2' as UniqueModelId,
        providerId: 'voyageai',
        apiModelId: 'rerank-2',
        name: 'rerank-2',
        capabilities: []
      }
    ])

    const [model] = await fetchResolvedProviderModels('voyageai')

    expect(model.capabilities).toEqual([MODEL_CAPABILITY.RERANK])
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

  it('preserves fetched rerank capability in the create payload', () => {
    const dto = toCreateModelDto('ppio', {
      id: 'ppio::bge-reranker-v2-m3' as UniqueModelId,
      providerId: 'ppio',
      apiModelId: 'bge-reranker-v2-m3',
      name: 'BGE Reranker',
      capabilities: [MODEL_CAPABILITY.RERANK],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    } as Model)

    expect(dto).toMatchObject({
      providerId: 'ppio',
      modelId: 'bge-reranker-v2-m3',
      capabilities: [MODEL_CAPABILITY.RERANK],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })
  })

  it('infers rerank capability in the create payload when upstream omits capabilities', () => {
    const dto = toCreateModelDto('voyageai', {
      id: 'voyageai::rerank-2' as UniqueModelId,
      providerId: 'voyageai',
      apiModelId: 'rerank-2',
      name: 'rerank-2',
      capabilities: []
    } as Model)

    expect(dto).toMatchObject({
      providerId: 'voyageai',
      modelId: 'rerank-2',
      capabilities: [MODEL_CAPABILITY.RERANK]
    })
  })
})
