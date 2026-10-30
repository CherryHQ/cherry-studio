import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { normalizeContext } from '@earendil-works/pi-ai'
import type { Api as PiApi, Model as PiModel } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { ReasoningWireProfile } from '@cherrystudio/provider-registry'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import type * as AgentApiGateway from '@main/ai/runtime/agentApiGateway'
import { CHERRY_CLOUD_MODEL_GROUP, CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const serviceMocks = vi.hoisted(() => ({
  getByProviderId: vi.fn(),
  getApiKeys: vi.fn(),
  resolveApiKey: vi.fn(),
  getByKey: vi.fn(),
  hasToken: vi.fn(),
  getCurrentConfig: vi.fn(() => ({ enabled: true })),
  resolveApiGatewayRuntime: vi.fn()
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    getByProviderId: serviceMocks.getByProviderId,
    getApiKeys: serviceMocks.getApiKeys,
    resolveApiKey: serviceMocks.resolveApiKey
  }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: serviceMocks.getByKey } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    OAuthRuntimeService: { hasToken: serviceMocks.hasToken },
    ApiGatewayService: { getCurrentConfig: serviceMocks.getCurrentConfig }
  } as never)
})
vi.mock('@main/ai/runtime/agentApiGateway', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentApiGateway>()),
  resolveApiGatewayRuntime: serviceMocks.resolveApiGatewayRuntime
}))

import {
  assertPiProviderUsable,
  buildPiGatewayInjection,
  buildPiProviderInjection,
  materializePiProviderStream,
  PI_PLACEHOLDER_API_KEY,
  PiMissingApiKeyError,
  PiUnsupportedProviderError,
  resolvePiProviderInjection,
  resolvePiProviderInjectionForSession,
  resolvePiProviderInjectionFromSnapshot
} from './modelInjection'

const REAL_KEY = 'sk-cherry-secret-key'
const GATEWAY_KEY = 'cs-sk-local-gateway'
const GATEWAY_USAGE_HEADERS = {
  'x-cherry-agent-session-id': 'session-1',
  'x-cherry-internal-usage-token': 'usage-token'
}
const GATEWAY = {
  baseUrl: 'http://127.0.0.1:23333',
  apiKey: GATEWAY_KEY,
  usageHeaders: GATEWAY_USAGE_HEADERS
}

function makeProvider(
  overrides: Omit<Partial<Provider>, 'presetProviderId'> & { presetProviderId?: string | null }
): Provider {
  return {
    id: 'p',
    name: 'P',
    reportsActualCost: false,
    ...overrides
  } as Provider
}

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [],
    contextWindow: 128_000,
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

beforeEach(() => {
  const getPath = vi.mocked(application.getPath).getMockImplementation()
  vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
    key === 'feature.provider_registry.data' && filename
      ? resolve(process.cwd(), 'packages/provider-registry/data', filename)
      : key === 'app.root'
        ? resolve(process.cwd(), filename ?? '')
        : (getPath?.(key, filename) ?? `/mock/${key}`)
  )
  providerRegistryService.clearCache()
})

afterEach(() => {
  vi.restoreAllMocks()
  providerRegistryService.clearCache()
})

