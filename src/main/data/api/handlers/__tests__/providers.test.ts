import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  listMock,
  getByProviderIdMock,
  updateMock,
  deleteMock,
  getApiKeysMock,
  replaceApiKeysMock,
  resolveModelsMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  getApiKeysMock: vi.fn(),
  replaceApiKeysMock: vi.fn(),
  resolveModelsMock: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    create: createMock,
    list: listMock,
    getByProviderId: getByProviderIdMock,
    update: updateMock,
    delete: deleteMock,
    getApiKeys: getApiKeysMock,
    replaceApiKeys: replaceApiKeysMock
  }
}))

vi.mock('@data/services/ProviderRegistryService', () => ({
  providerRegistryService: {
    resolveModels: resolveModelsMock
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

    it('replaces API keys through the dedicated api-keys resource', async () => {
      const keys = [{ id: 'key-a', key: 'sk-a', isEnabled: true }]
      replaceApiKeysMock.mockResolvedValueOnce({ id: 'openai', apiKeys: [{ id: 'key-a', isEnabled: true }] })

      await providerHandlers['/providers/:providerId/api-keys'].PUT({
        params: { providerId: 'openai' },
        body: { keys }
      } as never)

      expect(replaceApiKeysMock).toHaveBeenCalledWith('openai', keys)
    })
  })

  describe('/providers/:providerId/models:resolve', () => {
    it('resolves a single ids query string through ProviderRegistryService', async () => {
      resolveModelsMock.mockResolvedValueOnce([{ id: 'openai::gpt-4o' }])

      const result = await providerHandlers['/providers/:providerId/models:resolve'].GET({
        params: { providerId: 'openai' },
        query: { ids: 'gpt-4o' }
      } as never)

      expect(resolveModelsMock).toHaveBeenCalledWith('openai', ['gpt-4o'])
      expect(result).toEqual([{ id: 'openai::gpt-4o' }])
    })

    it('resolves repeated ids arrays without a request body', async () => {
      resolveModelsMock.mockResolvedValueOnce([])

      await providerHandlers['/providers/:providerId/models:resolve'].GET({
        params: { providerId: 'openai' },
        query: { ids: ['gpt-4o', 'o3'] }
      } as never)

      expect(resolveModelsMock).toHaveBeenCalledWith('openai', ['gpt-4o', 'o3'])
    })
  })
})
