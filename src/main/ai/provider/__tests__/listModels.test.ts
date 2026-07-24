import type * as AiSdkProviderUtils from '@ai-sdk/provider-utils'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
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
    getRotatedApiKeyMock: vi.fn<(providerId: string) => string>(),
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
  getRotatedApiKeyMock.mockReturnValue('AIza-secret-key')
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

describe('listModels — anthropicFetcher (x-api-key + anthropic-version transport)', () => {
  function makeAnthropicProvider() {
    return makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' }
      }
    })
  }

  it('hits /v1/models with x-api-key + anthropic-version, never Authorization: Bearer', async () => {
    getRotatedApiKeyMock.mockReturnValue('sk-ant-secret')
    aiSdkGetFromApiMock.mockResolvedValue({
      value: { data: [{ id: 'claude-opus-4-8', display_name: 'Claude Opus 4.8' }] }
    })

    const models = await listModels(makeAnthropicProvider())

    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(1)
    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { url: string; headers: Record<string, string> }
    expect(call.url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(call.headers['x-api-key']).toBe('sk-ant-secret')
    expect(call.headers['anthropic-version']).toBe('2023-06-01')
    expect(call.headers.Authorization).toBeUndefined()

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('claude-opus-4-8')
    expect(models[0].name).toBe('Claude Opus 4.8')
    expect(models[0].ownedBy).toBe('anthropic')
  })

  it('routes copied Anthropic providers (uuid id + presetProviderId) through the Anthropic fetcher (REGRESSION)', async () => {
    const copied = makeProvider({
      id: 'a1b2c3d4-e5f6-7089-1234-56789abcdef0',
      presetProviderId: 'anthropic',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://api.anthropic.com' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: { data: [{ id: 'claude-opus-4-8' }, { id: 'claude-opus-4-8' }] }
    })

    const models = await listModels(copied)

    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { headers: Record<string, string> }
    expect(call.headers['anthropic-version']).toBe('2023-06-01')
    // dedup keeps a single entry for the repeated id
    expect(models.map((m) => m.apiModelId)).toEqual(['claude-opus-4-8'])
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

describe('listModels — ppioFetcher capability mapping', () => {
  it('keeps only RERANK when the same model id appears in chat and reranker endpoints', async () => {
    const provider = makeProvider({
      id: 'ppio',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.ppio.com/v1' }
      }
    })
    aiSdkGetFromApiMock.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith('/models?model_type=embedding')) {
        return Promise.resolve({ value: { data: [{ id: 'ppio-embedding' }] } })
      }
      if (url.endsWith('/models?model_type=reranker')) {
        return Promise.resolve({
          value: {
            data: [
              {
                id: 'ppio-reranker',
                owned_by: 'ppio-rerank',
                name: 'PPIO Rerank Pro',
                description: 'Reranker endpoint metadata',
                group: 'rerankers'
              }
            ]
          }
        })
      }
      return Promise.resolve({ value: { data: [{ id: 'ppio-chat' }, { id: 'ppio-reranker' }] } })
    })

    const models = await listModels(provider)
    const chatModel = models.find((model) => model.apiModelId === 'ppio-chat')
    const rerankerModel = models.find((model) => model.apiModelId === 'ppio-reranker')

    expect(chatModel?.capabilities).not.toContain(MODEL_CAPABILITY.RERANK)
    expect(rerankerModel?.capabilities).toContain(MODEL_CAPABILITY.RERANK)
    expect(rerankerModel?.ownedBy).toBeUndefined()
    expect(rerankerModel?.name).toBe('ppio-reranker')
    expect(rerankerModel?.description).toBeUndefined()
    expect(rerankerModel?.group).toBe('ppio')
  })
})

