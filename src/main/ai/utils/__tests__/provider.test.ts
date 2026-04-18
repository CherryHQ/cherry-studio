import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { getBaseUrl } from '../provider'

function relayProvider(): Provider {
  return {
    id: 'relay',
    name: 'Relay',
    presetProviderId: null,
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/openai' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example/anthropic' }
    }
  } as unknown as Provider
}

describe('getBaseUrl', () => {
  it('prefers preferredEndpoint over defaultChatEndpoint when both have baseUrl', () => {
    const provider = relayProvider()
    expect(getBaseUrl(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('https://relay.example/anthropic')
  })

  it('falls back to defaultChatEndpoint when preferredEndpoint has no baseUrl', () => {
    const provider = {
      ...relayProvider(),
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/openai' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {}
      }
    } as unknown as Provider
    expect(getBaseUrl(provider, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe('https://relay.example/openai')
  })

  it('uses legacy behavior when preferredEndpoint is omitted', () => {
    const provider = relayProvider()
    expect(getBaseUrl(provider)).toBe('https://relay.example/openai')
  })
})
