import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/services/LoggerService', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn(),
  getAssistantSettings: vi.fn(),
  getDefaultAssistant: vi.fn().mockReturnValue({
    id: 'default',
    name: 'Default Assistant',
    prompt: '',
    settings: {}
  })
}))

vi.mock('@renderer/services/ProviderService', () => ({
  getProviderById: vi.fn()
}))

vi.mock('@renderer/store', () => {
  const mockGetState = vi.fn()
  return {
    default: { getState: mockGetState },
    __mockGetState: mockGetState
  }
})

// @renderer/utils/api: use real implementations (pure functions + store-dependent formatVertexApiHost works via mocked store)

vi.mock('@renderer/hooks/useVertexAI', () => ({
  isVertexProvider: vi.fn((p: { type: string }) => p.type === 'vertexai'),
  isVertexAIConfigured: vi.fn(() => true),
  createVertexProvider: vi.fn((provider: Provider) => ({
    ...provider,
    type: 'vertexai',
    googleCredentials: {
      clientEmail: 'test@test.iam.gserviceaccount.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
    },
    project: 'test-project',
    location: 'us-central1'
  }))
}))

vi.mock('@renderer/hooks/useAwsBedrock', () => ({
  getAwsBedrockAuthType: vi.fn(() => 'apiKey'),
  getAwsBedrockAccessKeyId: vi.fn(() => 'AKID_TEST'),
  getAwsBedrockSecretAccessKey: vi.fn(() => 'SECRET_TEST'),
  getAwsBedrockApiKey: vi.fn(() => 'bedrock-api-key'),
  getAwsBedrockRegion: vi.fn(() => 'us-east-1')
}))

import type { GoogleVertexProviderSettings } from '@ai-sdk/google-vertex/edge'
import type { OpenAICompatibleProviderSettings } from '@ai-sdk/openai-compatible'
import type { CherryInProviderSettings } from '@cherrystudio/ai-sdk-provider'
import type { GitHubCopilotProviderSettings } from '@opeoginni/github-copilot-openai-compatible'
import type { ProviderConfig } from '@renderer/aiCore/types'
import { getAwsBedrockAuthType } from '@renderer/hooks/useAwsBedrock'
import { isVertexAIConfigured } from '@renderer/hooks/useVertexAI'
import { getProviderByModel } from '@renderer/services/AssistantService'
import { getProviderById } from '@renderer/services/ProviderService'
import type { AwsBedrockAuthType, Model, Provider } from '@renderer/types'

import { COPILOT_DEFAULT_HEADERS } from '../constants'
import type { AihubmixProviderSettings } from '../custom/aihubmix-provider'
import type { NewApiProviderSettings } from '../custom/newapi-provider'
import { adaptProvider, formatProviderApiHost, getActualProvider, providerToAiSdkConfig } from '../providerConfig'

const { __mockGetState: mockGetState } = vi.mocked(await import('@renderer/store')) as unknown as {
  __mockGetState: ReturnType<typeof vi.fn>
}

// ==================== Helpers ====================

const createWindowKeyv = () => {
  const store = new Map<string, string>()
  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: string) => {
      store.set(key, value)
    }
  }
}

interface WindowMockApi {
  copilot?: { getToken: ReturnType<typeof vi.fn> }
  anthropic_oauth?: { getAccessToken: ReturnType<typeof vi.fn> }
  cherryai?: { generateSignature: ReturnType<typeof vi.fn> }
}

const setupWindowMock = (options?: {
  withCopilotToken?: boolean
  withAnthropicOAuth?: boolean
  withCherryAI?: boolean
}) => {
  const api: WindowMockApi = {}
  if (options?.withCopilotToken) {
    api.copilot = {
      getToken: vi.fn().mockResolvedValue({ token: 'mock-copilot-token' })
    }
  }
  if (options?.withAnthropicOAuth) {
    api.anthropic_oauth = {
      getAccessToken: vi.fn().mockResolvedValue('mock-oauth-token')
    }
  }
  if (options?.withCherryAI) {
    api.cherryai = {
      generateSignature: vi.fn().mockResolvedValue({ 'X-Signature': 'mock-sig' })
    }
  }

  Object.defineProperty(globalThis, 'window', {
    value: { ...globalThis.window, keyv: createWindowKeyv(), api },
    writable: true,
    configurable: true
  })
}

interface StoreMockOverrides {
  includeUsage?: boolean
  copilot?: { defaultHeaders: Record<string, string> }
}

