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
import { INTERNAL_FEATURES } from '../internalFeatures'

function makeScope(overrides: {
  provider: Partial<Provider>
  model: Partial<Model>
  assistant?: Partial<Assistant>
  capabilities?: Record<string, unknown>
  mcpToolIds?: string[]
  topicId?: string
  endpointType?: string
  aiSdkProviderId?: string
  reasoning?: RequestScope['reasoning']
  request?: Partial<RequestScope['request']>
}): RequestScope {
  return {
    request: (overrides.request ?? { mcpToolIds: [] }) as never,
    signal: undefined,
    registry: {} as never,
    assistant: overrides.assistant as Assistant | undefined,
    model: { id: 'openai::m1', name: 'M1', ...overrides.model } as Model,
    provider: { id: 'openai', settings: {}, ...overrides.provider } as Provider,
    capabilities: overrides.capabilities as never,
    sdkConfig: { providerId: 'openai' as never, providerSettings: {} as never, modelId: 'm1' },
    endpointType: overrides.endpointType as never,
    aiSdkProviderId: (overrides.aiSdkProviderId ?? 'openai-compatible') as never,
    reasoningProfile: { format: 'none', wire: { disabled: true } },
    reasoning: overrides.reasoning ?? { kind: 'omit', selection: 'default', emissions: [] },
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

async function qwenUserText(scope: RequestScope): Promise<string> {
  const plugin = collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters.find(
    (candidate) => (candidate as { name?: string }).name === 'qwen-thinking'
  ) as any
  const context = { middlewares: [] as any[] }
  plugin.configureContext(context)
  const result = await context.middlewares[0].transformParams({
    params: { prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
  })
  return result.prompt[0].content[0].text
}

describe('INTERNAL_FEATURES — decision matrix', () => {
  it('produces nothing when there is no assistant and the resolver picks an "anthropic" adapter (no inline-tag extraction)', () => {
    expect(activeNames(makeScope({ provider: { id: 'anthropic' }, model: {}, aiSdkProviderId: 'anthropic' }))).toEqual(
      []
    )
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

  it('anthropic-cache activates by default on anthropic-messages and respects explicit opt-out', () => {
    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: {} } as never,
          model: {},
          endpointType: 'anthropic-messages',
          aiSdkProviderId: 'anthropic'
        })
      )
    ).toContain('anthropic-cache')

    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: {} } as never,
          model: {},
          endpointType: 'openai-chat-completions',
          aiSdkProviderId: 'openai-chat'
        })
      )
    ).not.toContain('anthropic-cache')

    expect(
      activeNames(
        makeScope({
          provider: { settings: { cacheControl: { enabled: false, tokenThreshold: 1024 } } } as never,
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

  it('drives the Qwen suffix from the resolved request snapshot instead of persisted assistant settings', async () => {
    const base: Parameters<typeof makeScope>[0] = {
      provider: { id: 'nvidia' },
      model: {
        id: 'nvidia::qwen3-32b',
        providerId: 'nvidia',
        reasoning: { selectableEfforts: ['none', 'auto'], thinkingTokenLimits: { min: 1024, max: 38_912 } }
      },
      assistant: { id: 'a', settings: { reasoning_effort: 'high' } as Assistant['settings'] }
    }

    expect(activeNames(makeScope(base))).not.toContain('qwen-thinking')
    expect(
      await qwenUserText(
        makeScope({
          ...base,
          reasoning: { kind: 'off', selection: 'none', emissions: [{ target: 'enable_thinking', value: false }] }
        })
      )
    ).toBe('hello /no_think')
    expect(
      await qwenUserText(
        makeScope({
          ...base,
          assistant: { id: 'a', settings: { reasoning_effort: 'none' } as Assistant['settings'] },
          reasoning: { kind: 'auto', selection: 'auto', emissions: [{ target: 'enable_thinking', value: true }] }
        })
      )
    ).toBe('hello /think')
  })

  it('qwen-thinking applies to assistant-less requests with an explicit reasoning selection (translate)', async () => {
    const base: Parameters<typeof makeScope>[0] = {
      provider: { id: 'nvidia' },
      model: {
        id: 'nvidia::qwen3-32b',
        providerId: 'nvidia',
        reasoning: { selectableEfforts: ['none', 'auto'], thinkingTokenLimits: { min: 1024, max: 38_912 } }
      },
      request: { reasoningEffort: 'none' },
      reasoning: { kind: 'off', selection: 'none', emissions: [{ target: 'enable_thinking', value: false }] }
    }

    expect(await qwenUserText(makeScope(base))).toBe('hello /no_think')
    // Without the explicit request selection, assistant-less scopes stay inactive.
    expect(activeNames(makeScope({ ...base, request: undefined }))).not.toContain('qwen-thinking')
  })

  it('model-params is the first active feature for a plain assistant scope', () => {
    const names = activeNames(
      makeScope({
        provider: {},
        model: {},
        assistant: { id: 'a' },
        capabilities: {}
      })
    )
    expect(names[0]).toBe('model-params')
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

  // params-core-2: the hard invariant `reasoning-extraction` < `simulate-streaming` asserted as a
  // STATIC contract over the declaration order of INTERNAL_FEATURES — by feature `name`,
  // independent of any activation predicate.
  it('declares reasoning-extraction before simulate-streaming', () => {
    const indexOfName = (name: string) => INTERNAL_FEATURES.findIndex((f) => f.name === name)

    const reasoning = indexOfName('reasoning-extraction')
    const simulate = indexOfName('simulate-streaming')
    expect(reasoning).toBeGreaterThanOrEqual(0)
    expect(simulate).toBeGreaterThanOrEqual(0)
    expect(reasoning).toBeLessThan(simulate)
  })
})
