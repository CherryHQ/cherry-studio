import type { Model } from '@shared/data/types/model'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listModelsMock, listProvidersMock } = vi.hoisted(() => ({
  listModelsMock: vi.fn(),
  listProvidersMock: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { list: listModelsMock }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { list: listProvidersMock }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }))
  }
}))

import { modelsService } from '../models'

function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'openai',
    name: 'OpenAI',
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {
      arrayContent: true,
      streamOptions: true,
      developerRole: false,
      serviceTier: false,
      verbosity: false
    },
    settings: {},
    isEnabled: true,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
    },
    ...overrides
  } as Provider
}

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'openai::gpt-4o',
    providerId: 'openai',
    apiModelId: 'gpt-4o',
    name: 'GPT-4o',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('ModelsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns OpenAI-compatible model list with provider metadata', async () => {
    listProvidersMock.mockResolvedValue([createProvider()])
    listModelsMock.mockResolvedValue([createModel()])

    const result = await modelsService.getModels({})

    expect(result.object).toBe('list')
    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      // round-trips with the chat/messages parsers — keeps the "::" separator
      id: 'openai::gpt-4o',
      object: 'model',
      name: 'GPT-4o',
      owned_by: 'OpenAI',
      provider: 'openai',
      provider_name: 'OpenAI',
      provider_type: 'openai',
      provider_model_id: 'gpt-4o'
    })
  })

  it('only requests enabled providers and models', async () => {
    listProvidersMock.mockResolvedValue([])
    listModelsMock.mockResolvedValue([])

    await modelsService.getModels({})

    expect(listProvidersMock).toHaveBeenCalledWith({ enabled: true })
    expect(listModelsMock).toHaveBeenCalledWith({ enabled: true })
  })

  it('skips models whose provider is not enabled or missing', async () => {
    listProvidersMock.mockResolvedValue([createProvider({ id: 'openai' })])
    listModelsMock.mockResolvedValue([
      createModel({ id: 'openai::gpt-4o', providerId: 'openai' }),
      createModel({ id: 'ghost::m1', providerId: 'ghost' })
    ])

    const result = await modelsService.getModels({})

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('openai::gpt-4o')
  })

  it('filters to anthropic providers when providerType=anthropic', async () => {
    const anthropic = createProvider({
      id: 'my-anthropic',
      name: 'My Anthropic',
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' }
      }
    })
    listProvidersMock.mockResolvedValue([createProvider(), anthropic])
    listModelsMock.mockResolvedValue([
      createModel({ id: 'openai::gpt-4o', providerId: 'openai' }),
      createModel({ id: 'my-anthropic::claude', providerId: 'my-anthropic', apiModelId: 'claude' })
    ])

    const result = await modelsService.getModels({ providerType: 'anthropic' })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      id: 'my-anthropic::claude',
      provider: 'my-anthropic',
      provider_type: 'anthropic'
    })
  })

  it('applies offset and limit with pagination metadata', async () => {
    listProvidersMock.mockResolvedValue([createProvider()])
    listModelsMock.mockResolvedValue([
      createModel({ id: 'openai::a', apiModelId: 'a' }),
      createModel({ id: 'openai::b', apiModelId: 'b' }),
      createModel({ id: 'openai::c', apiModelId: 'c' })
    ])

    const result = await modelsService.getModels({ offset: 1, limit: 1 })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].id).toBe('openai::b')
    expect(result.total).toBe(3)
    expect(result.offset).toBe(1)
    expect(result.limit).toBe(1)
  })

  it('returns an empty list when the data layer throws', async () => {
    listProvidersMock.mockRejectedValue(new Error('db down'))

    const result = await modelsService.getModels({})

    expect(result).toEqual({ object: 'list', data: [] })
  })
})
