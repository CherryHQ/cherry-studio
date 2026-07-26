import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { resolvePaintingApiHost } from '../paintingProviderRuntime'

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'cherryin',
    name: 'CherryIN',
    apiKeys: [],
    authType: 'api-key',
    apiFeatures: {
      arrayContent: false,
      streamOptions: false,
      developerRole: false,
      serviceTier: false,
      verbosity: false
    },
    settings: {},
    isEnabled: true,
    ...overrides
  }
}

describe('resolvePaintingApiHost', () => {
  it('prefers the persisted provider endpoint config', () => {
    expect(
      resolvePaintingApiHost(
        provider({
          defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
          endpointConfigs: {
            [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://proxy.example/v1/' }
          }
        }),
        {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.cherryin.net/' }
        }
      )
    ).toBe('https://proxy.example/v1')
  })

  it('uses registry preset endpoint configs for an OpenAI-compatible painting provider', () => {
    expect(
      resolvePaintingApiHost(provider({ defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS }), {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.cherryin.net/' }
      })
    ).toBe('https://open.cherryin.net')
  })

  it('does not apply the OpenAI-compatible fallback to unrelated providers', () => {
    expect(
      resolvePaintingApiHost(provider({ id: 'openai' }), {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
      })
    ).toBe('')
  })
})
