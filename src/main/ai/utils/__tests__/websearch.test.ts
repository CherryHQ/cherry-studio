import type { Model } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { buildProviderBuiltinWebSearchConfig, getWebSearchParams } from '../websearch'

const webSearchConfig = { maxResults: 50, excludeDomains: [] }

const model = (partial: Partial<Model>): Model => partial as Model

describe('buildProviderBuiltinWebSearchConfig', () => {
  it('emits a bare openai config for doubao so only {type:"web_search"} reaches Ark', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'doubao::doubao-seed-2-1-pro', providerId: 'doubao', apiModelId: 'doubao-seed-2-1-pro' })
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
      model({ id: 'dashscope::qwen3.8-max', providerId: 'dashscope' })
    )
    expect(config).toEqual({ openai: {} })
  })

  it('emits a bare openai config for dashscope responses models (bare {type:"web_search"} for Bailian)', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'dashscope::qwen3-7-max', providerId: 'dashscope', apiModelId: 'qwen3.7-max' })
    )
    expect(config).toEqual({ openai: {} })
  })

  it('keeps searchContextSize for real openai models', () => {
    const config = buildProviderBuiltinWebSearchConfig(
      'openai',
      webSearchConfig,
      model({ id: 'openai::gpt-5.5', providerId: 'openai', apiModelId: 'gpt-5.5' })
    )
    expect(config).toEqual({ openai: { searchContextSize: 'medium' } })
  })
})

/**
 * Bailian serves built-in search through two different mechanisms, split by endpoint: the Responses
 * `web_search` tool (Qwen3.x line only) and Chat Completions' `enable_search` params. This matrix pins
 * which mechanism each SKU gets, so a model can never be handed the one its endpoint does not serve.
 */
describe('dashscope built-in web search: endpoint x model matrix', () => {
  const dashscope = (apiModelId: string) =>
    model({ id: `dashscope::${apiModelId}`, providerId: 'dashscope', apiModelId })

  // Responses tool: "Responses API 仅支持 Qwen3.7 Max系列、Qwen3.6、Qwen3.5、qwen3-max".
  it.each(['qwen3.7-max', 'qwen3.6-plus', 'qwen3.6-flash', 'qwen3.5-plus', 'qwen3.5-flash', 'qwen3-max'])(
    'attaches the Responses web_search tool for %s',
    (apiModelId) => {
      expect(buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, dashscope(apiModelId))).toEqual({
        openai: {}
      })
    }
  )

  // These search via Chat's enable_search; on Responses they must get NO tool. `undefined` (not `{}`) is
  // what actually suppresses it — providerWebSearchFeature applies on a truthy config.
  it.each(['qwen-plus', 'qwen-flash', 'qwen-plus-character', 'qwq-plus', 'deepseek-v3.2', 'MiniMax-M2.1'])(
    'attaches no Responses tool for %s, whose search is Chat-only',
    (apiModelId) => {
      expect(buildProviderBuiltinWebSearchConfig('openai', webSearchConfig, dashscope(apiModelId))).toBeUndefined()
    }
  )

  // The chat path is unaffected either way: every search-capable SKU still gets enable_search there.
  it.each(['qwen-plus', 'qwen3.7-max', 'deepseek-v3.2'])('still sends enable_search on chat for %s', (apiModelId) => {
    expect(getWebSearchParams(dashscope(apiModelId))).toMatchObject({ enable_search: true })
  })

  // qwen3-max needs the agent strategy in either thinking mode (非思考模式 requires `agent`).
  it('pins search_strategy=agent for qwen3-max on chat', () => {
    expect(getWebSearchParams(dashscope('qwen3-max'))).toEqual({
      enable_search: true,
      search_options: { forced_search: true, search_strategy: 'agent' }
    })
  })
})

describe('getWebSearchParams (dashscope chat)', () => {
  it('enables search without a strategy for standard qwen models', () => {
    const params = getWebSearchParams(
      model({ id: 'dashscope::qwen-plus', providerId: 'dashscope', apiModelId: 'qwen-plus' })
    )
    expect(params).toEqual({ enable_search: true, search_options: { forced_search: true } })
  })

  it('adds the agent strategy for qwen-max / multimodal SKUs that require it', () => {
    const params = getWebSearchParams(
      model({ id: 'dashscope::qwen3-max', providerId: 'dashscope', apiModelId: 'qwen3-max' })
    )
    expect(params).toEqual({ enable_search: true, search_options: { forced_search: true, search_strategy: 'agent' } })
  })
})
