import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerServiceMocks = vi.hoisted(() => ({
  getRotatedApiKey: vi.fn(),
  getAuthConfig: vi.fn(),
  getByProviderId: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: providerServiceMocks
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: providerServiceMocks
}))

vi.mock('@main/integration/cherryai', () => ({
  generateSignature: vi.fn(() => ({}))
}))

vi.mock('@main/services/CopilotService', () => ({
  copilotService: {
    getToken: vi.fn()
  }
}))

import { makeModel, makeProvider } from '../../__tests__/fixtures'
import { providerToAiSdkConfig } from '../config'

describe('providerToAiSdkConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerServiceMocks.getRotatedApiKey.mockReset()
    providerServiceMocks.getAuthConfig.mockReset()
    providerServiceMocks.getByProviderId.mockReset()
  })

  it('routes Vertex Claude models through the google-vertex-anthropic builder', async () => {
    providerServiceMocks.getRotatedApiKey.mockResolvedValueOnce('vertex-key')
    providerServiceMocks.getAuthConfig.mockResolvedValueOnce({
      type: 'iam-gcp',
      project: 'project-id',
      location: 'us-central1',
      credentials: {
        clientEmail: 'service@example.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----'
      }
    })

    const provider = makeProvider({
      id: 'vertexai',
      authType: 'iam-gcp',
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1/projects/project-id/locations/us-central1',
          adapterFamily: 'google-vertex'
        }
      }
    })
    const model = makeModel({
      id: 'vertexai::claude-sonnet-4',
      providerId: 'vertexai',
      apiModelId: 'claude-sonnet-4',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })

    const config = await providerToAiSdkConfig(provider, model)
    const settings = config.providerSettings as Record<string, unknown>

    expect(config.providerId).toBe('google-vertex-anthropic')
    expect(settings.apiKey).toBe('vertex-key')
    expect(settings.project).toBe('project-id')
    expect(settings.location).toBe('us-central1')
    expect(settings.baseURL).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/project-id/locations/us-central1/publishers/anthropic/models'
    )
    expect(settings.googleCredentials).toMatchObject({
      clientEmail: 'service@example.com'
    })
  })

  it('keeps Azure apiVersion v1 on the azure-responses adapter', async () => {
    providerServiceMocks.getRotatedApiKey.mockResolvedValueOnce('azure-key')

    const provider = makeProvider({
      id: 'azure-openai',
      authType: 'iam-azure',
      settings: { apiVersion: 'v1' },
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          baseUrl: 'https://example.openai.azure.com/openai',
          adapterFamily: 'azure'
        }
      },
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    })
    const model = makeModel({
      id: 'azure-openai::gpt-4o',
      providerId: 'azure-openai',
      apiModelId: 'gpt-4o'
    })

    const config = await providerToAiSdkConfig(provider, model)
    const settings = config.providerSettings as Record<string, unknown>

    expect(config.providerId).toBe('azure-responses')
    expect(settings.apiVersion).toBe('v1')
    expect(settings.useDeploymentBasedUrls).toBeUndefined()
  })
})
