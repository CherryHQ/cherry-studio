import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE, type EndpointType, type Model, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { resolveWebToolRoutes } from '@shared/utils/provider'

import { buildCapabilityProviderOptions } from '../options'
import { buildProviderBuiltinWebSearchConfig, getWebSearchParams } from '../websearch'

const webSearchConfig = { maxResults: 50, excludeDomains: [] }

const model = (partial: Partial<Model>): Model => partial as Model
/** Canonical preset provider (id === preset id) and a user-copied one that keeps its own id. */
const preset = (presetProviderId: string): Provider => ({ id: presetProviderId, presetProviderId }) as Provider
const copyOf = (presetProviderId: string): Provider => ({ id: 'user-copy-1', presetProviderId }) as Provider

describe('buildProviderBuiltinWebSearchConfig', () => {
  it('emits a bare openai config for doubao so only {type:"web_search"} reaches Ark', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'doubao::doubao-seed-2-1-pro', providerId: 'doubao', apiModelId: 'doubao-seed-2-1-pro' }),
      preset('doubao')
    )
    expect(config).toEqual({ openai: {} })
  })

  it('emits a bare openai config for DeepSeek Responses web search', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'deepseek::deepseek-v4-flash', providerId: 'deepseek', apiModelId: 'deepseek-v4-flash' }),
      preset('deepseek')
    )
    expect(config).toEqual({ openai: {} })
  })

  // Availability keys off the wire id with an `apiModelId ?? id` fallback, so a model
  // carrying the wire name in `id` alone still routes to the server side. Reading
  // `apiModelId` directly here made the config undefined for exactly those models:
  // the route stayed 'server' (client tools withheld) and nothing was injected.
  it('resolves the dashscope responses config from the wire id even without apiModelId', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'dashscope::qwen3.8-max', providerId: 'dashscope' }),
      preset('dashscope')
    )
    expect(config).toEqual({ openai: {} })
  })

  it('emits a bare openai config for dashscope responses models (bare {type:"web_search"} for Bailian)', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'dashscope::qwen3-7-max', providerId: 'dashscope', apiModelId: 'qwen3.7-max' }),
      preset('dashscope')
    )
    expect(config).toEqual({ openai: {} })
  })

  it('emits the openrouter web_search server-tool args (camelCase, mapped to the wire tool)', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openrouter',
      webSearchConfig,
      model({ id: 'openrouter::anthropic/claude-4', providerId: 'openrouter', apiModelId: 'anthropic/claude-4' }),
      preset('openrouter')
    )
    expect(config).toEqual({ openrouter: { maxResults: 50 } })
  })

  it('forwards excluded domains to the openrouter web_search tool (→ excluded_domains)', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openrouter',
      { maxResults: 10, excludeDomains: ['example.com', 'https://foo.dev/bar'] },
      model({ id: 'openrouter::x/y', providerId: 'openrouter', apiModelId: 'x/y' }),
      preset('openrouter')
    )
    expect(config).toEqual({ openrouter: { maxResults: 10, excludedDomains: ['example.com', 'foo.dev'] } })
  })

  it('keeps searchContextSize for real openai models', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'openai::gpt-5.5', providerId: 'openai', apiModelId: 'gpt-5.5' }),
      preset('openai')
    )
    expect(config).toEqual({ openai: { searchContextSize: 'medium' } })
  })
})

/**
 * Bailian serves built-in search through two different mechanisms, split by endpoint: the Responses
 * `web_search` tool (Qwen3.x and documented hosted SKUs) and Chat Completions' `enable_search` params. This matrix pins
 * which mechanism each SKU gets, so a model can never be handed the one its endpoint does not serve.
 */
