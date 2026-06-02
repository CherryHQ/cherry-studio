import { dataApiService } from '@data/DataApiService'
import { AiProvider } from '@renderer/aiCore'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels } from '../modelSync'

vi.mock('@renderer/aiCore', () => ({
  AiProvider: vi.fn()
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
    vi.mocked(dataApiService.get).mockImplementation(async (path) => {
      if (String(path).endsWith('/api-keys')) {
        return { keys: [{ id: 'k1', key: 'sk-test', isEnabled: true }] }
      }
      if (String(path).endsWith('/models:resolve')) {
        return []
      }
      return undefined
    })
  })

  it('throws when upstream model listing fails instead of returning an empty list', async () => {
    const models = vi.fn().mockRejectedValue(new Error('upstream failed'))
    vi.mocked(AiProvider).mockImplementation(() => ({ models }) as never)

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

    expect(models).toHaveBeenCalledWith({ throwOnError: true })
  })

  it('includes active registry provider models that upstream listing omits', async () => {
    const models = vi.fn().mockResolvedValue([{ id: 'gpt-4o', name: 'GPT-4o' }])
    vi.mocked(AiProvider).mockImplementation(() => ({ models }) as never)
    vi.mocked(dataApiService.get).mockImplementation(async (path, options) => {
      if (String(path).endsWith('/api-keys')) {
        return { keys: [{ id: 'k1', key: 'sk-test', isEnabled: true }] }
      }
      if (String(path).endsWith('/models:resolve') && 'ids' in ((options as { query?: object }).query ?? {})) {
        return [
          {
            id: 'openai::gpt-4o',
            providerId: 'openai',
            apiModelId: 'gpt-4o',
            presetModelId: 'gpt-4o',
            name: 'GPT-4o',
            capabilities: ['function-call'],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          }
        ]
      }
      if (String(path).endsWith('/models:resolve')) {
        return [
          {
            id: 'openai::gpt-4.1',
            providerId: 'openai',
            apiModelId: 'gpt-4.1',
            presetModelId: 'gpt-4.1',
            name: 'GPT-4.1',
            capabilities: ['function-call'],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          }
        ]
      }
      return undefined
    })

    const result = await fetchResolvedProviderModels('openai', {
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

    expect(result.map((model) => model.id)).toEqual(['openai::gpt-4o', 'openai::gpt-4.1'])
  })
})