const setupStoreMock = (overrides?: StoreMockOverrides) => {
  mockGetState.mockReturnValue({
    copilot: overrides?.copilot ?? { defaultHeaders: {} },
    settings: {
      openAI: {
        streamOptions: {
          includeUsage: overrides?.includeUsage
        }
      }
    },
    llm: {
      settings: {
        vertexai: {
          projectId: 'test-project',
          location: 'us-central1',
          serviceAccount: {
            clientEmail: 'test@test.iam.gserviceaccount.com',
            privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
          }
        },
        awsBedrock: {
          authType: 'apiKey',
          accessKeyId: 'AKID_TEST',
          secretAccessKey: 'SECRET_TEST',
          apiKey: 'bedrock-api-key',
          region: 'us-east-1'
        }
      }
    }
  })
}

// ==================== Provider Factories ====================

const makeProvider = (overrides: Partial<Provider> & { id: string; type: string }): Provider =>
  ({
    name: overrides.id,
    apiKey: 'test-key',
    apiHost: 'https://api.example.com',
    models: [],
    isSystem: true,
    ...overrides
  }) as Provider

const makeModel = (id: string, provider: string, overrides?: Partial<Model>): Model => ({
  id,
  name: id,
  provider,
  group: provider,
  ...overrides
})

// ==================== formatProviderApiHost ====================

