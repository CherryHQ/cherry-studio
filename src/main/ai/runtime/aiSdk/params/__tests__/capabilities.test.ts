import { describe, expect, it, vi } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'PreferenceService') {
        return {
          get: (key: string) => (key === 'chat.web_search.max_results' ? 5 : [])
        }
      }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const { resolveCapabilities } = await import('../capabilities')

const assistant = { id: 'a1', settings: {} } as unknown as Assistant

/**
 * `providerToolPlugin` reads its config by the id the runtime instantiated, which `config.ts` may
 * override away from the registry's adapter family (moonshot runs its own extension while the
 * registry says `openai-compatible`). Building the config under the registry id handed Kimi's tool
 * an empty config — i.e. an empty api key, which the fiber endpoint rejects.
 */
describe('resolveCapabilities — provider-builtin web search config key', () => {
  const model = {
    id: 'moonshot::kimi-k3',
    providerId: 'moonshot',
    apiModelId: 'kimi-k3',
    capabilities: []
  } as unknown as Model
  const provider = {
    id: 'moonshot',
    presetProviderId: 'moonshot',
    serverTools: [{ id: 'web-search', modelScope: 'model-dependent' }]
  } as unknown as Provider

  it('keys the config off the runtime provider id and carries the serving credential', () => {
    const capabilities = resolveCapabilities(model, provider, assistant, {
      webToolRoutes: { webSearch: 'server', webFetch: 'none' },
      runtimeProviderId: 'moonshot',
      serving: { apiKey: 'sk-live', baseURL: 'https://api.moonshot.cn/v1' }
    })

    expect(capabilities.webSearchPluginConfig).toEqual({
      moonshot: { apiKey: 'sk-live', baseURL: 'https://api.moonshot.cn/v1' }
    })
  })

  it('builds nothing when the plan did not route search to the server side', () => {
    const capabilities = resolveCapabilities(model, provider, assistant, {
      webToolRoutes: { webSearch: 'client', webFetch: 'none' },
      runtimeProviderId: 'moonshot',
      serving: { apiKey: 'sk-live' }
    })

    expect(capabilities.webSearchPluginConfig).toBeUndefined()
  })
})

describe('resolveCapabilities — native image output', () => {
  it.each(['google', 'newapi', 'aihubmix', 'dmxapi'] as const)(
    'enables native Gemini image responses through %s',
    (id) => {
      const model = {
        id: 'google::gemini-3.1-flash-image',
        providerId: 'google',
        apiModelId: 'gemini-3.1-flash-image',
        capabilities: ['image-generation'],
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
        outputModalities: ['text', 'image']
      } as unknown as Model
      const provider = {
        id,
        presetProviderId: id,
        endpointConfigs: { [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google' } }
      } as unknown as Provider

      expect(resolveCapabilities(model, provider, assistant, { runtimeProviderId: id }).enableGenerateImage).toBe(true)
    }
  )

  it('enables native image output on a Google image-chat model without a redundant text declaration', () => {
    const model = {
      id: 'google::gemini-3-pro-image-preview',
      providerId: 'google',
      apiModelId: 'gemini-3-pro-image-preview',
      capabilities: ['image-generation'],
      endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
      outputModalities: ['image']
    } as unknown as Model
    const provider = {
      id: 'google',
      presetProviderId: 'google',
      endpointConfigs: { [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google' } }
    } as unknown as Provider

    expect(resolveCapabilities(model, provider, assistant).enableGenerateImage).toBe(true)
  })

  it('leaves image-only and non-Gemini models on their dedicated image route', () => {
    const provider = { id: 'openrouter', presetProviderId: 'openrouter' } as unknown as Provider
    const base = {
      id: 'openrouter::google/gemini-3.1-flash-image',
      providerId: 'openrouter',
      apiModelId: 'google/gemini-3.1-flash-image',
      capabilities: ['image-generation']
    }

    expect(
      resolveCapabilities(
        {
          ...base,
          endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
          outputModalities: ['image']
        } as Model,
        provider,
        assistant
      ).enableGenerateImage
    ).toBe(false)
    expect(
      resolveCapabilities(
        {
          ...base,
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
          outputModalities: ['text', 'image']
        } as Model,
        provider,
        assistant
      ).enableGenerateImage
    ).toBe(false)
  })
})
