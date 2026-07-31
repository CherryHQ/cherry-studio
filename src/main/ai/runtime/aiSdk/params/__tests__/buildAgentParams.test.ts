import path from 'node:path'

import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { ENDPOINT_TYPE, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { StopCondition, Tool, ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAssistant, makeModel, makeProvider } from '../../../../__tests__/fixtures'
import { registry } from '../../../../tools/adapters/aiSdk/registry'
import type { ToolEntry } from '../../../../tools/adapters/aiSdk/types'
import type { CallOverrides } from '../../../../types/requests'

const { preferenceGetMock, resolveProviderAiSdkConfigMock } = vi.hoisted(() => ({
  preferenceGetMock: vi.fn(),
  resolveProviderAiSdkConfigMock: vi.fn()
}))

vi.mock('../../../../provider/config', () => ({
  resolveProviderAiSdkConfig: resolveProviderAiSdkConfigMock
}))

vi.mock('@application', () => ({
  application: {
    getPath: (_namespace: string, filename: string) =>
      path.join(process.cwd(), 'packages/provider-registry/data', filename),
    get: (name: string) => {
      if (name === 'KnowledgeService') return { hasAnyBase: () => true }
      if (name === 'PreferenceService') return { get: preferenceGetMock }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

const {
  applyCallOverrides,
  buildAgentParams,
  composeStopWhen,
  resolveReasoningMaxTokens,
  resolveToolCallLimit,
  resolveTools
} = await import('../buildAgentParams')

beforeEach(() => {
  preferenceGetMock.mockReturnValue(null)
})

describe('buildAgentParams provider resolution', () => {
  it('uses the resolved Vertex MaaS adapter, wire profile, and provider-options namespace', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: {
        providerId: 'google-vertex-maas',
        providerSettings: { project: 'my-project', location: 'global' }
      },
      credentialReceipt: { attribution: 'auth', method: 'iam-gcp' }
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
    expect(result.credentialReceipt).toEqual({ attribution: 'auth', method: 'iam-gcp' })
    expect(result.options.providerOptions).toMatchObject({
      vertex: {
        reasoningEffort: 'high',
        chat_template_kwargs: { enable_thinking: true }
      }
    })
    expect(result.options.providerOptions).not.toHaveProperty('google')
  })

  it('suppresses URL Context when Gemini 2.5 receives actual function tools', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'google', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google' }
      },
      serverTools: [{ id: 'url-context', modelScope: 'model-dependent' }]
    })
    const model = makeModel({
      id: 'gemini::gemini-2.5-pro',
      providerId: 'gemini',
      apiModelId: 'gemini-2.5-pro',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
    })
    const assistant = makeAssistant({ settings: { enableWebSearch: true } })

    const result = await buildAgentParams({
      request: { callOverrides: { tools: { mcp__test__lookup: {} as Tool } } },
      signal: undefined,
      provider,
      model,
      assistant
    })

    expect(result.tools).toHaveProperty('mcp__test__lookup')
    expect(result.plugins.map((plugin) => plugin.name)).not.toContain('urlContext')
  })

  it('keeps URL Context when Gemini 3 receives function tools', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'google', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: {
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google' }
      },
      serverTools: [{ id: 'url-context', modelScope: 'model-dependent' }]
    })
    const model = makeModel({
      id: 'gemini::gemini-3-pro',
      providerId: 'gemini',
      apiModelId: 'gemini-3-pro',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
    })
    const assistant = makeAssistant({ settings: { enableWebSearch: true } })

    const result = await buildAgentParams({
      request: { callOverrides: { tools: { mcp__test__lookup: {} as Tool } } },
      signal: undefined,
      provider,
      model,
      assistant
    })

    expect(result.plugins.map((plugin) => plugin.name)).toContain('urlContext')
  })
})

