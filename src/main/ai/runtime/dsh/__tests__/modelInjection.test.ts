import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import { ENDPOINT_TYPE, type Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

const mocks = vi.hoisted(() => ({
  resolveApiKey: vi.fn(),
  getApiKeys: vi.fn(),
  getByProviderId: vi.fn(),
  getByKey: vi.fn(),
  resolveApiGatewayRuntime: vi.fn(),
  getCurrentConfig: vi.fn(),
  ApiGatewayNotRunningError: class ApiGatewayNotRunningError extends Error {}
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    resolveApiKey: mocks.resolveApiKey,
    getApiKeys: mocks.getApiKeys,
    getByProviderId: mocks.getByProviderId
  }
}))
vi.mock('@data/services/ModelService', () => ({ modelService: { getByKey: mocks.getByKey } }))
vi.mock('@main/ai/runtime/agentApiGateway', () => ({
  ApiGatewayNotRunningError: mocks.ApiGatewayNotRunningError,
  resolveApiGatewayRuntime: mocks.resolveApiGatewayRuntime
}))
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ApiGatewayService') return { getCurrentConfig: mocks.getCurrentConfig }
      throw new Error(`unexpected service ${name}`)
    }
  }
}))

import { buildDshCompositionYaml } from '../compositionBuilder'
import {
  assertDshProviderUsable,
  buildDshGatewayInjection,
  buildDshProviderInjection,
  DshUnsupportedProviderError,
  resolveDshProviderInjectionFromSnapshot
} from '../modelInjection'

const GATEWAY_KEY = 'sk-cherry-gateway-secret'
const GATEWAY_USAGE_HEADERS = {
  'x-cherry-agent-session-id': 'session-1',
  'x-cherry-internal-usage-token': 'usage-token'
}
const GATEWAY = { baseUrl: 'http://127.0.0.1:23333', apiKey: GATEWAY_KEY, usageHeaders: GATEWAY_USAGE_HEADERS }

/** A Vertex-family Google provider: no native dsh wire family, but gateway-routable. */
const vertexProvider = {
  id: 'vertexai',
  name: 'Vertex AI',
  reportsActualCost: false,
  defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
  endpointConfigs: {
    [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: {
      adapterFamily: 'google-vertex',
      baseUrl: 'https://aiplatform.googleapis.com'
    }
  }
} as unknown as Provider

const nativeProvider = {
  id: 'deepseek',
  name: 'DeepSeek',
  reportsActualCost: false,
  defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
  endpointConfigs: {
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai', baseUrl: 'https://api.deepseek.com' }
  }
} as unknown as Provider

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'vertexai::gemini-2.5-pro',
    providerId: 'vertexai',
    apiModelId: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    capabilities: [],
    contextWindow: 1_000_000,
    maxOutputTokens: 8_192,
    ...overrides
  } as unknown as Model
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveApiGatewayRuntime.mockResolvedValue(GATEWAY)
  mocks.resolveApiKey.mockReturnValue({ value: 'sk-native', apiKeySelection: { attribution: 'unknown' } })
})

describe('buildDshGatewayInjection', () => {
  it('fronts the model as an OpenAI-compatible gateway route with provider-calls usage capture', () => {
    const injection = buildDshGatewayInjection(vertexProvider, makeModel(), GATEWAY)

    expect(injection.api).toBe('openai-completions')
    expect(injection.baseUrl).toBe('http://127.0.0.1:23333/v1')
    expect(injection.modelId).toBe('vertexai:gemini-2.5-pro')
    expect(injection.modelConfig.id).toBe('vertexai:gemini-2.5-pro')
    expect(injection.apiKey).toBe(GATEWAY_KEY)
    expect(injection.headers).toEqual(GATEWAY_USAGE_HEADERS)
    expect(injection.usageCapture).toEqual({ owner: 'provider-calls' })
  })

  it('keeps the gateway key out of the YAML — only the env indirection', () => {
    const injection = buildDshGatewayInjection(vertexProvider, makeModel(), GATEWAY)
    const yaml = buildDshCompositionYaml({
      providerName: injection.providerName,
      api: injection.api,
      baseUrl: injection.baseUrl,
      ...(injection.headers ? { headers: injection.headers } : {}),
      modelConfig: injection.modelConfig,
      workspacePath: '/tmp/ws',
      dshRoot: '/tmp/root',
      sessionsRoot: '/tmp/sessions',
      permissionMode: 'default',
      persona: '',
      customBase: false,
      skillDirs: []
    })

    expect(yaml).not.toContain(GATEWAY_KEY)
    const route = (parse(yaml) as Array<{ id: string; config?: any }>).find((entry) => entry.id === 'llm')?.config
      ?.providers?.[injection.providerName]
    expect(route).toMatchObject({
      apiKeyEnv: 'CHERRY_DSH_API_KEY',
      api: 'openai-completions',
      baseURL: 'http://127.0.0.1:23333/v1',
      headers: GATEWAY_USAGE_HEADERS
    })
    expect(route).not.toHaveProperty('apiKey')
    expect(route.models[0].id).toBe('vertexai:gemini-2.5-pro')
  })

  it('rejects models the gateway cannot route and defaults an undeclared context window', () => {
    const nonChat = makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS] })
    expect(() => buildDshGatewayInjection(vertexProvider, nonChat, GATEWAY)).toThrow(DshUnsupportedProviderError)

    const windowless = makeModel({ contextWindow: undefined })
    expect(buildDshGatewayInjection(vertexProvider, windowless, GATEWAY).modelConfig.contextWindow).toBe(256_000)
  })
})

