/**
 * Integration test for the internal-feature decision matrix. Mirrors what the
 * old `PluginBuilder.buildPlugins` did: given a `RequestScope`, exactly which
 * `RequestFeature`s should activate? Asserts on feature *names* (not on the
 * concrete `AiPlugin` instances) so the test stays decoupled from plugin
 * implementation details.
 */

import { describe, expect, it, vi } from 'vitest'

import type { Assistant } from '@shared/data/types/assistant'
import { DEFAULT_CONTEXT_SETTINGS } from '@shared/data/types/contextSettings'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

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
  webToolRoutes?: RequestScope['webToolRoutes']
  mcpToolIds?: string[]
  topicId?: string
  endpointType?: string
  aiSdkProviderId?: string
  reasoning?: RequestScope['reasoning']
  request?: Partial<RequestScope['request']>
}): RequestScope {
  return {
    request: { conversation: { id: 'test' }, mcpToolIds: [], ...overrides.request },
    signal: undefined,
    registry: {} as never,
    assistant: overrides.assistant as Assistant | undefined,
    model: { id: 'openai::m1', name: 'M1', ...overrides.model } as Model,
    provider: { id: 'openai', settings: {}, ...overrides.provider } as Provider,
    capabilities: overrides.capabilities as never,
    webToolRoutes: overrides.webToolRoutes,
    sdkConfig: {
      providerId: 'openai',
      providerOptionsKey: 'openai',
      providerSettings: {},
      modelId: 'm1'
    },
    endpointType: overrides.endpointType as never,
    aiSdkProviderId: overrides.aiSdkProviderId ?? 'openai-compatible',
    reasoningProfile: { format: 'none', wire: { disabled: true } },
    reasoning: overrides.reasoning ?? { kind: 'omit', selection: 'default', emissions: [] },
    requestContext: {
      requestId: 'req-1',
      topicId: overrides.topicId,
      assistant: overrides.assistant as Assistant | undefined,
      abortSignal: new AbortController().signal
    },
    mcpToolIds: new Set(overrides.mcpToolIds ?? []),
    contextSettings: DEFAULT_CONTEXT_SETTINGS,
    compressionModel: null,
    hasMessageAnchor: false
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
  it('gateway-anthropic-cache activates only for the Vercel AI Gateway with caching enabled', () => {
    const gatewayScope = (settings: Provider['settings'] = {}) =>
      makeScope({
        provider: { id: 'gateway', presetProviderId: 'gateway', settings },
        model: { id: 'gateway::anthropic/claude-sonnet-4', providerId: 'gateway' },
        endpointType: 'openai-chat-completions',
        aiSdkProviderId: 'gateway'
      })

    const names = activeNames(gatewayScope())
    expect(names).toContain('gateway-anthropic-cache')
    // Markers placed for the Anthropic wire never reach the gateway, so they must not be emitted.
    expect(names).not.toContain('anthropic-cache')

    expect(activeNames(gatewayScope({ cacheControl: { enabled: false, tokenThreshold: 1024 } }))).not.toContain(
      'gateway-anthropic-cache'
    )
    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: {} },
          model: {},
          endpointType: 'anthropic-messages',
          aiSdkProviderId: 'anthropic'
        })
      )
    ).not.toContain('gateway-anthropic-cache')
  })

  it('bedrock-anthropic-cache activates only for Claude on Bedrock with caching enabled, after anthropic-cache', () => {
    const bedrockScope = (apiModelId: string, settings: Provider['settings'] = {}) =>
      makeScope({
        provider: { id: 'aws-bedrock', settings },
        model: { id: `aws-bedrock::${apiModelId}`, apiModelId, providerId: 'aws-bedrock' },
        endpointType: 'anthropic-messages',
        aiSdkProviderId: 'bedrock'
      })

    const names = activeNames(bedrockScope('global.anthropic.claude-sonnet-4-6'))
    expect(names).toContain('anthropic-cache')
    expect(names.indexOf('bedrock-anthropic-cache')).toBe(names.indexOf('anthropic-cache') + 1)

    expect(activeNames(bedrockScope('meta.llama3-3-70b-instruct-v1:0'))).not.toContain('bedrock-anthropic-cache')
    expect(
      activeNames(
        bedrockScope('global.anthropic.claude-sonnet-4-6', { cacheControl: { enabled: false, tokenThreshold: 1024 } })
      )
    ).not.toContain('bedrock-anthropic-cache')
    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: {} },
          model: {},
          endpointType: 'anthropic-messages',
          aiSdkProviderId: 'anthropic'
        })
      )
    ).not.toContain('bedrock-anthropic-cache')
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
  })

  // params-core-2: the documented hard invariant `reasoning-extraction` < `simulate-streaming`.
  // Both gate predicates hold for the OpenAI chat wire with streamOutput === false; a
  // reorder of INTERNAL_FEATURES would otherwise pass unnoticed.

  // params-core-2: the hard invariant `reasoning-extraction` < `simulate-streaming` asserted as a
  // STATIC contract over the declaration order of INTERNAL_FEATURES — by feature `name`,
  // independent of any activation predicate.

  // The documented hard invariant `context-build` < `anthropic-cache`:
  // truncation must rewrite tool results before cache markers are placed.

  describe('qwen-enable-thinking', () => {
    it('adds enable_thinking to providerOptions via transformParams', async () => {
      const scope = makeScope({
        provider: { id: 'my-vllm' },
        model: {
          id: 'my-vllm::qwen3-14b',
          providerId: 'my-vllm',
          reasoning: { selectableEfforts: ['none', 'auto'] }
        },
        assistant: { id: 'a', settings: { reasoning_effort: 'auto' } as Assistant['settings'] },
        reasoning: { kind: 'auto', selection: 'auto', emissions: [{ target: 'reasoningEffort', value: 'low' }] }
      })

      const plugin = collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters.find(
        (candidate) => (candidate as { name?: string }).name === 'qwen-enable-thinking'
      ) as any

      // Simulate configureContext + transformParams
      const extensions = new Map<string, unknown>()
      const context = { extensions, middlewares: [] as any[] }
      plugin.configureContext(context)

      const params = { providerOptions: { openai: { temperature: 0.7 } } }
      const result = plugin.transformParams(params, context)

      expect(result.providerOptions.openai.enable_thinking).toBe(true)
      expect(result.providerOptions.openai.temperature).toBe(0.7)
    })

    it('sends enable_thinking: false when reasoning is off', async () => {
      const scope = makeScope({
        provider: { id: 'my-vllm' },
        model: {
          id: 'my-vllm::qwen3-14b',
          providerId: 'my-vllm',
          reasoning: { selectableEfforts: ['none', 'auto'] }
        },
        assistant: { id: 'a', settings: { reasoning_effort: 'none' } as Assistant['settings'] },
        reasoning: { kind: 'off', selection: 'none', emissions: [{ target: 'reasoningEffort', value: 'none' }] }
      })

      const plugin = collectFromFeatures(scope, INTERNAL_FEATURES).modelAdapters.find(
        (candidate) => (candidate as { name?: string }).name === 'qwen-enable-thinking'
      ) as any

      // Simulate configureContext + transformParams
      const extensions = new Map<string, unknown>()
      const context = { extensions, middlewares: [] as any[] }
      plugin.configureContext(context)

      const params = { providerOptions: { openai: { temperature: 0.7 } } }
      const result = plugin.transformParams(params, context)

      expect(result.providerOptions.openai.enable_thinking).toBe(false)
      expect(result.providerOptions.openai.temperature).toBe(0.7)
    })
  })
})