describe('buildAgentParams web-tool routing', () => {
  const provider = makeProvider({
    id: 'anthropic',
    defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
    endpointConfigs: {
      [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
    },
    serverTools: [
      { id: SERVER_TOOL.WEB_SEARCH, modelScope: 'all-chat-models' },
      { id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent' }
    ]
  })
  const model = makeModel({
    id: 'anthropic::claude-sonnet-4-6',
    providerId: 'anthropic',
    apiModelId: 'claude-sonnet-4-6',
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
  })
  const assistant = makeAssistant({ settings: { enableWebSearch: true } })
  const clientSearchEntry: ToolEntry = {
    name: 'web_search',
    namespace: 'web',
    description: 'client search',
    defer: 'never',
    tool: {} as Tool,
    applies: (scope) => scope.webToolRoutes?.webSearch === 'client'
  }
  const clientFetchEntry: ToolEntry = {
    name: 'web_fetch',
    namespace: 'web',
    description: 'client fetch',
    defer: 'never',
    tool: {} as Tool,
    applies: (scope) => scope.webToolRoutes?.webFetch === 'client'
  }

  beforeEach(() => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
  })

  afterEach(() => {
    registry.deregister(clientSearchEntry.name)
    registry.deregister(clientFetchEntry.name)
  })

  it.each([
    { clientToolsPreferred: true, expectedRoute: 'client' },
    { clientToolsPreferred: false, expectedRoute: 'server' }
  ])(
    'injects only $expectedRoute implementations when preference is $clientToolsPreferred',
    async ({ clientToolsPreferred, expectedRoute }) => {
      const preferences = new Map<string, unknown>([
        ['app.developer_mode.enabled', false],
        ['chat.web_search.client_tools_preferred', clientToolsPreferred],
        ['chat.web_search.default_search_keywords_provider', 'exa-mcp'],
        ['chat.web_search.default_fetch_urls_provider', 'jina'],
        ['chat.web_search.provider_overrides', {}],
        ['chat.web_search.max_results', 5],
        ['chat.web_search.exclude_domains', []]
      ])
      preferenceGetMock.mockImplementation((key: string) => preferences.get(key) ?? null)
      registry.register(clientSearchEntry)
      registry.register(clientFetchEntry)

      const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })
      const hasClientSearch = result.tools?.web_search === clientSearchEntry.tool
      const hasClientFetch = result.tools?.web_fetch === clientFetchEntry.tool
      const hasServerSearch = result.plugins.some((plugin) => plugin.name === 'webSearch')
      const hasServerFetch = result.plugins.some((plugin) => plugin.name === 'urlContext')

      expect(hasClientSearch).toBe(expectedRoute === 'client')
      expect(hasClientFetch).toBe(expectedRoute === 'client')
      expect(hasServerSearch).toBe(expectedRoute === 'server')
      expect(hasServerFetch).toBe(expectedRoute === 'server')
      expect(Number(hasClientSearch) + Number(hasServerSearch)).toBe(1)
      expect(Number(hasClientFetch) + Number(hasServerFetch)).toBe(1)
    }
  )
})

