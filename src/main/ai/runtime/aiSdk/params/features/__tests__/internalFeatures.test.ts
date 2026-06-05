/**
 * Integration test for the internal-feature decision matrix. Mirrors what the
 * old `PluginBuilder.buildPlugins` did: given a `RequestScope`, exactly which
 * `RequestFeature`s should activate? Asserts on feature *names* (not on the
 * concrete `AiPlugin` instances) so the test stays decoupled from plugin
 * implementation details.
 */

import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ai-core/built-in/plugins', () => ({
  providerToolPlugin: vi.fn((kind: string) => ({ name: `provider-tool-${kind}` }))
}))

import { collectFromFeatures } from '../../collectFromFeatures'
import type { RequestScope } from '../../scope'
import { INTERNAL_FEATURES } from '../index'

function makeScope(overrides: {
  provider: Partial<Provider>
  model: Partial<Model>
  assistant?: Partial<Assistant>
  capabilities?: Record<string, unknown>
  mcpToolIds?: string[]
  topicId?: string
  endpointType?: string
  aiSdkProviderId?: string
}): RequestScope {
  return {
    request: { mcpToolIds: [] } as never,
    signal: undefined,
    registry: {} as never,
    assistant: overrides.assistant as Assistant | undefined,
    model: { id: 'openai::m1', name: 'M1', ...overrides.model } as Model,
    provider: { id: 'openai', settings: {}, ...overrides.provider } as Provider,
    capabilities: overrides.capabilities as never,
    sdkConfig: { providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm1' },
    endpointType: overrides.endpointType as never,
    aiSdkProviderId: (overrides.aiSdkProviderId ?? 'openai-compatible') as never,
    requestContext: {
      requestId: 'req-1',
      topicId: overrides.topicId,
      assistant: overrides.assistant as Assistant | undefined,
      abortSignal: new AbortController().signal
    },
    mcpToolIds: new Set(overrides.mcpToolIds ?? [])
  }
}

function activeNames(scope: RequestScope): string[] {
  return collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters.map((p) => (p as { name: string }).name)
}

describe('INTERNAL_FEATURES — decision matrix', () => {
  it('produces nothing when there is no assistant and the resolver picks an "anthropic" adapter (no inline-tag extraction)', () => {
    expect(activeNames(makeScope({ provider: { id: 'anthropic' }, model: {}, aiSdkProviderId: 'anthropic' }))).toEqual([
      'pdf-compatibility'
    ])
  })

  it('model-params activates whenever an assistant is present', () => {
    expect(activeNames(makeScope({ provider: {}, model: {}, assistant: { id: 'a' } }))).toContain('model-params')
    expect(activeNames(makeScope({ provider: {}, model: {} }))).not.toContain('model-params')
  })

  it('reasoning-extraction activates for OpenAI-family resolved adapters', () => {
    // Match against `scope.aiSdkProviderId`, not `provider.id` — that's the
    // resolved adapter the SDK call actually hits.
    expect(activeNames(makeScope({ provider: { id: 'openai' }, model: {}, aiSdkProviderId: 'openai-chat' }))).toContain(
      'reasoning-extraction'
    )
    expect(
      activeNames(makeScope({ provider: { id: 'anthropic' }, model: {}, aiSdkProviderId: 'anthropic' }))
    ).not.toContain('reasoning-extraction')
  })

  it('simulate-streaming activates only when capabilities.streamOutput is false', () => {
    expect(activeNames(makeScope({ provider: {}, model: {}, capabilities: { streamOutput: false } }))).toContain(
      'simulate-streaming'
    )
    expect(activeNames(makeScope({ provider: {}, model: {}, capabilities: { streamOutput: true } }))).not.toContain(
      'simulate-streaming'
    )
  })

  it('anthropic-cache activates only when endpoint is anthropic-messages AND cacheControl is enabled with a threshold', () => {
    // Both conditions required after the endpoint-aware refactor: the
    // request must be heading to an anthropic-messages endpoint, AND
    // cacheControl must be opted in with a positive threshold.
    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: { cacheControl: { enabled: true, tokenThreshold: 1024 } } } as never,
          model: {},
          endpointType: 'anthropic-messages',
          aiSdkProviderId: 'anthropic'
        })
      )
    ).toContain('anthropic-cache')

    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: { cacheControl: { enabled: true, tokenThreshold: 1024 } } } as never,
          model: {},
          endpointType: 'openai-chat-completions',
          aiSdkProviderId: 'openai-chat'
        })
      )
    ).not.toContain('anthropic-cache')

    // Threshold of 0 still disables, regardless of endpoint.
    expect(
      activeNames(
        makeScope({
          provider: { settings: { cacheControl: { enabled: true, tokenThreshold: 0 } } } as never,
          model: {},
          endpointType: 'anthropic-messages',
          aiSdkProviderId: 'anthropic'
        })
      )
    ).not.toContain('anthropic-cache')
  })

  it('no-think activates only on OVMS with at least one MCP tool', () => {
    expect(
      activeNames(makeScope({ provider: { id: 'ovms' } as never, model: {}, mcpToolIds: ['mcp__a__b'] }))
    ).toContain('no-think')
    expect(activeNames(makeScope({ provider: { id: 'ovms' } as never, model: {} }))).not.toContain('no-think')
    expect(
      activeNames(makeScope({ provider: { id: 'openai' } as never, model: {}, mcpToolIds: ['mcp__a__b'] }))
    ).not.toContain('no-think')
  })

  it('provider-tool plugins activate based on capability flags', () => {
    expect(
      activeNames(
        makeScope({
          provider: {},
          model: {},
          capabilities: { enableWebSearch: true, webSearchPluginConfig: { provider: 'anthropic' } }
        })
      )
    ).toContain('provider-tool-webSearch')
    expect(activeNames(makeScope({ provider: {}, model: {}, capabilities: { enableUrlContext: true } }))).toContain(
      'provider-tool-urlContext'
    )
  })

  it('preserves declaration order: model-params first, pdf-compatibility second', () => {
    const names = activeNames(
      makeScope({
        provider: {},
        model: {},
        assistant: { id: 'a' },
        capabilities: {}
      })
    )
    expect(names.slice(0, 2)).toEqual(['model-params', 'pdf-compatibility'])
  })

  // params-core-2: the documented hard invariant `reasoning-extraction` < `simulate-streaming`.
  // Both gate predicates hold for an OpenAI-family adapter with streamOutput === false; a
  // reorder of INTERNAL_FEATURES would otherwise pass unnoticed.
  it('orders reasoning-extraction before simulate-streaming (OpenAI-family, non-streaming)', () => {
    const names = activeNames(
      makeScope({
        provider: { id: 'openai' },
        model: {},
        aiSdkProviderId: 'openai-chat',
        capabilities: { streamOutput: false }
      })
    )
    const reasoning = names.indexOf('reasoning-extraction')
    const simulate = names.indexOf('simulate-streaming')
    expect(reasoning).toBeGreaterThanOrEqual(0)
    expect(simulate).toBeGreaterThan(reasoning)
  })

  // params-features-3: the documented hard invariant `pdf-compatibility` < `anthropic-cache`
  // (cache estimation must see the extracted PDF text). Both gate predicates hold for an
  // anthropic-messages endpoint with cacheControl enabled.
  it('orders pdf-compatibility before anthropic-cache (anthropic-messages, cache on)', () => {
    const names = activeNames(
      makeScope({
        provider: { id: 'anthropic', settings: { cacheControl: { enabled: true, tokenThreshold: 1024 } } } as never,
        model: {},
        endpointType: 'anthropic-messages',
        aiSdkProviderId: 'anthropic'
      })
    )
    const pdf = names.indexOf('pdf-compatibility')
    const cache = names.indexOf('anthropic-cache')
    expect(pdf).toBeGreaterThanOrEqual(0)
    expect(cache).toBeGreaterThan(pdf)
  })

  // params-core-2: the same hard invariants asserted as a STATIC contract over the
  // declaration order of INTERNAL_FEATURES — by feature `name`, independent of any
  // activation predicate. Unlike the activation-based tests above, this catches a
  // reorder even if both members never co-activate for the chosen scope.
  it('declares pdf-compatibility before anthropic-cache and reasoning-extraction before simulate-streaming', () => {
    const indexOfName = (name: string) => INTERNAL_FEATURES.findIndex((f) => f.name === name)

    const pdf = indexOfName('pdf-compatibility')
    const cache = indexOfName('anthropic-cache')
    expect(pdf).toBeGreaterThanOrEqual(0)
    expect(cache).toBeGreaterThanOrEqual(0)
    expect(pdf).toBeLessThan(cache)

    const reasoning = indexOfName('reasoning-extraction')
    const simulate = indexOfName('simulate-streaming')
    expect(reasoning).toBeGreaterThanOrEqual(0)
    expect(simulate).toBeGreaterThanOrEqual(0)
    expect(reasoning).toBeLessThan(simulate)
  })
})