describe('dashscope built-in web search: endpoint x model matrix', () => {
  const dashscope = (apiModelId: string) =>
    model({ id: `dashscope::${apiModelId}`, providerId: 'dashscope', apiModelId })

  // Qwen3.x retains its Responses search tool.
  it.each([
    'qwen3.8-max',
    'qwen3.8-flash',
    'qwen3.7-max',
    'qwen3.6-plus',
    'qwen3.6-flash',
    'qwen3.5-plus',
    'qwen3.5-flash',
    'qwen3-max'
  ])('attaches the Responses web_search tool for %s', (apiModelId) => {
    expect(
      buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, dashscope(apiModelId), preset('dashscope'))
    ).toEqual({
      openai: {}
    })
  })

  // These search via Chat's enable_search; on Responses they must get NO tool. `undefined` (not `{}`) is
  // what actually suppresses it — providerWebSearchFeature applies on a truthy config.
  it.each(['qwen-plus', 'qwen-flash', 'qwen-plus-character', 'qwq-plus', 'deepseek-v3.2', 'MiniMax-M2.1'])(
    'attaches no Responses tool for %s, whose search is Chat-only',
    (apiModelId) => {
      expect(
        buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, dashscope(apiModelId), preset('dashscope'))
      ).toBeUndefined()
    }
  )

  // The chat path is unaffected either way: every search-capable SKU still gets enable_search there.
  it.each(['qwen-plus', 'qwen3.7-max', 'deepseek-v3.2'])('still sends enable_search on chat for %s', (apiModelId) => {
    expect(getWebSearchParams(dashscope(apiModelId), preset('dashscope'))).toMatchObject({ enable_search: true })
  })

  // qwen3-max needs the agent strategy in either thinking mode (非思考模式 requires `agent`).
  it('pins search_strategy=agent for qwen3-max on chat', () => {
    expect(getWebSearchParams(dashscope('qwen3-max'), preset('dashscope'))).toEqual({
      enable_search: true,
      search_options: { forced_search: true, search_strategy: 'agent' }
    })
  })

  // When the model also serves the web-extractor (url-context) tool, the strategy upgrades to
  // `agent_max`, which fetches full page content (help.aliyun.com/zh/model-studio/web-extractor).
  it('upgrades to agent_max for a model that serves the web-extractor tool', () => {
    const dashscopeWithExtractor = {
      id: 'dashscope',
      presetProviderId: 'dashscope',
      serverTools: [{ id: 'url-context', modelScope: 'model-dependent' }]
    } as unknown as Provider
    const extractorModel = model({
      id: 'dashscope::qwen3-max',
      providerId: 'dashscope',
      apiModelId: 'qwen3-max',
      capabilities: []
    })
    expect(getWebSearchParams(extractorModel, dashscopeWithExtractor)).toEqual({
      enable_search: true,
      search_options: { forced_search: true, search_strategy: 'agent_max' }
    })
  })
})

// A user-copied provider keeps its own id but still gets the preset's serverTools and the preset's
// request transform, so delivery must key off the preset link — not `model.providerId`. Keying it off
// the runtime id routed these copies to the server side and then injected nothing.
// Kimi's tool executes a formula fiber, so it needs THIS request's credential. The factory cannot
// read it off the provider instance — `getToolProvider` re-creates that one with no settings when an
// instance is cached, which made every search fail with "Moonshot API key is missing".
describe('moonshot formula credentials', () => {
  it('passes the resolved serving credential to the tool factory', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'moonshot',
      webSearchConfig,
      model({ id: 'moonshot::kimi-k3', providerId: 'moonshot', apiModelId: 'kimi-k3' }),
      preset('moonshot'),
      { apiKey: 'sk-live', baseURL: 'https://api.moonshot.cn/v1' }
    )
    expect(config).toEqual({ moonshot: { apiKey: 'sk-live', baseURL: 'https://api.moonshot.cn/v1' } })
  })
})

