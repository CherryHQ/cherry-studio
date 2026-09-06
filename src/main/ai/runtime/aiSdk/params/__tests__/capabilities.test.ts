import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

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

  it('projects CherryIN Chat search config onto its effective endpoint namespace', () => {
    const cherryModel = {
      id: 'cherryin::gpt-5',
      providerId: 'cherryin',
      apiModelId: 'gpt-5',
      capabilities: [],
      endpointTypes: ['openai-chat-completions']
    } as unknown as Model
    const cherryProvider = {
      id: 'cherryin',
      presetProviderId: 'cherryin',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { baseUrl: 'https://open.cherryin.net/v1' }
      },
      serverTools: [{ id: 'web-search', modelScope: 'model-dependent' }]
    } as unknown as Provider

    const capabilities = resolveCapabilities(cherryModel, cherryProvider, assistant, {
      webToolRoutes: { webSearch: 'server', webFetch: 'none' },
      runtimeProviderId: 'cherryin-chat'
    })

    expect(capabilities.webSearchPluginConfig).toEqual({
      'openai-chat': { searchContextSize: 'low' }
    })
  })
})
