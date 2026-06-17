import type * as AiSdkProviderUtils from '@ai-sdk/provider-utils'
import { ENDPOINT_TYPE } from '@shared/data/types/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeProvider } from '../../__tests__/fixtures/provider'
import { DEFAULT_VERTEX_MODEL_PUBLISHERS } from '../listModels/vertex'

// The fetchers resolve the rotated API key (and, for Vertex, the iam-gcp auth
// config + signed auth headers) off main-process singletons, then perform the
// HTTP call through @ai-sdk/provider-utils' getFromApi. Mock all of them at the
// module boundary: ProviderService / VertexAiService to avoid the DB and signing,
// and provider-utils' getFromApi to capture the exact { url, headers } passed.
const { getRotatedApiKeyMock, getAuthConfigMock, getAuthHeadersMock, getCopilotTokenMock, aiSdkGetFromApiMock } =
  vi.hoisted(() => ({
    getRotatedApiKeyMock: vi.fn<(providerId: string) => Promise<string>>(),
    getAuthConfigMock: vi.fn(),
    getAuthHeadersMock: vi.fn(),
    getCopilotTokenMock: vi.fn(),
    aiSdkGetFromApiMock: vi.fn()
  }))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock,
    getAuthConfig: getAuthConfigMock
  }
}))

vi.mock('@main/services/VertexAiService', () => ({
  vertexAiService: {
    getAuthHeaders: getAuthHeadersMock
  }
}))

vi.mock('@main/services/CopilotService', () => ({
  copilotService: {
    getToken: getCopilotTokenMock
  }
}))

vi.mock('@ai-sdk/provider-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof AiSdkProviderUtils>()
  return {
    ...actual,
    getFromApi: aiSdkGetFromApiMock
  }
})

// Import the SUT after the mocks are declared.
const { listModels } = await import('../listModels')

beforeEach(() => {
  vi.clearAllMocks()
  getRotatedApiKeyMock.mockResolvedValue('AIza-secret-key')
  getCopilotTokenMock.mockResolvedValue({ token: 'copilot-token' })
  // listModels' getFromApi wrapper reads `value` off the provider-utils result.
  aiSdkGetFromApiMock.mockResolvedValue({
    value: {
      models: [{ name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', description: 'fast' }]
    }
  })
})

function makeGeminiProvider() {
  return makeProvider({
    id: 'gemini',
    defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
    endpointConfigs: {
      [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
      }
    }
  })
}

describe('listModels — geminiFetcher API key transport', () => {
  it('passes the API key via the x-goog-api-key header, never the ?key= query (REGRESSION)', async () => {
    const provider = makeGeminiProvider()

    await listModels(provider)

    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(1)
    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { url: string; headers: Record<string, string> }

    // The key must NOT leak into the URL (it would be logged via APICallError.url).
    expect(call.url).not.toContain('AIza-secret-key')
    expect(call.url).not.toContain('key=')
    expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/models')

    // The key travels in the header instead.
    expect(call.headers['x-goog-api-key']).toBe('AIza-secret-key')
  })

  it('forwards provider extraHeaders alongside x-goog-api-key', async () => {
    const provider = makeProvider({
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
        }
      },
      settings: { extraHeaders: { 'X-Custom': 'on' } } as never
    })

    await listModels(provider)

    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { headers: Record<string, string> }
    expect(call.headers['x-goog-api-key']).toBe('AIza-secret-key')
    expect(call.headers['X-Custom']).toBe('on')
  })

  it('maps the listed models, stripping the models/ prefix from the id', async () => {
    const provider = makeGeminiProvider()

    const models = await listModels(provider)

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('gemini-2.0-flash')
    expect(models[0].name).toBe('Gemini 2.0 Flash')
  })

  it('drops audio and video generation models, keeping chat, image, and embedding models', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        models: [
          {
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            supportedGenerationMethods: ['generateContent', 'countTokens']
          },
          {
            name: 'models/gemini-2.5-flash-image',
            displayName: 'Gemini 2.5 Flash Image',
            supportedGenerationMethods: ['generateContent', 'countTokens']
          },
          {
            name: 'models/imagen-4.0-generate-001',
            displayName: 'Imagen 4',
            supportedGenerationMethods: ['predict']
          },
          {
            name: 'models/gemini-embedding-001',
            displayName: 'Gemini Embedding 001',
            supportedGenerationMethods: ['embedContent', 'countTokens']
          },
          {
            name: 'models/veo-3.1-generate-preview',
            displayName: 'Veo 3.1',
            supportedGenerationMethods: ['predictLongRunning']
          },
          {
            name: 'models/gemini-2.5-flash-preview-tts',
            displayName: 'Gemini 2.5 Flash TTS',
            supportedGenerationMethods: ['countTokens', 'generateContent']
          },
          {
            name: 'models/gemini-2.5-flash-native-audio-dialog',
            displayName: 'Gemini Native Audio',
            supportedGenerationMethods: ['countTokens', 'bidiGenerateContent']
          }
        ]
      }
    })

    const models = await listModels(makeGeminiProvider())

    expect(models.map((m) => m.apiModelId)).toEqual([
      'gemini-2.0-flash',
      'gemini-2.5-flash-image',
      'imagen-4.0-generate-001',
      'gemini-embedding-001'
    ])
  })
})

