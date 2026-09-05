import { CHERRY_CLOUD_PROVIDER_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it } from 'vitest'

import { resolveCanonicalEndpoint } from '../endpoint'

const provider = (overrides: Partial<Provider> = {}): Provider =>
  ({
    id: 'relay',
    presetProviderId: 'relay',
    defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
    endpointConfigs: {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' },
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example/anthropic' }
    },
    ...overrides
  }) as Provider

const model = (overrides: Partial<Model> = {}): Model =>
  ({
    id: 'relay:model',
    providerId: 'relay',
    name: 'model',
    capabilities: [],
    endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
    ...overrides
  }) as Model

describe('resolveCanonicalEndpoint', () => {
  it('prefers a supported and configured provider default', () => {
    expect(resolveCanonicalEndpoint(provider(), model()).endpointType).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('supports legacy model rows without a capabilities array', () => {
    const legacyModel = model({ capabilities: undefined as unknown as Model['capabilities'] })

    expect(resolveCanonicalEndpoint(provider(), legacyModel).endpointType).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })

  it('keeps a chat-capable model on chat when a secondary dedicated endpoint is declared', () => {
    const multimodalChatModel = model({
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
    })

    expect(resolveCanonicalEndpoint(provider(), multimodalChatModel).endpointType).toBe(
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    )
  })

  it('skips a stale default whose endpoint configuration is missing', () => {
    const stale = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://relay.example/anthropic' }
      }
    })

    expect(resolveCanonicalEndpoint(stale, model()).endpointType).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  })

  it('selects within a runtime allowlist without turning its first item into a preference', () => {
    expect(
      resolveCanonicalEndpoint(provider(), model(), undefined, [
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES
      ]).endpointType
    ).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)

    expect(
      resolveCanonicalEndpoint(provider(), model(), undefined, [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]).endpointType
    ).toBe(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
  })

  it.each([MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK])(
    'does not assign a chat route to a capability-only %s model without endpointTypes',
    (capability) => {
      const capabilityOnly = model({ capabilities: [capability], endpointTypes: undefined })

      expect(resolveCanonicalEndpoint(provider(), capabilityOnly).endpointType).toBeUndefined()
    }
  )

  it('skips chat endpoints when resolving a dedicated embedding model', () => {
    const embeddingProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' },
        [ENDPOINT_TYPE.OPENAI_EMBEDDINGS]: { baseUrl: 'https://relay.example/embeddings' }
      }
    })
    const embeddingModel = model({
      capabilities: [MODEL_CAPABILITY.EMBEDDING],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_EMBEDDINGS]
    })

    expect(resolveCanonicalEndpoint(embeddingProvider, embeddingModel).endpointType).toBe(
      ENDPOINT_TYPE.OPENAI_EMBEDDINGS
    )
  })

  it('does not fall back to chat when a declared dedicated endpoint is not configured', () => {
    const chatOnlyProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' }
      }
    })
    const imageModel = model({
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    expect(resolveCanonicalEndpoint(chatOnlyProvider, imageModel).endpointType).toBeUndefined()
  })

  it('does not fall back to chat when a legacy row omits capabilities', () => {
    const chatOnlyProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' }
      }
    })
    const legacyImageModel = model({
      capabilities: undefined as unknown as Model['capabilities'],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    expect(resolveCanonicalEndpoint(chatOnlyProvider, legacyImageModel).endpointType).toBeUndefined()
  })

  it('does not substitute another dedicated endpoint for an explicit model capability', () => {
    const mismatchedProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://relay.example/chat' },
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: { baseUrl: 'https://relay.example/images' }
      }
    })
    const embeddingModel = model({
      capabilities: [MODEL_CAPABILITY.EMBEDDING],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
    })

    expect(resolveCanonicalEndpoint(mismatchedProvider, embeddingModel).endpointType).toBeUndefined()
  })

  it('allows an explicitly declared general-purpose protocol to serve a non-chat capability', () => {
    const geminiProvider = provider({
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://relay.example/gemini' }
      }
    })
    const imageModel = model({
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
    })

    expect(resolveCanonicalEndpoint(geminiProvider, imageModel).endpointType).toBe(
      ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT
    )
  })

  it('returns the configured gateway route and its provider-options key together', () => {
    const gateway = provider({
      id: 'aihubmix',
      presetProviderId: 'aihubmix',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://aihubmix.example/v1' },
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://aihubmix.example/anthropic' }
      }
    })
    const claude = model({
      id: 'aihubmix::claude-opus-4-6',
      apiModelId: 'claude-opus-4-6',
      endpointTypes: undefined
    })

    expect(resolveCanonicalEndpoint(gateway, claude)).toEqual({
      endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      gatewayProviderOptionsKey: 'anthropic'
    })
  })

  it('uses managed Cherry Cloud model endpoints without local endpoint configs', () => {
    const cloud = provider({
      id: CHERRY_CLOUD_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      // The cloud builder supplies the authenticated origin at request time;
      // the shared resolver only needs the registry-owned endpoint metadata.
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' }
      }
    })
    const cloudModel = model({
      id: `${CHERRY_CLOUD_PROVIDER_ID}::deepseek-go`,
      providerId: CHERRY_CLOUD_PROVIDER_ID,
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    expect(resolveCanonicalEndpoint(cloud, cloudModel).endpointType).toBe(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  })
})