describe('buildPiProviderInjection', () => {
  it('maps an Anthropic provider', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
      }
    })
    const model = makeModel({ id: 'anthropic::claude', apiModelId: 'claude-sonnet-4', contextWindow: 200_000 })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerName).toBe('anthropic')
    expect(injection.modelId).toBe('claude-sonnet-4')
    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.baseUrl).toBe('https://api.anthropic.com')
    expect(injection.providerConfig.models?.[0]?.id).toBe('claude-sonnet-4')
    expect(injection.providerConfig.models?.[0]?.contextWindow).toBe(200_000)
  })

  it('preserves empty thinking signatures for CherryIN Anthropic-compatible models', () => {
    const provider = makeProvider({
      id: 'cherryin',
      name: 'CherryIN',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' },
        'openai-chat-completions': { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' }
      }
    })
    const model = makeModel({
      id: 'cherryin::agent/deepseek-v4-flash',
      apiModelId: 'agent/deepseek-v4-flash',
      capabilities: ['function-call', 'reasoning'],
      endpointTypes: ['anthropic-messages', 'openai-chat-completions']
    })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.models?.[0]?.compat).toEqual({ allowEmptySignature: true })
  })

  it('prefers Anthropic Messages when a Pi model also supports OpenAI Chat', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://gateway.example.com' },
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://gateway.example.com' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-chat-completions', 'anthropic-messages'] })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.baseUrl).toBe('https://gateway.example.com')
  })

  it('does not prefer Anthropic Messages for other endpoint combinations', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: {
        'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://gateway.example.com' },
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://gateway.example.com' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-responses', 'anthropic-messages'] })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('openai-responses')
  })

  it('routes a model-level Responses hint through a custom provider Responses base URL', () => {
    const provider = makeProvider({
      id: 'custom-provider',
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: {
        'openai-responses': { baseUrl: 'https://express-ent-admin.cherryin.net/v1' }
      }
    })
    const model = makeModel({
      id: 'custom-provider::openai/gpt-6-astra',
      apiModelId: 'openai/gpt-6-astra',
      endpointTypes: ['openai-responses']
    })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('openai-responses')
    expect(injection.providerConfig.baseUrl).toBe('https://express-ent-admin.cherryin.net/v1')
  })

  it('keeps OpenAI Chat when the provider has no Anthropic endpoint configuration', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://gateway.example.com' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-chat-completions', 'anthropic-messages'] })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('openai-completions')
  })

  it('maps an OpenAI-compatible provider (chat-completions)', () => {
    const provider = makeProvider({
      id: 'deepseek',
      name: 'DeepSeek',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'deepseek', baseUrl: 'https://api.deepseek.com' }
      }
    })
    const model = makeModel({ id: 'deepseek::chat', apiModelId: 'deepseek-chat' })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('openai-completions')
    expect(injection.providerConfig.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(injection.modelId).toBe('deepseek-chat')
  })

  it('maps a Gemini provider', () => {
    const provider = makeProvider({
      id: 'gemini',
      name: 'Gemini',
      defaultChatEndpoint: 'google-generate-content',
      endpointConfigs: {
        'google-generate-content': {
          adapterFamily: 'google',
          baseUrl: 'https://generativelanguage.googleapis.com'
        }
      }
    })
    const model = makeModel({ id: 'gemini::pro', apiModelId: 'gemini-2.5-pro' })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('google-generative-ai')
    expect(injection.providerConfig.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('materializes a Google stream that preserves tool signatures behind a dispatch alias (#22810)', async () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'google-generate-content',
      endpointConfigs: {
        'google-generate-content': { adapterFamily: 'google', baseUrl: 'https://gemini.test' }
      }
    })
    const injection = buildPiProviderInjection(
      provider,
      makeModel({ apiModelId: 'gemini-4-argon', capabilities: ['function-call'] }),
      'fixture-only'
    )
    const { streamSimple } = await materializePiProviderStream(injection)
    const target = {
      ...injection.providerConfig.models![0],
      api: 'cherry-fixture-google-generative-ai',
      provider: 'p:fixture-connection',
      baseUrl: injection.providerConfig.baseUrl
    } as PiModel<PiApi>
    const signature = Buffer.from('fixture-signature').toString('base64')
    const history = normalizeContext({ messages: [{ role: 'user', content: 'Read fixture.', timestamp: 1 }] })
    const requests: Array<{ contents: Array<{ parts: Array<Record<string, unknown>> }> }> = []
    const options = {
      apiKey: 'fixture-only',
      maxRetries: 0,
      fetch: async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        const parts =
          requests.length === 1
            ? [{ functionCall: { id: 'call_a', name: 'read', args: {} }, thoughtSignature: signature }]
            : [{ text: 'complete' }]
        return new Response(
          `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
    }
    const first = await streamSimple(target, history, options).result()
    history.messages.push(first, {
      role: 'toolResult',
      toolCallId: 'call_a',
      toolName: 'read',
      content: [{ type: 'text', text: 'fixture content' }],
      isError: false,
      timestamp: 3
    })
    const second = await streamSimple(target, history, options).result()

    expect(second.stopReason).toBe('stop')
    expect(requests[1].contents.flatMap((content) => content.parts)).toContainEqual({
      functionCall: { id: 'call_a', name: 'read', args: {} },
      thoughtSignature: signature
    })
    expect(target.api).toBe('cherry-fixture-google-generative-ai')
  })

  it.each([
    ['openai-chat-completions', 'openai-completions', 'https://open.cherryin.net/v1'],
    ['openai-responses', 'openai-responses', 'https://open.cherryin.net/v1'],
    ['google-generate-content', 'google-generative-ai', 'https://open.cherryin.net/v1beta'],
    ['anthropic-messages', 'anthropic-messages', 'https://open.cherryin.net']
  ] as const)('formats the CherryIN %s base URL for pi', (endpointType, expectedApi, expectedBaseUrl) => {
    const provider = makeProvider({
      id: 'cherryin',
      name: 'CherryIN',
      defaultChatEndpoint: endpointType,
      endpointConfigs: {
        [endpointType]: { adapterFamily: 'cherryin', baseUrl: 'https://open.cherryin.net' }
      }
    })
    const model = makeModel({ endpointTypes: [endpointType] })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe(expectedApi)
    expect(injection.providerConfig.baseUrl).toBe(expectedBaseUrl)
  })

  it.each([
    ['openai-chat-completions', 'openai-completions'],
    ['openai-responses', 'openai-responses']
  ] as const)('maps the endpoint developer-role dialect for %s', (endpointType, expectedApi) => {
    const endpointConfigs = {
      [endpointType]: { adapterFamily: 'openai-compatible', baseUrl: 'https://gateway.example.com' }
    }
    const model = makeModel({ endpointTypes: [endpointType], capabilities: ['reasoning'] })

    const unsupported = buildPiProviderInjection(
      makeProvider({ defaultChatEndpoint: endpointType, endpointConfigs }),
      model,
      REAL_KEY
    )
    const supported = buildPiProviderInjection(
      makeProvider({
        defaultChatEndpoint: endpointType,
        endpointConfigs: {
          [endpointType]: { ...endpointConfigs[endpointType], dialect: { developerRole: true } }
        }
      }),
      model,
      REAL_KEY
    )

    expect(unsupported.providerConfig.api).toBe(expectedApi)
    expect(unsupported.providerConfig.models?.[0]?.compat).toEqual({ supportsDeveloperRole: false })
    expect(supported.providerConfig.models?.[0]?.compat).toEqual({ supportsDeveloperRole: true })
  })

  it('maps Azure OpenAI through its responses endpoint (non-4-family)', () => {
    const provider = makeProvider({
      id: 'azure-openai',
      name: 'Azure OpenAI',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'azure', baseUrl: 'https://x.openai.azure.com' },
        'openai-responses': { adapterFamily: 'azure-responses', baseUrl: 'https://x.openai.azure.com' }
      }
    })
    // Model must pick the responses endpoint; the Azure chat-completions
    // endpoint has no pi mapping.
    const model = makeModel({
      id: 'azure-openai::gpt',
      apiModelId: 'gpt-4o',
      endpointTypes: ['openai-responses']
    })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.providerConfig.api).toBe('azure-openai-responses')
    expect(injection.providerConfig.baseUrl).toBe('https://x.openai.azure.com')
  })

  it('preserves provider headers and Azure API version request configuration', () => {
    const provider = makeProvider({
      id: 'azure-openai',
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: {
        'openai-responses': { adapterFamily: 'azure-responses', baseUrl: 'https://x.openai.azure.com' }
      },
      settings: { extraHeaders: { 'x-tenant': 'tenant-1' }, apiVersion: '2025-04-01-preview' }
    })
    const injection = buildPiProviderInjection(provider, makeModel({ endpointTypes: ['openai-responses'] }), REAL_KEY)

    expect(injection.providerConfig.headers).toEqual({ 'x-tenant': 'tenant-1' })
    expect(injection.requestEnvironment).toEqual({ AZURE_OPENAI_API_VERSION: '2025-04-01-preview' })
  })

  it('adds stable TokenDance app attribution', () => {
    const provider = makeProvider({
      id: 'tokendance',
      presetProviderId: 'tokendance',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': {
          adapterFamily: 'openai-compatible',
          baseUrl: 'https://tokendance.space/gateway'
        }
      },
      settings: { extraHeaders: { 'x-app-url': 'https://wrong.example', 'x-trace': 'on' } }
    })

    const injection = buildPiProviderInjection(provider, makeModel({ apiModelId: 'gpt-5' }), REAL_KEY)

    expect(injection.providerConfig.headers).toEqual({
      'x-trace': 'on',
      'X-App-URL': 'app://cherryai.com.cn'
    })
  })

  it('hands pi header values it resolves back to the literals the user typed', async () => {
    const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent')
    const provider = makeProvider({
      id: 'p',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: { 'openai-chat-completions': { baseUrl: 'https://example.com/v1' } },
      settings: {
        extraHeaders: {
          'x-token': 'a$b${HOME}',
          'x-command': '!echo pwned',
          // A non-string survives from v1 settings and from `String()`-less API writes.
          'x-legacy': 42 as unknown as string
        }
      }
    })
    const injection = buildPiProviderInjection(provider, makeModel({ apiModelId: 'm' }), REAL_KEY)

    const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai')
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    await runtime.setRuntimeApiKey('p', injection.apiKey)
    const registry = new ModelRegistry(runtime)
    registry.registerProvider('p', injection.providerConfig)
    const auth = await registry.getApiKeyAndHeaders(registry.find('p', injection.modelId)!)

    expect(auth).toMatchObject({
      ok: true,
      headers: { 'x-token': 'a$b${HOME}', 'x-command': '!echo pwned', 'x-legacy': '42' }
    })
  })

  it('uses the gateway per-model route for both API family and base URL', () => {
    const provider = makeProvider({
      id: 'aihubmix',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'aihubmix', baseUrl: 'https://aihubmix.com/v1' },
        'anthropic-messages': { adapterFamily: 'aihubmix', baseUrl: 'https://aihubmix.com' }
      }
    })
    const injection = buildPiProviderInjection(
      provider,
      makeModel({ id: 'aihubmix::claude-sonnet-4', apiModelId: 'claude-sonnet-4' }),
      REAL_KEY
    )

    expect(injection.providerConfig.api).toBe('anthropic-messages')
    expect(injection.providerConfig.baseUrl).toBe('https://aihubmix.com')
  })

  it('returns the real key separately and only a placeholder in the config', () => {
    const provider = makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    const injection = buildPiProviderInjection(provider, makeModel({}), REAL_KEY)

    expect(injection.apiKey).toBe(REAL_KEY)
    expect(injection.providerConfig.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(injection.providerConfig.apiKey).not.toBe(REAL_KEY)
    expect(injection.providerConfig.authHeader).toBeUndefined()
    expect(injection.usageCapture).toMatchObject({
      owner: 'agent-sdk',
      providerId: 'anthropic',
      credentialReceipt: { attribution: 'unknown' }
    })
  })

  it('freezes the selected key receipt and model aliases for invocation accounting', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    const model = makeModel({ id: 'anthropic::claude', apiModelId: 'claude-sonnet-4', name: 'Sonnet' })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY, {
      attribution: 'matched',
      id: 'key-1',
      label: 'Primary',
      masked: 'sk-****'
    })

    expect(injection.usageCapture).toEqual({
      owner: 'agent-sdk',
      credentialReceipt: { attribution: 'matched', id: 'key-1', label: 'Primary', masked: 'sk-****' },
      providerId: 'anthropic',
      providerName: 'Anthropic',
      source: null,
      frozenModels: [
        {
          modelId: 'anthropic::claude',
          apiModelId: 'claude-sonnet-4',
          modelName: 'Sonnet',
          aliases: ['anthropic::claude', 'claude-sonnet-4'],
          pricingSnapshot: null
        }
      ]
    })
    expect(JSON.stringify(injection.usageCapture)).not.toContain(REAL_KEY)
  })

  it('uses the raw wire id when apiModelId is absent', () => {
    const provider = makeProvider({
      id: 'anthropic',
      name: 'Anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    const model = makeModel({ id: 'anthropic::claude-sonnet-4', apiModelId: undefined })

    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.modelId).toBe('claude-sonnet-4')
    expect(injection.providerConfig.models?.[0]?.id).toBe('claude-sonnet-4')
    expect(injection.usageCapture.frozenModels[0].aliases).toEqual(['anthropic::claude-sonnet-4', 'claude-sonnet-4'])
  })

  it('derives image input support from capabilities', () => {
    const provider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://api.openai.com' } }
    })
    const textOnly = buildPiProviderInjection(provider, makeModel({}), REAL_KEY)
    expect(textOnly.providerConfig.models?.[0]?.input).toEqual(['text'])

    const multimodal = buildPiProviderInjection(provider, makeModel({ capabilities: ['image-recognition'] }), REAL_KEY)
    expect(multimodal.providerConfig.models?.[0]?.input).toEqual(['text', 'image'])
  })

  it('throws PiMissingApiKeyError when Cherry has no usable key', () => {
    const provider = makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })

    expect(() => buildPiProviderInjection(provider, makeModel({}), '   ')).toThrow(PiMissingApiKeyError)
  })

  it('falls back to the default context window when the model declares none', () => {
    const provider = makeProvider({
      id: 'anthropic',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })

    const injection = buildPiProviderInjection(provider, makeModel({ contextWindow: undefined }), REAL_KEY)
    expect(injection.providerConfig.models?.[0].contextWindow).toBe(256_000)
  })

  it('throws PiUnsupportedProviderError for a provider with no pi mapping', () => {
    const provider = makeProvider({
      id: 'ollama',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama', baseUrl: 'http://localhost:11434' } }
    })

    expect(() => buildPiProviderInjection(provider, makeModel({}), REAL_KEY)).toThrow(PiUnsupportedProviderError)
  })

  it('attaches a transport adapter for an app-managed-OAuth provider and keeps the placeholder key', () => {
    const provider = makeProvider({
      id: 'grok-cli',
      name: 'Grok CLI',
      authMethods: ['oauth'],
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily: 'grok', baseUrl: 'https://cli-chat-proxy.grok.com/v1' } }
    })
    // The connect-time key is only the placeholder; the real token comes from the adapter per call.
    const injection = buildPiProviderInjection(
      provider,
      makeModel({ id: 'grok-cli::grok-build', apiModelId: 'grok-build' }),
      PI_PLACEHOLDER_API_KEY
    )

    expect(injection.transportAdapter).toBeDefined()
    expect(injection.providerConfig.api).toBe('openai-responses')
    expect(injection.providerConfig.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(injection.modelId).toBe('grok-build')
    expect(injection.usageCapture.credentialReceipt).toEqual({ attribution: 'auth', method: 'oauth' })
  })

  it('keeps the unversioned ChatGPT Codex base URL', () => {
    const provider = makeProvider({
      id: 'openai-codex',
      name: 'OpenAI Codex',
      authMethods: ['oauth'],
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: {
        'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://chatgpt.com/backend-api/codex' }
      }
    })
    const injection = buildPiProviderInjection(
      provider,
      makeModel({ id: 'openai-codex::gpt-5-6-luna', apiModelId: 'gpt-5.6-luna' }),
      PI_PLACEHOLDER_API_KEY
    )

    expect(injection.providerConfig.baseUrl).toBe('https://chatgpt.com/backend-api/codex')
  })

  it('throws PiUnsupportedProviderError for a login-based external-CLI provider even with no key', () => {
    // Unsupported beats missing-key: claude-code has no adapter and no app-side key by design.
    const provider = makeProvider({
      id: 'claude-code',
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })

    expect(() => buildPiProviderInjection(provider, makeModel({}), '')).toThrow(PiUnsupportedProviderError)
  })
})

describe('OpenCode Pi session headers', () => {
  beforeEach(() => {
    serviceMocks.resolveApiKey.mockReturnValue({ value: REAL_KEY })
  })
  afterEach(() => {
    serviceMocks.resolveApiKey.mockReset()
  })

  const provider = makeProvider({
    id: 'opencode',
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: {
      'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://opencode.ai/zen/v1' },
      'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://opencode.ai/zen/v1' }
    }
  })

  it.each(['openai-chat-completions', 'openai-responses'] as const)(
    'keeps the session header stable and isolates sessions for %s',
    async (endpoint) => {
      const selectedProvider = { ...provider, defaultChatEndpoint: endpoint }
      const model = makeModel({ providerId: provider.id, endpointTypes: [endpoint] })
      const first = await resolvePiProviderInjectionForSession('session-1', selectedProvider, model)
      const repeated = await resolvePiProviderInjectionForSession('session-1', selectedProvider, model)
      const second = await resolvePiProviderInjectionForSession('session-2', selectedProvider, model)

      expect(first.api).toBe(endpoint === 'openai-responses' ? 'openai-responses' : 'openai-completions')
      expect(first.providerConfig.headers).toEqual({ 'x-opencode-session': 'session-1' })
      expect(repeated.providerConfig.headers).toEqual(first.providerConfig.headers)
      expect(second.providerConfig.headers).toEqual({ 'x-opencode-session': 'session-2' })
    }
  )

  it('recognizes providers created from the OpenCode preset', async () => {
    const customProvider = { ...provider, id: 'my-console', presetProviderId: 'opencode' }
    const injection = await resolvePiProviderInjectionForSession('session-1', customProvider, makeModel({}))

    expect(injection.providerConfig.headers).toEqual({ 'x-opencode-session': 'session-1' })
  })

  it('preserves an explicit session header regardless of its casing', async () => {
    const configured = {
      ...provider,
      settings: { extraHeaders: { 'X-OpenCode-Session': 'chosen-session', 'x-tenant': 'tenant-1' } }
    }
    const injection = await resolvePiProviderInjectionForSession('session-1', configured, makeModel({}))

    expect(injection.providerConfig.headers).toEqual({
      'X-OpenCode-Session': 'chosen-session',
      'x-tenant': 'tenant-1'
    })
  })

  it('keeps session and custom header values literal for Pi', async () => {
    const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent')
    const configured = { ...provider, settings: { extraHeaders: { 'x-tenant': 'a$b' } } }
    const injection = await resolvePiProviderInjectionForSession('!session$1', configured, makeModel({}))
    const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai')
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    await runtime.setRuntimeApiKey(provider.id, injection.apiKey)
    const registry = new ModelRegistry(runtime)
    registry.registerProvider(provider.id, injection.providerConfig)
    const auth = await registry.getApiKeyAndHeaders(registry.find(provider.id, injection.modelId)!)

    expect(auth).toMatchObject({
      ok: true,
      headers: { 'x-opencode-session': '!session$1', 'x-tenant': 'a$b' }
    })
  })

  it('does not add an OpenCode session header to unrelated providers', async () => {
    const otherProvider = { ...provider, id: 'other', settings: { extraHeaders: { 'x-tenant': 'tenant-1' } } }
    const injection = await resolvePiProviderInjectionForSession('session-1', otherProvider, makeModel({}))

    expect(injection.providerConfig.headers).toEqual({ 'x-tenant': 'tenant-1' })
  })
})

describe('Cherry Cloud Pi injection', () => {
  const provider = makeProvider({
    id: CHERRY_CLOUD_PROVIDER_ID,
    name: 'CherryAI',
    defaultChatEndpoint: 'anthropic-messages',
    endpointConfigs: {
      'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://cloud.cherryai.com.cn' }
    }
  })
  const model = makeModel({
    id: `${CHERRY_CLOUD_PROVIDER_ID}::deepseek-free`,
    providerId: CHERRY_CLOUD_PROVIDER_ID,
    apiModelId: 'deepseek-free',
    group: CHERRY_CLOUD_MODEL_GROUP,
    endpointTypes: ['anthropic-messages'],
    contextWindow: 128_000,
    maxOutputTokens: 8_192
  })

  it('routes Anthropic Messages through the local gateway without a provider key', () => {
    const injection = buildPiGatewayInjection(provider, model, GATEWAY)

    expect(injection.api).toBe('anthropic-messages')
    expect(injection.providerConfig.baseUrl).toBe('http://127.0.0.1:23333')
    expect(injection.providerConfig.headers).toEqual(GATEWAY_USAGE_HEADERS)
    expect(injection.providerConfig.models?.[0]).toMatchObject({
      id: 'cherryai-subscription:deepseek-free',
      contextWindow: 128_000,
      maxTokens: 8_192
    })
    expect(injection.apiKey).toBe(GATEWAY_KEY)
    expect(injection.usageCapture).toEqual({ owner: 'provider-calls' })
  })

  it('requires the enabled local gateway before materializing the Cloud route', async () => {
    serviceMocks.resolveApiGatewayRuntime.mockResolvedValue(GATEWAY)

    await expect(resolvePiProviderInjectionForSession('session-1', provider, model)).resolves.toMatchObject({
      modelId: 'cherryai-subscription:deepseek-free',
      apiKey: GATEWAY_KEY
    })
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()
  })
})

describe('Pi gateway fallback', () => {
  const provider = makeProvider({
    id: 'azure',
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: { 'openai-chat-completions': { adapterFamily: 'azure', baseUrl: 'https://azure.example' } }
  })
  const model = makeModel({ id: 'azure::deployment', providerId: 'azure', apiModelId: 'deployment' })

  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.getByProviderId.mockReturnValue(provider)
    serviceMocks.getByKey.mockReturnValue(model)
    serviceMocks.getCurrentConfig.mockReturnValue({ enabled: true })
    serviceMocks.resolveApiGatewayRuntime.mockResolvedValue(GATEWAY)
  })

  it.each([false, true])('rejects external-CLI models when Gateway enabled is %s', async (enabled) => {
    const cliProvider = makeProvider({
      id: 'claude-code',
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    const cliModel = makeModel({ id: 'claude-code::claude', providerId: 'claude-code', apiModelId: 'claude' })
    serviceMocks.getByProviderId.mockReturnValue(cliProvider)
    serviceMocks.getByKey.mockReturnValue(cliModel)
    serviceMocks.getCurrentConfig.mockReturnValue({ enabled })
    await expect(assertPiProviderUsable('claude-code::claude')).rejects.toBeInstanceOf(PiUnsupportedProviderError)
    expect(() => buildPiGatewayInjection(cliProvider, cliModel, GATEWAY)).toThrow(PiUnsupportedProviderError)
    await expect(resolvePiProviderInjectionForSession('session-1', cliProvider, cliModel)).rejects.toBeInstanceOf(
      PiUnsupportedProviderError
    )
  })

  it('preserves a gateway-only model and attributes usage only to provider calls', async () => {
    await assertPiProviderUsable('azure::deployment')
    const injection = await resolvePiProviderInjectionForSession('session-1', provider, model)
    expect(injection).toMatchObject({
      api: 'openai-completions',
      modelId: 'azure:deployment',
      providerConfig: { baseUrl: 'http://127.0.0.1:23333/v1', headers: GATEWAY_USAGE_HEADERS },
      apiKey: GATEWAY_KEY,
      usageCapture: { owner: 'provider-calls' }
    })
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()
    serviceMocks.resolveApiGatewayRuntime.mockResolvedValue({ ...GATEWAY, apiKey: 'rotated-local-key' })
    expect((await resolvePiProviderInjectionForSession('session-1', provider, model)).apiKey).toBe('rotated-local-key')
  })
})

function stubGrokCliServices(): void {
  serviceMocks.getByProviderId.mockReturnValue({
    id: 'grok-cli',
    name: 'Grok CLI',
    authMethods: ['oauth'],
    reportsActualCost: false,
    defaultChatEndpoint: 'openai-responses',
    endpointConfigs: { 'openai-responses': { adapterFamily: 'grok', baseUrl: 'https://cli-chat-proxy.grok.com/v1' } }
  })
  serviceMocks.getByKey.mockReturnValue({
    id: 'grok-cli::grok-build',
    providerId: 'grok-cli',
    name: 'M',
    capabilities: [],
    contextWindow: 128_000
  })
}

describe('modelInjection service resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.resolveApiGatewayRuntime.mockResolvedValue(GATEWAY)
    serviceMocks.getByProviderId.mockReturnValue({
      id: 'p',
      name: 'P',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    serviceMocks.getByKey.mockReturnValue({
      id: 'p::m',
      providerId: 'p',
      name: 'M',
      capabilities: [],
      contextWindow: 128_000
    })
    serviceMocks.getApiKeys.mockReturnValue([{ id: 'k1', key: 'sk-test', isEnabled: true }])
  })

  it('validates compatibility without consuming rotated API keys', async () => {
    await expect(assertPiProviderUsable('p::m')).resolves.toBeUndefined()
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()
  })

  it('accepts a Cherry Cloud model without a provider API key when synchronized metadata is complete', async () => {
    serviceMocks.getByProviderId.mockReturnValueOnce({
      id: CHERRY_CLOUD_PROVIDER_ID,
      name: 'CherryAI',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://cloud.cherryai.com.cn' }
      }
    })
    serviceMocks.getByKey.mockReturnValueOnce({
      id: `${CHERRY_CLOUD_PROVIDER_ID}::deepseek-free`,
      providerId: CHERRY_CLOUD_PROVIDER_ID,
      apiModelId: 'deepseek-free',
      name: 'DeepSeek Free',
      group: CHERRY_CLOUD_MODEL_GROUP,
      endpointTypes: ['anthropic-messages'],
      capabilities: [],
      contextWindow: 128_000,
      maxOutputTokens: 8_192
    })

    await expect(assertPiProviderUsable('cherryai-subscription::deepseek-free')).resolves.toBeUndefined()
    expect(serviceMocks.getApiKeys).not.toHaveBeenCalled()
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()
  })

  it('validates the same preferred Anthropic endpoint used during materialization', async () => {
    serviceMocks.getByProviderId.mockReturnValueOnce({
      id: 'p',
      name: 'P',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'bedrock', baseUrl: 'https://gateway.example.com' },
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://gateway.example.com' }
      }
    })
    serviceMocks.getByKey.mockReturnValueOnce({
      id: 'p::m',
      providerId: 'p',
      name: 'M',
      capabilities: [],
      contextWindow: 128_000,
      endpointTypes: ['openai-chat-completions', 'anthropic-messages']
    })

    await expect(assertPiProviderUsable('p::m')).resolves.toBeUndefined()
  })

  it('rejects missing credentials and unsupported providers', async () => {
    serviceMocks.getApiKeys.mockReturnValueOnce([{ id: 'k1', key: '   ', isEnabled: true }])
    await expect(assertPiProviderUsable('p::m')).rejects.toThrow(PiMissingApiKeyError)

    serviceMocks.getByProviderId.mockReturnValueOnce({
      id: 'p',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama', baseUrl: 'http://localhost:11434' } }
    })
    serviceMocks.getByKey.mockReturnValueOnce(makeModel({ capabilities: ['embedding'] }))
    await expect(assertPiProviderUsable('p::m')).rejects.toThrow(PiUnsupportedProviderError)
  })

  it('validates app-managed OAuth through its live session', async () => {
    stubGrokCliServices()
    serviceMocks.hasToken.mockResolvedValueOnce(true)
    await expect(assertPiProviderUsable('grok-cli::grok-build')).resolves.toBeUndefined()
    expect(serviceMocks.getApiKeys).not.toHaveBeenCalled()

    serviceMocks.hasToken.mockResolvedValueOnce(false)
    await expect(assertPiProviderUsable('grok-cli::grok-build')).rejects.toThrow(PiMissingApiKeyError)
  })

  it('resolves OAuth without key rotation and plain providers with rotation', async () => {
    stubGrokCliServices()
    const oauth = await resolvePiProviderInjection('grok-cli::grok-build')
    expect(oauth.transportAdapter).toBeDefined()
    expect(oauth.apiKey).toBe(PI_PLACEHOLDER_API_KEY)
    expect(serviceMocks.resolveApiKey).not.toHaveBeenCalled()

    serviceMocks.getByProviderId.mockReturnValue({
      id: 'p',
      name: 'P',
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' } }
    })
    serviceMocks.getByKey.mockReturnValue({
      id: 'p::m',
      providerId: 'p',
      name: 'M',
      capabilities: [],
      contextWindow: 128_000
    })
    serviceMocks.resolveApiKey.mockReturnValue({
      value: 'sk-rotated',
      apiKeySelection: { attribution: 'matched', id: 'k1', masked: 'sk-****' }
    })
    const plain = await resolvePiProviderInjection('p::m')
    expect(plain.apiKey).toBe('sk-rotated')
    expect(plain.usageCapture.credentialReceipt).toEqual({
      attribution: 'matched',
      id: 'k1',
      masked: 'sk-****'
    })
  })

  it('rejects a rotated credential outside the captured enabled-key set', () => {
    serviceMocks.resolveApiKey.mockReturnValue({
      value: 'sk-new',
      apiKeySelection: { attribution: 'matched', id: 'k2', masked: 'sk-****' }
    })

    expect(() =>
      resolvePiProviderInjectionFromSnapshot(
        {
          id: 'p',
          name: 'P',
          defaultChatEndpoint: 'anthropic-messages',
          endpointConfigs: {
            'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.anthropic.com' }
          }
        } as never,
        { id: 'p::m', providerId: 'p', name: 'M', capabilities: [] } as never,
        [{ id: 'k1', key: 'sk-old', isEnabled: true }]
      )
    ).toThrow('Pi provider credentials changed during materialization: p')
  })
})

// pi defaults its thinking level to `medium` and clamps it against the model's ladder. Cherry used to
// send no ladder, so pi assumed medium was available and emitted it verbatim — rejected by endpoints
// serving Kimi K3, whose vocabulary is low/high/max (#20029).
describe('pi thinking level ladder', () => {
  const relay = () =>
    makeProvider({
      id: 'new-api',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://relay.example.com' }
      }
    })

  const piModelFrom = (model: Model, provider = relay()): PiModel<PiApi> => {
    const injection = buildPiProviderInjection(provider, model, REAL_KEY)
    const modelConfig = injection.providerConfig.models?.[0]
    const api = modelConfig?.api ?? injection.providerConfig.api
    const baseUrl = modelConfig?.baseUrl ?? injection.providerConfig.baseUrl
    if (!modelConfig || !api || !baseUrl) throw new Error('Pi model configuration is incomplete')

    return {
      ...modelConfig,
      api,
      provider: injection.providerName,
      baseUrl
    }
  }

  it("clamps pi's medium default onto a tier Kimi K3 actually offers", async () => {
    const { clampThinkingLevel, getSupportedThinkingLevels } = await import('@earendil-works/pi-ai/compat')
    const piModel = piModelFrom(
      makeModel({
        id: 'new-api::moonshotai/kimi-k3',
        apiModelId: 'moonshotai/kimi-k3',
        capabilities: ['reasoning'],
        reasoning: {
          controls: [{ kind: 'effort', values: ['low', 'high', 'max'] }, { kind: 'toggle' }],
          selectableEfforts: ['low', 'high', 'max', 'none']
        }
      })
    )

    expect(getSupportedThinkingLevels(piModel)).toEqual(['off', 'low', 'high', 'max'])
    expect(clampThinkingLevel(piModel, 'medium')).toBe('high')
  })

  it('withholds the off level from an always-on model', async () => {
    const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai/compat')
    const piModel = piModelFrom(
      makeModel({
        apiModelId: 'kimi-k3-fast',
        capabilities: ['reasoning'],
        reasoning: {
          controls: [{ kind: 'effort', values: ['low', 'high', 'max'] }],
          selectableEfforts: ['low', 'high', 'max']
        }
      })
    )

    expect(getSupportedThinkingLevels(piModel)).not.toContain('off')
  })

  it('preserves the provider-specific ultra tier for GPT-6 Astra', async () => {
    const { clampThinkingLevel, getSupportedThinkingLevels } = await import('@earendil-works/pi-ai/compat')
    const { streamSimple: streamOpenAIResponses } = await import('@earendil-works/pi-ai/api/openai-responses')
    const piModel = piModelFrom(
      makeModel({
        id: 'openai-codex::gpt-6-astra',
        providerId: 'openai-codex',
        apiModelId: 'gpt-6-astra',
        capabilities: ['reasoning'],
        reasoning: {
          controls: [{ kind: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }],
          selectableEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
        }
      }),
      makeProvider({
        id: 'openai-codex',
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: {
          'openai-responses': { adapterFamily: 'openai-compatible', baseUrl: 'https://example.com/v1' }
        }
      })
    )
    if (piModel.api !== 'openai-responses') throw new Error('Expected an OpenAI Responses model')

    expect(getSupportedThinkingLevels(piModel)).toContain('ultra')
    expect(clampThinkingLevel(piModel, 'ultra')).toBe('ultra')

    let requestBody: any
    const stream = streamOpenAIResponses(
      { ...piModel, api: 'openai-responses' },
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 1 }] }),
      {
        apiKey: REAL_KEY,
        reasoning: 'ultra',
        fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
          requestBody = JSON.parse(init?.body as string)
          return new Response(JSON.stringify({ error: { message: 'expected test rejection' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' }
          })
        },
        maxRetries: 0
      }
    )
    await stream.result()

    expect(requestBody.reasoning).toMatchObject({ effort: 'ultra' })
  })

  // A toggle model expresses on/off through the wire, not a ladder; an all-null map would read as
  // "no level supported" and silently disable its thinking.
  it('sends no ladder for a model that declares no concrete tier', () => {
    const piModel = piModelFrom(
      makeModel({
        capabilities: ['reasoning'],
        reasoning: { controls: [{ kind: 'toggle' }], selectableEfforts: ['none', 'auto'] }
      })
    )

    expect(piModel).not.toHaveProperty('thinkingLevelMap')
  })
})

// These requests catch loss of the catalog dialect between Cherry injection, pi registration and serialization.
describe('Anthropic adaptive thinking projection', () => {
  const levels = ['low', 'medium', 'high', 'xhigh', 'max'] as const
  const provider = () =>
    makeProvider({
      presetProviderId: null,
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://example.invalid' } }
    })
  const model = (apiModelId = 'claude-opus-5-5', presetModelId?: string) =>
    makeModel({
      id: `p::${apiModelId}`,
      apiModelId,
      ...(presetModelId ? { presetModelId } : {}),
      capabilities: ['reasoning'],
      maxOutputTokens: 32768,
      contextWindow: 200000,
      reasoning: { selectableEfforts: [...levels] }
    })

  async function serialize(
    injection: ReturnType<typeof buildPiProviderInjection> | ReturnType<typeof buildPiGatewayInjection>,
    reasoning: (typeof levels)[number]
  ) {
    const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent')
    const { InMemoryCredentialStore } = await import('@earendil-works/pi-ai')
    const { streamSimple } = await import('@earendil-works/pi-ai/api/anthropic-messages')
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false
    })
    await runtime.setRuntimeApiKey(injection.providerName, injection.apiKey)
    const registry = new ModelRegistry(runtime)
    registry.registerProvider(injection.providerName, injection.providerConfig)
    const resolved = registry.find(injection.providerName, injection.modelId)
    if (!resolved || resolved.api !== 'anthropic-messages') throw new Error('Expected registered Anthropic model')
    const auth = await registry.getApiKeyAndHeaders(resolved)
    if (!auth.ok) throw new Error(auth.error)
    let body: any
    let headers: Headers | undefined
    const stream = streamSimple(
      resolved as PiModel<'anthropic-messages'>,
      normalizeContext({ messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }),
      {
        apiKey: auth.apiKey,
        reasoning,
        maxRetries: 0,
        fetch: async (_input, init) => {
          body = JSON.parse(init?.body as string)
          headers = new Headers(init?.headers)
          return new Response(
            JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'captured' } }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        }
      }
    )
    await stream.result()
    expect(body).toBeDefined()
    return { body, headers, resolved }
  }

  it.each(levels)('serializes custom catalog-matched Opus 5.5 at %s', async (level) => {
    const row = model()
    expect(row).not.toHaveProperty('presetModelId')
    expect(row.reasoning).not.toHaveProperty('wireDialect')
    const profile = providerRegistryService.resolveReasoningProfile(provider(), row, 'anthropic-messages')
    expect(profile.support?.wireDialect).toBeUndefined()
    const injection = buildPiProviderInjection(provider(), row, REAL_KEY)
    expect(injection.providerConfig.models?.[0]).toMatchObject({
      compat: { forceAdaptiveThinking: true },
      reasoning: true,
      input: ['text'],
      contextWindow: 200000,
      maxTokens: 32768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    })
    const { body, headers, resolved } = await serialize(injection, level)
    expect(resolved.compat).toMatchObject({ forceAdaptiveThinking: true })
    expect(body.thinking.type).toBe('adaptive')
    expect(body.output_config.effort).toBe(level)
    expect(body.thinking).not.toHaveProperty('budget_tokens')
    expect(headers?.get('anthropic-beta') ?? '').not.toContain('interleaved-thinking-2025-05-14')
  })

  it.each(levels)('serializes catalog-backed Opus 5.5 at %s', async (level) => {
    const injection = buildPiProviderInjection(provider(), model('claude-opus-5-5', 'claude-opus-5-5'), REAL_KEY)
    expect(injection.providerConfig.models?.[0]?.compat).toEqual({ forceAdaptiveThinking: true })
    const { body } = await serialize(injection, level)
    expect(body.thinking.type).toBe('adaptive')
    expect(body.output_config.effort).toBe(level)
    expect(body.thinking).not.toHaveProperty('budget_tokens')
  })

  it.each(['claude-opus-4-5', 'claude-haiku-4-5'])('keeps budget serialization for %s', async (id) => {
    const injection = buildPiProviderInjection(provider(), model(id), REAL_KEY)
    expect(injection.providerConfig.models?.[0]?.compat ?? {}).not.toHaveProperty('forceAdaptiveThinking')
    const { body, headers } = await serialize(injection, 'high')
    expect(body.thinking).toMatchObject({ type: 'enabled', budget_tokens: 16384 })
    expect(body.output_config?.effort).toBeUndefined()
    expect(headers?.get('anthropic-beta')).toContain('interleaved-thinking-2025-05-14')
  })

  it.each(['claude-opus-4-6', 'claude-sonnet-5-5', 'unknown-model'])('does not widen the dialect fence to %s', (id) => {
    expect(
      buildPiProviderInjection(provider(), model(id), REAL_KEY).providerConfig.models?.[0]?.compat ?? {}
    ).not.toHaveProperty('forceAdaptiveThinking')
  })

  it('composes CherryIN signature compatibility with adaptive thinking', () => {
    expect(
      buildPiProviderInjection({ ...provider(), id: 'cherryin' }, model(), REAL_KEY).providerConfig.models?.[0]?.compat
    ).toEqual({ allowEmptySignature: true, forceAdaptiveThinking: true })
  })

  it('preserves the gateway model namespace while resolving the original catalog id', async () => {
    const injection = buildPiGatewayInjection(provider(), model(), GATEWAY)
    expect(injection.modelId).toBe('p:claude-opus-5-5')
    expect(injection.providerConfig.models?.[0]?.compat).toEqual({ forceAdaptiveThinking: true })
    const { body } = await serialize(injection, 'high')
    expect(body.model).toBe('p:claude-opus-5-5')
    expect(body.thinking.type).toBe('adaptive')
    expect(body.output_config.effort).toBe('high')
    expect(body.thinking).not.toHaveProperty('budget_tokens')
  })

  it('withholds the flag when an Anthropic endpoint uses the OpenAI gateway fallback', () => {
    const fallback = provider()
    fallback.endpointConfigs!['anthropic-messages']!.adapterFamily = 'bedrock'
    const injection = buildPiGatewayInjection(fallback, model(), GATEWAY)
    expect(injection.api).toBe('openai-completions')
    expect(injection.providerConfig.models?.[0]?.compat).toEqual({ supportsDeveloperRole: false })
  })

  // Fixture wires catch dialect-only predicates and first-write-wins regressions without mocking resolution.
  describe.each(['endpoint', 'model-contract'] as const)('%s wire precedence', (scope) => {
    const adaptiveOperation = { target: 'thinking.type', value: { source: 'literal', value: 'adaptive' } } as const
    const wires: [string, ReasoningWireProfile][] = [
      [
        'enabled budget',
        {
          effort: {
            operations: [
              adaptiveOperation,
              { target: 'thinking.type', value: { source: 'literal', value: 'enabled' } },
              { target: 'thinking.budget_tokens', value: { source: 'budget' } }
            ],
            budget: { missing: { type: 'omit-mode' } }
          }
        }
      ],
      ['disabled', { disabled: true, effort: { operations: [adaptiveOperation] } }],
      [
        'non-adaptive literal',
        {
          effort: {
            operations: [
              adaptiveOperation,
              { target: 'thinking.type', value: { source: 'literal', value: 'disabled' } }
            ]
          }
        }
      ],
      [
        'non-literal type',
        { effort: { operations: [adaptiveOperation, { target: 'thinking.type', value: { source: 'effort' } }] } }
      ],
      ['no effort mode', { default: { operations: [adaptiveOperation] } }]
    ]
    it.each(wires)('withholds the adaptive flag for %s', (_name, wire) => {
      const directory = mkdtempSync(join(tmpdir(), 'pi-reasoning-'))
      try {
        const dataRoot = resolve(process.cwd(), 'packages/provider-registry/data')
        const providers = JSON.parse(readFileSync(join(dataRoot, 'providers.json'), 'utf8'))
        const overrides = JSON.parse(readFileSync(join(dataRoot, 'provider-models.json'), 'utf8'))
        providers.providers.push({
          id: 'p',
          name: 'Fixture',
          metadata: { website: {} },
          defaultChatEndpoint: 'anthropic-messages',
          endpointConfigs: {
            'anthropic-messages': {
              baseUrl: 'https://example.invalid',
              reasoningFormat: {
                type: 'anthropic',
                wire: scope === 'endpoint' ? wire : { effort: { operations: [adaptiveOperation] } }
              }
            }
          }
        })
        if (scope === 'model-contract')
          overrides.overrides.push({
            providerId: 'p',
            modelId: 'claude-opus-5-5',
            reasoningContracts: { 'anthropic-messages': { wire } }
          })
        writeFileSync(join(directory, 'providers.json'), JSON.stringify(providers))
        writeFileSync(join(directory, 'provider-models.json'), JSON.stringify(overrides))
        const getPath = vi.mocked(application.getPath).getMockImplementation()!
        vi.spyOn(application, 'getPath').mockImplementation((key, filename) =>
          key === 'feature.provider_registry.data' && filename && filename !== 'models.json'
            ? join(directory, filename)
            : getPath(key, filename)
        )
        providerRegistryService.clearCache()
        const context = { ...provider(), presetProviderId: undefined }
        const profile = providerRegistryService.resolveReasoningProfile(context, model(), 'anthropic-messages')
        expect(profile.wireDialect).toBe('adaptive-always')
        expect(profile.wire).toEqual(wire)
        expect(
          buildPiProviderInjection(context, model(), REAL_KEY).providerConfig.models?.[0]?.compat ?? {}
        ).not.toHaveProperty('forceAdaptiveThinking')
      } finally {
        providerRegistryService.clearCache()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  })
})

describe('Gateway issue 22785 core', () => {
  const provider = makeProvider({
    id: 'gateway',
    name: 'Vercel AI Gateway',
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: {
      'openai-chat-completions': { adapterFamily: 'gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1/ai' }
    }
  })
  const model = makeModel({
    id: 'gateway::openai/gpt-6-astra',
    providerId: 'gateway',
    apiModelId: 'openai/gpt-6-astra'
  })

  it('projects the Chat config without changing the stored Gateway base', () => {
    const injection = buildPiProviderInjection(provider, model, REAL_KEY)

    expect(injection.api).toBe('openai-completions')
    expect(injection.providerConfig.api).toBe('openai-completions')
    expect(injection.providerConfig.baseUrl).toBe('https://ai-gateway.vercel.sh/v1')
    expect(injection.modelId).toBe('openai/gpt-6-astra')
    expect(provider.endpointConfigs?.['openai-chat-completions']?.baseUrl).toBe('https://ai-gateway.vercel.sh/v1/ai')
  })

  it('projects the Responses fallback from the Chat config', () => {
    const injection = buildPiProviderInjection(provider, { ...model, endpointTypes: ['openai-responses'] }, REAL_KEY)

    expect(injection.api).toBe('openai-responses')
    expect(injection.providerConfig.api).toBe('openai-responses')
    expect(injection.providerConfig.baseUrl).toBe('https://ai-gateway.vercel.sh/v1')
  })

  it('sends real Chat wire requests to /v1/chat/completions', async () => {
    const requests: { method: string | undefined; url: string | undefined; body: { model?: string } }[] = []
    const marker = 'gateway-chat-22785'
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ method: req.method, url: req.url, body })
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unknown endpoint', type: 'invalid_request_error' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = {
        id: 'chat-22785',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'openai/gpt-6-astra',
        choices: [{ index: 0, delta: { content: marker }, finish_reason: null }]
      }
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.end('data: [DONE]\n\n')
    })
    server.requestTimeout = 3_000
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const injection = buildPiProviderInjection(
        {
          ...provider,
          endpointConfigs: {
            'openai-chat-completions': {
              adapterFamily: 'gateway',
              baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ai`
            }
          }
        },
        model,
        'test-key'
      )
      const materialized = await materializePiProviderStream(injection)
      const piModel = {
        ...injection.providerConfig.models![0],
        api: injection.api,
        provider: injection.providerName,
        baseUrl: injection.providerConfig.baseUrl
      } as PiModel<'openai-completions'>
      const result = await materialized
        .streamSimple(piModel, normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }), {
          apiKey: 'test-key',
          maxRetries: 0,
          timeoutMs: 2_000
        })
        .result()

      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('/v1/chat/completions')
      expect(requests[0].body.model).toBe('openai/gpt-6-astra')
      expect(result.stopReason).toBe('stop')
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: marker }))
      expect(requests[0].method).toBe('POST')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('sends real Responses fallback wire requests to /v1/responses', async () => {
    const requests: { method: string | undefined; url: string | undefined; body: { model?: string } }[] = []
    const marker = 'gateway-responses-22785'
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      requests.push({ method: req.method, url: req.url, body })
      if (req.method !== 'POST' || req.url !== '/v1/responses') {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Unknown endpoint', type: 'invalid_request_error' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'response.created', response: { id: 'resp-22785', status: 'in_progress' } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { id: 'msg-22785', type: 'message', role: 'assistant', content: [] }
        },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: marker },
        {
          type: 'response.completed',
          response: {
            id: 'resp-22785',
            status: 'completed',
            output: [],
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }
          }
        }
      ]
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    })
    server.requestTimeout = 3_000
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const injection = buildPiProviderInjection(
        {
          ...provider,
          endpointConfigs: {
            'openai-chat-completions': {
              adapterFamily: 'gateway',
              baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/ai`
            }
          }
        },
        { ...model, endpointTypes: ['openai-responses'] },
        'test-key'
      )
      const materialized = await materializePiProviderStream(injection)
      const piModel = {
        ...injection.providerConfig.models![0],
        api: injection.api,
        provider: injection.providerName,
        baseUrl: injection.providerConfig.baseUrl
      } as PiModel<'openai-responses'>
      const result = await materialized
        .streamSimple(piModel, normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }), {
          apiKey: 'test-key',
          maxRetries: 0,
          timeoutMs: 2_000
        })
        .result()

      expect(requests).toHaveLength(1)
      expect(requests[0].url).toBe('/v1/responses')
      expect(requests[0].body.model).toBe('openai/gpt-6-astra')
      expect(result.stopReason).toBe('stop')
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: marker }))
      expect(requests[0].method).toBe('POST')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })
})

describe('Gateway issue 22785 boundaries', () => {
  const provider = makeProvider({
    id: 'gateway',
    name: 'Vercel AI Gateway',
    defaultChatEndpoint: 'openai-chat-completions',
    endpointConfigs: {
      'openai-chat-completions': { adapterFamily: 'gateway', baseUrl: 'https://proxy.example/v1/ai' }
    }
  })
  const model = makeModel({
    id: 'gateway::openai/gpt-6-astra',
    providerId: 'gateway',
    apiModelId: 'openai/gpt-6-astra'
  })

  it.each([
    ['https://proxy.example/v1/ai/', 'https://proxy.example/v1'],
    ['https://proxy.example/v1/ai#', 'https://proxy.example/v1'],
    ['https://proxy.example', 'https://proxy.example/v1']
  ])('formats Gateway base %s as %s', (baseUrl, expectedBaseUrl) => {
    const injection = buildPiProviderInjection(
      {
        ...provider,
        endpointConfigs: {
          'openai-chat-completions': { adapterFamily: 'gateway', baseUrl }
        }
      },
      model,
      REAL_KEY
    )

    expect(injection.api).toBe('openai-completions')
    expect(injection.providerConfig.baseUrl).toBe(expectedBaseUrl)
  })

  it('preserves the proxy prefix for a preset-derived Gateway', () => {
    const derivedProvider = makeProvider({
      ...provider,
      id: 'my-gateway',
      presetProviderId: 'gateway',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'gateway', baseUrl: 'https://proxy.example/prefix/v1/ai' }
      }
    })
    const injection = buildPiProviderInjection(
      derivedProvider,
      { ...model, id: 'my-gateway::openai/gpt-6-astra', providerId: 'my-gateway' },
      REAL_KEY
    )

    expect(injection.providerConfig.baseUrl).toBe('https://proxy.example/prefix/v1')
  })

  it('honors an explicit Responses base with the no-version sentinel', () => {
    const injection = buildPiProviderInjection(
      {
        ...provider,
        endpointConfigs: {
          ...provider.endpointConfigs,
          'openai-responses': { adapterFamily: 'gateway', baseUrl: 'https://proxy.example/compat#' }
        }
      },
      { ...model, endpointTypes: ['openai-responses'] },
      REAL_KEY
    )

    expect(injection.api).toBe('openai-responses')
    expect(injection.providerConfig.baseUrl).toBe('https://proxy.example/compat')
  })

  it('projects an explicit Responses base using the OpenAI adapter', () => {
    const injection = buildPiProviderInjection(
      {
        ...provider,
        endpointConfigs: {
          ...provider.endpointConfigs,
          'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://proxy.example/v1/ai' }
        }
      },
      { ...model, endpointTypes: ['openai-responses'] },
      REAL_KEY
    )

    expect(injection.api).toBe('openai-responses')
    expect(injection.providerConfig.baseUrl).toBe('https://proxy.example/v1')
  })

  it('preserves a Gateway base with a path after /v1/ai', () => {
    const injection = buildPiProviderInjection(
      {
        ...provider,
        endpointConfigs: {
          'openai-chat-completions': { adapterFamily: 'gateway', baseUrl: 'https://proxy.example/v1/ai/extra' }
        }
      },
      model,
      REAL_KEY
    )

    expect(injection.providerConfig.baseUrl).toBe('https://proxy.example/v1/ai/extra')
  })

  it('preserves /v1/ai for a non-Gateway OpenAI-compatible provider', () => {
    const relay = makeProvider({
      id: 'relay',
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai', baseUrl: 'https://relay.example/v1/ai' }
      }
    })
    const injection = buildPiProviderInjection(
      relay,
      { ...model, id: 'relay::openai/gpt-6-astra', providerId: 'relay' },
      REAL_KEY
    )

    expect(injection.api).toBe('openai-completions')
    expect(injection.providerConfig.baseUrl).toBe('https://relay.example/v1/ai')
  })

  it('preserves the local gateway base, credentials, usage headers and model namespace', () => {
    const injection = buildPiGatewayInjection(provider, model, GATEWAY)

    expect(injection.providerConfig.baseUrl).toBe('http://127.0.0.1:23333/v1')
    expect(injection.apiKey).toBe(GATEWAY_KEY)
    expect(injection.providerConfig.headers).toEqual(GATEWAY_USAGE_HEADERS)
    expect(injection.modelId).toBe('gateway:openai/gpt-6-astra')
  })
})

describe('Responses summary permission through production materialization', () => {
  it.each([
    { id: 'doubao', summary: undefined, suppressed: true },
    { id: 'openai', summary: true, suppressed: false },
    { id: 'unlinked-custom', summary: undefined, suppressed: true }
  ])('applies the merged endpoint policy for $id on the wire', async ({ id, summary, suppressed }) => {
    const requests: { body: Record<string, any>; status: number }[] = []
    const marker = `materialized-${id}-22480`
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      const hasSummary = body.reasoning && Object.hasOwn(body.reasoning, 'summary')
      const status = suppressed && hasSummary ? 400 : 200
      requests.push({ body, status })
      if (status === 400) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ code: 'InvalidParameter', message: 'json: unknown field "summary"' }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'response.created', response: { id: 'resp-22480', status: 'in_progress' } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { id: 'msg-22480', type: 'message', role: 'assistant', content: [] }
        },
        { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: marker },
        {
          type: 'response.completed',
          response: {
            id: 'resp-22480',
            status: 'completed',
            output: [],
            usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 }
          }
        }
      ]
      for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      res.end()
    })
    server.requestTimeout = 3_000
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const provider = makeProvider({
        id,
        presetProviderId: null,
        defaultChatEndpoint: 'openai-chat-completions',
        endpointConfigs: {
          'openai-responses': {
            adapterFamily: 'openai',
            baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
            ...(summary === undefined ? {} : { dialect: { reasoningSummary: summary } })
          }
        }
      })
      const model = makeModel({
        id: `${id}::doubao-seed-evolving`,
        providerId: id,
        apiModelId: 'doubao-seed-evolving',
        capabilities: ['reasoning'],
        endpointTypes: ['openai-responses', 'openai-chat-completions']
      })
      const injection = buildPiProviderInjection(provider, model, 'test-key')
      expect(injection.suppressReasoningSummary).toBe(suppressed)
      const materialized = await materializePiProviderStream(injection)
      const registered = injection.providerConfig.models![0]
      const piModel = {
        ...registered,
        api: injection.api,
        provider: injection.providerName,
        baseUrl: injection.providerConfig.baseUrl
      } as PiModel<'openai-responses'>
      const result = await materialized
        .streamSimple(piModel, normalizeContext({ messages: [{ role: 'user', content: 'Hello', timestamp: 1 }] }), {
          apiKey: 'test-key',
          reasoning: 'medium',
          maxRetries: 0,
          timeoutMs: 2_000
        })
        .result()

      expect(requests).toHaveLength(1)
      expect(requests[0].status).toBe(200)
      expect(result.stopReason).toBe('stop')
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: marker }))
      expect(requests[0].body.reasoning.effort).toBe('medium')
      expect(Object.hasOwn(requests[0].body.reasoning, 'summary')).toBe(!suppressed)
      if (!suppressed) {
        expect(requests[0].body.reasoning.summary).toBe('auto')
        expect(materialized.providerConfig).toBe(injection.providerConfig)
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    }
  })

  it('keeps chat-completions and gateway configs and builtin streams unchanged', async () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai', baseUrl: 'https://example.com' },
        'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://example.com' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-chat-completions'] })
    const injections = [
      buildPiProviderInjection(provider, model, REAL_KEY),
      buildPiGatewayInjection(provider, makeModel({ endpointTypes: ['openai-responses'] }), GATEWAY)
    ]
    const { loadPiApiStreamSimple } = await import('./piSdk')
    for (const injection of injections) {
      expect(injection.suppressReasoningSummary).toBe(false)
      const materialized = await materializePiProviderStream(injection)
      expect(materialized.providerConfig).toBe(injection.providerConfig)
      expect(materialized.streamSimple).toBe(await loadPiApiStreamSimple(injection.api))
    }
  })
})
