import { describe, expect, it } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { isPiCompatibleModel, mapEndpointToPiApi } from '../piModelCompatibility'

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
  }
}

describe('mapEndpointToPiApi', () => {
  it('maps the four core endpoint types', () => {
    expect(mapEndpointToPiApi('anthropic-messages', 'anthropic')).toBe('anthropic-messages')
    expect(mapEndpointToPiApi('openai-chat-completions', 'openai-compatible')).toBe('openai-completions')
    expect(mapEndpointToPiApi('openai-responses', 'openai')).toBe('openai-responses')
    expect(mapEndpointToPiApi('google-generate-content', 'google')).toBe('google-generative-ai')
  })

  it('uses the gateway fallback for Azure responses', () => {
    expect(mapEndpointToPiApi('openai-responses', 'azure-responses')).toBeUndefined()
  })

  it('rejects Azure chat-completions (no pi azure-completions family)', () => {
    expect(mapEndpointToPiApi('openai-chat-completions', 'azure')).toBeUndefined()
  })

  it('uses the gateway fallback for Bedrock and Vertex', () => {
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

describe('isPiCompatibleModel', () => {
  it.each(['grok-cli', 'openai-codex'])('allows app-managed OAuth through the gateway: %s', (providerId) => {
    const provider = makeProvider({ id: providerId, authMethods: ['oauth'] })
    expect(isPiCompatibleModel(provider, makeModel({ id: `${providerId}::m`, providerId }))).toBe(true)
  })

  it('allows a gateway model without a native Pi protocol or declared context window', () => {
    const provider = makeProvider({ defaultChatEndpoint: 'ollama-chat' })
    expect(isPiCompatibleModel(provider, makeModel({ contextWindow: undefined }))).toBe(true)
  })

  it('rejects external CLI providers', () => {
    const provider = makeProvider({
      id: 'claude-code',
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'anthropic-messages'
    })
    expect(isPiCompatibleModel(provider, makeModel({ id: 'claude-code::claude', providerId: provider.id }))).toBe(false)
  })

  it('rejects models without a routable provider id even when Pi supports their protocol', () => {
    const provider = makeProvider({ id: 'custom:anthropic', defaultChatEndpoint: 'anthropic-messages' })
    expect(isPiCompatibleModel(provider, makeModel({ id: 'custom:anthropic::m', providerId: provider.id }))).toBe(false)
  })
})
