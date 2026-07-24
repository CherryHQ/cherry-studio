import path from 'node:path'

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { StopCondition, Tool, ToolSet } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeAssistant, makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { registry } from '../../../../tools/adapters/aiSdk/registry'
import type { ToolEntry } from '../../../../tools/adapters/aiSdk/types'
import type { CallOverrides } from '../../../../types/requests'

const { providerToAiSdkConfigMock } = vi.hoisted(() => ({
  providerToAiSdkConfigMock: vi.fn()
}))

vi.mock('../../../../provider/config', () => ({
  providerToAiSdkConfig: providerToAiSdkConfigMock
}))

vi.mock('@application', () => ({
  application: {
    getPath: (_namespace: string, filename: string) =>
      path.join(process.cwd(), 'packages/provider-registry/data', filename),
    get: (name: string) => {
      if (name === 'KnowledgeService') return { hasAnyBase: () => true }
      if (name === 'PreferenceService') return { get: () => null }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const {
  applyCallOverrides,
  buildAgentParams,
  composeStopWhen,
  resolveKnowledgeBaseIds,
  resolveReasoningMaxTokens,
  resolveToolCallLimit,
  resolveTools
} = await import('../buildAgentParams')

describe('buildAgentParams provider resolution', () => {
  it('uses the resolved Vertex MaaS adapter, wire profile, and provider-options namespace', async () => {
    providerToAiSdkConfigMock.mockResolvedValue({
      providerId: 'google-vertex-maas',
      providerSettings: { project: 'my-project', location: 'global' }
    })
    const provider = makeProvider({
      id: 'vertex',
      authType: 'iam-gcp',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google-vertex' }
      }
    })
    const model = makeModel({
      id: 'vertex::openai/gpt-oss-120b-maas',
      providerId: 'vertex',
      apiModelId: 'openai/gpt-oss-120b-maas',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    })
    const assistant = makeAssistant({
      settings: {
        reasoning_effort: 'high',
        customParameters: [
          {
            name: 'chat_template_kwargs',
            type: 'json',
            value: JSON.stringify({ enable_thinking: true })
          }
        ]
      }
    })

    const result = await buildAgentParams({
      request: {},
      signal: undefined,
      provider,
      model,
      assistant
    })

    expect(result.sdkConfig.providerId).toBe('google-vertex-maas')
    expect(result.options.providerOptions).toMatchObject({
      vertex: {
        reasoningEffort: 'high',
        chat_template_kwargs: { enable_thinking: true }
      }
    })
    expect(result.options.providerOptions).not.toHaveProperty('google')
  })
})

describe('buildAgentParams assistant-less reasoning', () => {
  const makeOffCapableSetup = () => {
    providerToAiSdkConfigMock.mockResolvedValue({
      providerId: 'anthropic',
      providerSettings: {}
    })
    const provider = makeProvider({
      id: 'custom-claude',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({
      id: 'custom-claude::claude-x',
      providerId: 'custom-claude',
      apiModelId: 'claude-x',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      }
    })
    return { provider, model }
  }

  it("encodes an explicit 'none' selection into the off wire mode without an assistant (translate)", async () => {
    const { provider, model } = makeOffCapableSetup()

    const result = await buildAgentParams({
      request: { reasoningEffort: 'none' },
      signal: undefined,
      provider,
      model
    })

    expect(result.options.providerOptions).toEqual({ anthropic: { thinking: { type: 'disabled' } } })
  })

  it("omits reasoning params when the model cannot be turned off ('none' degrades to omit)", async () => {
    const { provider } = makeOffCapableSetup()
    const model = makeModel({
      id: 'custom-claude::claude-fixed',
      providerId: 'custom-claude',
      apiModelId: 'claude-fixed',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    })

    const result = await buildAgentParams({
      request: { reasoningEffort: 'none' },
      signal: undefined,
      provider,
      model
    })

    expect(result.options.providerOptions).toBeUndefined()
  })

  it('leaves assistant-less requests without an explicit selection un-emitted (gateway regression guard)', async () => {
    const { provider, model } = makeOffCapableSetup()

    const result = await buildAgentParams({
      request: {},
      signal: undefined,
      provider,
      model
    })

    expect(result.options.providerOptions).toBeUndefined()
  })
})

describe('resolveReasoningMaxTokens', () => {
  const model = makeModel({ maxOutputTokens: 64_000 })

  it('ignores a stale assistant limit when max tokens are disabled', () => {
    const assistant = makeAssistant({ settings: { enableMaxTokens: false, maxTokens: 4_096 } })

    expect(resolveReasoningMaxTokens(undefined, assistant, model)).toBe(64_000)
  })

  it('uses an enabled assistant limit before the model default', () => {
    const assistant = makeAssistant({ settings: { enableMaxTokens: true, maxTokens: 16_000 } })

    expect(resolveReasoningMaxTokens(undefined, assistant, model)).toBe(16_000)
  })

  it('gives the per-request override highest precedence', () => {
    const assistant = makeAssistant({ settings: { enableMaxTokens: true, maxTokens: 16_000 } })

    expect(resolveReasoningMaxTokens(32_000, assistant, model)).toBe(32_000)
  })
})

/**
 * Covers the first-class per-request override merge that replaced the old
 * `createGatewayOverrideFeature` plugin: assistant-less precedence, capability
 * gating via `filterStandardParams`, and per-provider providerOptions merging.
 */
describe('applyCallOverrides', () => {
  const base = () => ({
    standardParams: {} as Partial<Record<string, unknown>>,
    providerOptions: {} as ProviderOptions
  })

  it('returns the base unchanged when there are no overrides', () => {
    const input = { standardParams: { temperature: 0.2 }, providerOptions: { openai: { reasoningEffort: 'low' } } }
    const result = applyCallOverrides(input, undefined, makeModel())
    expect(result).toBe(input)
  })

  it('applies sampling overrides at highest precedence', () => {
    const overrides: CallOverrides = { temperature: 0.9, topP: 0.5, maxOutputTokens: 100, stopSequences: ['STOP'] }
    const result = applyCallOverrides(
      { standardParams: { temperature: 0.2 }, providerOptions: {} },
      overrides,
      makeModel()
    )
    expect(result.standardParams).toMatchObject({
      temperature: 0.9,
      topP: 0.5,
      maxOutputTokens: 100,
      stopSequences: ['STOP']
    })
  })

  it('drops topK for Gemini 3.x via filterStandardParams', () => {
    const result = applyCallOverrides(base(), { topK: 40, temperature: 0.5 }, makeModel({ id: 'gemini::gemini-3-pro' }))
    expect(result.standardParams.temperature).toBe(0.5)
    expect(result.standardParams).not.toHaveProperty('topK')
  })

  it('keeps topK for models that support it', () => {
    const result = applyCallOverrides(base(), { topK: 40 }, makeModel({ id: 'openai::gpt-4o' }))
    expect(result.standardParams.topK).toBe(40)
  })

  it('merges providerOptions per provider without clobbering other providers', () => {
    const result = applyCallOverrides(
      { standardParams: {}, providerOptions: { openai: { reasoningEffort: 'low' } } },
      { providerOptions: { anthropic: { thinking: { type: 'enabled' } } } },
      makeModel()
    )
    expect(result.providerOptions).toMatchObject({
      openai: { reasoningEffort: 'low' },
      anthropic: { thinking: { type: 'enabled' } }
    })
  })

  it('shallow-merges keys within the same provider (override wins)', () => {
    const result = applyCallOverrides(
      { standardParams: {}, providerOptions: { anthropic: { existing: 1, shared: 'base' } } },
      { providerOptions: { anthropic: { shared: 'override', added: 2 } } },
      makeModel()
    )
    expect(result.providerOptions.anthropic).toEqual({ existing: 1, shared: 'override', added: 2 })
  })
})

describe('composeStopWhen', () => {
  const cond = (): StopCondition<ToolSet> => () => false

  it('returns the assistant base unchanged when no feature contributes a condition', () => {
    const base = cond()
    expect(composeStopWhen(base, [])).toBe(base)
    expect(composeStopWhen(undefined, [])).toBeUndefined()
  })

  it('OR-s the assistant base with feature conditions', () => {
    const base = cond()
    const feature = cond()
    expect(composeStopWhen(base, [feature])).toEqual([base, feature])
  })

  it('falls back to the SDK default step cap when a feature contributes without an assistant base', async () => {
    const feature = cond()
    const result = composeStopWhen(undefined, [feature])

    expect(Array.isArray(result)).toBe(true)
    const conditions = result as StopCondition<ToolSet>[]
    expect(conditions).toHaveLength(2)
    expect(conditions[1]).toBe(feature)
    // The injected fallback caps the tool loop at the SDK default of 20 steps.
    expect(await conditions[0]({ steps: new Array(20) } as never)).toBe(true)
    expect(await conditions[0]({ steps: new Array(19) } as never)).toBe(false)
  })
})

describe('resolveToolCallLimit', () => {
  it('uses the configured assistant limit', () => {
    expect(resolveToolCallLimit(makeAssistant({ settings: { maxToolCalls: 7 } }))).toBe(7)
  })

  it('retains the effective default cap for assistant-less and disabled-limit requests', () => {
    expect(resolveToolCallLimit(undefined)).toBe(20)
    expect(resolveToolCallLimit(makeAssistant({ settings: { enableMaxToolCalls: false, maxToolCalls: 7 } }))).toBe(20)
  })

  it('falls back when the configured limit is outside the supported range', () => {
    expect(resolveToolCallLimit(makeAssistant({ settings: { maxToolCalls: 101 } }))).toBe(20)
  })
})

describe('resolveKnowledgeBaseIds', () => {
  it('falls back to the assistant-bound bases when the request selects none', () => {
    expect(resolveKnowledgeBaseIds(makeAssistant({ knowledgeBaseIds: ['kb-1'] }), undefined)).toEqual(['kb-1'])
  })

  it('trusts the request-selected bases when the assistant has no static binding', () => {
    expect(resolveKnowledgeBaseIds(makeAssistant({ knowledgeBaseIds: [] }), ['kb-2'])).toEqual(['kb-2'])
    expect(resolveKnowledgeBaseIds(undefined, ['kb-2'])).toEqual(['kb-2'])
  })

  it('drops request-selected bases outside the assistant scope instead of expanding it', () => {
    // An assistant statically bound to `kb-public` must not become searchable for `kb-private`
    // just because the renderer/IPC request asked for it — the assistant's own binding is the
    // trust boundary, not whatever the composer UI happened to let the user pick.
    expect(resolveKnowledgeBaseIds(makeAssistant({ knowledgeBaseIds: ['kb-public'] }), ['kb-private'])).toEqual([
      'kb-public'
    ])
    expect(resolveKnowledgeBaseIds(makeAssistant({ knowledgeBaseIds: ['kb-1'] }), ['kb-1', 'kb-2'])).toEqual(['kb-1'])
  })

  it('returns an empty array when neither source selects a base', () => {
    expect(resolveKnowledgeBaseIds(undefined, undefined)).toEqual([])
    expect(resolveKnowledgeBaseIds(makeAssistant({ knowledgeBaseIds: [] }), undefined)).toEqual([])
  })
})

describe('resolveTools knowledge-base wiring', () => {
  const KB_GATED_TOOL_NAME = 'test-kb-gated-tool'

  const kbGatedEntry: ToolEntry = {
    name: KB_GATED_TOOL_NAME,
    namespace: 'test',
    description: 'test-only tool gated on knowledgeBaseIds',
    defer: 'never',
    tool: {} as Tool,
    applies: (scope) => (scope.knowledgeBaseIds?.length ?? 0) > 0
  }

  afterEach(() => {
    registry.deregister(KB_GATED_TOOL_NAME)
  })

  it('exposes a kb-gated tool when the effective knowledgeBaseIds is non-empty', async () => {
    registry.register(kbGatedEntry)

    const { tools } = await resolveTools({}, undefined, makeModel(), false, ['kb-1'])

    expect(tools?.[KB_GATED_TOOL_NAME]).toBeDefined()
  })

  it('hides a kb-gated tool when the effective knowledgeBaseIds is empty', async () => {
    registry.register(kbGatedEntry)

    const { tools } = await resolveTools({}, undefined, makeModel(), false, [])

    expect(tools?.[KB_GATED_TOOL_NAME]).toBeUndefined()
  })
})
