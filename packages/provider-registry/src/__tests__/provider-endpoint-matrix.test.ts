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
  it('serves the official Responses endpoint through the OpenAI adapter', () => {
    expect(provider('deepseek').endpointConfigs?.['openai-responses']).toEqual({
      adapterFamily: 'openai',
      baseUrl: 'https://api.deepseek.com',
      reasoningFormat: { type: 'openai-responses' }
    })
  })

  it('advertises the Responses API built-in web search tool', () => {
    expect(provider('deepseek').serverTools).toEqual([
      {
        id: 'web-search',
        modelScope: 'model-dependent',
        modelIdPrefixes: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        endpointTypes: ['openai-responses']
      }
    ])
  })

  /**
   * The Anthropic-compatible endpoint (api-docs.deepseek.com/zh-cn/guides/anthropic_api,
   * https://api.deepseek.com/anthropic) documents V4 Pro and V4 Flash only — it maps `claude-opus*`
   * onto v4-pro, `claude-sonnet*`/`claude-haiku*` onto v4-flash, and silently rewrites any other
   * model name to v4-flash. So chat/reasoner stay off it: reaching them through it would serve a
   * different model than the one selected. It trails the other two on every V4 SKU because
   * `endpointTypes[0]` is what routes in-app chat.
   */
  it.each(['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4-pro'])(
    'prefers Responses for %s while keeping Chat Completions selectable',
    (modelId) => {
      expect(endpointsOf('deepseek', modelId)).toEqual([
        'openai-responses',
        'openai-chat-completions',
        'anthropic-messages'
      ])
    }
  )

  it.each(['deepseek-chat', 'deepseek-reasoner'])(
    'pins %s to Chat Completions, the only endpoint DeepSeek serves it on',
    (modelId) => {
      expect(endpointsOf('deepseek', modelId)).toEqual(['openai-chat-completions'])
    }
  )
})

describe('MiniMax endpoint matrix', () => {
  it.each(['minimax', 'minimax-global'])(
    '%s keeps Chat Completions first while exposing Anthropic Messages for Agent sessions',
    (providerId) => {
      expect(endpointsOf(providerId, 'minimax-m3')).toEqual(['openai-chat-completions', 'anthropic-messages'])
    }
  )
})

/**
 * OpenCode Go multiplexes three wire protocols over one base URL, and the protocol per model is
 * published as models.dev's per-model `provider.npm` (`@ai-sdk/openai` → Responses, `@ai-sdk/anthropic`
 * → Messages, inherited `@ai-sdk/openai-compatible` → Chat) — which is what the OpenCode client itself
 * consumes. The vendor's Go endpoint table is asserted against only where the two agree: it still
 * prints chat/completions for Grok 4.5, months after models.dev moved it to the OpenAI SDK (#17860).
 */
describe('opencode (Zen Go) endpoint matrix', () => {
  it('serves the Responses endpoint through the OpenAI adapter', () => {
    const endpoint = provider('opencode').endpointConfigs?.['openai-responses']

    expect(endpoint).toMatchObject({
      adapterFamily: 'openai',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      reasoningFormat: { type: 'openai-responses' }
    })
    expect(endpoint?.reasoningFormat?.wire?.effort?.operations).toContainEqual({
      target: 'reasoningSummary',
      value: { source: 'assistant-summary' },
      delivery: 'provider-option' as const
    })
  })

  it('prefers Responses for Grok 4.5 while keeping the documented Chat route selectable', () => {
    expect(endpointsOf('opencode', 'grok-4-5')).toEqual(['openai-responses', 'openai-chat-completions'])
  })

  it('pins GPT 5.6 Luna to Responses, the only endpoint Go serves it on', () => {
    expect(endpointsOf('opencode', 'gpt-5-6-luna')).toEqual(['openai-responses'])
  })

  it.each(['qwen3-8-flash', 'qwen3-8-max', 'qwen3-7-max', 'minimax-m3'])(
    'pins %s to the Anthropic-compatible endpoint',
    (modelId) => {
      expect(endpointsOf('opencode', modelId)).toEqual(['anthropic-messages'])
    }
  )

  it.each(['hy4-preview', 'hy3', 'kimi-k3', 'glm-5-2'])('pins %s to Chat Completions', (modelId) => {
    expect(endpointsOf('opencode', modelId)).toEqual(['openai-chat-completions'])
  })
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

/**
 * A self-hosted relay has ONE user-supplied host. `getBaseUrl` only falls back to the default
 * chat endpoint when the requested endpoint has no `baseUrl`, so a placeholder host on a
 * secondary endpoint silently sends that protocol's traffic to localhost:3000.
 */
describe('new-api single-host endpoints', () => {
  it('carries a placeholder baseUrl on the default chat endpoint only', () => {
    const withBaseUrl = Object.entries(provider('new-api').endpointConfigs ?? {})
      .filter(([, config]) => config?.baseUrl)
      .map(([endpointType]) => endpointType)
    expect(withBaseUrl).toEqual(['openai-chat-completions'])
  })

  /**
   * An override is also a catalog row, so any entry here advertises a model to every New API user
   * regardless of what their relay serves. The wire such an entry would carry is unknowable too:
   * the thinking field depends on the channel behind the model, which is why New API solves this
   * with server-side 参数覆盖.
   */
  it('declares no per-model overrides', () => {
    expect(provider('new-api').overrides ?? []).toEqual([])
  })
})