describe('preset-derived (copied) providers deliver like their preset', () => {
  it('emits the zhipu marker for a copied Zhipu provider', () => {
    const params = getWebSearchParams(
      model({ id: 'user-copy-1::glm-5', providerId: 'user-copy-1', apiModelId: 'glm-5' }),
      copyOf('zhipu')
    )
    expect(params).toEqual({ web_search: { enable: true, search_engine: 'search_pro', search_result: true } })
  })

  it('emits the bare Ark tool for a copied Doubao provider instead of openai knobs', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'user-copy-1::doubao-seed-2-1-pro', providerId: 'user-copy-1', apiModelId: 'doubao-seed-2-1-pro' }),
      copyOf('doubao')
    )
    expect(config).toEqual({ openai: {} })
  })

  it('keeps enable_search for a copied Bailian provider', () => {
    const params = getWebSearchParams(
      model({ id: 'user-copy-1::qwen-plus', providerId: 'user-copy-1', apiModelId: 'qwen-plus' }),
      copyOf('dashscope')
    )
    expect(params).toMatchObject({ enable_search: true })
  })
})

describe('getWebSearchParams (zhipu chat)', () => {
  it('emits the web_search marker for the transform to move into tools', () => {
    const params = getWebSearchParams(
      model({ id: 'zhipu::glm-5', providerId: 'zhipu', apiModelId: 'glm-5' }),
      preset('zhipu')
    )
    expect(params).toEqual({
      web_search: { enable: true, search_engine: 'search_pro', search_result: true }
    })
  })
})

describe('getWebSearchParams (dashscope chat)', () => {
  it('enables search without a strategy for standard qwen models', () => {
    const params = getWebSearchParams(
      model({ id: 'dashscope::qwen-plus', providerId: 'dashscope', apiModelId: 'qwen-plus' }),
      preset('dashscope')
    )
    expect(params).toEqual({ enable_search: true, search_options: { forced_search: true } })
  })

  it('adds the agent strategy for qwen-max / multimodal SKUs that require it', () => {
    const params = getWebSearchParams(
      model({ id: 'dashscope::qwen3-max', providerId: 'dashscope', apiModelId: 'qwen3-max' }),
      preset('dashscope')
    )
    expect(params).toEqual({ enable_search: true, search_options: { forced_search: true, search_strategy: 'agent' } })
  })
})

