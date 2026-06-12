import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProviders: vi.fn(),
  listModels: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    list: mocks.listProviders
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: mocks.listModels
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

import { getModels } from '../models'

describe('api gateway model listing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listProviders.mockResolvedValue([
      { id: CHERRYAI_PROVIDER_ID, name: 'CherryAI' },
      { id: 'openai', name: 'OpenAI' }
    ])
    mocks.listModels.mockImplementation(({ providerId }: { providerId: string }) => {
      if (providerId === CHERRYAI_PROVIDER_ID) {
        return Promise.resolve([
          {
            id: 'cherryai::qwen',
            providerId: CHERRYAI_PROVIDER_ID,
            apiModelId: CHERRYAI_DEFAULT_MODEL_ID,
            ownedBy: 'CherryAI'
          }
        ])
      }

      return Promise.resolve([
        {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          apiModelId: 'gpt-4o',
          ownedBy: 'OpenAI'
        }
      ])
    })
  })

  it('does not expose the managed CherryAI default model', async () => {
    const response = await getModels()

    expect(response.data.map((model) => model.id)).toEqual(['openai:gpt-4o'])
  })
})
