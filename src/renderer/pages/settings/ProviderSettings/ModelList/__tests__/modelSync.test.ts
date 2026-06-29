import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchResolvedProviderModels } from '../modelSync'

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn().mockResolvedValue([]),
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
