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
})
