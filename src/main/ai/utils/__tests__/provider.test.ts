import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'

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

const aimlapiEndpoints = {
  [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.aimlapi.com/v1' },
  [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.aimlapi.com' }
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
  it('adds stable TokenDance attribution and replaces case-insensitive user overrides', () => {
    const provider = makeProvider({
      id: 'tokendance',
      settings: { extraHeaders: { 'x-app-url': 'https://wrong.example', 'X-Custom': 'keep' } }
    })

    expect(getExtraHeaders(provider)).toEqual({
      'X-Custom': 'keep',
      'X-App-URL': 'app://cherryai.com.cn'
    })
  })

  it('adds TokenDance attribution to providers copied from the preset', () => {
    const provider = makeProvider({ id: 'custom-tokendance', presetProviderId: 'tokendance' })

    expect(getExtraHeaders(provider)).toEqual({ 'X-App-URL': 'app://cherryai.com.cn' })
  })

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

  it('adds Perplexity attribution while preserving case-insensitive user overrides', () => {
    expect(getExtraHeaders(makeProvider({ id: 'perplexity' }))).toEqual({
      'X-Pplx-Integration': 'cherry-studio'
    })

    const provider = makeProvider({
      id: 'perplexity',
      settings: { extraHeaders: { 'x-pplx-integration': 'custom-client' } }
    })

    expect(getExtraHeaders(provider)).toEqual({ 'x-pplx-integration': 'custom-client' })
  })

  it('does not add the Radeon source to other providers', () => {
    const provider = makeProvider({ id: 'openai', settings: { extraHeaders: { 'X-Custom': 'keep' } } })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Custom': 'keep' })
  })

  it('adds the AIMLAPI source and partner id headers to the AI/ML API preset', () => {
    const provider = makeProvider({
      id: 'aimlapi',
      endpointConfigs: aimlapiEndpoints,
      settings: { extraHeaders: { 'X-Custom': 'keep' } }
    })

    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({
      'X-Custom': 'keep',
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
  })

  it('adds the AIMLAPI headers to a provider copied from the preset that still targets api.aimlapi.com', () => {
    const provider = makeProvider({
      id: 'custom-aimlapi',
      presetProviderId: 'aimlapi',
      endpointConfigs: aimlapiEndpoints
    })

    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
  })

  it('does not add the AIMLAPI headers when a preset-derived provider is pointed at another host', () => {
    const provider = makeProvider({
      id: 'custom-aimlapi',
      presetProviderId: 'aimlapi',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/v1' }
      },
      settings: { extraHeaders: { 'X-Custom': 'keep' } }
    })

    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({ 'X-Custom': 'keep' })
  })

  it('does not add the AIMLAPI headers when the selected endpoint routes elsewhere while the default is AI/ML API', () => {
    const provider = makeProvider({
      id: 'aimlapi',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.aimlapi.com/v1' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example/anthropic' }
      }
    })

    // The default endpoint alone would qualify…
    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
    // …but the request actually selected the Anthropic endpoint, which leaves for another host.
    expect(getExtraHeaders(provider, getBaseUrl(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES))).toEqual({})
  })

  it('does not add the AIMLAPI headers when no destination is given for the request', () => {
    const provider = makeProvider({ id: 'aimlapi', endpointConfigs: aimlapiEndpoints })

    expect(getExtraHeaders(provider)).toEqual({})
  })

  it('does not treat a look-alike host as AI/ML API', () => {
    const provider = makeProvider({
      id: 'aimlapi',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.aimlapi.com.evil.example/v1' }
      }
    })

    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({})
  })

  it('does not add the AIMLAPI headers when the provider has no endpoint configured', () => {
    const provider = makeProvider({ id: 'aimlapi' })

    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({})
  })

  it('does not add the AIMLAPI source to other providers', () => {
    const provider = makeProvider({ id: 'openrouter', settings: { extraHeaders: { 'X-Custom': 'keep' } } })

    expect(getExtraHeaders(provider)).toEqual({ 'X-Custom': 'keep' })
  })

  it('replaces case-insensitive user AIMLAPI header overrides with the stable values', () => {
    const provider = makeProvider({
      id: 'aimlapi',
      endpointConfigs: aimlapiEndpoints,
      settings: {
        extraHeaders: {
          'x-aimlapi-source': 'other-client',
          'X-Aimlapi-Partner-Id': 'other-partner',
          'X-Custom': 'keep'
        }
      }
    })

    expect(getExtraHeaders(provider, getBaseUrl(provider))).toEqual({
      'X-Custom': 'keep',
      'X-AIMLAPI-Source': 'agent/cherry-studio',
      'X-AIMLAPI-Partner-ID': 'part_coOdPvy7ZV7C44WAnKIfhnw8'
    })
  })
})
