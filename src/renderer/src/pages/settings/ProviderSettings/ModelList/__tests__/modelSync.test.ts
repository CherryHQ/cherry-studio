import { dataApiService } from '@data/DataApiService'
import { fetchModels } from '@renderer/services/ApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels } from '../modelSync'

vi.mock('@renderer/services/ApiService', () => ({
  fetchModels: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

describe('fetchResolvedProviderModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(dataApiService.get).mockResolvedValue({
      keys: [{ id: 'k1', key: 'sk-test', isEnabled: true }]
    })
  })

  it('throws when upstream model listing fails instead of returning an empty list', async () => {
    vi.mocked(fetchModels).mockRejectedValue(new Error('upstream failed'))

    await expect(
      fetchResolvedProviderModels('openai', {
        id: 'openai',
        name: 'OpenAI',
        isEnabled: true,
        presetProviderId: 'openai',
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-chat-completions': { baseUrl: 'https://api.openai.com/v1' }
        },
        apiFeatures: {}
      } as never)
    ).rejects.toThrow('upstream failed')

    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({ id: 'openai' }), { throwOnError: true })
  })

  it('normalizes v2 listModels ids back to raw SDK ids before resolving and creating preview models', async () => {
    vi.mocked(fetchModels).mockResolvedValue([
      {
        id: 'openai::gpt-4o',
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o',
        group: 'openai',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      } as never
    ])
    vi.mocked(dataApiService.get)
      .mockResolvedValueOnce({
        keys: [{ id: 'k1', key: 'sk-test', isEnabled: true }]
      })
      .mockResolvedValueOnce([
        {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          apiModelId: 'gpt-4o',
          name: 'Registry GPT-4o',
          group: 'OpenAI',
          capabilities: [],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false
        }
      ])

    const models = await fetchResolvedProviderModels('openai', {
      id: 'openai',
      name: 'OpenAI',
      isEnabled: true,
      presetProviderId: 'openai',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { baseUrl: 'https://api.openai.com/v1' }
      },
      apiFeatures: {}
    } as never)

    expect(dataApiService.get).toHaveBeenLastCalledWith('/providers/openai/models:resolve', {
      query: { ids: ['gpt-4o'] }
    })
    expect(models[0]).toMatchObject({
      id: 'openai::gpt-4o',
      apiModelId: 'gpt-4o',
      name: 'Registry GPT-4o'
    })
  })
})
