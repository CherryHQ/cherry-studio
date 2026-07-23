import {
  CHERRYAI_API_BASE_URL,
  CHERRYAI_DEFAULT_MODEL_ID,
  CHERRYAI_DEFAULT_MODEL_NAME,
  CHERRYAI_DEFAULT_UNIQUE_MODEL_ID,
  CHERRYAI_PROVIDER_ID
} from '@shared/data/presets/cherryai'
import {
  LOCAL_EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_PROVIDER_ID,
  LOCAL_EMBEDDING_UNIQUE_MODEL_ID
} from '@shared/data/presets/localEmbedding'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import { type AuthConfig, DEFAULT_API_FEATURES } from '@shared/data/types/provider'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeModel } from '../../__tests__/fixtures/model'
import { makeProvider } from '../../__tests__/fixtures/provider'
import { customFetch } from '../../utils/customFetch'

// providerToAiSdkConfig reads the rotated API key and (for Vertex/Bedrock) the
// auth config off the direct-import ProviderService singleton. Mock both at the
// module boundary so the dispatch builders run without touching the DB.
const { getRotatedApiKeyMock, getAuthConfigMock, getByProviderIdMock } = vi.hoisted(() => ({
  getRotatedApiKeyMock: vi.fn<(providerId: string) => string>(),
  getAuthConfigMock: vi.fn<(providerId: string) => AuthConfig | null>(),
  getByProviderIdMock: vi.fn()
}))
const { generateSignatureMock } = vi.hoisted(() => ({
  generateSignatureMock: vi.fn()
}))

vi.mock('@main/data/services/ProviderService', () => ({
  providerService: {
    getRotatedApiKey: getRotatedApiKeyMock,
    getAuthConfig: getAuthConfigMock,
    getByProviderId: getByProviderIdMock
  }
}))

vi.mock('@main/ai/provider/cherryai', () => ({
  generateSignature: generateSignatureMock
}))

// Import the SUT after the mock is declared.
const { providerToAiSdkConfig } = await import('../config')

