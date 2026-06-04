import {
  CHERRYAI_API_BASE_URL,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeModel, makeProvider } from '../../__tests__/fixtures'

const getRotatedApiKeyMock = vi.fn()
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock
  }
}))

const generateSignatureMock = vi.fn()
vi.mock('@main/integration/cherryai', () => ({
  generateSignature: generateSignatureMock
}))

const { providerToAiSdkConfig } = await import('../config')

describe('providerToAiSdkConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    getRotatedApiKeyMock.mockReset()
    generateSignatureMock.mockReset()
  })

  it('uses CherryAI custom fetch to sign chat completions requests', async () => {
    getRotatedApiKeyMock.mockResolvedValue('')
    generateSignatureMock.mockReturnValue({
      'X-Client-ID': 'cherry-studio',
      'X-Timestamp': '1700000000',
      'X-Signature': 'signed'
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    const provider = makeProvider({
      id: CHERRYAI_PROVIDER_ID,
      presetProviderId: CHERRYAI_PROVIDER_ID,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: CHERRYAI_API_BASE_URL
        }
      },
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    const model = makeModel({
      id: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
      providerId: CHERRYAI_PROVIDER_ID,
      name: CHERRYAI_DEFAULT_MODEL_NAME
    })

    const config = await providerToAiSdkConfig(provider, model)
    await (config.providerSettings as any).fetch(`${CHERRYAI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Existing: 'yes' },
      body: JSON.stringify({ model: CHERRYAI_DEFAULT_MODEL_ID })
    })

    expect(config.providerId).toBe('openai-compatible')
    expect(generateSignatureMock).toHaveBeenCalledWith({
      method: 'POST',
      path: '/chat/completions',
      query: '',
      body: { model: CHERRYAI_DEFAULT_MODEL_ID }
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `${CHERRYAI_API_BASE_URL}/chat/completions`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Existing: 'yes',
          'X-Client-ID': 'cherry-studio',
          'X-Timestamp': '1700000000',
          'X-Signature': 'signed'
        })
      })
    )
  })
})