describe('buildDshProviderInjection', () => {
  it('coerces user headers to the strings the dsh route schema accepts', () => {
    const provider = {
      ...nativeProvider,
      settings: { extraHeaders: { 'x-trace': 'on', 'x-legacy': 42, 'x-broken': { a: 1 } } }
    } as unknown as Provider
    const model = makeModel({ id: 'deepseek::deepseek-chat', providerId: 'deepseek', apiModelId: 'deepseek-chat' })

    const injection = buildDshProviderInjection(provider, model, 'sk-native')

    expect(injection.headers).toEqual({ 'x-trace': 'on', 'x-legacy': '42' })
  })
})

describe('resolveDshProviderInjectionFromSnapshot', () => {
  it.each([
    [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai-completions'],
    [ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai-responses']
  ] as const)('uses the resolved endpoint dialect for %s developer-role compatibility', (endpointType, api) => {
    const model = makeModel({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat',
      endpointTypes: [endpointType],
      contextWindow: 128_000
    })
    const provider = {
      ...nativeProvider,
      defaultChatEndpoint: endpointType,
      endpointConfigs: {
        [endpointType]: { adapterFamily: 'openai', baseUrl: 'https://api.deepseek.com' }
      }
    } as unknown as Provider
    const withoutDeveloperRole = buildDshProviderInjection(provider, model, 'sk-native')
    const withDeveloperRole = buildDshProviderInjection(
      {
        ...provider,
        endpointConfigs: {
          [endpointType]: {
            ...provider.endpointConfigs?.[endpointType],
            dialect: { developerRole: true }
          }
        }
      },
      model,
      'sk-native'
    )

    expect(withoutDeveloperRole.api).toBe(api)
    expect(withoutDeveloperRole.modelConfig.compat).toEqual({ supportsDeveloperRole: false })
    expect(withDeveloperRole.modelConfig.compat).toEqual({ supportsDeveloperRole: true })
  })

  it('keeps native providers on the native route with agent-sdk usage capture', async () => {
    const model = makeModel({
      id: 'deepseek::deepseek-chat',
      providerId: 'deepseek',
      apiModelId: 'deepseek-chat',
      contextWindow: 128_000
    })
    const injection = await resolveDshProviderInjectionFromSnapshot('session-1', nativeProvider, model)

    expect(injection.api).toBe('openai-completions')
    expect(injection.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(injection.apiKey).toBe('sk-native')
    expect(injection.usageCapture).toMatchObject({ owner: 'agent-sdk', providerId: 'deepseek' })
    expect(mocks.resolveApiGatewayRuntime).not.toHaveBeenCalled()
  })

  it('falls back to the gateway without consuming native key rotation', async () => {
    const injection = await resolveDshProviderInjectionFromSnapshot('session-1', vertexProvider, makeModel())

    expect(mocks.resolveApiGatewayRuntime).toHaveBeenCalledWith('session-1')
    expect(mocks.resolveApiKey).not.toHaveBeenCalled()
    expect(injection.apiKey).toBe(GATEWAY_KEY)
    expect(injection.headers).toEqual(GATEWAY_USAGE_HEADERS)
    expect(injection.usageCapture).toEqual({ owner: 'provider-calls' })
  })

  it('propagates the disabled-gateway consent error', async () => {
    mocks.resolveApiGatewayRuntime.mockRejectedValue(new mocks.ApiGatewayNotRunningError())

    await expect(resolveDshProviderInjectionFromSnapshot('session-1', vertexProvider, makeModel())).rejects.toThrow(
      mocks.ApiGatewayNotRunningError
    )
  })
})

describe('assertDshProviderUsable', () => {
  it('accepts a gateway-routable model when the gateway is enabled, without key side effects', async () => {
    mocks.getByProviderId.mockReturnValue(vertexProvider)
    mocks.getByKey.mockReturnValue(makeModel())
    mocks.getCurrentConfig.mockReturnValue({ enabled: true })

    await expect(assertDshProviderUsable('vertexai::gemini-2.5-pro')).resolves.toBeUndefined()
    expect(mocks.getApiKeys).not.toHaveBeenCalled()
    expect(mocks.resolveApiGatewayRuntime).not.toHaveBeenCalled()
  })

  it('fails closed on the persisted intent when the gateway is disabled', async () => {
    mocks.getByProviderId.mockReturnValue(vertexProvider)
    mocks.getByKey.mockReturnValue(makeModel())
    mocks.getCurrentConfig.mockReturnValue({ enabled: false })

    await expect(assertDshProviderUsable('vertexai::gemini-2.5-pro')).rejects.toThrow(mocks.ApiGatewayNotRunningError)
  })

  it('still reports unsupported when the model is not gateway-routable either', async () => {
    mocks.getByProviderId.mockReturnValue(vertexProvider)
    mocks.getByKey.mockReturnValue(makeModel({ endpointTypes: [ENDPOINT_TYPE.OPENAI_EMBEDDINGS] }))

    await expect(assertDshProviderUsable('vertexai::gemini-2.5-pro')).rejects.toThrow(DshUnsupportedProviderError)
  })
})
