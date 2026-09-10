import { type Model, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  type DshApi,
  isAgentCompatibleModel,
  mapEndpointToAgentApi,
  type PiApi,
  resolveAgentApi
} from '../agentModelCompatibility'

function makeProvider(overrides: Partial<Provider>): Provider {
  return { id: 'p', name: 'P', ...overrides } as Provider
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'p::m',
    providerId: 'p',
    name: 'M',
    capabilities: [MODEL_CAPABILITY.TEXT_GENERATION],
    contextWindow: 128_000,
    ...overrides
  } as Model
}

const azureProvider = makeProvider({
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: { 'openai-chat-completions': { adapterFamily: 'azure' } }
})

describe.each(['pi', 'dsh'] as const)('%s common model compatibility', (runtime) => {
  it('maps the four native chat protocols', () => {
    expect(mapEndpointToAgentApi(runtime, 'anthropic-messages', 'anthropic')).toBe('anthropic-messages')
    expect(mapEndpointToAgentApi(runtime, 'openai-chat-completions', 'openai-compatible')).toBe('openai-completions')
    expect(mapEndpointToAgentApi(runtime, 'openai-responses', 'openai')).toBe('openai-responses')
    expect(mapEndpointToAgentApi(runtime, 'google-generate-content', 'google')).toBe('google-generative-ai')
  })

  it('rejects adapters whose authentication or URL requirements cannot be injected', () => {
    expect(mapEndpointToAgentApi(runtime, 'openai-chat-completions', 'azure')).toBeUndefined()
    expect(mapEndpointToAgentApi(runtime, 'openai-chat-completions', 'bedrock')).toBeUndefined()
    expect(mapEndpointToAgentApi(runtime, 'google-generate-content', 'google-vertex')).toBeUndefined()
    expect(mapEndpointToAgentApi(runtime, 'anthropic-messages', 'google-vertex-anthropic')).toBeUndefined()
  })

  it('rejects unsupported and missing endpoint types', () => {
    expect(mapEndpointToAgentApi(runtime, 'ollama-chat', 'ollama')).toBeUndefined()
    expect(mapEndpointToAgentApi(runtime, 'openai-embeddings', undefined)).toBeUndefined()
    expect(mapEndpointToAgentApi(runtime, undefined, undefined)).toBeUndefined()
  })

  it('uses the provider default when undeclared, and respects a model-specific declaration', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: {
        'anthropic-messages': { adapterFamily: 'anthropic' },
        'openai-chat-completions': { adapterFamily: 'openai-compatible' }
      }
    })
    expect(resolveAgentApi(runtime, provider, makeModel())).toBe('anthropic-messages')
    expect(resolveAgentApi(runtime, provider, makeModel({ endpointTypes: ['openai-chat-completions'] }))).toBe(
      'openai-completions'
    )
  })

  it('prefers the supported provider default over declaration order, then honors an explicit pin', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-chat-completions',
      endpointConfigs: {
        'openai-chat-completions': { adapterFamily: 'openai-compatible' },
        'anthropic-messages': { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({ endpointTypes: ['anthropic-messages', 'openai-chat-completions'] })
    expect(resolveAgentApi(runtime, provider, model)).toBe('openai-completions')
    expect(resolveAgentApi(runtime, provider, { ...model, preferredEndpointType: 'anthropic-messages' })).toBe(
      'anthropic-messages'
    )
  })

  it('accepts native models even when their context window is unknown', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    })
    expect(isAgentCompatibleModel(runtime, provider, makeModel({ contextWindow: undefined }))).toBe(true)
  })

  it('uses a cloned gateway per-model route before an unsupported provider default', () => {
    const provider = makeProvider({
      id: 'custom-aihubmix',
      presetProviderId: 'aihubmix',
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: {
        'ollama-chat': { adapterFamily: 'ollama' },
        'anthropic-messages': { adapterFamily: 'anthropic' }
      }
    })
    expect(resolveAgentApi(runtime, provider, makeModel({ apiModelId: 'claude-sonnet-4' }))).toBe('anthropic-messages')
  })

  it('cannot directly inject an external CLI login, but DSH can use the gateway', () => {
    const provider = makeProvider({
      id: 'claude-code',
      authMethods: ['external-cli'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    })
    expect(resolveAgentApi(runtime, provider, makeModel())).toBeUndefined()
    expect(isAgentCompatibleModel(runtime, provider, makeModel())).toBe(runtime === 'dsh')
  })
})