describe('listModels — openAIFetcher (official OpenAI provider, audio/video filtering)', () => {
  function makeOpenAIProvider() {
    return makeProvider({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
      }
    })
  }

  it('drops audio/video models (tts/whisper/transcribe/audio/realtime/sora), keeping chat, image, embedding, and moderation', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [
          { id: 'gpt-4o' },
          { id: 'o3' },
          { id: 'gpt-image-1' },
          { id: 'dall-e-3' },
          { id: 'text-embedding-3-large' },
          { id: 'omni-moderation-latest' },
          { id: 'tts-1' },
          { id: 'gpt-4o-mini-tts' },
          { id: 'whisper-1' },
          { id: 'gpt-4o-transcribe' },
          { id: 'gpt-4o-realtime-preview' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'sora-2' }
        ]
      }
    })

    const models = await listModels(makeOpenAIProvider())

    expect(models.map((m) => m.apiModelId)).toEqual([
      'gpt-4o',
      'o3',
      'gpt-image-1',
      'dall-e-3',
      'text-embedding-3-large',
      'omni-moderation-latest'
    ])
  })

  it('applies the audio/video filter to copied OpenAI providers that keep presetProviderId but get a uuid id (REGRESSION)', async () => {
    const copiedOpenAIProvider = makeProvider({
      id: '550e8400-e29b-41d4-a716-446655440000',
      presetProviderId: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.openai.com/v1' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [{ id: 'gpt-4o' }, { id: 'tts-1' }, { id: 'whisper-1' }, { id: 'sora-2' }]
      }
    })

    const models = await listModels(copiedOpenAIProvider)

    expect(models.map((m) => m.apiModelId)).toEqual(['gpt-4o'])
  })
})

describe('listModels — copilotFetcher (preset-aware routing)', () => {
  it('routes copied Copilot providers (uuid id + presetProviderId) through the Copilot fetcher and its audio filter (REGRESSION)', async () => {
    const copiedCopilotProvider = makeProvider({
      id: 'c1a2b3c4-d5e6-7f80-9012-3456789abcde',
      presetProviderId: 'copilot',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.githubcopilot.com' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [{ id: 'gpt-4o' }, { id: 'tts-1' }, { id: 'whisper-1' }]
      }
    })

    const models = await listModels(copiedCopilotProvider)

    expect(getCopilotTokenMock).toHaveBeenCalledTimes(1)
    expect(models.map((m) => m.apiModelId)).toEqual(['gpt-4o'])
  })
})

