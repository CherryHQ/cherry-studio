import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { providerToAiSdkConfig } from '../config'

const { mockGetRotatedApiKey } = vi.hoisted(() => ({
  mockGetRotatedApiKey: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: (...args: unknown[]) => mockGetRotatedApiKey(...args)
  }
}))

describe('providerToAiSdkConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetRotatedApiKey.mockResolvedValue('sk-db')
  })

  it('uses apiKeyOverride for one-shot health checks without rotating stored provider keys', async () => {
    const provider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://api.openai.com/v1',
          adapterFamily: 'openai-compatible'
        }
      }
    })
    const model = makeModel({
      id: 'openai::gpt-4o',
      providerId: 'openai',
      apiModelId: 'gpt-4o',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
    })

    const config = await providerToAiSdkConfig(provider, model, { apiKeyOverride: 'sk-current' })

    expect(mockGetRotatedApiKey).not.toHaveBeenCalled()
    expect((config.providerSettings as { apiKey?: string }).apiKey).toBe('sk-current')
  })
})
