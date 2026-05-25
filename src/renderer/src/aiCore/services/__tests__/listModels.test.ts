/**
 * ModelListService conversion tests
 * Uses real API responses captured from providers to verify model conversion
 */
import type { Provider } from '@renderer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetFromApi = vi.fn()
const mockCopilotGetToken = vi.fn()
const mockVertexGetAuthHeaders = vi.fn()
const mockToastError = vi.fn()
const createMockStoreState = () => ({
  copilot: {
    defaultHeaders: {}
  },
  llm: {
    settings: {
      vertexai: {
        projectId: 'test-project',
        location: 'us-central1',
        serviceAccount: {
          privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
          clientEmail: 'vertex@test-project.iam.gserviceaccount.com'
        }
      }
    }
  }
})
let mockStoreState = createMockStoreState()
vi.mock('@ai-sdk/provider-utils', () => ({
  createJsonResponseHandler: vi.fn(() => 'json-handler'),
  createJsonErrorResponseHandler: vi.fn(() => 'error-handler'),
  getFromApi: (...args: unknown[]) => mockGetFromApi(...args),
  zodSchema: vi.fn((s: unknown) => s)
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

vi.mock('@renderer/utils', () => ({
  formatApiHost: (host: string) => host?.replace(/\/$/, ''),
  withoutTrailingSlash: (s: string) => s?.replace(/\/$/, ''),
  getLowerBaseModelName: (id: string) => id.toLowerCase()
}))

vi.mock('@renderer/utils/provider', () => ({
  isGeminiProvider: (p: Provider) => p.id === 'gemini' || p.type === 'gemini',
  isOllamaProvider: (p: Provider) => p.id === 'ollama' || p.type === 'ollama',
  isVertexProvider: (p: Provider) => p.id === 'vertexai' || p.type === 'vertexai'
}))

vi.mock('@shared/utils', () => ({
  defaultAppHeaders: () => ({ 'X-App': 'CherryStudio' })
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => mockStoreState
  }
}))

const { listModels } = await import('../listModels')
const { OllamaTagsResponseSchema } = await import('../schemas')

// === Real API response fixtures (captured 2026-03-19) ===

// From https://openrouter.ai/api/v1/models (public, no auth)
const REAL_OPENROUTER = {
  data: [
    { id: 'xiaomi/mimo-v2-omni', object: 'model', created: 1773863703, owned_by: null },
    { id: 'xiaomi/mimo-v2-pro', object: 'model', created: 1773863643, owned_by: null },
    { id: 'minimax/minimax-m2.7', object: 'model', created: 1773836697, owned_by: null },
    { id: 'openai/gpt-5.4-nano', object: 'model', created: 1773748187, owned_by: null },
    { id: 'openai/gpt-5.4-mini', object: 'model', created: 1773748178, owned_by: null },
    { id: 'mistralai/mistral-small-2603', object: 'model', created: 1773695685, owned_by: null },
    { id: 'z-ai/glm-5-turbo', object: 'model', created: 1773583573, owned_by: null },
    { id: 'x-ai/grok-4.20-multi-agent-beta', object: 'model', created: 1773325367, owned_by: null }
  ]
}

// From https://api.deepseek.com/v1/models
const REAL_DEEPSEEK = {
  object: 'list',
  data: [
    { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' },
    { id: 'deepseek-reasoner', object: 'model', owned_by: 'deepseek' }
  ]
}

// From https://generativelanguage.googleapis.com/v1beta/models
const REAL_GEMINI = {
  models: [
    {
      name: 'models/gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      description:
        'Stable version of Gemini 2.5 Flash, our mid-size multimodal model that supports up to 1 million tokens, released in June of 2025.'
    },
    {
      name: 'models/gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      description: 'Stable release (June 17th, 2025) of Gemini 2.5 Pro'
    },
    {
      name: 'models/gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      description: 'Gemini 2.0 Flash'
    },
    {
      name: 'models/gemini-2.0-flash-001',
      displayName: 'Gemini 2.0 Flash 001',
      description:
        'Stable version of Gemini 2.0 Flash, our fast and versatile multimodal model for scaling across diverse tasks, released in January of 2025.'
    },
    {
      name: 'models/gemini-2.0-flash-lite-001',
      displayName: 'Gemini 2.0 Flash-Lite 001',
      description: 'Stable version of Gemini 2.0 Flash-Lite'
    },
    {
      name: 'models/gemini-2.0-flash-lite',
      displayName: 'Gemini 2.0 Flash-Lite',
      description: 'Gemini 2.0 Flash-Lite'
    }
  ]
}

// From https://api.together.xyz/v1/models
const REAL_TOGETHER = [
  { id: 'hexgrad/Kokoro-82M', display_name: 'Kokoro 82M', organization: 'Hexgrad', description: null },
  { id: 'cartesia/sonic', display_name: 'Cartesia Sonic', organization: 'Cartesia', description: null },
  {
    id: 'black-forest-labs/FLUX.1-krea-dev',
    display_name: 'FLUX.1 Krea [dev]',
    organization: 'Black Forest Labs',
    description: null
  },
  {
    id: 'google/imagen-4.0-preview',
    display_name: 'Google Imagen 4.0 Preview',
    organization: 'Google',
    description: null
  },
  { id: 'cartesia/sonic-2', display_name: 'Cartesia Sonic 2', organization: 'Cartesia', description: null }
]

// From https://api.siliconflow.cn/v1/models (OpenAI-compatible)
const REAL_SILICONFLOW = {
  data: [
    { id: 'Pro/MiniMaxAI/MiniMax-M2.5', object: 'model', owned_by: '' },
    { id: 'Pro/zai-org/GLM-5', object: 'model', owned_by: '' },
    { id: 'Pro/moonshotai/Kimi-K2.5', object: 'model', owned_by: '' },
    { id: 'Pro/zai-org/GLM-4.7', object: 'model', owned_by: '' },
    { id: 'deepseek-ai/DeepSeek-V3.2', object: 'model', owned_by: '' },
    { id: 'Pro/deepseek-ai/DeepSeek-V3.2', object: 'model', owned_by: '' }
  ]
}

// From https://api.groq.com/openai/v1/models
const REAL_GROQ = {
  data: [
    { id: 'qwen/qwen3-32b', object: 'model', created: 1748396646, owned_by: 'Alibaba Cloud' },
    { id: 'groq/compound-mini', object: 'model', created: 1756949707, owned_by: 'Groq' }
  ]
}

// From https://api.ppinfra.com/v3/openai/models
const REAL_PPIO_CHAT = {
  data: [
    { id: 'minimax/minimax-m2.7', object: 'model', owned_by: 'unknown' },
    { id: 'minimax/minimax-m2.5-highspeed', object: 'model', owned_by: 'unknown' },
    { id: 'qwen/qwen3.5-27b', object: 'model', owned_by: 'unknown' },
    { id: 'qwen/qwen3.5-122b-a10b', object: 'model', owned_by: 'unknown' },
    { id: 'qwen/qwen3.5-35b-a3b', object: 'model', owned_by: 'unknown' }
  ]
}

// From https://ai-gateway.vercel.sh/v3/ai/config (Vercel AI Gateway model registry)
const REAL_VERCEL_GATEWAY = {
  models: [
    {
      id: 'alibaba/qwen3-max',
      name: 'Qwen3 Max',
      description: 'The Qwen 3 series Max model.',
      modelType: 'language',
      tags: ['tool-use', 'implicit-caching'],
      specification: {
        specificationVersion: 'v3',
        provider: 'alibaba',
        modelId: 'alibaba/qwen3-max',
        type: 'language'
      },
      pricing: { input: '0.0000012', output: '0.000006' }
    },
    {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      modelType: 'language',
      specification: {
        specificationVersion: 'v3',
        provider: 'openai',
        modelId: 'openai/gpt-4o'
      }
    },
    {
      id: 'openai/text-embedding-3-large',
      modelType: 'embedding',
      specification: {
        specificationVersion: 'v3',
        provider: 'openai',
        modelId: 'openai/text-embedding-3-large'
      }
    }
  ]
}

// From https://aihubmix.com/api/v1/models (custom schema with model_id/model_name)
const REAL_AIHUBMIX = {
  data: [
    {
      model_id: 'qwen3.6-plus',
      model_name: 'Qwen3.6 Plus',
      developer_id: 13,
      desc: 'Qwen 3.6, the native vision-language Plus series model.',
      pricing: { cache_read: 0.0282, cache_write: 0.3525, input: 0.282, output: 1.692 },
      types: 'llm',
      features: 'tools,function_calling,structured_outputs,web,long_context,thinking',
      input_modalities: 'text,image,video',
      endpoints: '',
      max_output: 64000,
      context_length: 991000
    },
    {
      model_id: 'claude-sonnet-4-6',
      model_name: 'Claude Sonnet 4.6',
      developer_id: 2,
      desc: 'Claude Sonnet 4.6 delivers frontier intelligence at scale.',
      pricing: { cache_read: 0.3, cache_write: 3.75, input: 3, output: 15 },
      types: 'llm',
      features: 'thinking,tools,function_calling,structured_outputs',
      input_modalities: 'text,image',
      endpoints: 'chat_completions,gemini_api,claude_api',
      max_output: 64000,
      context_length: 1000000
    },
    {
      model_id: 'gpt-5.4',
      model_name: 'GPT 5.4',
      developer_id: 12,
      desc: 'GPT-5.4 is our frontier model for complex professional work.',
      pricing: { cache_read: 0.25, input: 2.5, output: 15 },
      types: 'llm',
      features: 'thinking,function_calling,structured_outputs,web,tools',
      input_modalities: 'text,image',
      endpoints: '',
      max_output: 128000,
      context_length: 400000
    },
    {
      model_id: 'doubao-seedance-2-0-260128',
      model_name: 'Doubao Seedance 2.0 260128',
      developer_id: 4,
      desc: 'A new-generation professional-grade multimodal video-creation model.',
      pricing: { input: 2, output: 0 },
      types: 'video',
      features: '',
      input_modalities: 'image,text',
      endpoints: '',
      max_output: 0,
      context_length: 0
    }
  ],
  message: '',
  success: true
}

// === Helpers ===

function makeProvider(overrides: Partial<Provider> & { id: string }): Provider {
  return {
    name: overrides.id,
    type: 'openai',
    apiKey: 'sk-test',
    apiHost: 'https://api.example.com/v1',
    models: [],
    isSystem: true,
    enabled: true,
    ...overrides
  } as Provider
}

function assertValidModels(models: { id: string; name: string; provider: string; group: string }[]) {
  expect(models.length).toBeGreaterThan(0)
  for (const m of models) {
    expect(m.id).toBeTruthy()
    expect(typeof m.id).toBe('string')
    expect(m.id).toBe(m.id.trim())
    expect(m.name).toBeTruthy()
    expect(typeof m.provider).toBe('string')
    expect(typeof m.group).toBe('string')
  }
}

type VertexPublisherModelFixture = {
  name: string
  displayName?: string
  description?: string
}

type VertexPublisherFixtureResponse = {
  publisherModels?: VertexPublisherModelFixture[]
  nextPageToken?: string
}

function mockVertexPublisherResponses(
  responsesByPublisher: Record<string, VertexPublisherFixtureResponse | VertexPublisherFixtureResponse[] | Error>
) {
  const pageIndexByPublisher = new Map<string, number>()

  mockGetFromApi.mockImplementation(({ url }: { url: string }) => {
    const match = url.match(/\/publishers\/([^/]+)\/models/)
    const publisher = match?.[1]

    if (!publisher) {
      return Promise.resolve({
        value: { publisherModels: [] }
      })
    }

    const response = responsesByPublisher[publisher]

    if (response instanceof Error) {
      return Promise.reject(response)
    }

    if (Array.isArray(response)) {
      const pageIndex = pageIndexByPublisher.get(publisher) ?? 0
      pageIndexByPublisher.set(publisher, pageIndex + 1)

      return Promise.resolve({
        value: response[pageIndex] ?? { publisherModels: [] }
      })
    }

    return Promise.resolve({
      value: response ?? { publisherModels: [] }
    })
  })
}

const COPILOT_PROVIDER = makeProvider({
  id: 'copilot',
  apiHost: 'https://api.githubcopilot.com/'
})

const COPILOT_MODELS_RESPONSE = {
  value: {
    data: [
      { id: 'accounts/msft/routers/f185i3v4' },
      { id: 'tts-1', object: 'model' },
      { id: 'gpt-4o-mini', owned_by: 'github' },
      { id: 'claude-sonnet-4.5', policy: { state: 'disabled' } },
      { id: 'gpt-4o-mini', owned_by: 'github' }
    ]
  }
}

// === Tests ===

beforeEach(() => {
  mockGetFromApi.mockReset()
  mockCopilotGetToken.mockReset()
  mockVertexGetAuthHeaders.mockReset()
  mockToastError.mockReset()
  mockStoreState = createMockStoreState()
  mockCopilotGetToken.mockResolvedValue({ token: 'copilot-dynamic-token' })
  mockVertexGetAuthHeaders.mockResolvedValue({ Authorization: 'Bearer vertex-token' })
  vi.stubGlobal('window', {
    ...globalThis.window,
    keyv: { get: vi.fn(), set: vi.fn() },
    toast: {
      error: mockToastError
    },
    api: {
      copilot: {
        getToken: mockCopilotGetToken
      },
      vertexAI: {
        getAuthHeaders: mockVertexGetAuthHeaders
      }
    }
  })
})

describe('listModels', () => {
  describe('Copilot', () => {
    it('should use Copilot-specific token and filter unsupported Copilot entries', async () => {
      mockGetFromApi.mockResolvedValue(COPILOT_MODELS_RESPONSE)

      const models = await listModels(COPILOT_PROVIDER)
      expect(mockGetFromApi).toHaveBeenCalledTimes(1)
      const [request] = mockGetFromApi.mock.calls[0]

      expect(mockCopilotGetToken).toHaveBeenCalledTimes(1)
      expect(request).toMatchObject({
        url: 'https://api.githubcopilot.com/models',
        headers: {
          Authorization: 'Bearer copilot-dynamic-token',
          'Copilot-Integration-Id': 'vscode-chat'
        }
      })
      expect(models.map((model) => model.id)).toEqual(['gpt-4o-mini'])
    })
  })

  describe('OpenAI-compatible (DeepSeek)', () => {
    it('should convert real DeepSeek response', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_DEEPSEEK })
      const models = await listModels(makeProvider({ id: 'deepseek' }))
      assertValidModels(models)
      expect(models).toMatchSnapshot()
    })
  })

  describe('OpenAI-compatible (SiliconFlow)', () => {
    it('should handle nested slash IDs for group extraction', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_SILICONFLOW })
      const models = await listModels(makeProvider({ id: 'silicon' }))
      assertValidModels(models)
      // "Pro/MiniMaxAI/MiniMax-M2.5" -> group "Pro"
      expect(models[0].group).toBe('Pro')
      // "deepseek-ai/DeepSeek-V3.2" -> group "deepseek-ai"
      expect(models[4].group).toBe('deepseek-ai')
      expect(models).toMatchSnapshot()
    })
  })

  describe('OpenAI-compatible (Groq)', () => {
    it('should convert real Groq response with owned_by', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_GROQ })
      const models = await listModels(makeProvider({ id: 'groq' }))
      assertValidModels(models)
      expect(models[0].owned_by).toBe('Alibaba Cloud')
      expect(models[1].owned_by).toBe('Groq')
      expect(models).toMatchSnapshot()
    })
  })

  describe('Gemini', () => {
    it('should strip models/ prefix and use displayName from real response', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_GEMINI })
      const models = await listModels(
        makeProvider({ id: 'gemini', type: 'gemini', apiHost: 'https://generativelanguage.googleapis.com/v1beta' })
      )
      assertValidModels(models)
      for (const m of models) {
        expect(m.id).not.toMatch(/^models\//)
      }
      // displayName should be used as name
      expect(models[0].name).toBe('Gemini 2.5 Flash')
      expect(models[0].id).toBe('gemini-2.5-flash')
      expect(models).toMatchSnapshot()
    })
  })

  describe('Vertex AI', () => {
    it('should authenticate, paginate, and normalize Google Vertex publisher models', async () => {
      mockVertexPublisherResponses({
        google: [
          {
            publisherModels: [
              {
                name: 'publishers/google/models/gemini-2.5-pro',
                displayName: 'Gemini 2.5 Pro',
                description: 'Pro Gemini model'
              },
              {
                name: 'publishers/google/models/gemini-2.5-pro',
                displayName: 'Gemini 2.5 Pro duplicate'
              },
              {
                name: 'publishers/google/models/imageclassification-efficientnet'
              }
            ],
            nextPageToken: 'next-page'
          },
          {
            publisherModels: [
              {
                name: 'publishers/google/models/gemini-2.5-flash',
                displayName: 'Gemini 2.5 Flash',
                description: 'Fast Gemini model'
              },
              {
                name: 'publishers/google/models/text-embedding-005'
              }
            ]
          }
        ]
      })

      const models = await listModels(
        makeProvider({
          id: 'vertexai',
          type: 'vertexai',
          apiHost: 'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1'
        })
      )

      expect(mockVertexGetAuthHeaders).toHaveBeenCalledWith({
        projectId: 'test-project',
        serviceAccount: {
          privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
          clientEmail: 'vertex@test-project.iam.gserviceaccount.com'
        }
      })
      const requests = mockGetFromApi.mock.calls.map(([request]) => request)
      const requestedUrls = requests.map((request) => request.url)
      const googleUrls = requestedUrls.filter((url) => url.includes('/publishers/google/models'))

      expect(googleUrls).toEqual([
        'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=100&listAllVersions=true',
        'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=100&listAllVersions=true&pageToken=next-page'
      ])
      expect(requestedUrls).toContain(
        'https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/openai/models?pageSize=100&listAllVersions=true'
      )
      expect(requestedUrls.some((url) => url.includes('/publishers/anthropic/models'))).toBe(false)
      expect(requests[0].headers).toMatchObject({
        Authorization: 'Bearer vertex-token',
        'X-App': 'CherryStudio'
      })
      expect(models.map((m) => m.id)).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash', 'text-embedding-005'])
      expect(models[0]).toMatchObject({
        name: 'Gemini 2.5 Pro',
        description: 'Pro Gemini model',
        owned_by: 'google',
        provider: 'vertexai'
      })
    })

    it('should keep supported partner families, filter audio and tts models, and ignore failed publishers', async () => {
      mockVertexPublisherResponses({
        google: new Error('publisher unavailable'),
        openai: {
          publisherModels: [
            { name: 'publishers/openai/models/gpt-5-mini', displayName: 'GPT 5 Mini' },
            { name: 'publishers/openai/models/gpt-4o-audio-preview' },
            { name: 'publishers/openai/models/gpt-4o-mini-tts' }
          ]
        },
        meta: {
          publisherModels: [{ name: 'publishers/meta/models/llama-4-scout-17b-16e-instruct-maas' }]
        },
        qwen: {
          publisherModels: [{ name: 'publishers/qwen/models/qwen3.5-27b-instruct-maas' }]
        },
        'deepseek-ai': {
          publisherModels: [{ name: 'publishers/deepseek-ai/models/deepseek-v3.2-maas' }]
        },
        moonshotai: {
          publisherModels: [{ name: 'publishers/moonshotai/models/kimi-k2-thinking-maas' }]
        },
        'zai-org': {
          publisherModels: [{ name: 'publishers/zai-org/models/glm-5-maas' }]
        }
      })

      const models = await listModels(makeProvider({ id: 'vertexai', type: 'vertexai' }))

      expect(models.map((m) => m.id)).toEqual([
        'gpt-5-mini',
        'llama-4-scout-17b-16e-instruct-maas',
        'qwen3.5-27b-instruct-maas',
        'deepseek-v3.2-maas',
        'kimi-k2-thinking-maas',
        'glm-5-maas'
      ])
      expect(models.map((m) => m.owned_by)).toEqual(['openai', 'meta', 'qwen', 'deepseek-ai', 'moonshotai', 'zai-org'])
      expect(mockGetFromApi.mock.calls.some(([request]) => request.url.includes('/publishers/google/models'))).toBe(
        true
      )
    })

    it('should warn and skip listing when required Vertex settings are incomplete', async () => {
      mockStoreState = {
        ...createMockStoreState(),
        llm: {
          settings: {
            vertexai: {
              projectId: 'test-project',
              location: '',
              serviceAccount: {
                privateKey: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----',
                clientEmail: 'vertex@test-project.iam.gserviceaccount.com'
              }
            }
          }
        }
      }

      const models = await listModels(makeProvider({ id: 'vertexai', type: 'vertexai' }))

      expect(models).toEqual([])
      expect(mockVertexGetAuthHeaders).not.toHaveBeenCalled()
      expect(mockGetFromApi).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining('settings.provider.vertex_ai.service_account.incomplete_config')
      )
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('settings.provider.vertex_ai.location'))
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('settings.provider.vertex_ai.location_help'))
    })

    it('should warn and skip listing when Vertex auth header generation fails', async () => {
      mockVertexGetAuthHeaders.mockRejectedValueOnce(new Error('auth failed'))

      const models = await listModels(makeProvider({ id: 'vertexai', type: 'vertexai' }))

      expect(models).toEqual([])
      expect(mockGetFromApi).not.toHaveBeenCalled()
      expect(mockToastError).toHaveBeenCalledWith('auth failed')
    })
  })

  describe('Together', () => {
    it('should use display_name and organization from real response', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_TOGETHER })
      const models = await listModels(makeProvider({ id: 'together' }))
      assertValidModels(models)
      expect(models[0].name).toBe('Kokoro 82M')
      expect(models[0].owned_by).toBe('Hexgrad')
      expect(models[0].group).toBe('hexgrad')
      // FLUX model with org "Black Forest Labs"
      expect(models[2].name).toBe('FLUX.1 Krea [dev]')
      expect(models[2].owned_by).toBe('Black Forest Labs')
      expect(models).toMatchSnapshot()
    })
  })

  describe('OpenRouter', () => {
    it('should merge chat and embedding endpoints from real response', async () => {
      mockGetFromApi
        .mockResolvedValueOnce({ value: REAL_OPENROUTER })
        .mockResolvedValueOnce({ value: { data: [{ id: 'openai/text-embedding-3-large', object: 'model' }] } })
      const models = await listModels(makeProvider({ id: 'openrouter' }))
      assertValidModels(models)
      expect(models).toHaveLength(REAL_OPENROUTER.data.length + 1)
      // Slash IDs should produce correct group
      expect(models.find((m) => m.id === 'xiaomi/mimo-v2-omni')?.group).toBe('xiaomi')
      expect(models.find((m) => m.id === 'openai/gpt-5.4-nano')?.group).toBe('openai')
      expect(models.find((m) => m.id === 'x-ai/grok-4.20-multi-agent-beta')?.group).toBe('x-ai')
      expect(models).toMatchSnapshot()
    })

    it('should deduplicate across endpoints', async () => {
      mockGetFromApi
        .mockResolvedValueOnce({ value: { data: [REAL_OPENROUTER.data[0]] } })
        .mockResolvedValueOnce({ value: { data: [REAL_OPENROUTER.data[0]] } })
      const models = await listModels(makeProvider({ id: 'openrouter' }))
      expect(models).toHaveLength(1)
    })

    it('should handle embedding endpoint failure', async () => {
      mockGetFromApi.mockResolvedValueOnce({ value: REAL_OPENROUTER }).mockRejectedValueOnce(new Error('404 Not Found'))
      const models = await listModels(makeProvider({ id: 'openrouter' }))
      expect(models).toHaveLength(REAL_OPENROUTER.data.length)
    })
  })

  describe('PPIO', () => {
    it('should merge all three endpoints from real response', async () => {
      mockGetFromApi
        .mockResolvedValueOnce({ value: REAL_PPIO_CHAT })
        .mockResolvedValueOnce({ value: { data: [{ id: 'BAAI/bge-m3', object: 'model', owned_by: 'BAAI' }] } })
        .mockResolvedValueOnce({
          value: { data: [{ id: 'BAAI/bge-reranker-v2-m3', object: 'model', owned_by: 'BAAI' }] }
        })
      const models = await listModels(makeProvider({ id: 'ppio' }))
      assertValidModels(models)
      expect(models).toHaveLength(7)
      expect(models.find((m) => m.id === 'BAAI/bge-m3')?.group).toBe('BAAI')
      expect(models).toMatchSnapshot()
    })

    it('should handle partial endpoint failures', async () => {
      mockGetFromApi
        .mockResolvedValueOnce({ value: REAL_PPIO_CHAT })
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
      const models = await listModels(makeProvider({ id: 'ppio' }))
      expect(models).toHaveLength(REAL_PPIO_CHAT.data.length)
    })
  })

  describe('AIHubMix', () => {
    it('should convert real AIHubMix response with model_id and model_name', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_AIHUBMIX })
      const models = await listModels(makeProvider({ id: 'aihubmix' }))
      assertValidModels(models)
      expect(models).toHaveLength(4)
      // model_name should be used as name
      expect(models[0].name).toBe('Qwen3.6 Plus')
      expect(models[0].id).toBe('qwen3.6-plus')
      expect(models[0].description).toBe('Qwen 3.6, the native vision-language Plus series model.')
      // No slash in ID -> group falls back to provider id
      expect(models[0].group).toBe('aihubmix')
      expect(models[1].name).toBe('Claude Sonnet 4.6')
      expect(models[2].name).toBe('GPT 5.4')
      expect(models[3].name).toBe('Doubao Seedance 2.0 260128')
      expect(models).toMatchSnapshot()
    })

    it('should deduplicate by model_id', async () => {
      const duped = {
        ...REAL_AIHUBMIX,
        data: [REAL_AIHUBMIX.data[0], REAL_AIHUBMIX.data[0], REAL_AIHUBMIX.data[1]]
      }
      mockGetFromApi.mockResolvedValue({ value: duped })
      const models = await listModels(makeProvider({ id: 'aihubmix' }))
      expect(models).toHaveLength(2)
    })
  })

  describe('Ollama', () => {
    it('should accept null families in Ollama tags schema', () => {
      const parsed = OllamaTagsResponseSchema.parse({
        models: [
          {
            name: 'glm-5:cloud',
            model: 'glm-5:cloud',
            details: {
              parent_model: '',
              format: '',
              family: '',
              families: null,
              parameter_size: '',
              quantization_level: ''
            }
          }
        ]
      })

      expect(parsed.models[0].details?.families).toBeUndefined()
    })

    it('should accept null families in real Ollama tag responses', async () => {
      mockGetFromApi.mockResolvedValue({
        value: {
          models: [
            {
              name: 'glm-5:cloud',
              model: 'glm-5:cloud',
              details: {
                parent_model: '',
                format: '',
                family: '',
                families: null,
                parameter_size: '',
                quantization_level: ''
              }
            },
            {
              name: 'qwen3.5:9b',
              model: 'qwen3.5:9b',
              details: {
                family: 'qwen35',
                families: ['qwen35']
              }
            }
          ]
        }
      })

      const models = await listModels(makeProvider({ id: 'ollama', type: 'ollama', apiHost: 'http://localhost:11434' }))
      assertValidModels(models)
      expect(models.map((m) => m.id)).toEqual(['glm-5:cloud', 'qwen3.5:9b'])
    })
  })

  describe('Vercel AI Gateway', () => {
    it('should hit /v3/ai/config and normalize entries', async () => {
      mockGetFromApi.mockResolvedValue({ value: REAL_VERCEL_GATEWAY })
      const models = await listModels(
        makeProvider({
          id: 'gateway',
          type: 'gateway' as any,
          apiHost: 'https://ai-gateway.vercel.sh/v1/ai',
          apiKey: 'sk-gw'
        })
      )

      expect(mockGetFromApi).toHaveBeenCalledTimes(1)
      const [request] = mockGetFromApi.mock.calls[0]
      expect(request).toMatchObject({
        url: 'https://ai-gateway.vercel.sh/v3/ai/config',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-gw',
          'ai-gateway-protocol-version': '0.0.1'
        })
      })
      assertValidModels(models)
      expect(models).toHaveLength(3)
      expect(models[0]).toMatchObject({
        id: 'alibaba/qwen3-max',
        name: 'Qwen3 Max',
        provider: 'gateway',
        group: 'alibaba',
        owned_by: 'alibaba',
        description: 'The Qwen 3 series Max model.'
      })
      expect(models[2].name).toBe('openai/text-embedding-3-large')
    })

    it('should fall back to id when name is missing and deduplicate', async () => {
      mockGetFromApi.mockResolvedValue({
        value: {
          models: [
            { id: 'openai/gpt-4o', specification: { provider: 'openai' } },
            { id: 'openai/gpt-4o', specification: { provider: 'openai' } }
          ]
        }
      })
      const models = await listModels(
        makeProvider({ id: 'gateway', type: 'gateway' as any, apiHost: 'https://ai-gateway.vercel.sh/v1/ai' })
      )
      expect(models).toHaveLength(1)
      expect(models[0].name).toBe('openai/gpt-4o')
    })
  })

  describe('Unsupported providers', () => {
    it.each([
      ['aws-bedrock', { id: 'aws-bedrock' }],
      ['anthropic', { id: 'anthropic' }],
      ['vertex-anthropic', { id: 'vertex-anthro', type: 'vertex-anthropic' as any }]
    ])('should return empty for %s', async (_, overrides) => {
      const models = await listModels(makeProvider(overrides as any))
      expect(models).toEqual([])
      expect(mockGetFromApi).not.toHaveBeenCalled()
    })
  })

  describe('Error handling', () => {
    it('should return empty on network error', async () => {
      mockGetFromApi.mockRejectedValue(new Error('ECONNREFUSED'))
      const models = await listModels(makeProvider({ id: 'openai' }))
      expect(models).toEqual([])
    })
  })
})
