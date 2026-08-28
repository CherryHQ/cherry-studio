import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { makeProvider } from '../../__tests__/fixtures'
import { getBaseUrl, getExtraHeaders } from '../provider'

function relayProvider() {
  return makeProvider({
    id: 'relay',
    name: 'Relay',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/openai' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example/anthropic' }
    }
  })
}

describe('getBaseUrl', () => {
  it('prefers preferredEndpoint over defaultChatEndpoint when both have baseUrl', () => {
    expect(getBaseUrl(relayProvider(), ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('https://relay.example/anthropic')
  })

  it('falls back to defaultChatEndpoint when preferredEndpoint has no baseUrl', () => {
    const provider = makeProvider({
      id: 'relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/openai' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {}
      }
    })
    expect(getBaseUrl(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('https://relay.example/openai')
  })

  it('uses legacy behavior when preferredEndpoint is omitted', () => {
    expect(getBaseUrl(relayProvider())).toBe('https://relay.example/openai')
  })

  it('returns empty string when endpointConfigs is undefined', () => {
    const provider = makeProvider({ id: 'relay', endpointConfigs: undefined })
    expect(getBaseUrl(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('')
    expect(getBaseUrl(provider)).toBe('')
  })

  it('treats null preferredEndpoint the same as omitted', () => {
    expect(getBaseUrl(relayProvider(), null)).toBe('https://relay.example/openai')
  })

  it('falls back to defaultChatEndpoint when preferredEndpoint key is absent from configs', () => {
    const provider = makeProvider({
      id: 'relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/openai' }
      }
    })
    expect(getBaseUrl(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('https://relay.example/openai')
  })

  it('walks ENDPOINT_FALLBACK_ORDER when defaultChatEndpoint has no baseUrl, preferring earlier entries', () => {
    const provider = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {},
        [ENDPOINT_TYPE.OLLAMA_CHAT]: { baseUrl: 'https://relay.example/ollama' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example/anthropic' }
      }
    })
    // ANTHROPIC_MESSAGES precedes OLLAMA_CHAT in the fallback order
    expect(getBaseUrl(provider)).toBe('https://relay.example/anthropic')
  })

  it('uses fallback order when defaultChatEndpoint is undefined', () => {
    const provider = makeProvider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://relay.example/responses' }
      }
    })
    expect(getBaseUrl(provider)).toBe('https://relay.example/responses')
  })

  it('falls through to any-remaining-config when no fallback-order endpoint has a baseUrl', () => {
    const provider = makeProvider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://relay.example/image' }
      }
    })
    expect(getBaseUrl(provider)).toBe('https://relay.example/image')
  })

  it('returns empty string when no endpoint config has a baseUrl', () => {
    const provider = makeProvider({
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {},
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: '' }
      }
    })
    expect(getBaseUrl(provider)).toBe('')
  })
})

describe('getExtraHeaders', () => {
  it('adds the Cherry source to the Radeon Cloud preset', () => {
    const provider = makeProvider({
      id: 'radeon-cloud',
      settings: { extraHeaders: { 'X-Custom': 'keep' } }
    })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Custom': 'keep', 'X-Source': 'cherry-studio' })
  })

  it('adds the Cherry source to providers copied from the Radeon Cloud preset', () => {
    const provider = makeProvider({ id: 'custom-radeon', presetProviderId: 'radeon-cloud' })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Source': 'cherry-studio' })
  })

  it('replaces case-insensitive user X-Source overrides with the stable source', () => {
    const provider = makeProvider({
      id: 'radeon-cloud',
      settings: { extraHeaders: { 'x-source': 'other-client', 'X-Custom': 'keep' } }
    })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Custom': 'keep', 'X-Source': 'cherry-studio' })
  })

  it('does not add the Radeon source to other providers', () => {
    const provider = makeProvider({ id: 'openai', settings: { extraHeaders: { 'X-Custom': 'keep' } } })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Custom': 'keep' })
  })

  it('adds the AIMLAPI source and partner id headers to the AI/ML API preset', () => {
    const provider = makeProvider({
      id: 'aimlapi',
      settings: { extraHeaders: { 'X-Custom': 'keep' } }
    })

    expect(getExtraHeaders(provider)).toEqual({
      'X-Custom': 'keep',
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
  })

  it('adds the AIMLAPI source and partner id headers to providers copied from the AI/ML API preset', () => {
    const provider = makeProvider({ id: 'custom-aimlapi', presetProviderId: 'aimlapi' })

    expect(getExtraHeaders(provider)).toEqual({
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
  })

  it('does not add the AIMLAPI source to other providers', () => {
    const provider = makeProvider({ id: 'openrouter', settings: { extraHeaders: { 'X-Custom': 'keep' } } })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Custom': 'keep' })
  })

  it('replaces case-insensitive user AIMLAPI header overrides with the stable values', () => {
    const provider = makeProvider({
      id: 'aimlapi',
      settings: {
        extraHeaders: {
          'x-aimlapi-source': 'other-client',
          'X-Aimlapi-Partner-Id': 'other-partner',
          'X-Custom': 'keep'
        }
      }
    })

    expect(getExtraHeaders(provider)).toEqual({
      'X-Custom': 'keep',
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
  })
})
