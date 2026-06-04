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
})
