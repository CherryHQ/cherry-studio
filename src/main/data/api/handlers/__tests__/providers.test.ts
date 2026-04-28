import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, listMock, getByProviderIdMock, updateMock, deleteMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    create: createMock,
    list: listMock,
    getByProviderId: getByProviderIdMock,
    update: updateMock,
    delete: deleteMock
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    getRegistryModelsByProvider: vi.fn(),
    resolveModels: vi.fn(),
    getProviderPresetMetadata: vi.fn()
  }
}))

import { providerHandlers } from '../providers'

describe('providerHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/providers', () => {
    it('accepts a minimal create payload without DB-managed fields', async () => {
      createMock.mockResolvedValueOnce({
        id: 'custom-provider',
        name: 'CherryAI',
        defaultChatEndpoint: 'openai-chat-completions',
        apiKeys: [],
        authType: 'api-key',
        apiFeatures: {},
        settings: {},
        isEnabled: true
      })

      const body = {
        providerId: 'custom-provider',
        name: 'CherryAI',
        defaultChatEndpoint: 'openai-chat-completions'
      }

      const result = await providerHandlers['/providers'].POST({ body } as never)

      expect(createMock).toHaveBeenCalledWith(body)
      expect(result).toMatchObject({
        id: 'custom-provider',
        name: 'CherryAI'
      })
    })
  })
})
