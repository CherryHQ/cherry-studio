import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { makeProvider } from '../../__tests__/fixtures'
import { getBaseUrl } from '../provider'

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
