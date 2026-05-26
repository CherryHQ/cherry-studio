import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerUtilsMocks = vi.hoisted(() => ({
  getFromApi: vi.fn(),
  createJsonErrorResponseHandler: vi.fn(() => vi.fn()),
  createJsonResponseHandler: vi.fn(() => vi.fn()),
  zodSchema: vi.fn((schema) => schema)
}))

const providerServiceMocks = vi.hoisted(() => ({
  getRotatedApiKey: vi.fn(),
  getAuthConfig: vi.fn()
}))

vi.mock('@ai-sdk/provider-utils', () => providerUtilsMocks)

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: providerServiceMocks
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: providerServiceMocks
}))

vi.mock('@main/services/CopilotService', () => ({
  copilotService: {
    getToken: vi.fn()
  }
}))

import { makeProvider } from '../../__tests__/fixtures'
import { listModels } from '../listModels'

describe('listModels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerUtilsMocks.getFromApi.mockReset()
    providerServiceMocks.getRotatedApiKey.mockReset()
    providerServiceMocks.getAuthConfig.mockReset()
  })

  function makeGeminiProvider() {
    return makeProvider({
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://generativelanguage.googleapis.com',
          adapterFamily: 'google'
        }
      }
    })
  }

  it('sends Gemini API keys in headers instead of the URL', async () => {
    providerServiceMocks.getRotatedApiKey.mockResolvedValueOnce('gemini-secret')
    providerUtilsMocks.getFromApi.mockResolvedValueOnce({
      value: {
        models: [
          {
            name: 'models/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            description: 'Gemini model'
          }
        ]
      }
    })

    const models = await listModels(makeGeminiProvider())
    const request = providerUtilsMocks.getFromApi.mock.calls[0][0]

    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(request.url).not.toContain('key=')
    expect(request.headers).toMatchObject({ 'x-goog-api-key': 'gemini-secret' })
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      apiModelId: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      description: 'Gemini model'
    })
  })

  it('throws by default when model listing fails', async () => {
    providerServiceMocks.getRotatedApiKey.mockResolvedValueOnce('gemini-secret')
    providerUtilsMocks.getFromApi.mockRejectedValueOnce(new Error('network failed'))

    await expect(listModels(makeGeminiProvider())).rejects.toThrow('network failed')
  })

  it('keeps the legacy empty-array behavior when throwOnError is false', async () => {
    providerServiceMocks.getRotatedApiKey.mockResolvedValueOnce('gemini-secret')
    providerUtilsMocks.getFromApi.mockRejectedValueOnce(new Error('network failed'))

    await expect(listModels(makeGeminiProvider(), undefined, { throwOnError: false })).resolves.toEqual([])
  })
})