beforeEach(() => {
  vi.clearAllMocks()
  getRotatedApiKeyMock.mockReturnValue('sk-test-key')
  getAuthConfigMock.mockReturnValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('providerToAiSdkConfig — builder dispatch matrix', () => {
  it('uses an explicit API key override instead of the provider rotation key', async () => {
    const provider = makeProvider({ id: 'openai' })
    const model = makeModel({ id: 'openai::gpt-4o', apiModelId: 'gpt-4o', providerId: 'openai' })

    const config = await providerToAiSdkConfig(provider, model, { apiKeyOverride: 'sk-selected' })

    expect(getRotatedApiKeyMock).not.toHaveBeenCalled()
    expect((config.providerSettings as Record<string, unknown>).apiKey).toBe('sk-selected')
  })

  describe('Vertex routing (google-vertex AND google-vertex-anthropic → buildVertexConfig)', () => {
    const vertexAuth: AuthConfig = {
      type: 'iam-gcp',
      project: 'my-project',
      location: 'us-central1',
      // buildVertexConfig reads `privateKey` (camelCase) and runs it through
      // formatPrivateKey, which throws on an empty string.
      credentials: {
        client_email: 'svc@my-project.iam.gserviceaccount.com',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n'
      }
    }

    it('routes a google-vertex-anthropic endpoint to buildVertexConfig, retaining project/location/googleCredentials (REGRESSION)', async () => {
      // The active endpoint carries adapterFamily 'google-vertex-anthropic', which
      // resolveAiSdkProviderId self-maps to the same aiSdkProviderId. Without the
      // 'google-vertex-anthropic' row in the dispatch table this falls through to
      // the generic builder and silently DROPS project/location/googleCredentials.
      getAuthConfigMock.mockReturnValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex-anthropic'
          }
        }
      })
      const model = makeModel({
        id: 'vertex::claude-3-7-sonnet',
        apiModelId: 'claude-3-7-sonnet',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      // Routed to the anthropic Vertex builder, not the generic fallback.
      expect(config.providerId).toBe('google-vertex-anthropic')
      // The fixed bug: these three fields survive instead of being dropped.
      expect(settings.project).toBe('my-project')
      expect(settings.location).toBe('us-central1')
      // snake_case `client_email` (fixture) is lifted to camelCase `clientEmail`
      // so the Vertex SDK's JWT carries `iss`. Without this the auth builds a
      // JWT with iss:undefined and auth fails.
      expect(settings.googleCredentials).toMatchObject({
        clientEmail: 'svc@my-project.iam.gserviceaccount.com'
      })
      // Anthropic publisher baseURL suffix is appended by buildVertexConfig.
      expect(settings.baseURL).toBe('https://us-central1-aiplatform.googleapis.com/v1/publishers/anthropic/models')
    })

    it('routes a normal google-vertex endpoint to buildVertexConfig with the google publisher baseURL', async () => {
      getAuthConfigMock.mockReturnValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex'
          }
        }
      })
      const model = makeModel({
        id: 'vertex::gemini-2.0-flash',
        apiModelId: 'gemini-2.0-flash',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('google-vertex')
      expect(settings.project).toBe('my-project')
      expect(settings.location).toBe('us-central1')
      expect(settings.baseURL).toBe('https://us-central1-aiplatform.googleapis.com/v1/publishers/google')
    })

    it('lifts snake_case-only credentials (private_key/client_email) to camelCase clientEmail (REGRESSION)', async () => {
      // Service-account JSON stored with snake_case keys must surface as camelCase
      // `clientEmail` on googleCredentials; otherwise @ai-sdk/google-vertex/edge
      // builds a JWT with iss:undefined and auth fails.
      getAuthConfigMock.mockReturnValue({
        type: 'iam-gcp',
        project: 'my-project',
        location: 'us-central1',
        credentials: {
          client_email: 'svc@my-project.iam.gserviceaccount.com',
          private_key: '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n'
        }
      })
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex'
          }
        }
      })
      const model = makeModel({
        id: 'vertex::gemini-2.0-flash',
        apiModelId: 'gemini-2.0-flash',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(settings.googleCredentials).toMatchObject({
        clientEmail: 'svc@my-project.iam.gserviceaccount.com'
      })
    })

    it('leaves baseURL undefined when no custom host is configured, so the SDK derives the aiplatform host (REGRESSION)', async () => {
      // Standard Vertex providers leave baseUrl empty. The old code appended the publisher
      // suffix to '' → '/publishers/google', a truthy host-less URL the Vertex SDK's `?? `
      // default does NOT override, so every inference request targeted a host-less path.
      getAuthConfigMock.mockReturnValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            // No baseUrl — the common case for a standard Vertex provider.
            adapterFamily: 'google-vertex'
          }
        }
      })
      const model = makeModel({
        id: 'vertex::gemini-2.0-flash',
        apiModelId: 'gemini-2.0-flash',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('google-vertex')
      // The fix: undefined (not '' and not '/publishers/google') so the SDK auto-derives the host.
      expect(settings.baseURL).toBeUndefined()
      expect(settings.project).toBe('my-project')
      expect(settings.location).toBe('us-central1')
    })

    it('routes a MaaS (publisher-prefixed, non-Claude) Vertex model to the google-vertex-maas adapter', async () => {
      // MaaS open/partner models resolve through the default google-generate-content endpoint
      // (they carry no endpointTypes), so buildVertexConfig must distinguish them from Gemini by
      // the `{publisher}/{model}` id shape and route them to the OpenAI-compatible MaaS adapter.
      getAuthConfigMock.mockReturnValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google-vertex' }
        }
      })
      const model = makeModel({
        id: 'vertex::meta/llama-4-scout-17b-16e-instruct-maas',
        apiModelId: 'meta/llama-4-scout-17b-16e-instruct-maas'
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('google-vertex-maas')
      expect(settings.project).toBe('my-project')
      expect(settings.location).toBe('us-central1')
      expect(settings.googleCredentials).toMatchObject({
        clientEmail: 'svc@my-project.iam.gserviceaccount.com'
      })
      // No custom host configured → adapter derives the aiplatform host from project+location.
      expect(settings.baseURL).toBeUndefined()
    })

    it.each([
      'meta/llama-4-scout-17b-16e-instruct',
      'anthropic/claude-3-7-sonnet',
      'meta/catalog/llama-4-scout-17b-16e-instruct-maas'
    ])('does not route a non-MaaS slash id (%s) to the google-vertex-maas adapter', async (apiModelId) => {
      getAuthConfigMock.mockReturnValue(vertexAuth)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google-vertex' }
        }
      })
      const model = makeModel({ id: `vertex::${apiModelId}`, apiModelId })

      const config = await providerToAiSdkConfig(provider, model)

      expect(config.providerId).toBe('google-vertex')
    })

    it('throws when a Vertex-resolved provider lacks iam-gcp auth config', async () => {
      getAuthConfigMock.mockReturnValue(null)
      const provider = makeProvider({
        id: 'vertex',
        authType: 'iam-gcp',
        defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
            baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
            adapterFamily: 'google-vertex'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT] })

      await expect(providerToAiSdkConfig(provider, model)).rejects.toThrow(
        'VertexAI requires iam-gcp auth configuration.'
      )
    })
  })

  describe('Bedrock row', () => {
    it('routes a bedrock-resolved provider to buildBedrockConfig (iam-aws region/keys)', async () => {
      getAuthConfigMock.mockReturnValue({
        type: 'iam-aws',
        region: 'us-east-1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret'
      })
      const provider = makeProvider({
        id: 'bedrock',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
            adapterFamily: 'bedrock'
          }
        }
      })
      const model = makeModel({
        id: 'bedrock::claude',
        apiModelId: 'anthropic.claude-3',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('bedrock')
      expect(settings.region).toBe('us-east-1')
      expect(settings.accessKeyId).toBe('AKIA')
      expect(settings.secretAccessKey).toBe('secret')
      // getAuthConfig is consulted for bedrock credentials.
      expect(getAuthConfigMock).toHaveBeenCalledWith('bedrock')
    })

    it('passes baseURL=undefined (not "") when no host is configured, so the SDK derives the host (upstream #14425)', async () => {
      getAuthConfigMock.mockReturnValue({
        type: 'iam-aws',
        region: 'us-east-1',
        accessKeyId: 'AKIA',
        secretAccessKey: 'secret'
      })
      const provider = makeProvider({
        id: 'bedrock',
        authType: 'iam-aws',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          // No baseUrl — the SDK must NOT receive "" (it would target ""/model/...).
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'bedrock' }
        }
      })
      const model = makeModel({
        id: 'bedrock::claude',
        apiModelId: 'anthropic.claude-3',
        endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('bedrock')
      expect(settings.baseURL).toBeUndefined()
      expect(settings.region).toBe('us-east-1')
    })
  })

  describe('Azure routing (iam-azure → buildAzureConfig)', () => {
    it('routes an Azure provider with a Claude model id to azure-anthropic', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        authType: 'iam-azure',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://myres.openai.azure.com' }
        }
      })
      const model = makeModel({
        id: 'azure::claude',
        apiModelId: 'claude-3-5-sonnet',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('azure-anthropic')
      // The anthropic branch normalizes the host WITHOUT the '/openai' suffix.
      expect(settings.baseURL).not.toMatch(/\/openai$/)
    })

    it('uses the provider default endpoint to route an Azure provider to azure-anthropic', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        authType: 'iam-azure',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://myres.openai.azure.com' }
        }
      })
      const model = makeModel({
        id: 'azure::custom',
        apiModelId: 'some-anthropic-relay-model',
        endpointTypes: undefined
      })

      const config = await providerToAiSdkConfig(provider, model)
      expect(config.providerId).toBe('azure-anthropic')
    })

    it('routes an Azure provider with a regular model to azure (openai suffix)', async () => {
      const provider = makeProvider({
        id: 'azure-openai',
        authType: 'iam-azure',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://myres.openai.azure.com' }
        }
      })
      const model = makeModel({
        id: 'azure::gpt-4o',
        apiModelId: 'gpt-4o',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('azure')
      expect(settings.baseURL).toMatch(/\/openai$/)
    })
  })

  describe('CherryIn routing (default chat endpoint upgrades to cherryin-chat variant)', () => {
    it('routes the default cherryin chat endpoint to buildCherryinConfig, not the generic builder (REGRESSION)', async () => {
      // The resolver upgrades the default OpenAI chat endpoint to the `cherryin-chat` variant,
      // so the old `id === 'cherryin'` dispatch row never matched and the request fell through
      // to buildGenericProviderConfig — dropping endpointType + the relay anthropic/gemini URLs.
      getByProviderIdMock.mockReturnValue(
        makeProvider({
          id: 'cherryin',
          endpointConfigs: {
            [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://open.cherryin.net' },
            [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://open.cherryin.net' }
          }
        })
      )
      const provider = makeProvider({
        id: 'cherryin',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://open.cherryin.net',
            adapterFamily: 'cherryin'
          }
        }
      })
      const model = makeModel({
        id: 'cherryin::gpt-4o',
        apiModelId: 'gpt-4o',
        endpointTypes: undefined
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      // The variant id still flows through as the providerId so the chat transform is selected.
      expect(config.providerId).toBe('cherryin-chat')
      // buildCherryinConfig sets endpointType + relay base URLs; the generic builder would not.
      expect(settings.endpointType).toBe('openai')
      expect(settings.anthropicBaseURL).toBeDefined()
      expect(settings.geminiBaseURL).toBeDefined()
    })

    it('routes a CherryIn google-generate-content model (e.g. nano-banana image) to the cherryin extension, not openai-compatible (REGRESSION)', async () => {
      // CherryIN relays its Google models via Gemini's native `generateContent`; its
      // registry declares `google-generate-content` → adapterFamily 'cherryin'.
      // Without that declaration the endpoint fell through to `openai-compatible`,
      // whose image model POSTs edits to `/v1/images/edits` — which CherryIN serves
      // only for imagen (500 "only imagen models supported"). The declaration routes
      // it to the cherryin extension so createImageModel() drives editing through
      // `generateContent`.
      const cherryinEndpointConfigs = {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' },
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' }
      }
      getByProviderIdMock.mockReturnValue(makeProvider({ id: 'cherryin', endpointConfigs: cherryinEndpointConfigs }))
      const provider = makeProvider({
        id: 'cherryin',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: cherryinEndpointConfigs
      })
      const model = makeModel({
        providerId: 'cherryin',
        apiModelId: 'google/gemini-3.1-flash-image-preview',
        endpointTypes: [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT],
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION]
      })

      const config = await providerToAiSdkConfig(provider, model)
      expect(config.providerId).toBe('cherryin')
    })

    it('leaves a CherryIn image model on an undeclared endpoint (e.g. imagen via openai-image-generation) on openai-compatible', async () => {
      // Only `google-generate-content` (Gemini) is declared. An imagen model reports
      // `openai-image-generation`, which stays undeclared → resolveAiSdkProviderId
      // returns openai-compatible, keeping imagen on its working `/v1/images/*` path.
      getByProviderIdMock.mockReturnValue(makeProvider({ id: 'cherryin', endpointConfigs: {} }))
      const provider = makeProvider({
        id: 'cherryin',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://open.cherryin.net', adapterFamily: 'cherryin' }
        }
      })
      const model = makeModel({
        providerId: 'cherryin',
        apiModelId: 'imagen-4.0-generate-001',
        endpointTypes: [ENDPOINT_TYPE.OPENAI_IMAGE_GENERATION],
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION]
      })

      const config = await providerToAiSdkConfig(provider, model)
      expect(config.providerId).toBe('openai-compatible')
    })

    it('routes a preset-derived CherryIN instance (custom host) through buildCherryinConfig with ITS OWN relay base URLs (REGRESSION)', async () => {
      // A user-created / enterprise CherryIN instance: UUID id, presetProviderId
      // 'cherryin', custom host. `matchesPreset` (not a bare `id === 'cherryin'`)
      // must still dispatch to buildCherryinConfig, and its gemini/anthropic base
      // URLs must come from THIS instance — reading the hardcoded preset would send
      // the request to open.cherryin.net instead of the enterprise host.
      const host = 'https://express-ent-admin.cherryin.ai'
      const provider = makeProvider({
        id: 'aa1dff45-uuid',
        presetProviderId: 'cherryin',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: host, adapterFamily: 'cherryin' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { baseUrl: `${host}/v1`, adapterFamily: 'cherryin' },
          [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { baseUrl: `${host}/v1beta`, adapterFamily: 'cherryin' }
        }
      })
      // Gemini image model with EMPTY endpointTypes (how the instance's models are
      // stored) → falls back to the chat endpoint → cherryin-chat variant;
      // createImageModel still dispatches gemini→generateContent by model id.
      const model = makeModel({
        providerId: 'aa1dff45-uuid',
        apiModelId: 'google/gemini-3.1-flash-image-preview',
        endpointTypes: undefined,
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('cherryin-chat')
      // The fix: relay base URLs come from THIS instance, not open.cherryin.net.
      expect(settings.geminiBaseURL).toBe(`${host}/v1beta`)
      expect(settings.anthropicBaseURL).toBe(`${host}/v1`)
    })
  })

  describe('CherryAI routing', () => {
    it('uses custom fetch to sign chat completions requests', async () => {
      getRotatedApiKeyMock.mockReturnValue('')
      generateSignatureMock.mockReturnValue({
        'X-Client-ID': 'cherry-studio',
        'X-Timestamp': '1700000000',
        'X-Signature': 'signed'
      })
      // The signing wrapper composes onto customFetch (net.fetch), so the request
      // routes through Chromium's proxy-aware network stack rather than globalThis.fetch.
      vi.mocked(net.fetch).mockResolvedValue(new Response('{}'))

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
      await (config.providerSettings as { fetch: typeof fetch }).fetch(`${CHERRYAI_API_BASE_URL}/chat/completions`, {
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
      expect(net.fetch).toHaveBeenCalledWith(
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

  describe('Local embedding routing (in-process provider, no endpoint/baseURL/apiKey)', () => {
    it('routes the local embedding provider to its own provider id instead of the openai-compatible fallback (REGRESSION)', async () => {
      // The local embedding provider has no endpoint config, so resolveAiSdkProviderId
      // returns 'openai-compatible'. Without the dedicated dispatch row it would fall
      // through to buildOpenAICompatibleConfig, which hands ai-core an empty baseURL and
      // throws "Invalid URL". The id-based row must win and produce empty providerSettings.
      const provider = makeProvider({
        id: LOCAL_EMBEDDING_PROVIDER_ID,
        presetProviderId: LOCAL_EMBEDDING_PROVIDER_ID,
        // Mirrors the registered row: in-process runtime, no endpoints.
        endpointConfigs: {}
      })
      const model = makeModel({
        id: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
        providerId: LOCAL_EMBEDDING_PROVIDER_ID,
        apiModelId: LOCAL_EMBEDDING_MODEL_ID,
        capabilities: [MODEL_CAPABILITY.EMBEDDING]
      })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe(LOCAL_EMBEDDING_PROVIDER_ID)
      // The local builder returns empty providerSettings: no baseURL/apiKey leak from the
      // openai-compatible builder (the rotated key is fetched but deliberately discarded).
      expect(settings.baseURL).toBeUndefined()
      expect(settings.apiKey).toBeUndefined()
      // Still defaulted to the proxy-aware fetch by the shared tail of providerToAiSdkConfig.
      expect(settings.fetch).toBe(customFetch)
    })
  })

  describe('generic / openai-compatible fallback', () => {
    it('routes DashScope openai-compatible endpoints through DashScope config and preserves stream usage support', async () => {
      const provider = makeProvider({
        id: 'dashscope',
        apiFeatures: { ...DEFAULT_API_FEATURES, streamOptions: true },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
          }
        }
      })
      const model = makeModel({ providerId: 'dashscope', endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('dashscope')
      expect(settings.includeUsage).toBe(true)
      expect(settings.apiKey).toBe('sk-test-key')
      expect(settings.name).toBeUndefined()
      // A builder that installs no fetch of its own must default to the proxy-aware customFetch
      // (the `settings.fetch ??= customFetch` in providerToAiSdkConfig — the point of this path).
      expect(settings.fetch).toBe(customFetch)
    })

    it('routes ModelScope IMAGE models through ModelScope config (so the async submit/poll transport is used)', async () => {
      // modelscope chat declares adapterFamily 'openai-compatible', and an image model
      // resolves to that same fallback id — the override must force providerId 'modelscope'
      // so createModelscopeProvider().imageModel() (the X-ModelScope-Async-Mode submit/poll
      // transport) is used instead of the generic OpenAICompatibleImageModel (which would
      // hit the non-existent /v1/images/edits → 404).
      const provider = makeProvider({
        id: 'modelscope',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api-inference.modelscope.cn/v1/',
            adapterFamily: 'openai-compatible'
          }
        }
      })
      const model = makeModel({ providerId: 'modelscope', capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('modelscope')
      expect(settings.apiKey).toBe('sk-test-key')
    })

    it('leaves ModelScope CHAT models on openai-compatible (image-only override; keeps includeUsage)', async () => {
      const provider = makeProvider({
        id: 'modelscope',
        apiFeatures: { ...DEFAULT_API_FEATURES, streamOptions: true },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api-inference.modelscope.cn/v1/',
            adapterFamily: 'openai-compatible'
          }
        }
      })
      // No image-generation capability → a chat model.
      const model = makeModel({ providerId: 'modelscope', endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('openai-compatible')
      expect(settings.includeUsage).toBe(true)
    })

    it('routes PPIO IMAGE models through PPIO config', async () => {
      const provider = makeProvider({
        id: 'ppio',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.ppinfra.com/v3/openai/',
            adapterFamily: 'openai-compatible'
          }
        }
      })
      const model = makeModel({ providerId: 'ppio', capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION] })

      const config = await providerToAiSdkConfig(provider, model)
      expect(config.providerId).toBe('ppio')
    })

    it('routes DMXAPI bespoke-family IMAGE models (e.g. qwen-image) through DMXAPI config', async () => {
      const provider = makeProvider({
        id: 'dmxapi',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://www.dmxapi.cn',
            adapterFamily: 'openai-compatible'
          }
        }
      })
      const model = makeModel({
        providerId: 'dmxapi',
        apiModelId: 'qwen-image',
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION]
      })

      const config = await providerToAiSdkConfig(provider, model)
      expect(config.providerId).toBe('dmxapi')
    })

    it('keeps DMXAPI native IMAGE models (gpt-image / dall-e / imagen) on openai-compatible (unchanged path)', async () => {
      const provider = makeProvider({
        id: 'dmxapi',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://www.dmxapi.cn',
            adapterFamily: 'openai-compatible'
          }
        }
      })
      const model = makeModel({
        providerId: 'dmxapi',
        apiModelId: 'gpt-image-1',
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION]
      })

      const config = await providerToAiSdkConfig(provider, model)
      expect(config.providerId).toBe('openai-compatible')
    })

    it('falls back to buildOpenAICompatibleConfig for an unknown openai-compatible provider', async () => {
      // No adapterFamily → resolveAiSdkProviderId returns 'openai-compatible',
      // which matches no builder row and is excluded from the generic branch.
      const provider = makeProvider({
        id: 'some-relay',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://relay.example.com/v1'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

      const config = await providerToAiSdkConfig(provider, model)
      const settings = config.providerSettings as Record<string, unknown>

      expect(config.providerId).toBe('openai-compatible')
      expect(settings.name).toBe('some-relay')
      expect(settings.apiKey).toBe('sk-test-key')
      // No Vertex leakage into the generic fallback.
      expect(settings.project).toBeUndefined()
      expect(settings.location).toBeUndefined()
      expect(settings.googleCredentials).toBeUndefined()
    })

    it('routes a core-registered adapter (deepseek) to buildGenericProviderConfig', async () => {
      // deepseek has a registered ai-core provider config (hasProviderConfig true)
      // and is not 'openai-compatible', so it takes the generic branch — not the
      // openai-compatible fallback — and the config providerId stays 'deepseek'.
      const provider = makeProvider({
        id: 'deepseek',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
            baseUrl: 'https://api.deepseek.com/v1',
            adapterFamily: 'deepseek'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS] })

      const config = await providerToAiSdkConfig(provider, model)

      expect(config.providerId).toBe('deepseek')
      expect((config.providerSettings as Record<string, unknown>).apiKey).toBe('sk-test-key')
    })
  })

  describe('NewAPI builder', () => {
    it('uses the provider default anthropic endpoint when the model has no endpoint types', async () => {
      const provider = makeProvider({
        id: 'my-newapi',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
            baseUrl: 'https://api.newapi.com/v1',
            adapterFamily: 'newapi'
          },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
            baseUrl: 'https://api.newapi.com/anthropic',
            adapterFamily: 'newapi'
          }
        }
      })
      const model = makeModel({ endpointTypes: undefined })

      const config = await providerToAiSdkConfig(provider, model)

      expect(config.providerId).toBe('newapi')
      const settings = config.providerSettings as Record<string, unknown>
      expect(settings.baseURL).toBe('https://api.newapi.com/anthropic')
    })

    it('falls back to default endpoint baseURL when anthropic endpointConfig has no baseUrl', async () => {
      const provider = makeProvider({
        id: 'my-newapi',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
            baseUrl: 'https://api.newapi.com/v1',
            adapterFamily: 'newapi'
          }
        }
      })
      const model = makeModel({ endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES] })

      const config = await providerToAiSdkConfig(provider, model)

      const settings = config.providerSettings as Record<string, unknown>
      expect(settings.baseURL).toBe('https://api.newapi.com/v1')
    })
  })
})