describe('runtime-specific compatibility', () => {
  it('supports Azure Responses only through Pi native injection', () => {
    const provider = makeProvider({
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily: 'azure-responses' } }
    })
    expect(resolveAgentApi('pi', provider, makeModel())).toBe('azure-openai-responses')
    expect(resolveAgentApi('dsh', provider, makeModel())).toBeUndefined()
    expectTypeOf(mapEndpointToAgentApi('dsh', 'openai-responses', 'azure-responses')).toEqualTypeOf<
      DshApi | undefined
    >()
    expectTypeOf(mapEndpointToAgentApi('pi', 'openai-responses', 'azure-responses')).toEqualTypeOf<PiApi | undefined>()
    expectTypeOf(resolveAgentApi('dsh', provider, makeModel())).toEqualTypeOf<DshApi | undefined>()
  })

  it.each([
    ['grok-cli', 'grok'],
    ['openai-codex', 'openai']
  ])('supports app-managed OAuth for %s only through Pi native injection', (id, adapterFamily) => {
    const provider = makeProvider({
      id,
      authMethods: ['oauth'],
      defaultChatEndpoint: 'openai-responses',
      endpointConfigs: { 'openai-responses': { adapterFamily } }
    })
    expect(resolveAgentApi('pi', provider, makeModel())).toBe('openai-responses')
    expect(resolveAgentApi('dsh', provider, makeModel())).toBeUndefined()
    expect(isAgentCompatibleModel('pi', provider, makeModel())).toBe(true)
    expect(isAgentCompatibleModel('dsh', provider, makeModel())).toBe(true)
  })

  it.each([
    azureProvider,
    makeProvider({
      defaultChatEndpoint: 'google-generate-content',
      endpointConfigs: { 'google-generate-content': { adapterFamily: 'google-vertex' } }
    }),
    makeProvider({
      authMethods: ['oauth'],
      defaultChatEndpoint: 'anthropic-messages',
      endpointConfigs: { 'anthropic-messages': { adapterFamily: 'anthropic' } }
    }),
    makeProvider({
      defaultChatEndpoint: 'ollama-chat',
      endpointConfigs: { 'ollama-chat': { adapterFamily: 'ollama' } }
    })
  ])('allows a gateway fallback only for DSH: %j', (provider) => {
    expect(resolveAgentApi('dsh', provider, makeModel())).toBeUndefined()
    expect(isAgentCompatibleModel('dsh', provider, makeModel())).toBe(true)
    expect(isAgentCompatibleModel('pi', provider, makeModel())).toBe(false)
  })

  it('rejects fallback models without chat capability or a valid gateway address', () => {
    expect(
      isAgentCompatibleModel(
        'dsh',
        azureProvider,
        makeModel({
          capabilities: [MODEL_CAPABILITY.EMBEDDING],
          endpointTypes: ['openai-embeddings']
        })
      )
    ).toBe(false)
    expect(
      isAgentCompatibleModel('dsh', { ...azureProvider, id: 'corp:west' }, makeModel({ providerId: 'corp:west' }))
    ).toBe(false)
  })

  it('requires gateway fallback models to accept text input', () => {
    expect(isAgentCompatibleModel('dsh', azureProvider, makeModel({ inputModalities: [] }))).toBe(true)
    expect(isAgentCompatibleModel('dsh', azureProvider, makeModel({ inputModalities: ['text', 'image'] }))).toBe(true)
    expect(isAgentCompatibleModel('dsh', azureProvider, makeModel({ inputModalities: ['image'] }))).toBe(false)
    expect(isAgentCompatibleModel('dsh', azureProvider, makeModel({ inputModalities: ['audio'] }))).toBe(false)
  })
})
