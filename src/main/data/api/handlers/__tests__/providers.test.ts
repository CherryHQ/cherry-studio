import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createMock,
  listMock,
  getByProviderIdMock,
  updateMock,
  deleteMock,
  getApiKeysMock,
  addApiKeyMock,
  replaceApiKeysMock,
  getAuthConfigMock,
  updateApiKeyMock,
  deleteApiKeyMock,
  moveMock,
  reorderMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  listMock: vi.fn(),
  getByProviderIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  getApiKeysMock: vi.fn(),
  addApiKeyMock: vi.fn(),
  replaceApiKeysMock: vi.fn(),
  getAuthConfigMock: vi.fn(),
  updateApiKeyMock: vi.fn(),
  deleteApiKeyMock: vi.fn(),
  moveMock: vi.fn(),
  reorderMock: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    create: createMock,
    list: listMock,
    getByProviderId: getByProviderIdMock,
    update: updateMock,
    delete: deleteMock,
    getApiKeys: getApiKeysMock,
    addApiKey: addApiKeyMock,
    replaceApiKeys: replaceApiKeysMock,
    getAuthConfig: getAuthConfigMock,
    updateApiKey: updateApiKeyMock,
    deleteApiKey: deleteApiKeyMock,
    move: moveMock,
    reorder: reorderMock
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

    it('rejects unknown create fields before calling the service', async () => {
      await expect(
        providerHandlers['/providers'].POST({
          body: {
            providerId: 'custom-provider',
            name: 'CherryAI',
            createdAt: Date.now()
          }
        } as never)
      ).rejects.toThrow()

      expect(createMock).not.toHaveBeenCalled()
    })
  })

  describe('/providers/:providerId', () => {
    it('delegates PATCH to providerService.update with parsed body', async () => {
      const updated = { id: 'openai', isEnabled: false }
      updateMock.mockResolvedValueOnce(updated)

      const result = await providerHandlers['/providers/:providerId'].PATCH({
        params: { providerId: 'openai' },
        body: { isEnabled: false }
      } as never)

      expect(updateMock).toHaveBeenCalledWith('openai', { isEnabled: false })
      expect(result).toBe(updated)
    })

    it('rejects DB-managed update fields before calling the service', async () => {
      await expect(
        providerHandlers['/providers/:providerId'].PATCH({
          params: { providerId: 'openai' },
          body: { updatedAt: Date.now() }
        } as never)
      ).rejects.toThrow()

      expect(updateMock).not.toHaveBeenCalled()
    })

    it('delegates DELETE to providerService.delete', async () => {
      deleteMock.mockResolvedValueOnce(undefined)

      const result = await providerHandlers['/providers/:providerId'].DELETE({
        params: { providerId: 'openai' }
      } as never)

      expect(deleteMock).toHaveBeenCalledWith('openai')
      expect(result).toBeUndefined()
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

    it('adds one API key with an optional label', async () => {
      const updated = { id: 'openai', apiKeys: [{ id: 'key-a', key: 'sk-a', label: 'Primary', isEnabled: true }] }
      addApiKeyMock.mockResolvedValueOnce(updated)

      const result = await providerHandlers['/providers/:providerId/api-keys'].POST({
        params: { providerId: 'openai' },
        body: { key: 'sk-a', label: 'Primary' }
      } as never)

      expect(addApiKeyMock).toHaveBeenCalledWith('openai', 'sk-a', 'Primary')
      expect(result).toBe(updated)
    })

    it('rejects empty POST API keys before calling the service', async () => {
      await expect(
        providerHandlers['/providers/:providerId/api-keys'].POST({
          params: { providerId: 'openai' },
          body: { key: '' }
        } as never)
      ).rejects.toThrow()

      expect(addApiKeyMock).not.toHaveBeenCalled()
    })

    it('rejects malformed replacement key entries before calling the service', async () => {
      await expect(
        providerHandlers['/providers/:providerId/api-keys'].PUT({
          params: { providerId: 'openai' },
          body: { keys: [{ id: 'key-a', key: 'sk-a' }] }
        } as never)
      ).rejects.toThrow()

      expect(replaceApiKeysMock).not.toHaveBeenCalled()
    })
  })

  describe('/providers/:providerId/auth-config', () => {
    it('delegates GET to providerService.getAuthConfig', async () => {
      const authConfig = { type: 'bearer', token: 'token' }
      getAuthConfigMock.mockResolvedValueOnce(authConfig)

      const result = await providerHandlers['/providers/:providerId/auth-config'].GET({
        params: { providerId: 'vertexai' }
      } as never)

      expect(getAuthConfigMock).toHaveBeenCalledWith('vertexai')
      expect(result).toBe(authConfig)
    })
  })

  describe('/providers/:providerId/api-keys/:keyId', () => {
    it('updates one API key by ID', async () => {
      const updated = { id: 'openai', apiKeys: [{ id: 'key-a', key: 'sk-new', isEnabled: false }] }
      updateApiKeyMock.mockResolvedValueOnce(updated)

      const result = await providerHandlers['/providers/:providerId/api-keys/:keyId'].PATCH({
        params: { providerId: 'openai', keyId: 'key-a' },
        body: { key: 'sk-new', isEnabled: false }
      } as never)

      expect(updateApiKeyMock).toHaveBeenCalledWith('openai', 'key-a', { key: 'sk-new', isEnabled: false })
      expect(result).toBe(updated)
    })

    it('rejects invalid API key updates before calling the service', async () => {
      await expect(
        providerHandlers['/providers/:providerId/api-keys/:keyId'].PATCH({
          params: { providerId: 'openai', keyId: 'key-a' },
          body: { key: '' }
        } as never)
      ).rejects.toThrow()

      expect(updateApiKeyMock).not.toHaveBeenCalled()
    })

    it('deletes one API key by ID', async () => {
      const updated = { id: 'openai', apiKeys: [] }
      deleteApiKeyMock.mockResolvedValueOnce(updated)

      const result = await providerHandlers['/providers/:providerId/api-keys/:keyId'].DELETE({
        params: { providerId: 'openai', keyId: 'key-a' }
      } as never)

      expect(deleteApiKeyMock).toHaveBeenCalledWith('openai', 'key-a')
      expect(result).toBe(updated)
    })
  })

  describe('/providers/:id/order', () => {
    it('delegates provider moves to providerService.move', async () => {
      await providerHandlers['/providers/:id/order'].PATCH({
        params: { id: 'openai' },
        body: { before: 'anthropic' }
      } as never)

      expect(moveMock).toHaveBeenCalledWith('openai', { before: 'anthropic' })
    })

    it('rejects invalid move anchors before calling the service', async () => {
      await expect(
        providerHandlers['/providers/:id/order'].PATCH({
          params: { id: 'openai' },
          body: { before: '' }
        } as never)
      ).rejects.toThrow()

      expect(moveMock).not.toHaveBeenCalled()
    })
  })

  describe('/providers/order:batch', () => {
    it('delegates provider reorder batches to providerService.reorder', async () => {
      const moves = [{ id: 'openai', anchor: { position: 'first' as const } }]

      await providerHandlers['/providers/order:batch'].PATCH({
        body: { moves }
      } as never)

      expect(reorderMock).toHaveBeenCalledWith(moves)
    })

    it('rejects empty reorder batches before calling the service', async () => {
      await expect(
        providerHandlers['/providers/order:batch'].PATCH({
          body: { moves: [] }
        } as never)
      ).rejects.toThrow()

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })
})
