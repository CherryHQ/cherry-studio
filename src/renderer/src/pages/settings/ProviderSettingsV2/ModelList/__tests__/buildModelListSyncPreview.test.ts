import { dataApiService } from '@data/DataApiService'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildModelListSyncPreview } from '../buildModelListSyncPreview'
import { fetchResolvedProviderModels } from '../modelSync'

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn()
  }
}))

vi.mock('../modelSync', () => ({
  fetchResolvedProviderModels: vi.fn()
}))

describe('buildModelListSyncPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses API-provided presetModelId to include only preset-owned missing models', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue([
      {
        id: 'openai::gpt-4o',
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        presetModelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      },
      {
        id: 'openai::custom-model',
        providerId: 'openai',
        apiModelId: 'custom-model',
        presetModelId: null,
        name: 'Custom Model',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }
    ])
    vi.mocked(fetchResolvedProviderModels).mockResolvedValue([
      {
        id: 'openai::gpt-5',
        providerId: 'openai',
        apiModelId: 'gpt-5',
        name: 'GPT-5',
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }
    ])

    const preview = await buildModelListSyncPreview({
      providerId: 'openai',
      provider: { id: 'openai' } as never
    })

    expect(dataApiService.get).toHaveBeenCalledWith('/models', { query: { providerId: 'openai' } })
    expect(preview.added.map((model) => model.id)).toEqual(['openai::gpt-5'])
    expect(preview.missing.map((item) => item.model.id)).toEqual(['openai::gpt-4o'])
  })
})