describe('buildAgentParams assistant-less reasoning', () => {
  const makeOffCapableSetup = () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: {
        providerId: 'anthropic',
        providerSettings: {}
      },
      credentialReceipt: { attribution: 'unknown' }
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

  it('carries the AiHubMix Gemini provider-options namespace from endpoint resolution into translation', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: {
        providerId: 'aihubmix',
        providerSettings: {}
      },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'aihubmix',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'aihubmix' },
        [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'aihubmix' }
      }
    })
    const model = makeModel({
      id: 'aihubmix::gemini-2.5-flash',
      providerId: 'aihubmix',
      apiModelId: 'gemini-2.5-flash',
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'toggle' }],
        selectableEfforts: ['none', 'auto']
      }
    })

    const result = await buildAgentParams({
      request: { reasoningEffort: 'none' },
      signal: undefined,
      provider,
      model
    })

    expect(result.sdkConfig.providerOptionsKey).toBe('google')
    expect(result.options.providerOptions).toEqual({
      google: { thinkingConfig: { includeThoughts: false, thinkingLevel: 'minimal' } }
    })
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

  it('does not add citation guidance for a same-named Gateway client tool', async () => {
    const { provider, model } = makeOffCapableSetup()
    const entry: ToolEntry = {
      name: 'web_search',
      namespace: 'web',
      description: 'first-party search',
      defer: 'never',
      tool: {} as Tool
    }
    registry.register(entry)

    try {
      const customTool = {} as Tool
      const result = await buildAgentParams({
        request: { callOverrides: { tools: { web_search: customTool } } },
        signal: undefined,
        provider,
        model: { ...model, capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] }
      })

      expect(result.tools?.web_search).toBe(customTool)
      expect(result.system ?? '').not.toContain('<citations>')
    } finally {
      registry.deregister(entry.name)
    }
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

/**
 * The resolver's own semantics live in `utils/__tests__/knowledgeScope.test.ts`. These tests pin the
 * *call site* instead: that `buildAgentParams` composes the assistant binding with the request
 * selection in that order, and hands the result to `resolveTools`. Asserting the resolver directly
 * here would leave a swapped-argument call site (`resolveKnowledgeBaseScope(request, assistant)`)
 * green while the trust boundary inverts.
 */
describe('buildAgentParams knowledge-scope enforcement', () => {
  const SCOPE_PROBE_TOOL_NAME = 'test-scope-probe-tool'
  let observedScope: readonly string[] | undefined

  const scopeProbeEntry: ToolEntry = {
    name: SCOPE_PROBE_TOOL_NAME,
    namespace: 'test',
    description: 'test-only tool that records the effective knowledge scope it is resolved with',
    defer: 'never',
    tool: {} as Tool,
    applies: (scope) => {
      observedScope = scope.knowledgeBaseIds
      return true
    }
  }

  afterEach(() => {
    registry.deregister(SCOPE_PROBE_TOOL_NAME)
  })

  /** Drive the real `buildAgentParams` and report the scope that actually reached the tool layer. */
  const effectiveScopeFor = async (
    assistantKnowledgeBaseIds: string[] | undefined,
    requestKnowledgeBaseIds: string[] | undefined
  ): Promise<readonly string[] | undefined> => {
    observedScope = undefined
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    registry.register(scopeProbeEntry)

    await buildAgentParams({
      request: { knowledgeBaseIds: requestKnowledgeBaseIds },
      signal: undefined,
      provider: makeProvider({
        id: 'custom-claude',
        defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
        endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' } }
      }),
      model: makeModel({ capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] }),
      assistant: makeAssistant({ knowledgeBaseIds: assistantKnowledgeBaseIds })
    })

    return observedScope
  }

  it('narrows the assistant binding to the request selection instead of ignoring it', async () => {
    await expect(effectiveScopeFor(['kb-1', 'kb-2'], ['kb-1'])).resolves.toEqual(['kb-1'])
  })

  it('never widens the assistant binding, whichever bases the request asks for', async () => {
    // An assistant statically bound to `kb-public` must not become searchable for `kb-private` just
    // because the renderer/IPC request asked for it — the binding is the trust boundary, not whatever
    // the composer UI happened to let the user pick. A wholly out-of-scope selection is no narrowing
    // at all, so the full binding stands rather than the assistant losing its own bases.
    await expect(effectiveScopeFor(['kb-public'], ['kb-private'])).resolves.toEqual(['kb-public'])
    await expect(effectiveScopeFor(['kb-1'], ['kb-1', 'kb-2'])).resolves.toEqual(['kb-1'])
  })

  it('falls back to the assistant binding when the request selects none', async () => {
    await expect(effectiveScopeFor(['kb-1'], undefined)).resolves.toEqual(['kb-1'])
  })

  it('lets the request selection define the scope when the assistant has no binding', async () => {
    await expect(effectiveScopeFor(undefined, ['kb-2'])).resolves.toEqual(['kb-2'])
  })

  it('resolves to an empty scope when neither source selects a base', async () => {
    await expect(effectiveScopeFor(undefined, undefined)).resolves.toEqual([])
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

describe('resolveTools citation provenance', () => {
  const tool = {} as Tool
  const entry: ToolEntry = {
    name: 'web_search',
    namespace: 'web',
    description: 'first-party search',
    defer: 'never',
    tool
  }

  afterEach(() => registry.deregister(entry.name))

  it('reports citation capability for a selected first-party entry', async () => {
    registry.register(entry)
    const result = await resolveTools({}, undefined, makeModel(), false, [])
    expect(result.hasCitableTools).toBe(true)
  })

  it('does not report citation capability when a Gateway client tool overrides the name', async () => {
    registry.register(entry)
    const customTool = {} as Tool
    const result = await resolveTools(
      { callOverrides: { tools: { web_search: customTool } } },
      undefined,
      makeModel(),
      false,
      []
    )

    expect(result.tools?.web_search).toBe(customTool)
    expect(result.hasCitableTools).toBe(false)
  })
})