describe('listModels — gatewayFetcher (Vercel AI Gateway /v3/ai/config)', () => {
  function makeGatewayProvider() {
    return makeProvider({
      id: 'gateway',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://ai-gateway.vercel.sh' }
      }
    })
  }

  it('hits /v3/ai/config with the protocol-version header (not the @ai-sdk/gateway path)', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        models: [{ id: 'openai/gpt-4o', name: 'GPT-4o', description: 'omni', specification: { provider: 'openai' } }]
      }
    })

    const models = await listModels(makeGatewayProvider())

    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(1)
    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { url: string; headers: Record<string, string> }
    expect(call.url).toBe('https://ai-gateway.vercel.sh/v3/ai/config')
    expect(call.headers['ai-gateway-protocol-version']).toBe('0.0.1')

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('openai/gpt-4o')
    expect(models[0].name).toBe('GPT-4o')
    expect(models[0].ownedBy).toBe('openai')
  })

  it('dedups models returned with duplicate ids', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        models: [
          { id: 'openai/gpt-4o', name: 'GPT-4o' },
          { id: 'openai/gpt-4o', name: 'GPT-4o (dup)' }
        ]
      }
    })

    const models = await listModels(makeGatewayProvider())
    expect(models).toHaveLength(1)
  })
})

describe('listModels — vertexFetcher (per-publisher pagination)', () => {
  function makeVertexProvider() {
    return makeProvider({
      id: 'vertex',
      authType: 'iam-gcp',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: { [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {} }
    })
  }

  beforeEach(() => {
    getAuthConfigMock.mockResolvedValue({
      type: 'iam-gcp',
      project: 'my-project',
      location: 'us-central1',
      credentials: {
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n',
        client_email: 'svc@my-project.iam.gserviceaccount.com'
      }
    })
    getAuthHeadersMock.mockResolvedValue({ Authorization: 'Bearer vertex-token' })
  })

  it('queries every default publisher under the location aiplatform host with the signed headers', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        publisherModels: [
          { name: 'publishers/google/models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
          { name: 'publishers/google/models/imagen-tts', displayName: 'Imagen TTS' }
        ]
      }
    })

    const models = await listModels(makeVertexProvider())

    // One request per default publisher (single page each — no nextPageToken).
    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(DEFAULT_VERTEX_MODEL_PUBLISHERS.length)
    const urls = aiSdkGetFromApiMock.mock.calls.map((c) => (c[0] as { url: string }).url)
    for (const publisher of DEFAULT_VERTEX_MODEL_PUBLISHERS) {
      expect(
        urls.some((u) =>
          u.startsWith(`https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/${publisher}/models?`)
        )
      ).toBe(true)
    }
    const firstHeaders = (aiSdkGetFromApiMock.mock.calls[0][0] as { headers: Record<string, string> }).headers
    expect(firstHeaders.Authorization).toBe('Bearer vertex-token')

    // Supported gemini model kept (deduped across publishers); the *-tts model filtered out.
    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('gemini-2.0-flash')
    expect(models[0].ownedBy).toBe('google')
  })

  it('paginates a publisher via nextPageToken', async () => {
    // First call returns a page token; every subsequent call returns a final page.
    aiSdkGetFromApiMock
      .mockResolvedValue({
        value: { publisherModels: [{ name: 'publishers/google/models/gemini-2.0-flash' }] }
      })
      .mockResolvedValueOnce({
        value: {
          publisherModels: [{ name: 'publishers/google/models/gemini-1.5-pro' }],
          nextPageToken: 'page-2'
        }
      })

    const models = await listModels(makeVertexProvider())

    // 7 publishers, with the first one taking an extra page → 8 requests.
    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(DEFAULT_VERTEX_MODEL_PUBLISHERS.length + 1)
    const ids = models.map((m) => m.apiModelId).sort()
    expect(ids).toEqual(['gemini-1.5-pro', 'gemini-2.0-flash'])
  })

  it('returns [] when the provider is not configured with iam-gcp auth', async () => {
    getAuthConfigMock.mockResolvedValue(null)

    const models = await listModels(makeVertexProvider())

    expect(models).toEqual([])
    expect(aiSdkGetFromApiMock).not.toHaveBeenCalled()
  })
})
