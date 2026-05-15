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
})
