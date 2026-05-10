import { beforeEach, describe, expect, it, vi } from 'vitest'

import { providerCheckApiAdapter } from '../providerCheckApiAdapter'

const toV1ProviderShim = vi.fn()
const toV1ModelForCheckApi = vi.fn()
const checkApi = vi.fn()

vi.mock('@renderer/pages/settings/ProviderSettings/utils/v1ProviderShim', () => ({
  toV1ProviderShim: (...args: unknown[]) => toV1ProviderShim(...args),
  toV1ModelForCheckApi: (...args: unknown[]) => toV1ModelForCheckApi(...args)
}))

vi.mock('@renderer/services/ApiService', () => ({
  checkApi: (...args: unknown[]) => checkApi(...args)
}))

describe('providerCheckApiAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('bridges v2 provider/model data through the v1 shim before calling checkApi', async () => {
    const provider = { id: 'openai', name: 'OpenAI' }
    const models = [{ id: 'openai:gpt-4o' }]
    const selectedModel = { id: 'openai:gpt-4o-mini' }
    const bridgedProvider = { id: 'v1-provider' }
    const bridgedModel = { id: 'v1-model' }

    toV1ProviderShim.mockReturnValue(bridgedProvider)
    toV1ModelForCheckApi.mockReturnValue(bridgedModel)

    await providerCheckApiAdapter({
      provider: provider as never,
      models: models as never,
      selectedModel: selectedModel as never,
      apiKey: 'sk-test',
      apiHost: 'https://api.example.com'
    })

    expect(toV1ProviderShim).toHaveBeenCalledWith(provider, {
      models,
      apiKey: 'sk-test',
      apiHost: 'https://api.example.com'
    })
    expect(toV1ModelForCheckApi).toHaveBeenCalledWith(selectedModel)
    expect(checkApi).toHaveBeenCalledWith(bridgedProvider, bridgedModel)
  })
})
