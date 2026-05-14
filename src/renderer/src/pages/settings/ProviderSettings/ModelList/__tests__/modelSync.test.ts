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
    vi.mocked(dataApiService.get).mockResolvedValue({
      keys: [{ id: 'k1', key: 'sk-test', isEnabled: true }]
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
})
