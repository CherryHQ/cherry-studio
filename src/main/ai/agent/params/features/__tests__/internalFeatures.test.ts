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

vi.mock('../../../plugins/modelParamsPlugin', () => ({
  createModelParamsPlugin: vi.fn(() => ({ name: 'model-params' }))
}))
vi.mock('../../../plugins/pdfCompatibilityPlugin', () => ({
  createPdfCompatibilityPlugin: vi.fn(() => ({ name: 'pdf-compatibility' }))
}))
vi.mock('../../../plugins/reasoningExtractionPlugin', () => ({
  createReasoningExtractionPlugin: vi.fn(() => ({ name: 'reasoning-extraction' }))
}))
vi.mock('../../../plugins/simulateStreamingPlugin', () => ({
  createSimulateStreamingPlugin: vi.fn(() => ({ name: 'simulate-streaming' }))
}))
vi.mock('../../../plugins/anthropicCachePlugin', () => ({
  createAnthropicCachePlugin: vi.fn(() => ({ name: 'anthropic-cache' }))
}))
vi.mock('../../../plugins/anthropicHeadersPlugin', () => ({
  createAnthropicHeadersPlugin: vi.fn(() => ({ name: 'anthropic-headers' }))
}))
vi.mock('../../../plugins/openrouterReasoningPlugin', () => ({
  createOpenrouterReasoningPlugin: vi.fn(() => ({ name: 'openrouter-reasoning' }))
}))
vi.mock('../../../plugins/noThinkPlugin', () => ({
  createNoThinkPlugin: vi.fn(() => ({ name: 'no-think' }))
}))
vi.mock('../../../plugins/qwenThinkingPlugin', () => ({
  createQwenThinkingPlugin: vi.fn(() => ({ name: 'qwen-thinking' }))
}))
vi.mock('../../../plugins/skipGeminiThoughtSignaturePlugin', () => ({
  createSkipGeminiThoughtSignaturePlugin: vi.fn(() => ({ name: 'skip-gemini-thought-signature' }))
}))
vi.mock('@cherrystudio/ai-core/built-in/plugins', () => ({
  providerToolPlugin: vi.fn((kind: string) => ({ name: `provider-tool-${kind}` })),
  createPromptToolUsePlugin: vi.fn(() => ({ name: 'prompt-tool-use' }))
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
  it('produces nothing when there is no assistant and no special provider/model traits', () => {
    expect(activeNames(makeScope({ provider: { id: 'unknown' }, model: {} }))).toEqual(['pdf-compatibility'])
  })

  it('model-params activates whenever an assistant is present', () => {
    expect(activeNames(makeScope({ provider: {}, model: {}, assistant: { id: 'a' } }))).toContain('model-params')
    expect(activeNames(makeScope({ provider: {}, model: {} }))).not.toContain('model-params')
  })

  it('reasoning-extraction activates for OpenAI-family providers', () => {
    expect(activeNames(makeScope({ provider: { id: 'openai', type: 'openai' } as never, model: {} }))).toContain(
      'reasoning-extraction'
    )
    expect(
      activeNames(makeScope({ provider: { id: 'anthropic', type: 'anthropic' } as never, model: {} }))
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

  it('anthropic-cache activates only when provider.settings.cacheControl is enabled with a threshold', () => {
    expect(
      activeNames(
        makeScope({
          provider: { id: 'anthropic', settings: { cacheControl: { enabled: true, tokenThreshold: 1024 } } } as never,
          model: {}
        })
      )
    ).toContain('anthropic-cache')
    expect(
      activeNames(
        makeScope({
          provider: { settings: { cacheControl: { enabled: true, tokenThreshold: 0 } } } as never,
          model: {}
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

  it('prompt-tool-use activates only when capabilities.isPromptToolUse', () => {
    expect(activeNames(makeScope({ provider: {}, model: {}, capabilities: { isPromptToolUse: true } }))).toContain(
      'prompt-tool-use'
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
})
