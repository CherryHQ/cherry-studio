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
