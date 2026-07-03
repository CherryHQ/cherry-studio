import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getApiKeys: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getByKey: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getByProviderId,
    getApiKeys: mocks.getApiKeys,
    getRotatedApiKey: mocks.getRotatedApiKey
  }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getByKey } }))

const { assertPiProviderUsable, PiMissingApiKeyError, PiUnsupportedProviderError } = await import('./modelInjection')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getByProviderId.mockResolvedValue({
    id: 'p',
    name: 'P',
    defaultChatEndpoint: 'anthropic-messages',
    endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
  })
  mocks.getByKey.mockResolvedValue({ id: 'p::m', providerId: 'p', name: 'M', capabilities: [] })
  mocks.getApiKeys.mockResolvedValue([{ id: 'k1', key: 'sk-test', isEnabled: true }])
})

describe('assertPiProviderUsable', () => {
  it('validates compatibility without consuming rotated API keys', async () => {
    await expect(assertPiProviderUsable('p::m')).resolves.toBeUndefined()

    expect(mocks.getApiKeys).toHaveBeenCalledWith('p', { enabled: true })
    expect(mocks.getRotatedApiKey).not.toHaveBeenCalled()
  })

  it('rejects providers with no enabled usable key', async () => {
    mocks.getApiKeys.mockResolvedValue([{ id: 'k1', key: '   ', isEnabled: true }])

    await expect(assertPiProviderUsable('p::m')).rejects.toThrow(PiMissingApiKeyError)
    expect(mocks.getRotatedApiKey).not.toHaveBeenCalled()
  })

  it('rejects providers with no pi API mapping', async () => {
    mocks.getByProviderId.mockResolvedValue({
      id: 'p',
      name: 'P',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama', baseUrl: 'http://localhost:11434' } }
    })

    await expect(assertPiProviderUsable('p::m')).rejects.toThrow(PiUnsupportedProviderError)
  })
})