describe('DashScope routed search delivery', () => {
  const chat = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  const responses = ENDPOINT_TYPE.OPENAI_RESPONSES
  const host = (id = 'dashscope'): Provider =>
    ({
      id,
      presetProviderId: 'dashscope',
      defaultChatEndpoint: chat,
      serverTools: [
        { id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' },
        { id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent' }
      ]
    }) as Provider
  const hosted = (wireId: string, providerId = 'dashscope', apiModelId: string | undefined = wireId) =>
    model({
      id: `${providerId}::${wireId}`,
      providerId,
      apiModelId,
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
    })
  const delivery = (m: Model, p: Provider, endpointType: EndpointType, clientSearchAvailable: boolean) => {
    const route = resolveWebToolRoutes(m, p, {
      webSearchEnabled: true,
      modelToolsPreferred: true,
      clientSearchAvailable,
      clientFetchAvailable: false,
      endpointType
    })
    const runtimeProviderId = endpointType === responses ? 'openai' : 'openai-compatible'
    const options = buildCapabilityProviderOptions(
      m,
      p,
      {
        enableReasoning: false,
        enableWebSearch: route.webSearch === 'server',
        enableGenerateImage: false
      },
      {
        aiSdkProviderId: runtimeProviderId,
        runtimeProviderId,
        providerOptionsKey: runtimeProviderId,
        endpointType,
        reasoning: { kind: 'omit', selection: 'default', emissions: [] }
      }
    )
    return { route, options }
  }
  const expectNoChatSearch = (options: unknown) => {
    expect(JSON.stringify(options)).not.toContain('"enable_search"')
    expect(JSON.stringify(options)).not.toContain('"search_options"')
  }

  describe.each(['dashscope', 'user-copy-1'])('%s', (providerId) => {
    it.each(['glm-5.2', 'kimi/kimi-k3', 'kimi-k3'])(
      'routes %s through client/none on Chat and server on Responses',
      (wireId) => {
        const p = host(providerId)
        for (const apiModelId of [wireId, undefined, '']) {
          const m = hosted(wireId, providerId)
          m.apiModelId = apiModelId
          const client = delivery(m, p, chat, true)
          const none = delivery(m, p, chat, false)
          expect(client.route.webSearch).toBe('client')
          expect(none.route.webSearch).toBe('none')
          expectNoChatSearch(client.options)
          expectNoChatSearch(none.options)
          const server = delivery(m, p, responses, true)
          expect(server.route.webSearch).toBe('server')
          expectNoChatSearch(server.options)
          expect(buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, m, preset('dashscope'))).toEqual({
            openai: {}
          })
          expect(buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, m, p)).toEqual({ openai: {} })
        }
      }
    )
  })

  it.each(['glm-5.2', 'kimi/kimi-k3', 'kimi-k3'])(
    'omits invalid Chat keys independently of route assertions for %s',
    (wireId) => {
      for (const ready of [true, false]) {
        expectNoChatSearch(delivery(hosted(wireId), host(), chat, ready).options)
      }
    }
  )

  it.each(['glm-5.2', 'kimi/kimi-k3', 'kimi-k3'])('emits the bare Responses config for hosted %s', (wireId) => {
    expect(buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, hosted(wireId), host())).toEqual({
      openai: {}
    })
  })

  it.each([
    'glm-5.3',
    'glm-5.2-fast',
    'kimi-k3-fast',
    'kimi/kimi-k3-fast',
    'kimi-latest',
    'glm-4',
    'glm-5',
    'glm-5.1',
    'kimi-k2',
    'kimi-k2.7-code',
    'kimi-k3-1-pro',
    'glm-5-2',
    'GLM-5.2',
    'other/glm-5.2',
    'other/kimi-k3',
    'glm-5.2-2026-10-01'
  ])('never delivers native search for unlisted wire id %s', (wireId) => {
    const m = hosted(wireId)
    if (wireId === 'glm-5-2') m.apiModelId = undefined
    for (const endpoint of [chat, responses]) {
      for (const ready of [true, false]) {
        const result = delivery(m, host(), endpoint, ready)
        expect(result.route.webSearch).toBe(ready ? 'client' : 'none')
        expectNoChatSearch(result.options)
      }
    }
    expect(buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, m, host())).toBeUndefined()
  })

  it.each(['qwen3-max', 'qwen3.7-max', 'qwen3.8-max', 'qwen-plus', 'qwen-flash'])(
    'preserves agent_max Chat payload for extractor-capable %s',
    (wireId) => {
      const m = hosted(wireId)
      expect(delivery(m, host(), chat, true).route.webSearch).toBe('server')
      expect(getWebSearchParams(m, host())).toEqual({
        enable_search: true,
        search_options: { forced_search: true, search_strategy: 'agent_max' }
      })
      expect(JSON.stringify(getWebSearchParams(m, host()))).toBe(
        '{"enable_search":true,"search_options":{"forced_search":true,"search_strategy":"agent_max"}}'
      )
    }
  )

  it.each(['deepseek-v3', 'deepseek-v3.2', 'deepseek-v4-pro', 'deepseek-v4-flash'])(
    'preserves the DeepSeek Chat payload for %s',
    (wireId) => {
      const m = hosted(wireId)
      expect(delivery(m, host(), chat, true).route.webSearch).toBe('server')
      expect(getWebSearchParams(m, host())).toEqual({ enable_search: true, search_options: { forced_search: true } })
      expect(JSON.stringify(getWebSearchParams(m, host()))).toBe(
        '{"enable_search":true,"search_options":{"forced_search":true}}'
      )
    }
  )
})