describe('formatProviderApiHost', () => {
  describe('Anthropic provider (special dual-field sync)', () => {
    it('syncs apiHost from anthropicApiHost when both are set', () => {
      const provider = makeProvider({
        id: 'anthropic',
        type: 'anthropic',
        apiHost: 'https://api.anthropic.com',
        anthropicApiHost: 'https://custom-anthropic.example.com'
      })

      const result = formatProviderApiHost(provider)

      // Both fields should be formatted, apiHost derived from anthropicApiHost
      expect(result.anthropicApiHost).toBe('https://custom-anthropic.example.com/v1')
      expect(result.apiHost).toBe('https://custom-anthropic.example.com/v1')
    })

    it('copies apiHost to anthropicApiHost when anthropicApiHost is not set', () => {
      const provider = makeProvider({
        id: 'anthropic',
        type: 'anthropic',
        apiHost: 'https://api.anthropic.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://api.anthropic.com/v1')
      expect(result.anthropicApiHost).toBe('https://api.anthropic.com/v1')
    })

    it('skips version append when trailing sharp is present', () => {
      const provider = makeProvider({
        id: 'anthropic',
        type: 'anthropic',
        apiHost: 'https://api.anthropic.com/v1#'
      })

      const result = formatProviderApiHost(provider)

      // Trailing # disables version append
      expect(result.apiHost).not.toContain('/v1/v1')
    })
  })

  describe('Copilot / GitHub provider', () => {
    it('formats apiHost without appending version', () => {
      const provider = makeProvider({
        id: 'copilot',
        type: 'openai',
        apiHost: 'https://api.githubcopilot.com'
      })

      const result = formatProviderApiHost(provider)

      // Copilot uses formatApiHost(host, false) — no /v1 appended
      expect(result.apiHost).toBe('https://api.githubcopilot.com')
    })

    it('formats GitHub provider the same way', () => {
      const provider = makeProvider({
        id: 'github',
        type: 'openai',
        apiHost: 'https://models.inference.ai.azure.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://models.inference.ai.azure.com')
    })
  })

  describe('CherryAI provider', () => {
    it('formats apiHost without appending version', () => {
      const provider = makeProvider({
        id: 'cherryai',
        type: 'openai',
        apiHost: 'https://api.cherryai.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://api.cherryai.com')
    })

    it('handles empty apiHost gracefully', () => {
      const provider = makeProvider({
        id: 'cherryai',
        type: 'openai',
        apiHost: ''
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('')
    })
  })

  describe('Perplexity provider', () => {
    it('formats apiHost without appending version', () => {
      const provider = makeProvider({
        id: 'perplexity',
        type: 'openai',
        apiHost: 'https://api.perplexity.ai'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://api.perplexity.ai')
    })
  })

  describe('Ollama provider', () => {
    it('strips trailing /v1 and appends /api', () => {
      const provider = makeProvider({
        id: 'ollama',
        type: 'ollama',
        apiHost: 'http://localhost:11434/v1'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('http://localhost:11434/api')
    })

    it('strips trailing /api and re-appends cleanly', () => {
      const provider = makeProvider({
        id: 'ollama',
        type: 'ollama',
        apiHost: 'http://localhost:11434/api'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('http://localhost:11434/api')
    })

    it('handles plain host', () => {
      const provider = makeProvider({
        id: 'ollama',
        type: 'ollama',
        apiHost: 'http://localhost:11434'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('http://localhost:11434/api')
    })
  })

  describe('Gemini provider', () => {
    it('appends v1beta instead of v1', () => {
      const provider = makeProvider({
        id: 'gemini',
        type: 'gemini',
        apiHost: 'https://generativelanguage.googleapis.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://generativelanguage.googleapis.com/v1beta')
    })

    it('does not double-append when version already present', () => {
      const provider = makeProvider({
        id: 'gemini',
        type: 'gemini',
        apiHost: 'https://generativelanguage.googleapis.com/v1beta'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).not.toContain('v1beta/v1beta')
    })

    it('skips version when trailing sharp is present', () => {
      const provider = makeProvider({
        id: 'gemini',
        type: 'gemini',
        apiHost: 'https://custom-gemini.example.com/custom-path#'
      })

      const result = formatProviderApiHost(provider)

      // Trailing # means appendApiVersion = false
      expect(result.apiHost).not.toContain('v1beta')
    })
  })

  describe('Azure OpenAI provider', () => {
    it('normalizes apiHost without appending version (deferred to build phase)', () => {
      const provider = makeProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://example.openai.azure.com/openai'
      })

      const result = formatProviderApiHost(provider)

      // Azure now defers /openai suffix to buildAzureConfig; formatProviderApiHost only normalizes
      expect(result.apiHost).toBe('https://example.openai.azure.com/openai')
    })

    it('does not append /v1 to bare Azure host', () => {
      const provider = makeProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://example.openai.azure.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://example.openai.azure.com')
    })
  })

  describe('Vertex provider', () => {
    beforeEach(() => {
      setupStoreMock()
    })

    it('formats empty host using store vertexai settings', () => {
      const provider = makeProvider({
        id: 'vertexai',
        type: 'vertexai',
        apiHost: ''
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toContain('aiplatform.googleapis.com')
      expect(result.apiHost).toContain('projects/test-project')
      expect(result.apiHost).toContain('locations/us-central1')
    })

    it('uses custom host when provided', () => {
      const provider = makeProvider({
        id: 'vertexai',
        type: 'vertexai',
        apiHost: 'https://custom-vertex.example.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://custom-vertex.example.com/v1')
      expect(result.apiHost).not.toContain('projects/')
    })
  })

  describe('Default fallback (unmatched provider)', () => {
    it('appends /v1 to apiHost', () => {
      const provider = makeProvider({
        id: 'some-custom-provider',
        type: 'openai',
        apiHost: 'https://custom-api.example.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://custom-api.example.com/v1')
    })

    it('does not double-append /v1', () => {
      const provider = makeProvider({
        id: 'some-custom-provider',
        type: 'openai',
        apiHost: 'https://custom-api.example.com/v1'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://custom-api.example.com/v1')
    })

    it('skips version with trailing sharp', () => {
      const provider = makeProvider({
        id: 'some-custom-provider',
        type: 'openai',
        apiHost: 'https://custom-api.example.com/custom#'
      })

      const result = formatProviderApiHost(provider)

      expect(result.apiHost).toBe('https://custom-api.example.com/custom')
    })
  })

  describe('does not mutate the original provider', () => {
    it('returns a new object', () => {
      const provider = makeProvider({
        id: 'some-custom-provider',
        type: 'openai',
        apiHost: 'https://api.example.com'
      })

      const result = formatProviderApiHost(provider)

      expect(result).not.toBe(provider)
      expect(provider.apiHost).toBe('https://api.example.com')
      expect(result.apiHost).toBe('https://api.example.com/v1')
    })
  })
})

// ==================== getActualProvider / adaptProvider ====================

describe('getActualProvider', () => {
  it('retrieves provider by model and formats its apiHost', () => {
    const provider = makeProvider({
      id: 'openai',
      type: 'openai',
      apiHost: 'https://api.openai.com'
    })
    vi.mocked(getProviderByModel).mockReturnValue(provider)

    const result = getActualProvider(makeModel('gpt-4', 'openai'))

    expect(result.apiHost).toBe('https://api.openai.com/v1')
    // Should not mutate original
    expect(provider.apiHost).toBe('https://api.openai.com')
  })
})

describe('adaptProvider', () => {
  it('deep clones and formats the provider', () => {
    const provider = makeProvider({
      id: 'perplexity',
      type: 'openai',
      apiHost: 'https://api.perplexity.ai'
    })

    const result = adaptProvider({ provider })

    expect(result.apiHost).toBe('https://api.perplexity.ai')
    expect(result).not.toBe(provider)
  })
})

// ==================== providerToAiSdkConfig ====================

describe('providerToAiSdkConfig', () => {
  beforeEach(() => {
    setupWindowMock({ withCopilotToken: true, withAnthropicOAuth: true, withCherryAI: true })
    setupStoreMock()
    vi.clearAllMocks()
  })

  describe('Copilot builder', () => {
    it('uses copilot token and default headers', async () => {
      const provider = makeProvider({
        id: 'copilot',
        type: 'openai',
        apiHost: 'https://api.githubcopilot.com'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', 'copilot'))

      expect(config.providerId).toBe('github-copilot-openai-compatible')
      const settings = config.providerSettings as GitHubCopilotProviderSettings
      expect(settings.apiKey).toBe('mock-copilot-token')
      expect(settings.headers).toBeDefined()
      expect(settings.headers!['Copilot-Integration-Id']).toBe(COPILOT_DEFAULT_HEADERS['Copilot-Integration-Id'])
      expect(settings.headers!['Editor-Version']).toBe(COPILOT_DEFAULT_HEADERS['Editor-Version'])
      expect(settings.headers!['copilot-vision-request']).toBe('true')
    })

    it('merges stored custom headers', async () => {
      setupStoreMock({ copilot: { defaultHeaders: { 'X-Custom': 'value' } } })

      const provider = makeProvider({
        id: 'copilot',
        type: 'openai',
        apiHost: 'https://api.githubcopilot.com'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', 'copilot'))

      const settings = config.providerSettings as GitHubCopilotProviderSettings
      expect(settings.headers).toBeDefined()
      expect(settings.headers!['X-Custom']).toBe('value')
    })
  })

  describe('CherryAI builder', () => {
    it('returns openai-compatible with custom fetch for signature', async () => {
      const provider = makeProvider({
        id: 'cherryai',
        type: 'openai',
        apiHost: 'https://api.cherryai.com'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', 'cherryai'))

      expect(config.providerId).toBe('openai-compatible')
      const settings = config.providerSettings as OpenAICompatibleProviderSettings
      expect(settings.name).toBe('cherryai')
      expect(typeof settings.fetch).toBe('function')
    })
  })

  describe('Anthropic OAuth builder', () => {
    it('uses OAuth token with bearer auth', async () => {
      const provider = makeProvider({
        id: 'anthropic',
        type: 'anthropic',
        apiHost: 'https://api.anthropic.com/v1',
        authType: 'oauth'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('claude-3-5-sonnet', 'anthropic'))

      expect(config.providerId).toBe('anthropic')
      const settings = config.providerSettings as { baseURL: string; apiKey: string; headers: Record<string, string> }
      expect(settings.baseURL).toBe('https://api.anthropic.com/v1')
      expect(settings.headers.Authorization).toBe('Bearer mock-oauth-token')
      expect(settings.apiKey).toBe('')
    })
  })

  describe('Ollama builder', () => {
    it('includes Authorization header when apiKey is set', async () => {
      const provider = makeProvider({
        id: 'ollama',
        type: 'ollama',
        apiHost: 'http://localhost:11434/api',
        apiKey: 'my-ollama-key'
      })

      const config = (await providerToAiSdkConfig(provider, makeModel('llama3', 'ollama'))) as ProviderConfig<'ollama'>

      expect(config.providerId).toBe('ollama')
      expect(config.providerSettings.headers?.Authorization).toBe('Bearer my-ollama-key')
    })

    it('omits Authorization header when apiKey is empty', async () => {
      const provider = makeProvider({
        id: 'ollama',
        type: 'ollama',
        apiHost: 'http://localhost:11434/api',
        apiKey: ''
      })

      const config = (await providerToAiSdkConfig(provider, makeModel('llama3', 'ollama'))) as ProviderConfig<'ollama'>

      expect(config.providerId).toBe('ollama')
      expect(config.providerSettings.headers?.Authorization).toBeUndefined()
    })
  })

  describe('Azure builder', () => {
    it('uses deployment-based URLs for date-format apiVersion', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://example.openai.azure.com/openai',
        apiVersion: '2024-02-15-preview'
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4o', provider.id)
      )) as ProviderConfig<'azure'>

      expect(config.providerId).toBe('azure')
      expect(config.providerSettings.apiVersion).toBe('2024-02-15-preview')
      expect(config.providerSettings.useDeploymentBasedUrls).toBe(true)
    })

    it('uses azure-responses for apiVersion "v1"', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://example.openai.azure.com/openai',
        apiVersion: 'v1'
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4o', provider.id)
      )) as ProviderConfig<'azure-responses'>

      expect(config.providerId).toBe('azure-responses')
      expect(config.providerSettings.apiVersion).toBe('v1')
      expect(config.providerSettings.useDeploymentBasedUrls).toBeUndefined()
    })

    it('uses azure-responses for apiVersion "preview"', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://example.openai.azure.com/openai',
        apiVersion: 'preview'
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4o', provider.id)
      )) as ProviderConfig<'azure-responses'>

      expect(config.providerId).toBe('azure-responses')
      expect(config.providerSettings.apiVersion).toBe('preview')
    })

    it('routes Claude models on Azure to azure-anthropic', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        type: 'azure-openai',
        apiHost: 'https://example.openai.azure.com/openai',
        apiVersion: '2024-02-15-preview'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('claude-3-5-sonnet', provider.id))

      expect(config.providerId).toBe('azure-anthropic')
    })
  })

  describe('Bedrock builder', () => {
    it('uses apiKey auth when authType is apiKey', async () => {
      const provider = makeProvider({
        id: 'aws-bedrock',
        type: 'aws-bedrock',
        apiHost: 'https://bedrock.us-east-1.amazonaws.com'
      })

      vi.mocked(getAwsBedrockAuthType).mockReturnValue('apiKey' satisfies AwsBedrockAuthType)

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('anthropic.claude-v2', provider.id)
      )) as ProviderConfig<'bedrock'>

      expect(config.providerId).toBe('bedrock')
      const settings = config.providerSettings
      expect(settings.region).toBe('us-east-1')
      expect(settings.apiKey).toBe('bedrock-api-key')
    })

    it('uses accessKey auth when authType is iam', async () => {
      const provider = makeProvider({
        id: 'aws-bedrock',
        type: 'aws-bedrock',
        apiHost: 'https://bedrock.us-east-1.amazonaws.com'
      })

      vi.mocked(getAwsBedrockAuthType).mockReturnValue('iam' satisfies AwsBedrockAuthType)

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('anthropic.claude-v2', provider.id)
      )) as ProviderConfig<'bedrock'>

      expect(config.providerId).toBe('bedrock')
      const settings = config.providerSettings
      expect(settings.accessKeyId).toBe('AKID_TEST')
      expect(settings.secretAccessKey).toBe('SECRET_TEST')
    })
  })

  describe('Vertex builder', () => {
    it('routes Claude models to google-vertex-anthropic', async () => {
      const provider = makeProvider({
        id: 'vertexai',
        type: 'vertexai',
        apiHost: 'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('claude-3-5-sonnet', provider.id))

      expect(config.providerId).toBe('google-vertex-anthropic')
      const settings = config.providerSettings as GoogleVertexProviderSettings
      expect(settings.project).toBe('test-project')
      expect(settings.location).toBe('us-central1')
      expect(settings.baseURL).toContain('/publishers/anthropic/models')
    })

    it('routes non-Claude models to google-vertex', async () => {
      const provider = makeProvider({
        id: 'vertexai',
        type: 'vertexai',
        apiHost: 'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gemini-1.5-pro', provider.id))

      expect(config.providerId).toBe('google-vertex')
      const settings = config.providerSettings as GoogleVertexProviderSettings
      expect(settings.baseURL).toContain('/publishers/google')
    })

    it('throws when VertexAI is not configured', () => {
      vi.mocked(isVertexAIConfigured).mockReturnValue(false)

      const provider = makeProvider({
        id: 'vertexai',
        type: 'vertexai',
        apiHost: ''
      })

      expect(() => providerToAiSdkConfig(provider, makeModel('gemini-1.5-pro', provider.id))).toThrow(
        'VertexAI is not configured'
      )
    })
  })

  describe('Cherryin builder', () => {
    it('includes anthropic and gemini base URLs from cherryin provider config', async () => {
      const cherryinProvider = makeProvider({
        id: 'cherryin',
        type: 'openai',
        apiHost: 'https://api.cherryin.com',
        anthropicApiHost: 'https://anthropic.cherryin.com'
      })

      vi.mocked(getProviderById).mockReturnValue(cherryinProvider)

      const config = await providerToAiSdkConfig(cherryinProvider, makeModel('gpt-4', 'cherryin'))

      expect(config.providerId).toBe('cherryin')
      const settings = config.providerSettings as CherryInProviderSettings
      expect(settings.anthropicBaseURL).toBe('https://anthropic.cherryin.com/v1')
      expect(settings.geminiBaseURL).toBe('https://api.cherryin.com/v1beta')
    })
  })

  describe('NewAPI builder', () => {
    it('passes endpoint_type from model', async () => {
      const provider = makeProvider({
        id: 'new-api',
        type: 'openai',
        apiHost: 'https://api.newapi.com'
      })

      const model = makeModel('gpt-4', provider.id, { endpoint_type: 'openai-response' })

      const config = await providerToAiSdkConfig(provider, model)

      expect(config.providerId).toBe('newapi')
      const settings = config.providerSettings as NewApiProviderSettings
      expect(settings.endpointType).toBe('openai-response')
    })
  })

  describe('AiHubMix builder', () => {
    it('returns aihubmix provider config', async () => {
      const provider = makeProvider({
        id: 'aihubmix',
        type: 'openai',
        apiHost: 'https://api.aihubmix.com'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', provider.id))

      expect(config.providerId).toBe('aihubmix')
      const settings = config.providerSettings as AihubmixProviderSettings
      expect(settings.baseURL).toBeTruthy()
      expect(settings.apiKey).toBe('test-key')
    })
  })

  describe('OpenAI-compatible fallback', () => {
    it('includes includeUsage when provider supports stream options', async () => {
      setupStoreMock({ includeUsage: true })

      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/v1'
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4', provider.id)
      )) as ProviderConfig<'openai-compatible'>

      expect(config.providerId).toBe('openai-compatible')
      expect(config.providerSettings.includeUsage).toBe(true)
    })

    it('excludes includeUsage when provider opts out of stream options', async () => {
      setupStoreMock({ includeUsage: true })

      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/v1',
        apiOptions: { isNotSupportStreamOptions: true }
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4', provider.id)
      )) as ProviderConfig<'openai-compatible'>

      expect(config.providerSettings.includeUsage).toBeUndefined()
    })

    it('respects includeUsage=false from settings', async () => {
      setupStoreMock({ includeUsage: false })

      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/v1'
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4', provider.id)
      )) as ProviderConfig<'openai-compatible'>

      expect(config.providerSettings.includeUsage).toBe(false)
    })

    it('includes default app headers', async () => {
      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/v1'
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4', provider.id)
      )) as ProviderConfig<'openai-compatible'>

      const settings = config.providerSettings
      expect(settings.headers).toBeDefined()
      expect(settings.headers!['HTTP-Referer']).toBe('https://cherry-ai.com')
      expect(settings.headers!['X-Title']).toBe('Cherry Studio')
    })

    it('merges extra_headers from provider', async () => {
      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/v1',
        extra_headers: { 'X-Custom': 'custom-value' }
      })

      const config = (await providerToAiSdkConfig(
        provider,
        makeModel('gpt-4', provider.id)
      )) as ProviderConfig<'openai-compatible'>

      const settings = config.providerSettings
      expect(settings.headers).toBeDefined()
      expect(settings.headers!['X-Custom']).toBe('custom-value')
    })

    it('adds X-Api-Key header for openai provider type', async () => {
      const provider = makeProvider({
        id: 'openai',
        type: 'openai-response',
        apiHost: 'https://api.openai.com/v1',
        apiKey: 'sk-test'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', provider.id))

      const settings = config.providerSettings as OpenAICompatibleProviderSettings
      expect(settings.headers).toBeDefined()
      expect(settings.headers!['X-Api-Key']).toBe('sk-test')
    })
  })

  describe('endpoint extraction', () => {
    it('extracts endpoint from trailing sharp URLs', async () => {
      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/chat/completions#'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', provider.id))

      expect(config.endpoint).toBe('chat/completions')
    })

    it('returns empty endpoint for normal URLs', async () => {
      const provider = makeProvider({
        id: 'some-openai-compat',
        type: 'openai',
        apiHost: 'https://api.custom.com/v1'
      })

      const config = await providerToAiSdkConfig(provider, makeModel('gpt-4', provider.id))

      expect(config.endpoint).toBe('')
    })
  })
})
