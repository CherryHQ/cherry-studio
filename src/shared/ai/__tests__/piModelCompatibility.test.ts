import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { isPiCompatibleModel, mapEndpointToPiApi, resolvePiApi } from '../piModelCompatibility'

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
    contextWindow: 128_000,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  } as Model
}

describe('mapEndpointToPiApi', () => {
  it('maps the four core endpoint types', () => {
    expect(mapEndpointToPiApi('anthropic-messages', 'anthropic')).toBe('anthropic-messages')
    expect(mapEndpointToPiApi('openai-chat-completions', 'openai-compatible')).toBe('openai-completions')
    expect(mapEndpointToPiApi('openai-responses', 'openai')).toBe('openai-responses')
    expect(mapEndpointToPiApi('google-generate-content', 'google')).toBe('google-generative-ai')
  })

  it('maps Azure responses to the dedicated pi family', () => {
    expect(mapEndpointToPiApi('openai-responses', 'azure-responses')).toBe('azure-openai-responses')
  })

  it('rejects Azure chat-completions (no pi azure-completions family)', () => {
    expect(mapEndpointToPiApi('openai-chat-completions', 'azure')).toBeUndefined()
  })

  it('rejects Bedrock and Vertex (auth models pi cannot inject in v1)', () => {
    expect(mapEndpointToPiApi('openai-chat-completions', 'bedrock')).toBeUndefined()
    expect(mapEndpointToPiApi('google-generate-content', 'google-vertex')).toBeUndefined()
    expect(mapEndpointToPiApi('anthropic-messages', 'google-vertex-anthropic')).toBeUndefined()
  })

  it('rejects non-chat endpoint types', () => {
    expect(mapEndpointToPiApi('ollama-chat', 'ollama')).toBeUndefined()
    expect(mapEndpointToPiApi('openai-embeddings', undefined)).toBeUndefined()
    expect(mapEndpointToPiApi(undefined, undefined)).toBeUndefined()
  })
})

describe('resolvePiApi', () => {
  it('uses the model endpoint first, then the provider default', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
      }
    })
    // No model endpoint → falls back to provider default.
    expect(resolvePiApi(provider, makeModel({}))).toBe('anthropic-messages')
    // Model endpoint wins over provider default.
    const openaiProvider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic' },
        'openai-chat-completions': { adapterFamily: 'openai-compatible' }
      }
    })
    expect(resolvePiApi(openaiProvider, makeModel({ endpointTypes: ['openai-chat-completions'] }))).toBe(
      'openai-completions'
    )
  })

  it('is false for an unmapped provider', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama' } }
    })
    expect(isPiCompatibleModel(provider, makeModel({}))).toBe(false)
  })

  it('accepts a model whose context window is unknown', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    })

    expect(isPiCompatibleModel(provider, makeModel({ contextWindow: undefined }))).toBe(true)
  })

  it('uses a cloned gateway per-model route before an unsupported provider default', () => {
    const provider = makeProvider({
      id: 'custom-aihubmix',
      presetProviderId: 'aihubmix',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: {
        'ollama-chat': { adapterFamily: 'ollama' },
        'anthropic-messages': { adapterFamily: 'anthropic' }
      }
    })

    expect(resolvePiApi(provider, makeModel({ apiModelId: 'claude-sonnet-4' }))).toBe('anthropic-messages')
  })

  it('rejects an external-CLI provider (claude-code) even on a pi-speakable endpoint', () => {
    const provider = makeProvider({
      id: 'claude-code',
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    })
    expect(resolvePiApi(provider, makeModel({}))).toBeUndefined()
    expect(isPiCompatibleModel(provider, makeModel({}))).toBe(false)
  })

  it.each([
    ['grok-cli', 'grok'],
    ['openai-codex', 'openai']
  ])('accepts the app-managed-OAuth provider %s via its transport adapter', (providerId, adapterFamily) => {
    // Login-based (authMethods declared, no api-key) but adapter-backed, so pi
    // CAN drive it on its openai-responses endpoint.
    const provider = makeProvider({
      id: providerId,
      authMethods: ['oauth'],
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily } }
    })
    expect(resolvePiApi(provider, makeModel({}))).toBe('openai-responses')
    expect(isPiCompatibleModel(provider, makeModel({}))).toBe(true)
  })
})

describe('endpoint candidate walk (#19184)', () => {
  it('falls through to a later declared endpoint when the first has no pi protocol', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible' }
      }
    })
    // First declared endpoint (ollama) has no pi protocol; the second does.
    const model = makeModel({ endpointTypes: ['ollama', 'openai-chat-completions'] })
    expect(resolvePiApi(provider, model)).toBe('openai-completions')
    expect(isPiCompatibleModel(provider, model)).toBe(true)
  })

  it('falls through to the provider default when no declared endpoint maps', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic' },
        'openai-embeddings': { adapterFamily: 'openai-compatible' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-embeddings'] })
    expect(resolvePiApi(provider, model)).toBe('anthropic-messages')
    expect(isPiCompatibleModel(provider, model)).toBe(true)
  })

  it('still prefers the first declared endpoint when it maps', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible' },
        'anthropic-messages': { adapterFamily: 'anthropic' }
      }
    })
    expect(
      resolvePiApi(provider, makeModel({ endpointTypes: ['anthropic-messages', 'openai-chat-completions'] }))
    ).toBe('anthropic-messages')
  })

  it('returns undefined when no candidate maps', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: { 'openai-chat-completions': { adapterFamily: 'azure' } }
    })
    expect(resolvePiApi(provider, makeModel({ endpointTypes: ['ollama'] }))).toBeUndefined()
  })
})
