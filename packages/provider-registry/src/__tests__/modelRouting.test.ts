/**
 * Gateway per-model endpoint dispatch. These tables are the ONE source both the request path
 * (`resolveEffectiveEndpoint`) and the catalog's reasoning projection read, so a change here moves
 * the wire AND the vocabulary the renderer offers — keep them in lock-step with the vendors' docs.
 */
import { describe, expect, it } from 'vitest'

import aihubmix from '../providers/aihubmix'
import dmxapi from '../providers/dmxapi'
import { resolveProviderModelRoute } from '../utils/modelRouting'

/**
 * `passthrough` = no rule claims the id (the gateway's openai-compatible line, served on
 * `defaultChatEndpoint`); `derived` = the namespace comes from `resolveProviderOptionsKey`,
 * which only a vendor-class exception overrides.
 */
const routeOf = (routes: typeof aihubmix.modelRouting, modelId: string) => {
  const route = resolveProviderModelRoute(routes, modelId)
  return route ? [route.endpointType, route.providerOptionsKey ?? 'derived'] : ['passthrough', 'passthrough']
}

describe('aihubmix modelRouting', () => {
  it.each([
    ['claude-opus-4-6', 'anthropic-messages', 'derived'],
    ['claude-3-5-haiku', 'anthropic-messages', 'derived'],
    ['gemini-2.5-pro', 'google-generate-content', 'derived'],
    ['imagen-4.0-generate-001', 'google-generate-content', 'derived'],
    // gpt/o LLMs go to the Responses API…
    ['gpt-4o', 'openai-responses', 'derived'],
    ['o3', 'openai-responses', 'derived'],
    // …except the chat-completion-only exceptions, which need the vendor class's namespace
    ['gpt-4o-search-preview', 'openai-chat-completions', 'openai'],
    ['o1-mini', 'openai-chat-completions', 'openai'],
    ['o1-preview', 'openai-chat-completions', 'openai'],
    // everything else stays on the openai-compatible passthrough line
    ['glm-5', 'passthrough', 'passthrough'],
    ['deepseek-v4', 'passthrough', 'passthrough'],
    ['qwen3.5-plus', 'passthrough', 'passthrough'],
    ['gpt-4o-image', 'passthrough', 'passthrough'],
    ['gemini-embedding-001', 'passthrough', 'passthrough']
  ])('routes %s → %s / %s', (modelId, endpointType, providerOptionsKey) => {
    expect(routeOf(aihubmix.modelRouting, modelId)).toEqual([endpointType, providerOptionsKey])
  })
})

describe('dmxapi modelRouting', () => {
  it.each([
    ['claude-opus-4-6', 'anthropic-messages', 'derived'],
    ['gemini-2.5-pro', 'google-generate-content', 'derived'],
    ['gemini-2.5-flash-image-preview', 'passthrough', 'passthrough'],
    // Both land on chat-completions, but the concrete SDK models read different option namespaces.
    ['gpt-5', 'openai-chat-completions', 'openai'],
    ['o3', 'openai-chat-completions', 'openai'],
    ['qwen3.5-plus', 'passthrough', 'passthrough']
  ])('routes %s → %s / %s', (modelId, endpointType, providerOptionsKey) => {
    expect(routeOf(dmxapi.modelRouting, modelId)).toEqual([endpointType, providerOptionsKey])
  })
})

describe('resolveProviderModelRoute', () => {
  it('returns undefined when the provider declares no routing', () => {
    expect(resolveProviderModelRoute(undefined, 'claude-opus-4-6')).toBeUndefined()
  })

  it('honours rule order — the first match wins', () => {
    const routes = [
      { pattern: 'claude', endpointType: 'anthropic-messages' as const },
      { pattern: '.', endpointType: 'openai-chat-completions' as const }
    ]
    expect(resolveProviderModelRoute(routes, 'claude-opus-4-6')?.endpointType).toBe('anthropic-messages')
  })
})
