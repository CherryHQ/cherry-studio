import { describe, expect, it } from 'vitest'

import { splitOverrideWireId } from '../../scripts/canonicalize'
import { PROVIDERS } from '../providers'

/**
 * Per-model endpoint pins are a VENDOR CAPABILITY MATRIX, so they are asserted against the
 * vendor docs rather than against whatever the source happens to say.
 *
 * The invariant that matters: `resolveEffectiveEndpoint` takes `endpointTypes[0]`, and a model
 * absent from `endpointTypes` cannot be reached at all from the endpoint picker. So a one-element
 * pin REMOVES an endpoint, and must be justified by the vendor actually not serving it.
 */
const provider = (providerId: string) => {
  const result = PROVIDERS.find(({ id }) => id === providerId)
  if (!result) throw new Error(`Missing provider: ${providerId}`)
  return result
}

// Look up by the CANONICAL key the catalog ships: source authors `modelId` as the served id
// (`qwen3.7-max`), and generation splits it into key + `apiModelId` (see splitOverrideWireId).
const endpointsOf = (providerId: string, modelId: string): string[] | undefined => {
  const entry = provider(providerId)
    .overrides?.map((o) => splitOverrideWireId(o))
    .find((o) => o.modelId === modelId)
  if (!entry) throw new Error(`Missing override: ${providerId}/${modelId}`)
  return entry.endpointTypes as string[] | undefined
}

describe('dashscope (Bailian) endpoint matrix', () => {
  /**
   * Bailian serves the whole qwen line on Chat Completions — the OpenAI-compatible Chat doc
   * (help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) lists qwen3.7-max,
   * qwen3.6-plus, qwen3.6-flash and qwen3.8-max-preview among its supported models, and its only
   * "仅…支持" carve-outs are Qwen-Audio / qwen-long / qwen-doc-turbo. So NO qwen may be pinned
   * Responses-only: the newest SKUs prefer Responses but must keep Chat selectable.
   *
   * This previously regressed by reading "Responses API 仅支持 Qwen3.7 Max系列、Qwen3.6、Qwen3.5、
   * qwen3-max" (a statement about which models the Responses *web-search tool* covers) as if it
   * said those models support only Responses.
   */
  it.each(['qwen3-7-max', 'qwen3-6-plus', 'qwen3-6-flash', 'qwen3-8-max-preview'])(
    'prefers Responses but keeps Chat Completions selectable for %s',
    (modelId) => {
      expect(endpointsOf('dashscope', modelId)).toEqual(['openai-responses', 'openai-chat-completions'])
    }
  )

  // These search via Chat's `enable_search` (the Responses web_search tool is Qwen3.x-only), so
  // Chat leads — but Responses stays reachable. See `servesResponsesWebSearch` in
  // src/main/ai/utils/websearch.ts.
  it.each(['qwen-plus', 'qwen-flash', 'qwen-plus-character'])(
    'orders Chat Completions first for %s, whose built-in search is Chat-only',
    (modelId) => {
      expect(endpointsOf('dashscope', modelId)).toEqual(['openai-chat-completions', 'openai-responses'])
    }
  )

  it('never pins any dashscope model to a single endpoint', () => {
    const singlePinned = (provider('dashscope').overrides ?? [])
      .filter((o) => o.endpointTypes?.length === 1)
      .map((o) => `${o.modelId}:${o.endpointTypes?.join()}`)
    expect(singlePinned).toEqual([])
  })
})

describe('deepseek endpoint matrix', () => {
  it('uses the native OpenAI adapter for the official Responses endpoint', () => {
    expect(provider('deepseek').endpointConfigs?.['openai-responses']).toEqual({
      adapterFamily: 'openai',
      baseUrl: 'https://api.deepseek.com',
      reasoningFormat: { type: 'openai-responses' }
    })
  })

  it('advertises the Responses API built-in web search tool', () => {
    expect(provider('deepseek').serverTools).toEqual([{ id: 'web-search', modelScope: 'model-dependent' }])
  })

  it('prefers Responses for V4 Flash while keeping Chat Completions selectable', () => {
    expect(endpointsOf('deepseek', 'deepseek-v4-flash')).toEqual([
      'openai-responses',
      'openai-chat-completions',
      'anthropic-messages'
    ])
  })

  /**
   * The Anthropic-compatible endpoint (api-docs.deepseek.com/zh-cn/guides/anthropic_api,
   * https://api.deepseek.com/anthropic) documents V4 Pro and V4 Flash only — it maps `claude-opus*`
   * onto v4-pro, `claude-sonnet*`/`claude-haiku*` onto v4-flash, and silently rewrites any other
   * model name to v4-flash. So chat/reasoner stay off it: reaching them through it would serve a
   * different model than the one selected. It trails Chat Completions on both V4 SKUs because
   * `endpointTypes[0]` is what routes in-app chat.
   */
  it('exposes the Anthropic-compatible endpoint on V4 Pro without displacing its Chat default', () => {
    expect(endpointsOf('deepseek', 'deepseek-v4-pro')).toEqual(['openai-chat-completions', 'anthropic-messages'])
  })

  it.each(['deepseek-chat', 'deepseek-reasoner'])(
    'pins %s to Chat Completions, the only endpoint DeepSeek serves it on',
    (modelId) => {
      expect(endpointsOf('deepseek', modelId)).toEqual(['openai-chat-completions'])
    }
  )
})

describe('doubao (Ark) endpoint matrix', () => {
  // Ark serves /responses for the 250615+ line only (docs/82379/1585128), so here a single-element
  // pin IS correct — the vendor genuinely does not serve the other endpoint.
  it.each(['doubao-seed-2-1-pro', 'doubao-seed-1-6', 'doubao-seed-1-8'])(
    'prefers Responses with Chat selectable for the 250615+ SKU %s',
    (modelId) => {
      expect(endpointsOf('doubao', modelId)).toEqual(['openai-responses', 'openai-chat-completions'])
    }
  )

  it.each([
    'doubao-seed-1-6-flash', // built-in tools discouraged on flash
    'deepseek-v4-pro', // reasoning_effort on chat only (responses 待支持)
    'doubao-1-5-thinking-pro' // pre-250615, not served by /responses at all
  ])('pins %s to Chat Completions, which is the only endpoint Ark serves for it', (modelId) => {
    expect(endpointsOf('doubao', modelId)).toEqual(['openai-chat-completions'])
  })
})