describe('listModels — openRouterFetcher image models', () => {
  function makeOpenRouterProvider() {
    return makeProvider({
      id: 'openrouter',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1/',
          modelsApiUrls: {
            default: 'https://openrouter.example/models',
            embedding: 'https://openrouter.example/embeddings/models',
            image: 'https://openrouter.example/images/models'
          }
        },
        [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]: {
          adapterFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1/'
        }
      }
    })
  }

  it('unions the dedicated image catalog and marks duplicate image models for image routing', async () => {
    const provider = makeOpenRouterProvider()
    aiSdkGetFromApiMock.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith('/embeddings/models')) {
        return Promise.resolve({ value: { data: [{ id: 'openai/text-embedding-3-small' }] } })
      }
      if (url.endsWith('/images/models')) {
        return Promise.resolve({
          value: {
            data: [
              { id: 'openai/gpt-image-2', name: 'OpenAI: GPT Image 2' },
              { id: 'sourceful/riverflow-v2.5-fast', name: 'Sourceful: Riverflow V2.5 Fast' }
            ]
          }
        })
      }
      return Promise.resolve({ value: { data: [{ id: 'anthropic/claude-sonnet-4' }, { id: 'openai/gpt-image-2' }] } })
    })

    const models = await listModels(provider)

    expect(aiSdkGetFromApiMock.mock.calls.map(([call]) => call.url)).toEqual([
      'https://openrouter.example/models',
      'https://openrouter.example/embeddings/models',
      'https://openrouter.example/images/models'
    ])
    expect(models.map((model) => model.apiModelId)).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-image-2',
      'openai/text-embedding-3-small',
      'sourceful/riverflow-v2.5-fast'
    ])
    expect(models.find((model) => model.apiModelId === 'openai/gpt-image-2')).toMatchObject({
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION]
    })
    expect(models.find((model) => model.apiModelId === 'sourceful/riverflow-v2.5-fast')).toMatchObject({
      capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
      endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
      name: 'Sourceful: Riverflow V2.5 Fast'
    })
  })

  it('keeps the primary and embedding catalogs when the image catalog fails in strict sync mode', async () => {
    const provider = makeOpenRouterProvider()
    aiSdkGetFromApiMock.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith('/images/models')) {
        return Promise.reject(new Error('image catalog unavailable'))
      }
      if (url.endsWith('/embeddings/models')) {
        return Promise.resolve({ value: { data: [{ id: 'openai/text-embedding-3-small' }] } })
      }
      return Promise.resolve({ value: { data: [{ id: 'anthropic/claude-sonnet-4' }] } })
    })

    await expect(listModels(provider, undefined, { throwOnError: true })).resolves.toEqual([
      expect.objectContaining({ apiModelId: 'anthropic/claude-sonnet-4' }),
      expect.objectContaining({ apiModelId: 'openai/text-embedding-3-small' })
    ])
  })
})

describe('listModels — copied preset provider routing', () => {
  it('routes a copied GitHub provider through the GitHub catalog fetcher', async () => {
    const provider = makeProvider({
      id: '550e8400-e29b-41d4-a716-446655440001',
      presetProviderId: 'github'
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: [{ id: 'openai/gpt-4o', name: 'GPT-4o', publisher: 'OpenAI' }]
    })

    const models = await listModels(provider)

    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(1)
    expect(aiSdkGetFromApiMock.mock.calls[0][0]).toMatchObject({
      url: 'https://models.github.ai/catalog/models'
    })
    expect(models.map((model) => model.apiModelId)).toEqual(['openai/gpt-4o'])
  })
})

describe('listModels — Radeon Cloud source header', () => {
  it('adds X-Source to Radeon model listing without adding it to other providers', async () => {
    const radeonProvider = makeProvider({
      id: 'radeon-cloud',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://developer.amd.com.cn/radeon/api/v1' }
      }
    })
    const otherProvider = makeProvider({
      id: 'other-openai-compatible',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.example.com/v1' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({ value: { data: [] } })

    await listModels(radeonProvider)
    await listModels(otherProvider)

    const radeonCall = aiSdkGetFromApiMock.mock.calls[0][0] as { url: string; headers: Record<string, string> }
    const otherCall = aiSdkGetFromApiMock.mock.calls[1][0] as { url: string; headers: Record<string, string> }
    expect(radeonCall.url).toBe('https://developer.amd.com.cn/radeon/api/v1/models')
    expect(radeonCall.headers['X-Source']).toBe('cherry-studio')
    expect(otherCall.headers).not.toHaveProperty('X-Source')
  })
})

describe('listModels — newApiFetcher endpoint types', () => {
  it('maps supported_endpoint_types from NewAPI model responses', async () => {
    const provider = makeProvider({
      id: 'new-api',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://newapi.example.com/v1' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [
          {
            id: 'agent/deepseek-v3.2',
            object: 'model',
            created: 1626777600,
            owned_by: 'custom',
            supported_endpoint_types: [
              'openai',
              'openai-response',
              'openai-response-compact',
              'anthropic',
              'gemini',
              'jina-rerank',
              'image-generation',
              'image-edit'
            ]
          }
        ]
      }
    })

    const models = await listModels(provider)

    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      apiModelId: 'agent/deepseek-v3.2',
      ownedBy: 'custom',
      endpointTypes: [
        ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        ENDPOINT_TYPE.OPENAI_RESPONSES,
        ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        ENDPOINT_TYPE.JINA_RERANK,
        ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
        ENDPOINT_TYPE.OPENAI_IMAGE_EDIT
      ]
    })
  })

  it('routes aionly through the NewAPI-compatible model parser', async () => {
    const provider = makeProvider({
      id: 'aionly',
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://api.aionly.com/v1' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [
          {
            id: 'deepseek-v3.2',
            supported_endpoint_types: ['anthropic']
          }
        ]
      }
    })

    const models = await listModels(provider)

    expect(models[0].endpointTypes).toEqual([ENDPOINT_TYPE.ANTHROPIC_MESSAGES])
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

