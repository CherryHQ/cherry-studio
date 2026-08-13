import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const serviceMocks = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getApiKeys: vi.fn(),
  resolveApiKey: vi.fn(),
  getByKey: vi.fn(),
  hasToken: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: serviceMocks.getByProviderId,
    getApiKeys: serviceMocks.getApiKeys,
    resolveApiKey: serviceMocks.resolveApiKey
  }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: serviceMocks.getByKey } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ OAuthRuntimeService: { hasToken: serviceMocks.hasToken } } as never)
})

import {
  assertPiProviderUsable,
  buildPiProviderInjection,
  PI_PLACEHOLDER_API_KEY,
  PiMissingApiKeyError,
  PiUnsupportedProviderError,
  resolvePiProviderInjection,
  resolvePiProviderInjectionFromSnapshot
} from './modelInjection'

const REAL_KEY = 'sk-cherry-secret-key'

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    id: 'p',
    name: 'P',
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('buildPiProviderInjection', () => {
  it('maps an Anthropic provider', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
      }
    })
    const model = makeModel({ id: 'anthropic::claude', apiModelId: 'claude-sonnet-4', contextWindow: 200_000 })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerName).toBe('anthropic')
    expect(injection.modelId).toBe('claude-sonnet-4')
    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.baseUrl).toBe('https://api.anthropic.com')
    expect(injection.providerConfig.models?.[0]?.id).toBe('claude-sonnet-4')
    expect(injection.providerConfig.models?.[0]?.contextWindow).toBe(200_000)
  })

  it('preserves empty thinking signatures for CherryIN Anthropic-compatible models', () => {
    const provider = makeProvider({
      id: 'cherryin',
      name: 'CherryIN',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
        'openai-chat-completions': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' }
      }
    })
    const model = makeModel({
      id: 'cherryin::agent/deepseek-v4-flash',
      apiModelId: 'agent/deepseek-v4-flash',
      capabilities: ['function-call', 'reasoning'],
      endpointTypes: ['anthropic-messages', 'openai-chat-completions']
    })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.models?.[0]?.compat).toEqual({ allowEmptySignature: true })
  })

  it('maps an OpenAI-compatible provider (chat-completions)', () => {
    const provider = makeProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'deepseek', baseUrl: 'https://api.deepseek.com' }
      }
    })
    const model = makeModel({ id: 'deepseek::chat', apiModelId: 'deepseek-chat' })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('openai-completions')
    expect(injection.providerConfig.baseUrl).toBe('https://api.deepseek.com')
    expect(injection.modelId).toBe('deepseek-chat')
  })

  it('maps a Gemini provider', () => {
    const provider = makeProvider({
      id: 'gemini',
      name: 'Gemini',
      defaultChatEndpoint: 'google-generate-content',
      endpointConfigs: {
        'google-generate-content': {
          adapterFamily: 'google',
          baseUrl: 'https://generativelanguage.googleapis.com'
        }
      }
    })
    const model = makeModel({ id: 'gemini::pro', apiModelId: 'gemini-2.5-pro' })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('google-generative-ai')
    expect(injection.providerConfig.baseUrl).toBe('https://generativelanguage.googleapis.com')
  })

  it('maps Azure OpenAI through its responses endpoint (non-4-family)', () => {
    const provider = makeProvider({
      id: 'azure-openai',
      name: 'Azure OpenAI',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'azure', baseUrl: 'https://x.openai.azure.com' },
        'openai-responses': { adapterFamily: 'azure-responses', baseUrl: 'https://x.openai.azure.com' }
      }
    })
    // Model must pick the responses endpoint; the Azure chat-completions
    // endpoint has no pi mapping.
    const model = makeModel({
      id: 'azure-openai::gpt',
      apiModelId: 'gpt-4o',
      endpointTypes: ['openai-responses']
    })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('azure-openai-responses')
    expect(injection.providerConfig.baseUrl).toBe('https://x.openai.azure.com')
  })

  it('preserves provider headers and Azure API version request configuration', () => {
    const provider = makeProvider({
      id: 'azure-openai',
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: {
        'openai-responses': { adapterFamily: 'azure-responses', baseUrl: 'https://x.openai.azure.com' }
      },
      settings: { extraHeaders: { 'x-tenant': 'tenant-1' }, apiVersion: '2025-04-01-preview' }
    })
    const injection = buildPiProviderInjection(provider, makeModel({ endpointTypes: ['openai-responses'] }), REAL_KEY)

    expect(injection.providerConfig.headers).toEqual({ 'x-tenant': 'tenant-1' })
    expect(injection.requestEnvironment).toEqual({ AZURE_OPENAI_API_VERSION: '2025-04-01-preview' })
  })

  it('uses the gateway per-model route for both API family and base URL', () => {
    const provider = makeProvider({
      id: 'aihubmix',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'aihubmix', baseUrl: 'https://aihubmix.com/v1' },
        'anthropic-messages': { adapterFamily: 'aihubmix', baseUrl: 'https://aihubmix.com' }
      }
    })
    const injection = buildPiProviderInjection(
      provider,
      makeModel({ id: 'aihubmix::claude-sonnet-4', apiModelId: 'claude-sonnet-4' }),
      REAL_KEY
    )

    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.baseUrl).toBe('https://aihubmix.com')
  })

  it('returns the real key separately and only a placeholder in the config', () => {
    const provider = makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    const injection = buildPiProviderInjection(provider, makeModel({}), REAL_KEY)

    expect(injection.apiKey).toBe(REAL_KEY)
    expect(injection.providerConfig.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(injection.providerConfig.apiKey).not.toBe(REAL_KEY)
    expect(injection.providerConfig.authHeader).toBeUndefined()
    expect(injection.usageCapture).toMatchObject({
      owner: 'agent-sdk',
      providerId: 'anthropic',
      credentialReceipt: { attribution: 'unknown' }
    })
  })

  it('freezes the selected key receipt and model aliases for invocation accounting', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    const model = makeModel({ id: 'anthropic::claude', apiModelId: 'claude-sonnet-4', name: 'Sonnet' })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY, {
      attribution: 'matched',
      id: 'key-1',
      label: 'Primary',
      masked: 'sk-****'
    })

    expect(injection.usageCapture).toEqual({
      owner: 'agent-sdk',
      credentialReceipt: { attribution: 'matched', id: 'key-1', label: 'Primary', masked: 'sk-****' },
      providerId: 'anthropic',
      providerName: 'Anthropic',
      source: null,
      frozenModels: [
        {
          modelId: 'anthropic::claude',
          modelName: 'Sonnet',
          aliases: ['anthropic::claude', 'claude-sonnet-4'],
          pricingSnapshot: null
        }
      ]
    })
    expect(JSON.stringify(injection.usageCapture)).not.toContain(REAL_KEY)
  })

  it('derives image input support from capabilities', () => {
    const provider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://api.openai.com' } }
    })
    const textOnly = buildPiProviderInjection(provider, makeModel({}), REAL_KEY)
    expect(textOnly.providerConfig.models?.[0]?.input).toEqual(['text'])

    const multimodal = buildPiProviderInjection(provider, makeModel({ capabilities: ['image-recognition'] }), REAL_KEY)
    expect(multimodal.providerConfig.models?.[0]?.input).toEqual(['text', 'image'])
  })

  it('throws PiMissingApiKeyError when Cherry has no usable key', () => {
    const provider = makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })

    expect(() => buildPiProviderInjection(provider, makeModel({}), '   ')).toThrow(PiMissingApiKeyError)
  })

  it('throws PiUnsupportedProviderError for a provider with no pi mapping', () => {
    const provider = makeProvider({
      id: 'ollama',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama', baseUrl: 'http://localhost:11434' } }
    })

    expect(() => buildPiProviderInjection(provider, makeModel({}), REAL_KEY)).toThrow(PiUnsupportedProviderError)
  })

  it('attaches a transport adapter for an app-managed-OAuth provider and keeps the placeholder key', () => {
    const provider = makeProvider({
      id: 'grok-cli',
      name: 'Grok CLI',
      authMethods: ['oauth'],
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily: 'grok', baseUrl: 'https://cli-chat-proxy.grok.com/v1' } }
    })
    // The connect-time key is only the placeholder; the real token comes from the adapter per call.
    const injection = buildPiProviderInjection(
      provider,
      makeModel({ id: 'grok-cli::grok-build', apiModelId: 'grok-build' }),
      PI_PLACEHOLDER_API_KEY
    )

    expect(injection.transportAdapter).toBeDefined()
    expect(injection.providerConfig.api).toBe('openai-responses')
    expect(injection.providerConfig.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(injection.modelId).toBe('grok-build')
    expect(injection.usageCapture.credentialReceipt).toEqual({ attribution: 'auth', method: 'oauth' })
  })

  it('throws PiUnsupportedProviderError for a login-based external-CLI provider even with no key', () => {
    // Unsupported beats missing-key: claude-code has no adapter and no app-side key by design.
    const provider = makeProvider({
      id: 'claude-code',
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })

    expect(() => buildPiProviderInjection(provider, makeModel({}), '')).toThrow(PiUnsupportedProviderError)
  })
})

