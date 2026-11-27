import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { getProviderHostTopology } from '../providerTopology'

const provider = (endpointConfigs: Provider['endpointConfigs'], defaultChatEndpoint?: string) =>
  ({ endpointConfigs, defaultChatEndpoint }) as unknown as Provider

describe('getProviderHostTopology', () => {
  it('names the endpoint an image-only provider actually declares', () => {
    // ComfyUI declares nothing but its image endpoint, and the settings' API
    // Host field writes to this topology's primary endpoint. Defaulting to a
    // chat endpoint the provider does not have sent the configured host to a
    // key nothing reads, so image generation kept the registry default.
    const topology = getProviderHostTopology(
      provider({ [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'http://localhost:8188' } })
    )

    expect(topology.primaryEndpoint).toBe(ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION)
    expect(topology.primaryBaseUrl).toBe('http://localhost:8188')
  })

  it('prefers a declared chat endpoint over the image one', () => {
    const topology = getProviderHostTopology(
      provider({
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com' },
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://images.example.com' }
      })
    )

    expect(topology.primaryEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('still falls back to the chat endpoint when the provider declares none', () => {
    const topology = getProviderHostTopology(provider({}))

    expect(topology.primaryEndpoint).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    expect(topology.primaryBaseUrl).toBe('')
  })

  it('keeps an explicit defaultChatEndpoint authoritative', () => {
    const topology = getProviderHostTopology(
      provider(
        {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { baseUrl: 'https://responses.example.com' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://chat.example.com' }
        },
        ENDPOINT_TYPE.OPENAI_RESPONSES
      )
    )

    expect(topology.primaryEndpoint).toBe(ENDPOINT_TYPE.OPENAI_RESPONSES)
  })
})
