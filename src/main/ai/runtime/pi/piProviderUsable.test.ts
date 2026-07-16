import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getApiKeys: vi.fn(),
  getRotatedApiKey: vi.fn(),
  getByKey: vi.fn(),
  hasToken: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: mocks.getByProviderId,
    getApiKeys: mocks.getApiKeys,
    getRotatedApiKey: mocks.getRotatedApiKey
  }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getByKey } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ OAuthRuntimeService: { hasToken: mocks.hasToken } } as never)
})

const {
  assertPiProviderUsable,
  PI_PLACEHOLDER_API_KEY,
  PiMissingApiKeyError,
  PiUnsupportedProviderError,
  resolvePiProviderInjection
} = await import('./modelInjection')

/** A signed-in app-managed-OAuth (grok-cli) provider + model fixture. */
function stubGrokCli(): void {
  mocks.getByProviderId.mockResolvedValue({
    id: 'grok-cli',
    name: 'Grok CLI',
    authMethods: ['oauth'],
    defaultChatEndpoint: 'openai-responses',
    endpointConfigs: { 'openai-responses': { adapterFamily: 'grok', baseUrl: 'https://cli-chat-proxy.grok.com/v1' } }
  })
  mocks.getByKey.mockResolvedValue({ id: 'grok-cli::grok-build', providerId: 'grok-cli', name: 'M', capabilities: [] })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getByProviderId.mockResolvedValue({
    id: 'p',
    name: 'P',
    defaultChatEndpoint: 'anthropic-messages',
    endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
  })
  mocks.getByKey.mockResolvedValue({ id: 'p::m', providerId: 'p', name: 'M', capabilities: [] })
  // getApiKeys / getRotatedApiKey are synchronous on ProviderService.
  mocks.getApiKeys.mockReturnValue([{ id: 'k1', key: 'sk-test', isEnabled: true }])
})

describe('assertPiProviderUsable', () => {
  it('validates compatibility without consuming rotated API keys', async () => {
    await expect(assertPiProviderUsable('p::m')).resolves.toBeUndefined()

    expect(mocks.getApiKeys).toHaveBeenCalledWith('p', { enabled: true })
    expect(mocks.getRotatedApiKey).not.toHaveBeenCalled()
  })

  it('rejects providers with no enabled usable key', async () => {
    mocks.getApiKeys.mockReturnValue([{ id: 'k1', key: '   ', isEnabled: true }])

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

  it('validates an app-managed-OAuth provider via its OAuth session, not api keys', async () => {
    stubGrokCli()
    mocks.hasToken.mockResolvedValue(true)

    await expect(assertPiProviderUsable('grok-cli::grok-build')).resolves.toBeUndefined()
    expect(mocks.hasToken).toHaveBeenCalledWith('grok-cli')
    expect(mocks.getApiKeys).not.toHaveBeenCalled()
  })

  it('rejects a signed-out app-managed-OAuth provider with PiMissingApiKeyError', async () => {
    stubGrokCli()
    mocks.hasToken.mockResolvedValue(false)

    await expect(assertPiProviderUsable('grok-cli::grok-build')).rejects.toThrow(PiMissingApiKeyError)
  })
})

describe('resolvePiProviderInjection', () => {
  it('resolves an app-managed-OAuth provider with the placeholder key + adapter, skipping key rotation', async () => {
    stubGrokCli()

    const injection = await resolvePiProviderInjection('grok-cli::grok-build')

    expect(injection.transportAdapter).toBeDefined()
    expect(injection.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(injection.providerConfig.api).toBe('openai-responses')
    // The round-robin key rotation is a plain-api-key concern; adapter providers skip it.
    expect(mocks.getRotatedApiKey).not.toHaveBeenCalled()
  })

  it('resolves a plain api-key provider through the rotated key', async () => {
    mocks.getRotatedApiKey.mockReturnValue('sk-rotated')

    const injection = await resolvePiProviderInjection('p::m')

    expect(injection.transportAdapter).toBeUndefined()
    expect(injection.apiKey).toBe('sk-rotated')
    expect(mocks.getRotatedApiKey).toHaveBeenCalledWith('p')
  })
})