function stubGrokCliServices(): void {
  serviceMocks.getByProviderId.mockResolvedValue({
    id: 'grok-cli',
    name: 'Grok CLI',
    authMethods: ['oauth'],
    defaultChatEndpoint: 'openai-responses',
    endpointConfigs: { 'openai-responses': { adapterFamily: 'grok', baseUrl: 'https://cli-chat-proxy.grok.com/v1' } }
  })
  serviceMocks.getByKey.mockResolvedValue({
    id: 'grok-cli::grok-build',
    providerId: 'grok-cli',
    name: 'M',
    capabilities: []
  })
}

describe('modelInjection service resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.getByProviderId.mockResolvedValue({
      id: 'p',
      name: 'P',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    serviceMocks.getByKey.mockResolvedValue({ id: 'p::m', providerId: 'p', name: 'M', capabilities: [] })
    serviceMocks.getApiKeys.mockReturnValue([{ id: 'k1', key: 'sk-test', isEnabled: true }])
  })

  it('validates compatibility without consuming rotated API keys', async () => {
    await expect(assertPiProviderUsable('p::m')).resolves.toBeUndefined()
    expect(serviceMocks.getApiKeys).toHaveBeenCalledWith('p', { enabled: true })
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()
  })

  it('rejects missing credentials and unsupported providers', async () => {
    serviceMocks.getApiKeys.mockReturnValueOnce([{ id: 'k1', key: '   ', isEnabled: true }])
    await expect(assertPiProviderUsable('p::m')).rejects.toThrow(PiMissingApiKeyError)

    serviceMocks.getByProviderId.mockResolvedValueOnce({
      id: 'p',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama', baseUrl: 'http://localhost:11434' } }
    })
    await expect(assertPiProviderUsable('p::m')).rejects.toThrow(PiUnsupportedProviderError)
  })

  it('validates app-managed OAuth through its live session', async () => {
    stubGrokCliServices()
    serviceMocks.hasToken.mockResolvedValueOnce(true)
    await expect(assertPiProviderUsable('grok-cli::grok-build')).resolves.toBeUndefined()
    expect(serviceMocks.getApiKeys).not.toHaveBeenCalled()

    serviceMocks.hasToken.mockResolvedValueOnce(false)
    await expect(assertPiProviderUsable('grok-cli::grok-build')).rejects.toThrow(PiMissingApiKeyError)
  })

  it('resolves OAuth without key rotation and plain providers with rotation', async () => {
    stubGrokCliServices()
    const oauth = await resolvePiProviderInjection('grok-cli::grok-build')
    expect(oauth.transportAdapter).toBeDefined()
    expect(oauth.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()

    serviceMocks.getByProviderId.mockResolvedValue({
      id: 'p',
      name: 'P',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    serviceMocks.getByKey.mockResolvedValue({ id: 'p::m', providerId: 'p', name: 'M', capabilities: [] })
    serviceMocks.resolveApiKey.mockReturnValue({
      value: 'sk-rotated',
      apiKeySelection: { attribution: 'matched', id: 'k1', masked: 'sk-****' }
    })
    const plain = await resolvePiProviderInjection('p::m')
    expect(plain.apiKey).toBe('sk-rotated')
    expect(plain.usageCapture.credentialReceipt).toEqual({
      attribution: 'matched',
      id: 'k1',
      masked: 'sk-****'
    })
  })

  it('rejects a rotated credential outside the captured enabled-key set', () => {
    serviceMocks.resolveApiKey.mockReturnValue({
      value: 'sk-new',
      apiKeySelection: { attribution: 'matched', id: 'k2', masked: 'sk-****' }
    })

    expect(() =>
      resolvePiProviderInjectionFromSnapshot(
        {
          id: 'p',
          name: 'P',
          defaultChatEndpoint: 'anthropic-messages',
          endpointConfigs: {
            'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
          }
        } as never,
        { id: 'p::m', providerId: 'p', name: 'M', capabilities: [] } as never,
        [{ id: 'k1', key: 'sk-old', isEnabled: true }]
      )
    ).toThrow('Pi provider credentials changed during materialization: p')
  })
})
