import { CHERRYAI_DEFAULT_MODEL_ID, CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { MODEL_CAPABILITY } from '@shared/data/types/model'
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
    mocks.listProviders.mockReturnValue([
      { id: CHERRYAI_PROVIDER_ID, name: 'CherryAI' },
      { id: 'openai', name: 'OpenAI' }
    ])
    mocks.listModels.mockImplementation(({ providerId }: { providerId: string }) => {
      if (providerId === CHERRYAI_PROVIDER_ID) {
        return [
          {
            id: 'cherryai::qwen',
            providerId: CHERRYAI_PROVIDER_ID,
            apiModelId: CHERRYAI_DEFAULT_MODEL_ID,
            ownedBy: 'CherryAI',
            capabilities: []
          }
        ]
      }

      return [
        {
          id: 'openai::gpt-4o',
          providerId: 'openai',
          apiModelId: 'gpt-4o',
          ownedBy: 'OpenAI',
          capabilities: []
        }
      ]
    })
  })

  it('does not expose the managed CherryAI default model', async () => {
    const response = await getModels()

    expect(response.data.map((model) => model.id)).toEqual(['openai:gpt-4o'])
  })

  // The listing shares isGatewayRoutableModel with the renderer's gateway picker: it must never
  // advertise a model the proxy cannot route (non-chat classes, un-addressable provider ids).
  it('does not expose non-chat (audio/video/transcription) models', async () => {
    mocks.listProviders.mockReturnValue([{ id: 'openai', name: 'OpenAI' }])
    mocks.listModels.mockImplementation(() => [
      { id: 'openai::gpt-4o', providerId: 'openai', apiModelId: 'gpt-4o', ownedBy: 'OpenAI', capabilities: [] },
      {
        id: 'openai::tts-1',
        providerId: 'openai',
        apiModelId: 'tts-1',
        ownedBy: 'OpenAI',
        capabilities: [MODEL_CAPABILITY.AUDIO_GENERATION]
      },
      {
        id: 'openai::whisper-1',
        providerId: 'openai',
        apiModelId: 'whisper-1',
        ownedBy: 'OpenAI',
        capabilities: [MODEL_CAPABILITY.AUDIO_TRANSCRIPT]
      },
      {
        id: 'openai::sora',
        providerId: 'openai',
        apiModelId: 'sora',
        ownedBy: 'OpenAI',
        capabilities: [MODEL_CAPABILITY.VIDEO_GENERATION]
      }
    ])

    const response = await getModels()

    expect(response.data.map((model) => model.id)).toEqual(['openai:gpt-4o'])
  })

  it('does not expose models of a provider id containing ":" (un-addressable through the gateway)', async () => {
    mocks.listProviders.mockReturnValue([{ id: 'corp:west', name: 'Corp West' }])
    mocks.listModels.mockImplementation(() => [
      { id: 'corp:west::gpt-4o', providerId: 'corp:west', apiModelId: 'gpt-4o', ownedBy: 'Corp', capabilities: [] }
    ])

    const response = await getModels()

    expect(response.data).toEqual([])
  })
})
