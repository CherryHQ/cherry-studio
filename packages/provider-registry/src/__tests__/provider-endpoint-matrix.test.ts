import { describe, expect, it } from 'vitest'

import { providerModelEntries } from '../../scripts/canonicalize'
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

// Look up by the CANONICAL key the catalog ships: source authors the served `apiModelId`
// (`qwen3.7-max`), and generation derives the key (see deriveOverrideModelId).
const endpointsOf = (providerId: string, modelId: string): string[] | undefined => {
  const entry = providerModelEntries(provider(providerId)).find((o) => o.modelId === modelId)
  if (!entry) throw new Error(`Missing override: ${providerId}/${modelId}`)
  return entry.endpointTypes
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

  // These Qwen aliases search via Chat's `enable_search`, so Chat leads while Responses stays selectable.
  // See `servesResponsesWebSearch` in src/main/ai/utils/websearch.ts.

  it.each(['glm-5-2', 'kimi-k3'])('keeps inherited endpoint selection for %s', (modelId) => {
    expect(endpointsOf('dashscope', modelId)).toBeUndefined()
    expect(provider('dashscope').defaultChatEndpoint).toBe('openai-chat-completions')
  })
})

describe('deepseek endpoint matrix', () => {
  it.each(['deepseek-flash', 'deepseek-v4-pro'])(
    'prefers Responses for %s while keeping Chat Completions selectable',
    (modelId) => {
      expect(endpointsOf('deepseek', modelId)).toEqual([
        'openai-responses',
        'openai-chat-completions',
        'anthropic-messages'
      ])
    }
  )

  it.each(['deepseek-v4-flash'])('prefers Responses for %s while keeping Chat Completions selectable', (modelId) => {
    expect(endpointsOf('deepseek', modelId)).toEqual(['openai-responses', 'openai-chat-completions'])
  })

  it('lists only the current official DeepSeek model IDs', () => {
    expect(providerModelEntries(provider('deepseek')).map(({ modelId }) => modelId)).toEqual([
      'deepseek-flash',
      'deepseek-v4-flash',
      'deepseek-v4-pro'
    ])
  })
})

/**
 * OpenCode Go multiplexes three wire protocols over one base URL, and the protocol per model is
 * published as models.dev's per-model `provider.npm` (`@ai-sdk/openai` → Responses, `@ai-sdk/anthropic`
 * → Messages, inherited `@ai-sdk/openai-compatible` → Chat) — which is what the OpenCode client itself
 * consumes. The vendor's Go endpoint table is asserted against only where the two agree: it still
 * prints chat/completions for Grok 4.5, months after models.dev moved it to the OpenAI SDK (#17860).
 */
describe('opencode (Zen Go) endpoint matrix', () => {
  it('pins Muse Spark 1.3 Contributor to Responses and excludes Chat Completions', () => {
    expect(endpointsOf('opencode', 'muse-spark-1-3-contributor')).toEqual(['openai-responses'])
  })
})

/**
 * A self-hosted relay has ONE user-supplied host. `getBaseUrl` only falls back to the default
 * chat endpoint when the requested endpoint has no `baseUrl`, so a placeholder host on a
 * secondary endpoint silently sends that protocol's traffic to localhost:3000.
 */
describe('new-api single-host endpoints', () => {
  it.each(['openai-image-generation', 'openai-image-edit'] as const)(
    'routes %s through the New API adapter without overriding the user host',
    (endpointType) => {
      expect(provider('new-api').endpointConfigs?.[endpointType]).toEqual({ adapterFamily: 'newapi' })
    }
  )

  /**
   * An override is also a catalog row, so any entry here advertises a model to every New API user
   * regardless of what their relay serves. The wire such an entry would carry is unknowable too:
   * the thinking field depends on the channel behind the model, which is why New API solves this
   * with server-side 参数覆盖.
   */
})

// Hugging Face documents Chat Completions for general chat and Anthropic Messages for Claude Code.
// Declaring both lets Agents reach the router directly while keeping Responses selectable (#18676).
describe('huggingface (router) endpoint matrix', () => {
  it('preserves the Responses default inherited by existing unpinned models', () => {
    expect(provider('huggingface').defaultChatEndpoint).toBe('openai-responses')
  })

  it('configures a base URL for Anthropic Messages so Claude Code Agents can address the router', () => {
    expect(provider('huggingface').endpointConfigs?.['anthropic-messages']).toEqual({
      adapterFamily: 'anthropic',
      baseUrl: 'https://router.huggingface.co/v1/'
    })
  })

  it('keeps all three router surfaces on the same host', () => {
    expect(provider('huggingface').endpointConfigs).toEqual({
      'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://router.huggingface.co/v1/' },
      'openai-chat-completions': {
        adapterFamily: 'openai-compatible',
        baseUrl: 'https://router.huggingface.co/v1'
      },
      'openai-responses': { adapterFamily: 'open-responses', baseUrl: 'https://router.huggingface.co/v1/' }
    })
  })
})

describe('aionly NewAPI relay endpoints (#21168)', () => {
  const AIONLY_ENDPOINT_TYPES = [
    'anthropic-messages',
    'google-generate-content',
    'openai-responses',
    'openai-chat-completions'
  ]

  it('declares all four New API relay protocols', () => {
    expect(Object.keys(provider('aionly').endpointConfigs ?? {})).toEqual(AIONLY_ENDPOINT_TYPES)
  })

  it('routes every protocol through the newapi adapter family', () => {
    const families = Object.values(provider('aionly').endpointConfigs ?? {}).map((config) => config?.adapterFamily)
    expect(families.every((family) => family === 'newapi')).toBe(true)
  })

  it('carries a placeholder baseUrl on the default chat endpoint only', () => {
    const withBaseUrl = Object.entries(provider('aionly').endpointConfigs ?? {})
      .filter(([, config]) => config?.baseUrl)
      .map(([endpointType]) => endpointType)
    expect(withBaseUrl).toEqual(['openai-chat-completions'])
  })
})
