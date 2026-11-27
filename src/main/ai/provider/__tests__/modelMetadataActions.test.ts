import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn(), apply: vi.fn(), list: vi.fn(), provider: vi.fn() }))
vi.mock('@data/services/ProviderService', () => ({ providerService: { getByProviderId: mocks.provider } }))
vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.get, applyProviderMetadata: mocks.apply }
}))

import { CreateProviderSchema } from '@shared/data/api/schemas/providers'

import { refreshCustomModelMetadata, resetCustomModelMetadata } from '../modelMetadataActions'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.get.mockReturnValue({ endpointTypes: ['openai-chat-completions'] })
  mocks.provider.mockReturnValue({
    id: 'provider',
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://chat.example/v1' } }
  })
  MockApplicationUtils.setService('AiService', { listModels: mocks.list })
})
afterEach(() => MockApplicationUtils.resetServices())

describe('explicit custom model metadata actions', () => {
  it('refreshes only the exact model requested by the settings action', async () => {
    mocks.list.mockResolvedValue({
      models: [
        { apiModelId: 'wanted', providerMetadata: { contextWindow: 1000 } },
        { apiModelId: 'other', providerMetadata: { contextWindow: 2000 } }
      ]
    })
    await refreshCustomModelMetadata('provider', 'wanted')
    expect(mocks.get).toHaveBeenCalledWith('provider', 'wanted')
    expect(mocks.list).toHaveBeenCalledWith({ providerId: 'provider', throwOnError: true })
    expect(mocks.apply).toHaveBeenCalledWith('provider', 'wanted', { contextWindow: 1000 })
  })

  it('declines non-default model endpoints before listing or writing any metadata', async () => {
    mocks.get.mockReturnValueOnce({ endpointTypes: ['openai-responses'] })
    mocks.provider.mockReturnValueOnce({
      id: 'provider',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { baseUrl: 'https://chat.example/v1' },
        'openai-responses': { baseUrl: 'https://other.example/v1' }
      }
    })
    await expect(refreshCustomModelMetadata('provider', 'wanted')).rejects.toThrow('non-default endpoint')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('refreshes a Responses model when both endpoints resolve the same catalog URL', async () => {
    mocks.get.mockReturnValueOnce({ endpointTypes: ['openai-responses'] })
    mocks.provider.mockReturnValueOnce({
      id: 'provider',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { baseUrl: 'https://chat.example/v1' },
        'openai-responses': { baseUrl: 'https://chat.example/v1' }
      }
    })
    mocks.list.mockResolvedValueOnce({
      models: [{ apiModelId: 'wanted', providerMetadata: { contextWindow: 8000 } }]
    })
    await refreshCustomModelMetadata('provider', 'wanted')
    expect(mocks.apply).toHaveBeenCalledWith('provider', 'wanted', { contextWindow: 8000 })
  })

  it('refreshes an imported model when an accepted custom provider uses the undeclared fallback catalog', async () => {
    const provider = CreateProviderSchema.parse({
      providerId: 'custom',
      name: 'Custom',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://custom.example/v1' } }
    })
    mocks.provider.mockReturnValueOnce({ ...provider, id: provider.providerId })
    mocks.get.mockReturnValueOnce({ endpointTypes: undefined })
    mocks.list.mockResolvedValueOnce({
      models: [{ apiModelId: 'imported', providerMetadata: { contextWindow: 16000 } }]
    })
    await refreshCustomModelMetadata('custom', 'imported')
    expect(mocks.list).toHaveBeenCalledWith({ providerId: 'custom', throwOnError: true })
    expect(mocks.apply).toHaveBeenCalledWith('custom', 'imported', { contextWindow: 16000 })
  })

  it('declines an undeclared endpoint when no nonempty fallback catalog exists', async () => {
    mocks.provider.mockReturnValueOnce({ id: 'custom', endpointConfigs: {} })
    mocks.get.mockReturnValueOnce({ endpointTypes: undefined })
    await expect(refreshCustomModelMetadata('custom', 'imported')).rejects.toThrow('non-default endpoint')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('does not write on failed, missing or unsupported provider results', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'))
    await expect(refreshCustomModelMetadata('p', 'm')).rejects.toThrow('offline')
    mocks.list.mockResolvedValueOnce({ models: [] })
    await expect(refreshCustomModelMetadata('p', 'm')).rejects.toThrow()
    mocks.list.mockResolvedValueOnce({ models: [{ apiModelId: 'm' }] })
    await expect(refreshCustomModelMetadata('p', 'm')).rejects.toThrow()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('resets one field from the stored snapshot without listing (AC6/AC7)', () => {
    resetCustomModelMetadata('p', 'm', 'contextWindow')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.apply).toHaveBeenCalledWith('p', 'm', {}, 'contextWindow')
  })
})
