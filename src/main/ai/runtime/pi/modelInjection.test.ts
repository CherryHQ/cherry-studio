import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { normalizeContext } from '@earendil-works/pi-ai'
import type { Api as PiApi, Model as PiModel } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { ReasoningWireProfile } from '@cherrystudio/provider-registry'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { buildPiGatewayInjection, PI_PLACEHOLDER_API_KEY, PiUnsupportedProviderError } from './modelInjection'

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

describe('buildPiGatewayInjection', () => {
  it.each([
    ['anthropic-messages', 'anthropic', 'anthropic-messages', 'http://127.0.0.1:23333'],
    ['openai-chat-completions', 'openai-compatible', 'openai-completions', 'http://127.0.0.1:23333/v1'],
    ['openai-responses', 'openai', 'openai-responses', 'http://127.0.0.1:23333/v1'],
    ['google-generate-content', 'google', 'google-generative-ai', 'http://127.0.0.1:23333/v1beta'],
    ['openai-chat-completions', 'azure', 'openai-completions', 'http://127.0.0.1:23333/v1'],
    ['openai-responses', 'azure-responses', 'openai-completions', 'http://127.0.0.1:23333/v1'],
    ['anthropic-messages', 'bedrock', 'openai-completions', 'http://127.0.0.1:23333/v1'],
    ['google-generate-content', 'google-vertex', 'openai-completions', 'http://127.0.0.1:23333/v1'],
    ['anthropic-messages', 'google-vertex-anthropic', 'openai-completions', 'http://127.0.0.1:23333/v1'],
    ['ollama-chat', 'ollama', 'openai-completions', 'http://127.0.0.1:23333/v1']
  ] as const)('routes %s / %s through the internal gateway', (endpointType, adapterFamily, api, baseUrl) => {
    const provider = makeProvider({
      defaultChatEndpoint: endpointType,
      endpointConfigs: { [endpointType]: { adapterFamily, baseUrl: 'https://upstream.invalid' } }
    })
    const injection = buildPiGatewayInjection(provider, makeModel({ apiModelId: 'wire-model' }), GATEWAY)

    expect(injection.providerConfig).toMatchObject({
      api,
      baseUrl,
      apiKey: PI_PLACEHOLDER_API_KEY,
      headers: GATEWAY_USAGE_HEADERS,
      models: [{ id: 'p:wire-model' }]
    })
    expect(injection.apiKey).toBe(GATEWAY_KEY)
    expect(injection.modelId).toBe('p:wire-model')
  })

  it('prefers Anthropic Messages when the model and provider also support OpenAI Chat', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://upstream.invalid/v1' },
        'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://upstream.invalid' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-chat-completions', 'anthropic-messages'] })
    expect(buildPiGatewayInjection(provider, model, GATEWAY).api).toBe('anthropic-messages')

    delete provider.endpointConfigs!['anthropic-messages']
    expect(buildPiGatewayInjection(provider, model, GATEWAY).api).toBe('openai-completions')
  })

  it('keeps a model Responses hint ahead of the provider default', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'openai-responses': { adapterFamily: 'openai' },
        'anthropic-messages': { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({ endpointTypes: ['openai-responses', 'anthropic-messages'] })
    expect(buildPiGatewayInjection(provider, model, GATEWAY).api).toBe('openai-responses')
  })

  it('preserves the per-model protocol of a cloned gateway provider', () => {
    const provider = makeProvider({
      id: 'custom-aihubmix',
      presetProviderId: 'aihubmix',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: {
        'ollama-chat': { adapterFamily: 'ollama' },
        'anthropic-messages': { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({
      id: 'custom-aihubmix::claude-sonnet-4',
      providerId: provider.id,
      apiModelId: 'claude-sonnet-4'
    })
    const injection = buildPiGatewayInjection(provider, model, GATEWAY)
    expect(injection.api).toBe('anthropic-messages')
    expect(injection.modelId).toBe('custom-aihubmix:claude-sonnet-4')
  })

  it.each(['grok-cli', 'openai-codex'])('routes %s OAuth through the gateway', (providerId) => {
    const provider = makeProvider({
      id: providerId,
      authMethods: ['oauth'],
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily: 'openai' } }
    })
    const model = makeModel({ id: `${providerId}::model`, providerId })
    const injection = buildPiGatewayInjection(provider, model, GATEWAY)
    expect(injection.api).toBe('openai-responses')
    expect(injection.apiKey).toBe(GATEWAY_KEY)
    expect(injection.providerConfig.baseUrl).toBe('http://127.0.0.1:23333/v1')
  })

  it('rejects unroutable provider ids and external CLI authentication', () => {
    for (const provider of [
      makeProvider({ id: 'custom:anthropic', defaultChatEndpoint: 'anthropic-messages' }),
      makeProvider({ id: 'claude-code', authMethods: ['external-cli'], defaultChatEndpoint: 'anthropic-messages' })
    ]) {
      const model = makeModel({ id: `${provider.id}::model`, providerId: provider.id })
      expect(() => buildPiGatewayInjection(provider, model, GATEWAY)).toThrow(PiUnsupportedProviderError)
    }
  })

  it.each(['openai-chat-completions', 'openai-responses'] as const)(
    'retains the endpoint developer-role capability for %s',
    (endpointType) => {
      const provider = makeProvider({
        defaultChatEndpoint: endpointType,
        endpointConfigs: { [endpointType]: { dialect: { developerRole: true } } }
      })
      const injection = buildPiGatewayInjection(provider, makeModel({}), GATEWAY)
      expect(injection.providerConfig.models?.[0]?.compat).toMatchObject({ supportsDeveloperRole: true })
    }
  )

  it.each([
    { capabilities: ['image-recognition'] as Model['capabilities'] },
    { inputModalities: ['image'] as Model['inputModalities'] }
  ])('retains image input and context limits for the native model', (imageSupport) => {
    const model = makeModel({ ...imageSupport, contextWindow: 200_000, maxOutputTokens: 32_768 })
    const injection = buildPiGatewayInjection(makeProvider({}), model, GATEWAY)
    expect(injection.providerConfig.models?.[0]).toMatchObject({
      input: ['text', 'image'],
      contextWindow: 200_000,
      maxTokens: 32_768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    })
  })
})

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
    const injection = buildPiGatewayInjection(provider, model, GATEWAY)
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
        apiKey: GATEWAY.apiKey,
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

  async function serialize(injection: ReturnType<typeof buildPiGatewayInjection>, reasoning: (typeof levels)[number]) {
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
    const injection = buildPiGatewayInjection(provider(), row, GATEWAY)
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
    const injection = buildPiGatewayInjection(provider(), model('claude-opus-5-5', 'claude-opus-5-5'), GATEWAY)
    expect(injection.providerConfig.models?.[0]?.compat).toEqual({ forceAdaptiveThinking: true })
    const { body } = await serialize(injection, level)
    expect(body.thinking.type).toBe('adaptive')
    expect(body.output_config.effort).toBe(level)
    expect(body.thinking).not.toHaveProperty('budget_tokens')
  })

  it.each(['claude-opus-4-5', 'claude-haiku-4-5'])('keeps budget serialization for %s', async (id) => {
    const injection = buildPiGatewayInjection(provider(), model(id), GATEWAY)
    expect(injection.providerConfig.models?.[0]?.compat ?? {}).not.toHaveProperty('forceAdaptiveThinking')
    const { body, headers } = await serialize(injection, 'high')
    expect(body.thinking).toMatchObject({ type: 'enabled', budget_tokens: 16384 })
    expect(body.output_config?.effort).toBeUndefined()
    expect(headers?.get('anthropic-beta')).toContain('interleaved-thinking-2025-05-14')
  })

  it.each(['claude-opus-4-6', 'claude-sonnet-5-5', 'unknown-model'])('does not widen the dialect fence to %s', (id) => {
    expect(
      buildPiGatewayInjection(provider(), model(id), GATEWAY).providerConfig.models?.[0]?.compat ?? {}
    ).not.toHaveProperty('forceAdaptiveThinking')
  })

  it('composes CherryIN signature compatibility with adaptive thinking', () => {
    expect(
      buildPiGatewayInjection({ ...provider(), id: 'cherryin' }, model(), GATEWAY).providerConfig.models?.[0]?.compat
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
          buildPiGatewayInjection(context, model(), GATEWAY).providerConfig.models?.[0]?.compat ?? {}
        ).not.toHaveProperty('forceAdaptiveThinking')
      } finally {
        providerRegistryService.clearCache()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  })
})
