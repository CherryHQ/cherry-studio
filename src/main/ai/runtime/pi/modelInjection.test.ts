import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import {
  buildPiProviderInjection,
  PI_PLACEHOLDER_API_KEY,
  PiMissingApiKeyError,
  PiUnsupportedProviderError
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
})
