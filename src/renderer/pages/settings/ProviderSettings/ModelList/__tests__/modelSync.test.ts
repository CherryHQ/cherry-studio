import { dataApiService } from '@data/DataApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels } from '../modelSync'

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn().mockResolvedValue([]),
    post: vi.fn()
  }
}))

const listModelsMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // Stub the Electron preload bridge surface used by modelSync.
  ;(globalThis as any).window = {
    api: {
      ai: {
        listModels: listModelsMock
      }
    }
  }
  listModelsMock.mockResolvedValue([])
  vi.mocked(dataApiService.get).mockResolvedValue([])
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

  it('includes registry provider models that upstream listing omits', async () => {
    listModelsMock.mockResolvedValueOnce([
      {
        id: 'openai::gpt-4o',
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: [],
        isEnabled: true,
        isHidden: false
      }
    ])
    vi.mocked(dataApiService.get).mockImplementation(async (_path, options) => {
      if ('ids' in ((options as { query?: object }).query ?? {})) {
        return [
          {
            id: 'openai::gpt-4o',
            providerId: 'openai',
            apiModelId: 'gpt-4o',
            name: 'GPT-4o',
            capabilities: ['function-call'],
            supportsStreaming: true,
            isEnabled: true,
            isHidden: false
          }
        ]
      }

      return [
        {
          id: 'openai::gpt-4.1',
          providerId: 'openai',
          apiModelId: 'gpt-4.1',
          name: 'GPT-4.1',
          capabilities: ['function-call'],
          supportsStreaming: true,
          isEnabled: true,
          isHidden: false
        }
      ]
    })

    const result = await fetchResolvedProviderModels('openai')

    expect(result.map((model) => model.id)).toEqual(['openai::gpt-4o', 'openai::gpt-4.1'])
  })
})
