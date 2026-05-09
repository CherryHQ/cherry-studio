import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createMock, listMock, getByProviderIdMock, updateMock, deleteMock, getApiKeysMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  getApiKeysMock: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    create: createMock,
    list: listMock,
    getByProviderId: getByProviderIdMock,
    update: updateMock,
    delete: deleteMock,
    getApiKeys: getApiKeysMock
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

  describe('/providers/:providerId/api-keys', () => {
    it('returns all api keys so settings edits preserve disabled entries', async () => {
      const keys = [
        { id: 'enabled-key', key: 'sk-enabled', isEnabled: true },
        { id: 'disabled-key', key: 'sk-disabled', isEnabled: false, label: 'Backup' }
      ]
      getApiKeysMock.mockResolvedValueOnce(keys)

      const result = await providerHandlers['/providers/:providerId/api-keys'].GET({
        params: { providerId: 'openai' }
      } as never)

      expect(getApiKeysMock).toHaveBeenCalledWith('openai', {})
      expect(result).toEqual({ keys })
    })

    it('forwards ?enabled=true to the service so callers can request enabled keys only', async () => {
      const enabledKeys = [{ id: 'enabled-key', key: 'sk-enabled', isEnabled: true }]
      getApiKeysMock.mockResolvedValueOnce(enabledKeys)

      const result = await providerHandlers['/providers/:providerId/api-keys'].GET({
        params: { providerId: 'openai' },
        query: { enabled: true }
      } as never)

      expect(getApiKeysMock).toHaveBeenCalledWith('openai', { enabled: true })
      expect(result).toEqual({ keys: enabledKeys })
    })
  })
})