describe('listModels — aiHubMixFetcher (configured base URL)', () => {
  it('builds the models URL from the configured base URL, stripping a trailing /v1', async () => {
    const provider = makeProvider({
      id: 'aihubmix',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://custom.example.com/v1' }
      }
    })
    aiSdkGetFromApiMock.mockResolvedValue({
      value: { data: [{ model_id: 'qwen3.6-plus', model_name: 'Qwen3.6 Plus', desc: 'test' }] }
    })

    const models = await listModels(provider)

    expect(aiSdkGetFromApiMock).toHaveBeenCalledTimes(1)
    const call = aiSdkGetFromApiMock.mock.calls[0][0] as { url: string }
    expect(call.url).toBe('https://custom.example.com/api/v1/models')
    expect(models.map((m) => m.apiModelId)).toEqual(['qwen3.6-plus'])
  })
})

describe('listModels — newApiFetcher endpoint-implied capabilities', () => {
  function makeNewApiProvider() {
    return makeProvider({
      id: 'new-api',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://new-api.example.com/v1' }
      }
    })
  }

  it('marks normalized primary jina-rerank models while ignoring unknown endpoint routing metadata', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [
          {
            id: 'opaque-model-id',
            owned_by: 'new-api',
            supported_endpoint_types: [' JINA-RERANK ', 'openai', 'unknown-endpoint']
          }
        ]
      }
    })

    const models = await listModels(makeNewApiProvider())

    expect(models).toHaveLength(1)
    expect(models[0].capabilities).toContain(MODEL_CAPABILITY.RERANK)
    expect(models[0].endpointTypes).toEqual([ENDPOINT_TYPE.JINA_RERANK, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS])
  })

  it('does not mark jina-rerank when a chat endpoint has higher priority', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [
          {
            id: 'multi-endpoint-chat-model',
            supported_endpoint_types: ['openai', 'jina-rerank']
          }
        ]
      }
    })

    const models = await listModels(makeNewApiProvider())

    expect(models[0].endpointTypes).toEqual([ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, ENDPOINT_TYPE.JINA_RERANK])
    expect(models[0].capabilities).not.toContain(MODEL_CAPABILITY.RERANK)
  })

  it('derives the capability for other capability-exclusive primary endpoints (image)', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        data: [
          {
            id: 'opaque-image-model',
            supported_endpoint_types: ['image-generation', 'openai']
          }
        ]
      }
    })

    const models = await listModels(makeNewApiProvider())

    expect(models[0].capabilities).toContain(MODEL_CAPABILITY.IMAGE_GENERATION)
    expect(models[0].endpointTypes).toEqual([
      ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION,
      ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    ])
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
    getAuthConfigMock.mockReturnValue({
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

  it('bakes the publisher prefix into MaaS (non-google) model ids so the OpenAI-compatible endpoint gets the right model', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        publisherModels: [
          { name: 'publishers/meta/models/llama-4-scout-17b-16e-instruct-maas', displayName: 'Llama 4 Scout' }
        ]
      }
    })

    const models = await listModels(makeVertexProvider())

    // Same MaaS model deduped across the per-publisher fan-out → a single entry.
    expect(models).toHaveLength(1)
    // Publisher-prefixed id (survives the bare-name support filter) is what the request sends.
    expect(models[0].apiModelId).toBe('meta/llama-4-scout-17b-16e-instruct-maas')
    expect(models[0].ownedBy).toBe('meta')
  })

  it('preserves the publisher prefix for MaaS models published by Google', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        publisherModels: [{ name: 'publishers/google/models/gemma-4-26b-a4b-it-maas', displayName: 'Gemma 4 26B' }]
      }
    })

    const models = await listModels(makeVertexProvider())

    expect(models).toHaveLength(1)
    expect(models[0].apiModelId).toBe('google/gemma-4-26b-a4b-it-maas')
    expect(models[0].ownedBy).toBe('google')
  })

  it('filters non-google publisher models that do not use the MaaS id format', async () => {
    aiSdkGetFromApiMock.mockResolvedValue({
      value: {
        publisherModels: [
          { name: 'publishers/meta/models/llama-4-scout-17b-16e-instruct-maas' },
          { name: 'publishers/meta/models/llama-3.1-8b-instruct' }
        ]
      }
    })

    const models = await listModels(makeVertexProvider())

    expect(models.map((model) => model.apiModelId)).toEqual(['meta/llama-4-scout-17b-16e-instruct-maas'])
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
    getAuthConfigMock.mockReturnValue(null)

    const models = await listModels(makeVertexProvider())

    expect(models).toEqual([])
    expect(aiSdkGetFromApiMock).not.toHaveBeenCalled()
  })
})
