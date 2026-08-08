/**
 * Gateway per-model endpoint dispatch. Each endpoint's `serves` is the ONE declaration both the
 * request path (`resolveEffectiveEndpoint`) and the catalog's reasoning projection read, so a change
 * here moves the wire AND the vocabulary the renderer offers — keep them in lock-step with the
 * vendors' docs.
 *
 * The claims run off the raw id, so these hold for ids the catalog never saw — which is the case a
 * gateway's `/models` listing and every user-added row actually hit.
 */
import { describe, expect, it } from 'vitest'

import aihubmix from '../providers/aihubmix'
import dmxapi from '../providers/dmxapi'
import { resolveProviderModelRoute } from '../registry-utils'

/**
 * `passthrough` = no endpoint claims the model (the gateway's openai-compatible line, served on
 * `defaultChatEndpoint`); `derived` = the namespace comes from `resolveProviderOptionsKey`, which
 * only a vendor-class exception overrides.
 */
const routeOf = (configs: typeof aihubmix.endpointConfigs, modelId: string) => {
  const route = resolveProviderModelRoute(configs, modelId)
  return route ? [route.endpointType, route.providerOptionsKey ?? 'derived'] : ['passthrough', 'passthrough']
}

describe('aihubmix endpoint dispatch', () => {
  it.each([
    ['claude-opus-4-6', 'anthropic-messages', 'derived'],
    ['claude-3-5-haiku', 'anthropic-messages', 'derived'],
    ['gemini-2.5-pro', 'google-generate-content', 'derived'],
    ['imagen-4.0-generate-001', 'google-generate-content', 'derived'],
    // gpt/o LLMs go to the Responses API…
    ['gpt-4o', 'openai-responses', 'derived'],
    ['o3', 'openai-responses', 'derived'],
    // …except the chat-completion-only SKUs, claimed by chat-completions for the vendor namespace.
    ['gpt-4o-search-preview', 'openai-chat-completions', 'openai'],
    ['gpt-4o-mini-search-preview', 'openai-chat-completions', 'openai'],
    ['o1-mini', 'openai-chat-completions', 'openai'],
    ['o1-preview', 'openai-chat-completions', 'openai'],
    // everything else stays on the openai-compatible passthrough line
    ['glm-5', 'passthrough', 'passthrough'],
    ['deepseek-v4', 'passthrough', 'passthrough'],
    ['qwen3.5-plus', 'passthrough', 'passthrough'],
    ['gpt-4o-image', 'passthrough', 'passthrough'],
    ['gemini-embedding-001', 'passthrough', 'passthrough'],
    // Google's, but not served over generateContent — the case that rules out matching on the
    // creator (`ownedBy`) instead of the protocol: all of these carry ownedBy 'google'.
    ['gemma-3-27b-it', 'passthrough', 'passthrough'],
    ['veo-3-1-generate-preview', 'passthrough', 'passthrough'],
    ['lyria-3-pro-preview', 'passthrough', 'passthrough'],
    // OpenAI's, but not chat models — same argument on the other vendor.
    ['dall-e-3', 'passthrough', 'passthrough'],
    ['text-embedding-3-large', 'passthrough', 'passthrough']
  ])('routes %s → %s / %s', (modelId, endpointType, providerOptionsKey) => {
    expect(routeOf(aihubmix.endpointConfigs, modelId)).toEqual([endpointType, providerOptionsKey])
  })
})

describe('dmxapi endpoint dispatch', () => {
  it.each([
    ['claude-opus-4-6', 'anthropic-messages', 'derived'],
    ['gemini-2.5-pro', 'google-generate-content', 'derived'],
    ['gemini-2.5-flash-image-preview', 'passthrough', 'passthrough'],
    // Native OpenAI chat models read the vendor class's namespace, not dmxapi's passthrough one.
    ['gpt-5', 'openai-chat-completions', 'openai'],
    ['o3', 'openai-chat-completions', 'openai'],
    ['qwen3.5-plus', 'passthrough', 'passthrough']
  ])('routes %s → %s / %s', (modelId, endpointType, providerOptionsKey) => {
    expect(routeOf(dmxapi.endpointConfigs, modelId)).toEqual([endpointType, providerOptionsKey])
  })
})

describe('resolveProviderModelRoute', () => {
  it('returns undefined when no endpoint claims the id', () => {
    expect(resolveProviderModelRoute(undefined, 'claude-opus-4-6')).toBeUndefined()
    expect(
      resolveProviderModelRoute({ 'openai-responses': { serves: { pattern: '^gpt' } } }, 'claude-opus-4-6')
    ).toBeUndefined()
  })

  it('ignores an endpoint that declares no claim', () => {
    expect(resolveProviderModelRoute({ 'openai-responses': {} }, 'gpt-4o')).toBeUndefined()
  })

  it('carves a SKU shape back out with `except`', () => {
    const configs = { 'openai-responses': { serves: { pattern: '^gpt', except: 'search-preview' } } }
    expect(resolveProviderModelRoute(configs, 'gpt-4o')?.endpointType).toBe('openai-responses')
    expect(resolveProviderModelRoute(configs, 'gpt-4o-search-preview')).toBeUndefined()
  })
})
