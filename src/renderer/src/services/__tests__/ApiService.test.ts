import { beforeEach, describe, expect, it, vi } from 'vitest'

import { checkApi, fetchModels } from '../ApiService'

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: vi.fn()
  }
}))

vi.mock('../ModelService', () => ({
  readDefaultModel: vi.fn(),
  readQuickModel: vi.fn()
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

describe('ApiService', () => {
  const checkModel = vi.fn()
  const listModels = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    checkModel.mockResolvedValue({ latency: 1 })
    listModels.mockResolvedValue([])
    ;(window as any).api = {
      ai: {
        checkModel,
        listModels
      }
    }
    ;(window as any).toast = {
      error: vi.fn()
    }
  })

  it('forwards the current api key and abort signal to main-side model checks', async () => {
    const controller = new AbortController()

    await checkApi(
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-current',
        apiHost: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o', name: 'GPT-4o' }]
      } as never,
      { id: 'gpt-4o', name: 'GPT-4o' } as never,
      1000,
      controller.signal
    )

    expect(checkModel).toHaveBeenCalledWith(
      {
        uniqueModelId: 'openai::gpt-4o',
        timeout: 1000,
        apiKeyOverride: 'sk-current'
      },
      controller.signal
    )
  })

  it('forwards the current api key when fetching provider models', async () => {
    listModels.mockResolvedValue([
      {
        id: 'openai::gpt-4o',
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o',
        group: 'OpenAI',
        endpointTypes: ['openai'],
        ownedBy: 'openai',
        supportsStreaming: true
      }
    ])

    const models = await fetchModels(
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: 'sk-current',
        apiHost: 'https://api.openai.com/v1',
        models: []
      } as never,
      { throwOnError: true }
    )

    expect(listModels).toHaveBeenCalledWith({
      providerId: 'openai',
      throwOnError: true,
      apiKeyOverride: 'sk-current'
    })
    expect(models[0]).toMatchObject({
      id: 'gpt-4o',
      provider: 'openai',
      owned_by: 'openai',
      supported_endpoint_types: ['openai'],
      supported_text_delta: true
    })
  })
})
