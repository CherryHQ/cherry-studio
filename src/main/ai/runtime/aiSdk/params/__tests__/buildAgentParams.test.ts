import path from 'node:path'

import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { generateText as aiCoreGenerateText } from '@cherrystudio/ai-core'
import { FS_READ_TOOL_NAME } from '@shared/ai/builtinTools'
import { ENDPOINT_TYPE, type EndpointType, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { StopCondition, Tool, ToolSet } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAssistant, makeModel, makeProvider } from '../../../../__tests__/fixtures'
import type * as ResolveRequestContextSettingsModule from '../../../../contextBuild/resolveRequestContextSettings'
import { createFsReadToolEntry } from '../../../../tools/adapters/aiSdk/builtin/FsReadTool'
import type { RequestContext } from '../../../../tools/adapters/aiSdk/context'
import { registry } from '../../../../tools/adapters/aiSdk/registry'
import type { ToolEntry } from '../../../../tools/adapters/aiSdk/types'
import type { AppProviderSettingsMap } from '../../../../types'
import type { CallOverrides } from '../../../../types/requests'
import type { AgentOptions } from '../../loop/types'

const { preferenceGetMock, resolveProviderAiSdkConfigMock, resolveRequestContextSettingsSpy } = vi.hoisted(() => ({
  preferenceGetMock: vi.fn(),
  resolveProviderAiSdkConfigMock: vi.fn(),
  resolveRequestContextSettingsSpy: vi.fn()
}))

vi.mock('../../../../provider/config', () => ({
  resolveProviderAiSdkConfig: resolveProviderAiSdkConfigMock
}))

// Spy that calls through to the real resolver (the null-pref mock keeps it
// behavior-preserving) so existing tests are untouched but the assistant
// override passthrough can be asserted.
vi.mock('../../../../contextBuild/resolveRequestContextSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof ResolveRequestContextSettingsModule>()
  return {
    ...actual,
    resolveRequestContextSettings: (...args: Parameters<typeof actual.resolveRequestContextSettings>) => {
      resolveRequestContextSettingsSpy(...args)
      return actual.resolveRequestContextSettings(...args)
    }
  }
})

vi.mock('@application', () => ({
  application: {
    getPath: (_namespace: string, filename: string) =>
      path.join(process.cwd(), 'packages/provider-registry/data', filename),
    get: (name: string) => {
      if (name === 'KnowledgeService') return { hasAnyBase: () => true }
      if (name === 'PreferenceService') return { get: preferenceGetMock }
      // No connected MCP server in these tests, so nothing declares the resources capability.
      if (name === 'McpRuntimeService') return { getConnectedServerCapabilities: () => undefined }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

// No MCP servers configured in these tests — keeps the MCP tool/resource resolution off the DB.
vi.mock('@main/data/services/McpServerService', () => ({
  mcpServerService: { list: () => ({ items: [] }) }
}))

const {
  applyCallOverrides,
  applyResponsesInstructions,
  buildAgentParams,
  composeStopWhen,
  resolveToolCallLimit,
  resolveTools
} = await import('../buildAgentParams')

beforeEach(() => {
  preferenceGetMock.mockReturnValue(null)
})

describe('buildAgentParams provider resolution', () => {
  it('passes the conversation id to provider configuration as the session id', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'openai-compatible', providerSettings: {} },
      credentialReceipt: { attribution: 'explicit', id: 'key', masked: 'sk-****' }
    })
    const provider = makeProvider({ id: 'opencode' })
    const model = makeModel({ id: 'opencode::glm-5', providerId: 'opencode', apiModelId: 'glm-5' })

    await buildAgentParams({
      request: { chatId: 'topic-123' },
      signal: undefined,
      provider,
      model
    })

    expect(resolveProviderAiSdkConfigMock).toHaveBeenLastCalledWith(
      provider,
      model,
      expect.objectContaining({ sessionId: 'topic-123' })
    )
  })

  it('maps Groq service tiers after assistant custom parameters and before call overrides', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'groq', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'groq',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'groq', baseUrl: 'https://api.groq.com/openai' }
      }
    })
    const model = makeModel({
      id: 'groq::openai/gpt-oss-120b',
      providerId: 'groq',
      apiModelId: 'openai/gpt-oss-120b'
    })
    const assistant = makeAssistant({
      settings: {
        customParameters: [{ name: 'groq', type: 'json', value: JSON.stringify({ serviceTier: 'auto', seed: 7 }) }]
      }
    })

    const result = await buildAgentParams({
      request: {
        serviceTier: 'fast',
        callOverrides: { providerOptions: { groq: { serviceTier: 'flex', extra: true } } }
      },
      signal: undefined,
      provider,
      model,
      assistant
    })

    expect(result.options.providerOptions?.groq).toEqual({ serviceTier: 'flex', seed: 7, extra: true })
  })

  it('falls an unsupported Groq Performance selection back to Standard', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'groq', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'groq',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'groq', baseUrl: 'https://api.groq.com/openai' }
      }
    })
    const model = makeModel({
      id: 'groq::llama-3.1-8b-instant',
      providerId: 'groq',
      apiModelId: 'llama-3.1-8b-instant'
    })

    const result = await buildAgentParams({ request: { serviceTier: 'fast' }, signal: undefined, provider, model })

    expect(result.options.providerOptions?.groq).toMatchObject({ serviceTier: 'on_demand' })
  })

  it('maps OpenRouter Chat tiers into the OpenRouter provider-options namespace', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'openrouter', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'openrouter',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: {
          adapterFamily: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1/'
        }
      }
    })
    const model = makeModel({
      id: 'openrouter::openai/gpt-5.4',
      providerId: 'openrouter',
      apiModelId: 'openai/gpt-5.4'
    })

    const result = await buildAgentParams({
      request: { serviceTier: 'flex', callOverrides: { providerOptions: { openrouter: { extra: true } } } },
      signal: undefined,
      provider,
      model
    })

    expect(result.options.providerOptions?.openrouter).toEqual({ service_tier: 'flex', extra: true })
  })

  it('injects OpenRouter Messages service_tier at the top level after custom request-body parameters', async () => {
    let sentBody: Record<string, unknown> | undefined
    const innerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('{}')
    })
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: { fetch: innerFetch } },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'openrouter',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: {
          adapterFamily: 'anthropic',
          baseUrl: 'https://openrouter.ai/api'
        }
      }
    })
    const model = makeModel({
      id: 'openrouter::anthropic/claude-sonnet-4.6',
      providerId: 'openrouter',
      apiModelId: 'anthropic/claude-sonnet-4.6',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]
    })
    const assistant = makeAssistant({
      settings: {
        customParameters: [
          { name: 'service_tier', type: 'string', value: 'custom' },
          { name: 'route_hint', type: 'string', value: 'keep-me' }
        ]
      }
    })

    const result = await buildAgentParams({
      request: { serviceTier: 'fast' },
      signal: undefined,
      provider,
      model,
      assistant
    })
    await (result.sdkConfig.providerSettings.fetch as typeof globalThis.fetch)('https://openrouter.ai/api/messages', {
      method: 'POST',
      body: JSON.stringify({ model: model.apiModelId })
    })

    expect(sentBody).toEqual({ route_hint: 'keep-me', service_tier: 'priority', model: model.apiModelId })
    expect(result.options.providerOptions?.anthropic).not.toHaveProperty('service_tier')
  })

  it('omits service tier parameters when the endpoint declares no capability', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'openai-compatible', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({ id: 'opencode' })
    const model = makeModel({ id: 'opencode::glm-5', providerId: 'opencode', apiModelId: 'glm-5' })

    const result = await buildAgentParams({
      request: { serviceTier: 'flex' },
      signal: undefined,
      provider,
      model
    })

    expect(result.options.providerOptions).toBeUndefined()
  })

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
      capabilities: [
        MODEL_CAPABILITY.REASONING,
        MODEL_CAPABILITY.AUDIO_RECOGNITION,
        MODEL_CAPABILITY.VIDEO_RECOGNITION
      ],
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
    expect(result.nativeFileSupport).toMatchObject({ audio: true, video: false })
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
      id: 'gemini::gemini-3-1-pro-preview',
      providerId: 'gemini',
      apiModelId: 'gemini-3-1-pro-preview',
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

  it('preserves assistant custom parameters unchanged in the final provider request body', async () => {
    const firstCustomParameters = [
      { name: 'enable_search', type: 'json' as const, value: 'true' },
      {
        name: 'chat_template_kwargs',
        type: 'json' as const,
        value: JSON.stringify({ enable_thinking: true })
      },
      { name: 'customCamelCase', type: 'json' as const, value: JSON.stringify({ nestedValue: 1 }) },
      { name: 'custom_snake_case', type: 'json' as const, value: JSON.stringify(['one', 'two']) }
    ]
    const secondCustomParameters = [
      { name: 'enable_search', type: 'json' as const, value: 'false' },
      {
        name: 'chat_template_kwargs',
        type: 'json' as const,
        value: JSON.stringify({ enable_thinking: false })
      },
      { name: 'customCamelCase', type: 'json' as const, value: JSON.stringify({ nestedValue: 2 }) },
      { name: 'custom_snake_case', type: 'json' as const, value: JSON.stringify(['three']) }
    ]
    const assistantCustomParameterSets = [firstCustomParameters, secondCustomParameters, firstCustomParameters]
    const expectedCustomParameterSets = assistantCustomParameterSets.map((customParameters) =>
      Object.fromEntries(customParameters.map(({ name, value }) => [name, JSON.parse(value)]))
    )
    const receivedBodies: Record<string, unknown>[] = []
    const requestFetches: Array<typeof globalThis.fetch> = []
    const innerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      receivedBodies.push(JSON.parse(init?.body as string))
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-test',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    resolveProviderAiSdkConfigMock.mockImplementation(async () => ({
      config: {
        providerId: 'openai-chat' as const,
        providerSettings: {
          apiKey: 'sk-test',
          baseURL: 'https://api.test/v1',
          fetch: innerFetch
        }
      },
      credentialReceipt: { attribution: 'auth', method: 'api-key' }
    }))
    const provider = makeProvider({
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai' }
      }
    })
    const model = makeModel({
      id: 'openai::gpt-test',
      providerId: 'openai',
      apiModelId: 'gpt-test'
    })
    for (const customParameters of assistantCustomParameterSets) {
      const result = await buildAgentParams({
        request: {},
        signal: undefined,
        provider,
        model,
        assistant: makeAssistant({ settings: { customParameters } })
      })
      requestFetches.push(result.sdkConfig.providerSettings.fetch as typeof globalThis.fetch)
      await aiCoreGenerateText<AppProviderSettingsMap>(result.sdkConfig.providerId, result.sdkConfig.providerSettings, {
        model: result.sdkConfig.modelId,
        prompt: 'hello',
        providerOptions: result.options.providerOptions
      })
    }

    const receivedCustomParameterSets = expectedCustomParameterSets.map((expectedCustomParameters, index) =>
      Object.fromEntries(Object.keys(expectedCustomParameters).map((name) => [name, receivedBodies[index]?.[name]]))
    )
    expect(receivedCustomParameterSets).toEqual(expectedCustomParameterSets)
    expect(requestFetches[2]).toBe(requestFetches[0])
    expect(requestFetches[1]).not.toBe(requestFetches[0])
  })
})

describe('buildAgentParams standard model parameters', () => {
  function makeSetup(endpointType: EndpointType, maxOutputTokens?: number) {
    const providerId = endpointType === ENDPOINT_TYPE.ANTHROPIC_MESSAGES ? 'anthropic' : 'openai-compatible'
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: {
        providerId,
        providerSettings: {}
      },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'custom',
      defaultChatEndpoint: endpointType,
      endpointConfigs: {
        [endpointType]: { adapterFamily: providerId }
      }
    })
    const model = makeModel({
      id: 'custom::model',
      providerId: 'custom',
      endpointTypes: [endpointType],
      maxOutputTokens
    })
    return { provider, model }
  }

  it('passes enabled assistant sampling settings directly to ToolLoopAgent options', async () => {
    const { provider, model } = makeSetup(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    const assistant = makeAssistant({
      settings: {
        enableTemperature: true,
        temperature: 0.4,
        enableTopP: true,
        topP: 0.8,
        enableMaxTokens: true,
        maxTokens: 12_000
      }
    })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(result.options).toMatchObject({
      temperature: 0.4,
      topP: 0.8,
      maxOutputTokens: 12_000
    })
  })

  it('uses the model catalog limit for an Anthropic-compatible non-Claude model', async () => {
    const { provider, model } = makeSetup(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 65_536)
    const assistant = makeAssistant({ settings: { enableMaxTokens: false, maxTokens: 4096 } })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(result.options.maxOutputTokens).toBe(65_536)
  })

  it('leaves maxOutputTokens unset when an Anthropic-compatible model has no limit metadata', async () => {
    const { provider, model } = makeSetup(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)
    const assistant = makeAssistant({ settings: { enableMaxTokens: false, maxTokens: 4096 } })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(result.options.maxOutputTokens).toBeUndefined()
  })

  it('applies call override over custom parameter and enabled assistant max tokens', async () => {
    const { provider, model } = makeSetup(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 65_536)
    const assistant = makeAssistant({
      settings: {
        enableMaxTokens: true,
        maxTokens: 12_000,
        customParameters: [{ name: 'maxOutputTokens', type: 'number', value: 24_000 }]
      }
    })

    const result = await buildAgentParams({
      request: { callOverrides: { maxOutputTokens: 32_000 } },
      signal: undefined,
      provider,
      model,
      assistant
    })

    expect(result.options.maxOutputTokens).toBe(32_000)
  })

  it('subtracts the effective API Gateway thinking override from the caller total-token cap', async () => {
    const { provider, model } = makeSetup(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)

    const result = await buildAgentParams({
      request: {
        callOverrides: {
          maxOutputTokens: 10_000,
          providerOptions: {
            anthropic: { thinking: { type: 'enabled', budgetTokens: 4000 } }
          }
        }
      },
      signal: undefined,
      provider,
      model
    })

    expect(result.options.providerOptions).toMatchObject({
      anthropic: { thinking: { type: 'enabled', budgetTokens: 4000 } }
    })
    expect(result.options.maxOutputTokens).toBe(6000)
  })

  it('does not apply a model catalog limit to a non-Anthropic endpoint', async () => {
    const { provider, model } = makeSetup(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 65_536)
    const assistant = makeAssistant({ settings: { enableMaxTokens: false, maxTokens: 4096 } })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(result.options.maxOutputTokens).toBeUndefined()
  })

  it.each([
    { providerId: 'anthropic', apiModelId: 'claude-sonnet-4-5' },
    { providerId: 'opencode', apiModelId: 'qwen3.5-plus' }
  ])('subtracts the additive thinking budget once for $apiModelId', async ({ providerId, apiModelId }) => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: providerId,
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({
      id: `${providerId}::${apiModelId}`,
      providerId,
      apiModelId,
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
      maxOutputTokens: 10_000,
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'budget', min: 1024, max: 8192 }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    })
    const assistant = makeAssistant({
      settings: {
        enableMaxTokens: true,
        maxTokens: 10_000,
        reasoning_effort: 'high'
      }
    })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })
    const thinking = result.options.providerOptions?.anthropic?.thinking as { budgetTokens: number }

    expect(thinking.budgetTokens).toBeGreaterThan(0)
    expect(result.options.maxOutputTokens).toBe(10_000 - thinking.budgetTokens)
  })

  it('does not subtract an adaptive thinking mode without a budget', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'opencode',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({
      id: 'opencode::minimax-m3',
      providerId: 'opencode',
      apiModelId: 'minimax-m3',
      endpointTypes: [ENDPOINT_TYPE.ANTHROPIC_MESSAGES],
      maxOutputTokens: 10_000,
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'toggle', default: true }],
        selectableEfforts: ['none', 'auto']
      }
    })
    const assistant = makeAssistant({
      settings: {
        enableMaxTokens: true,
        maxTokens: 10_000,
        reasoning_effort: 'auto'
      }
    })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(result.options.providerOptions).toMatchObject({ anthropic: { thinking: { type: 'adaptive' } } })
    expect(result.options.maxOutputTokens).toBe(10_000)
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
    { clientPreferred: true, expectedRoute: 'client' },
    { clientPreferred: false, expectedRoute: 'server' }
  ])(
    'injects only $expectedRoute implementations when both preferences are $clientPreferred',
    async ({ clientPreferred, expectedRoute }) => {
      const preferences = new Map<string, unknown>([
        ['app.developer_mode.enabled', false],
        ['chat.web_search.search_keywords.client_tools_preferred', clientPreferred],
        ['chat.web_search.fetch_urls.client_tools_preferred', clientPreferred],
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

  it('injects mixed search and fetch sources when their preferences differ', async () => {
    const preferences = new Map<string, unknown>([
      ['app.developer_mode.enabled', false],
      ['chat.web_search.search_keywords.client_tools_preferred', false],
      ['chat.web_search.fetch_urls.client_tools_preferred', true],
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

    expect(result.plugins.some((plugin) => plugin.name === 'webSearch')).toBe(true)
    expect(result.plugins.some((plugin) => plugin.name === 'urlContext')).toBe(false)
    expect(result.tools?.web_search).toBeUndefined()
    expect(result.tools?.web_fetch).toBe(clientFetchEntry.tool)
  })

  it('disables Responses storage for assistant-backed calls too', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'openai', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'openai',
      presetProviderId: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai' } }
    })
    const model = makeModel({
      id: 'openai::gpt-5.6',
      providerId: 'openai',
      apiModelId: 'gpt-5.6',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
    })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(result.options.providerOptions?.openai).toMatchObject({ store: false })
  })

  it.each([
    { endpointType: ENDPOINT_TYPE.OPENAI_RESPONSES, runtimeProviderId: 'openai', expectedRoute: 'server' },
    {
      endpointType: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      runtimeProviderId: 'deepseek',
      expectedRoute: 'client'
    },
    { endpointType: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, runtimeProviderId: 'anthropic', expectedRoute: 'client' }
  ] as const)(
    'routes DeepSeek V4 Flash web search to $expectedRoute on $endpointType',
    async ({ endpointType, runtimeProviderId, expectedRoute }) => {
      resolveProviderAiSdkConfigMock.mockResolvedValue({
        config: { providerId: runtimeProviderId, providerSettings: {} },
        credentialReceipt: { attribution: 'unknown' }
      })
      const deepseekProvider = makeProvider({
        id: 'deepseek',
        presetProviderId: 'deepseek',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai' },
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'deepseek' },
          [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
        },
        serverTools: [
          {
            id: SERVER_TOOL.WEB_SEARCH,
            modelScope: 'model-dependent',
            endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
          }
        ]
      })
      const deepseekModel = makeModel({
        id: 'deepseek::deepseek-v4-flash',
        providerId: 'deepseek',
        apiModelId: 'deepseek-v4-flash',
        endpointTypes: [endpointType],
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
      })
      const preferences = new Map<string, unknown>([
        ['app.developer_mode.enabled', false],
        ['chat.web_search.search_keywords.client_tools_preferred', false],
        ['chat.web_search.fetch_urls.client_tools_preferred', false],
        ['chat.web_search.default_search_keywords_provider', 'exa-mcp'],
        ['chat.web_search.provider_overrides', {}],
        ['chat.web_search.max_results', 5],
        ['chat.web_search.exclude_domains', []]
      ])
      preferenceGetMock.mockImplementation((key: string) => preferences.get(key) ?? null)
      registry.register(clientSearchEntry)

      const result = await buildAgentParams({
        request: {},
        signal: undefined,
        provider: deepseekProvider,
        model: deepseekModel,
        assistant
      })

      expect(result.plugins.some((plugin) => plugin.name === 'webSearch')).toBe(expectedRoute === 'server')
      expect(result.tools?.web_search === clientSearchEntry.tool).toBe(expectedRoute === 'client')
    }
  )

  it.each(['deepseek-v3', 'deepseek-v3.2'])(
    'keeps Bailian built-in search enabled for %s on Chat Completions',
    async (apiModelId) => {
      resolveProviderAiSdkConfigMock.mockResolvedValue({
        config: { providerId: 'openai-compatible', providerSettings: {} },
        credentialReceipt: { attribution: 'unknown' }
      })
      const dashscopeProvider = makeProvider({
        id: 'dashscope',
        presetProviderId: 'dashscope',
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' }
        },
        serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' }]
      })
      const dashscopeModel = makeModel({
        id: `dashscope::${apiModelId}`,
        providerId: 'dashscope',
        apiModelId,
        endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
      })
      preferenceGetMock.mockImplementation((key: string) => {
        if (key === 'chat.web_search.search_keywords.client_tools_preferred') return false
        if (key === 'chat.web_search.fetch_urls.client_tools_preferred') return false
        if (key === 'chat.web_search.max_results') return 5
        if (key === 'chat.web_search.exclude_domains') return []
        return null
      })

      const result = await buildAgentParams({
        request: {},
        signal: undefined,
        provider: dashscopeProvider,
        model: dashscopeModel,
        assistant
      })

      expect(result.options.providerOptions).toMatchObject({
        dashscope: { enable_search: true, search_options: { forced_search: true } }
      })
      expect(result.tools?.web_search).toBeUndefined()
    }
  )

  // Owning a knowledge base is global account state; the KB tools only load when this request also
  // scopes one (their `applies` requires both). Treating the global flag as a function-tool signal
  // made every Gemini 2.5 request look like a native-tool conflict and lose the server route.
  it('keeps the server route for Gemini 2.5 when a knowledge base exists but none is selected', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'google', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const geminiProvider = makeProvider({
      id: 'gemini',
      defaultChatEndpoint: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT,
      endpointConfigs: { [ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT]: { adapterFamily: 'google' } },
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' }]
    })
    const geminiModel = makeModel({
      id: 'gemini::gemini-2.5-pro',
      providerId: 'gemini',
      apiModelId: 'gemini-2.5-pro',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
    })
    preferenceGetMock.mockImplementation((key: string) => {
      if (key === 'chat.web_search.search_keywords.client_tools_preferred') return false
      if (key === 'chat.web_search.fetch_urls.client_tools_preferred') return false
      return null
    })
    registry.register(clientSearchEntry)

    const result = await buildAgentParams({
      request: {},
      signal: undefined,
      provider: geminiProvider,
      model: geminiModel,
      assistant
    })

    expect(result.plugins.some((plugin) => plugin.name === 'webSearch')).toBe(true)
    expect(result.tools?.web_search).toBeUndefined()
  })
})

describe('buildAgentParams assistant-less reasoning', () => {
  it('disables Bailian qwen3.7-max reasoning in the serialized Responses request', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: {
        providerId: 'openai',
        providerSettings: {}
      },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'dashscope',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'openai-compatible' },
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai' }
      }
    })
    const model = makeModel({
      id: 'dashscope::qwen3-7-max',
      providerId: 'dashscope',
      apiModelId: 'qwen3.7-max',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES, ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS],
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
    const prompt: LanguageModelV3CallOptions['prompt'] = [
      { role: 'user', content: [{ type: 'text', text: 'Translate this.' }] }
    ]
    let requestBody: Record<string, unknown> | undefined
    const sdkModel = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        throw new Error('request captured')
      }
    }).responses('qwen3.7-max')

    await expect(sdkModel.doGenerate({ prompt, providerOptions: result.options.providerOptions })).rejects.toThrow(
      'request captured'
    )
    expect(requestBody).toMatchObject({ store: false, reasoning: { effort: 'none' } })
  })

  it('serializes gateway reasoning overrides with Responses storage disabled', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'newapi', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'new-api',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'newapi' } }
    })
    const model = makeModel({
      id: 'new-api::gpt-5.6-sol',
      providerId: 'new-api',
      apiModelId: 'gpt-5.6-sol',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
      capabilities: [MODEL_CAPABILITY.REASONING]
    })

    const result = await buildAgentParams({
      request: { callOverrides: { providerOptions: { openai: { reasoningEffort: 'none', forceReasoning: true } } } },
      signal: undefined,
      provider,
      model
    })
    let requestBody: Record<string, unknown> | undefined
    const sdkModel = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        throw new Error('request captured')
      }
    }).responses('gpt-5.6-sol')

    await expect(
      sdkModel.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run the task.' }] }],
        providerOptions: result.options.providerOptions
      })
    ).rejects.toThrow('request captured')
    expect(requestBody).toMatchObject({ store: false, reasoning: { effort: 'none' } })
  })

  it('serializes reasoning.summary when a compatible Responses endpoint explicitly opts in', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'newapi', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'new-api',
      presetProviderId: 'new-api',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: {
          adapterFamily: 'newapi',
          dialect: { reasoningSummary: true }
        }
      }
    })
    const model = makeModel({
      id: 'new-api::gpt-5.6-sol',
      providerId: 'new-api',
      apiModelId: 'gpt-5.6-sol',
      endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES],
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: {
        controls: [{ kind: 'effort', values: ['low', 'medium', 'high'] }],
        selectableEfforts: ['low', 'medium', 'high']
      }
    })
    const assistant = makeAssistant({
      settings: { reasoning_effort: 'high', reasoning_summary: 'detailed' }
    })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })
    let requestBody: Record<string, unknown> | undefined
    const sdkModel = createOpenAI({
      apiKey: 'sk-test',
      baseURL: 'https://example.com/v1',
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body))
        throw new Error('request captured')
      }
    }).responses('gpt-5.6-sol')

    await expect(
      sdkModel.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Run the task.' }] }],
        providerOptions: result.options.providerOptions
      })
    ).rejects.toThrow('request captured')
    expect(requestBody).toMatchObject({
      store: false,
      reasoning: { effort: 'high', summary: 'detailed' }
    })
  })

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

  it('applies the Ollama context-window default without an assistant', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'ollama', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'ollama',
      presetProviderId: 'ollama',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { adapterFamily: 'ollama' } }
    })
    const model = makeModel({
      id: 'ollama::qwen3',
      providerId: 'ollama',
      apiModelId: 'qwen3',
      contextWindow: 131072
    })

    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model })

    expect(result.options.providerOptions?.ollama).toMatchObject({ options: { num_ctx: 131072 } })
  })

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

  it.each([
    { providerId: 'opencode', runtimeProviderId: 'openai-compatible', adapterFamily: 'openai-compatible' },
    { providerId: 'openrouter', runtimeProviderId: 'openrouter', adapterFamily: 'openrouter' }
  ])('treats stale Auto as Default for mandatory-thinking GLM on $providerId', async (providerConfig) => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: providerConfig.runtimeProviderId, providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const endpointType = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
    const provider = makeProvider({
      id: providerConfig.providerId,
      defaultChatEndpoint: endpointType,
      endpointConfigs: { [endpointType]: { adapterFamily: providerConfig.adapterFamily } }
    })
    const model = makeModel({
      id: `${providerConfig.providerId}::glm-5.3-flash`,
      providerId: providerConfig.providerId,
      apiModelId: 'glm-5.3-flash',
      presetModelId: 'glm-5-3-flash',
      endpointTypes: [endpointType],
      capabilities: [MODEL_CAPABILITY.REASONING]
    })

    const result = await buildAgentParams({
      request: { reasoningEffort: 'auto' },
      signal: undefined,
      provider,
      model
    })

    const providerOptions = result.options.providerOptions?.[result.sdkConfig.providerOptionsKey] ?? {}
    expect(providerOptions).not.toHaveProperty('reasoning')
    expect(providerOptions).not.toHaveProperty('reasoningEffort')
    expect(providerOptions).not.toHaveProperty('reasoning_effort')
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
    // Gemini 2.5 speaks the budget dialect and hard-rejects `thinkingLevel`, so
    // turning reasoning off must send `thinkingBudget: 0`. This row is exactly
    // the shape that used to leak the Gemini 3 field: a catalog-backed custom
    // row (resolvable apiModelId, no presetModelId) on a gateway with no pin.
    expect(result.options.providerOptions?.google).toMatchObject({
      thinkingConfig: { includeThoughts: false, thinkingBudget: 0 }
    })
    expect(Object.keys(result.options.providerOptions ?? {})).toEqual(['google'])
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

/**
 * Custom rows carry no `presetModelId`, and `wireDialect` is a catalog fact that
 * is never persisted on the row — so the dialect has to be re-resolved through
 * `apiModelId` at request time. When that lookup is missing these rows silently
 * fall back to the newer wire and emit a field the vendor rejects outright
 * (Gemini 2.x `thinkingLevel`, Claude <=4.5 `thinking.type=adaptive`).
 */
describe('buildAgentParams native-dialect resolution for catalog-backed custom rows', () => {
  const buildFor = async (
    endpoint: (typeof ENDPOINT_TYPE)[keyof typeof ENDPOINT_TYPE],
    adapterFamily: string,
    apiModelId: string
  ) => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: adapterFamily, providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'my-gateway',
      defaultChatEndpoint: endpoint,
      endpointConfigs: { [endpoint]: { adapterFamily } }
    })
    // No presetModelId — the row a user gets by typing the id on a custom provider.
    const model = makeModel({
      id: `my-gateway::${apiModelId}`,
      providerId: 'my-gateway',
      apiModelId,
      maxOutputTokens: 32_000,
      capabilities: [MODEL_CAPABILITY.REASONING],
      reasoning: { controls: [{ kind: 'budget', min: 1024, max: 8192 }], selectableEfforts: ['low', 'high'] }
    })
    const assistant = makeAssistant({ settings: { reasoning_effort: 'high' } })
    const result = await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })
    return result.options.providerOptions ?? {}
  }

  it('keeps Claude 4.5 on the budget dialect', async () => {
    const options = await buildFor(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic', 'claude-sonnet-4-5')
    const thinking = options.anthropic?.thinking as { type?: string; budgetTokens?: number } | undefined
    expect(thinking?.type).toBe('enabled')
    expect(thinking?.budgetTokens).toBeGreaterThan(0)
  })

  it('keeps Gemini 2.5 on the budget dialect', async () => {
    const options = await buildFor(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google', 'gemini-2.5-flash')
    const config = options.google?.thinkingConfig as Record<string, unknown> | undefined
    expect(config).toHaveProperty('thinkingBudget')
    expect(config).not.toHaveProperty('thinkingLevel')
  })

  // Positive control: the fallback must not force every model onto budget.
  it('leaves Gemini 3 on the level dialect', async () => {
    const options = await buildFor(ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, 'google', 'gemini-3-flash')
    const config = options.google?.thinkingConfig as Record<string, unknown> | undefined
    expect(config).toHaveProperty('thinkingLevel')
    expect(config).not.toHaveProperty('thinkingBudget')
  })

  it('leaves Claude 4.6+ on the adaptive dialect', async () => {
    const options = await buildFor(ENDPOINT_TYPE.ANTHROPIC_MESSAGES, 'anthropic', 'claude-opus-4-6')
    const thinking = options.anthropic?.thinking as { type?: string; budgetTokens?: number } | undefined
    expect(thinking?.type).toBe('adaptive')
    expect(thinking?.budgetTokens).toBeUndefined()
  })
})

describe('buildAgentParams retained context', () => {
  const makeSetup = () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'custom-claude',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: {
        [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' }
      }
    })
    const model = makeModel({ id: 'custom-claude::claude-x', providerId: 'custom-claude', apiModelId: 'claude-x' })
    return { provider, model }
  }
  const fileMessage = {
    id: 'm1',
    role: 'user' as const,
    parts: [
      { type: 'text', text: 'see attachment' },
      {
        type: 'file',
        mediaType: 'text/plain',
        url: 'file:///tmp/log.txt',
        filename: 'log.txt',
        providerMetadata: { cherry: { fileEntryId: 'fe-1' } }
      }
    ]
  } as never

  it('prefers the request-carried retained context over scanning messages', async () => {
    const { provider, model } = makeSetup()
    const retainedContext = {
      fileAttachments: [{ fileEntryId: 'fe-raw', handle: 'folded.txt', displayName: 'folded.txt' }],
      persistedOutputPaths: new Set(['/blobs/fe-blob.txt'])
    }

    const result = await buildAgentParams({
      request: { messages: [fileMessage], retainedContext },
      signal: undefined,
      provider,
      model
    })

    // Served messages carry fe-1, but the raw-path retained context wins.
    expect(result.fileAttachments).toBe(retainedContext.fileAttachments)
    expect((result.options.context as RequestContext | undefined)?.persistedOutputPaths).toEqual(
      new Set(['/blobs/fe-blob.txt'])
    )
  })

  it('clones the allow-list Set so mid-turn appends never reach the shared retained context', async () => {
    const { provider, model } = makeSetup()
    const retainedContext = {
      fileAttachments: [],
      persistedOutputPaths: new Set(['/blobs/fe-blob.txt'])
    }

    const result = await buildAgentParams({
      request: { retainedContext },
      signal: undefined,
      provider,
      model
    })

    const served = (result.options.context as RequestContext | undefined)?.persistedOutputPaths
    expect(served).not.toBe(retainedContext.persistedOutputPaths)
    served?.add('/blobs/new-mid-turn.txt')
    expect(retainedContext.persistedOutputPaths.has('/blobs/new-mid-turn.txt')).toBe(false)
  })

  it('falls back to scanning served messages when no retained context rides the request', async () => {
    const { provider, model } = makeSetup()

    const result = await buildAgentParams({
      request: { messages: [fileMessage] },
      signal: undefined,
      provider,
      model
    })

    expect(result.fileAttachments).toEqual([{ fileEntryId: 'fe-1', handle: 'log.txt', displayName: 'log.txt' }])
    expect((result.options.context as RequestContext | undefined)?.persistedOutputPaths?.size).toBe(0)
  })
})

describe('buildAgentParams — Responses instructions delivery', () => {
  it('lands the system prompt on the namespace the resolved responses model reads', async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'openai', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    const provider = makeProvider({
      id: 'relay',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      endpointConfigs: {
        [ENDPOINT_TYPE.OPENAI_RESPONSES]: { adapterFamily: 'openai', baseUrl: 'https://relay.example/v1' }
      }
    })
    const model = makeModel({ id: 'relay::gpt-5', providerId: 'relay', apiModelId: 'gpt-5' })
    const assistant = makeAssistant({ prompt: 'YOU-ARE-REPRO-BOT' })

    const { options, sdkConfig, system } = await buildAgentParams({
      request: {},
      signal: undefined,
      provider,
      model,
      assistant
    })

    expect(system).toContain('YOU-ARE-REPRO-BOT')
    expect(options.providerOptions?.[sdkConfig.providerOptionsKey]).toMatchObject({
      instructions: system,
      systemMessageMode: 'remove'
    })
  })
})

describe('buildAgentParams — assistant context-settings passthrough (P2-D)', () => {
  it("forwards the assistant's contextSettings override to the resolver", async () => {
    resolveProviderAiSdkConfigMock.mockResolvedValue({
      config: { providerId: 'anthropic', providerSettings: {} },
      credentialReceipt: { attribution: 'unknown' }
    })
    resolveRequestContextSettingsSpy.mockClear()
    const provider = makeProvider({
      id: 'custom-claude',
      defaultChatEndpoint: ENDPOINT_TYPE.ANTHROPIC_MESSAGES,
      endpointConfigs: { [ENDPOINT_TYPE.ANTHROPIC_MESSAGES]: { adapterFamily: 'anthropic' } }
    })
    const model = makeModel({ id: 'custom-claude::claude-x', providerId: 'custom-claude', apiModelId: 'claude-x' })
    const override = { truncateThreshold: 4000, compress: { enabled: false } }
    const assistant = makeAssistant({ settings: { contextSettings: override } })

    await buildAgentParams({ request: {}, signal: undefined, provider, model, assistant })

    expect(resolveRequestContextSettingsSpy).toHaveBeenCalledWith(model, override)
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

describe('applyResponsesInstructions', () => {
  const optionsWith = (providerOptions?: ProviderOptions): AgentOptions =>
    ({ maxRetries: 0, ...(providerOptions && { providerOptions }) }) as AgentOptions

  it('mirrors the system prompt into instructions and drops the duplicate system input message', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'YOU-ARE-REPRO-BOT', ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai')
    // Without `systemMessageMode: 'remove'` @ai-sdk/openai keeps the system input
    // message alongside `instructions` and the prompt ships twice.
    expect(options.providerOptions?.openai).toEqual({
      instructions: 'YOU-ARE-REPRO-BOT',
      systemMessageMode: 'remove'
    })
  })

  it('writes to the namespace the model reads, not a hardcoded openai one', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_RESPONSES, 'my-relay')
    expect(options.providerOptions?.['my-relay']?.instructions).toBe('SYS')
    expect(options.providerOptions?.openai).toBeUndefined()
  })

  it('merges into an existing providerOptions block without clobbering siblings', () => {
    const options = optionsWith({ openai: { reasoningEffort: 'low' } })
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai')
    expect(options.providerOptions?.openai).toMatchObject({ reasoningEffort: 'low', instructions: 'SYS' })
  })

  it('leaves an instructions value the user already set completely alone', () => {
    const options = optionsWith({ openai: { instructions: 'USER-SET' } })
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai')
    // Their prompt is authoritative — including which messages reach the model.
    expect(options.providerOptions?.openai).toEqual({ instructions: 'USER-SET' })
  })

  it('does nothing for non-Responses endpoints (Chat Completions)', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'SYS', ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, 'openai')
    expect(options.providerOptions).toBeUndefined()
  })

  it('does nothing when the endpoint is undefined', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, 'SYS', undefined, 'openai')
    expect(options.providerOptions).toBeUndefined()
  })

  it('does nothing when there is no system prompt', () => {
    const options = optionsWith()
    applyResponsesInstructions(options, undefined, ENDPOINT_TYPE.OPENAI_RESPONSES, 'openai')
    expect(options.providerOptions).toBeUndefined()
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
    expect(resolveToolCallLimit(makeAssistant({ settings: { enableMaxToolCalls: false, maxToolCalls: 7 } }))).toBe(100)
  })

  it('falls back when the configured limit is outside the supported range', () => {
    expect(resolveToolCallLimit(makeAssistant({ settings: { maxToolCalls: 1001 } }))).toBe(100)
  })

  it('accepts a limit above the previous 100-round ceiling', () => {
    expect(resolveToolCallLimit(makeAssistant({ settings: { maxToolCalls: 500 } }))).toBe(500)
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

describe('resolveTools fs_read gating', () => {
  const OTHER_TOOL_NAME = 'test-plain-tool'
  const otherEntry: ToolEntry = {
    name: OTHER_TOOL_NAME,
    namespace: 'test',
    description: 'ungated test tool',
    defer: 'never',
    tool: {} as Tool
  }

  beforeEach(() => registry.register(createFsReadToolEntry()))
  afterEach(() => {
    registry.deregister(FS_READ_TOOL_NAME)
    registry.deregister(OTHER_TOOL_NAME)
  })

  it('drops a lone fs_read when no markers exist (nothing else can be offloaded)', async () => {
    const { tools } = await resolveTools({}, undefined, makeModel(), false, [], undefined, undefined, false, true)
    expect(tools).toBeUndefined()
  })

  it('keeps fs_read alongside another function tool when offload is possible', async () => {
    registry.register(otherEntry)
    const { tools } = await resolveTools({}, undefined, makeModel(), false, [], undefined, undefined, false, true)
    expect(tools?.[FS_READ_TOOL_NAME]).toBeDefined()
    expect(tools?.[OTHER_TOOL_NAME]).toBeDefined()
  })

  it('keeps a lone fs_read when the conversation already has persisted-output markers', async () => {
    const { tools } = await resolveTools({}, undefined, makeModel(), false, [], undefined, undefined, true, false)
    expect(tools?.[FS_READ_TOOL_NAME]).toBeDefined()
  })

  it('omits fs_read when offload is impossible and no markers exist, even with other tools', async () => {
    registry.register(otherEntry)
    const { tools } = await resolveTools({}, undefined, makeModel(), false, [], undefined, undefined, false, false)
    expect(tools?.[FS_READ_TOOL_NAME]).toBeUndefined()
    expect(tools?.[OTHER_TOOL_NAME]).toBeDefined()
  })

  it('keeps a lone fs_read when gateway client tools are present', async () => {
    const { tools } = await resolveTools(
      { callOverrides: { tools: { client_tool: {} as Tool } } },
      undefined,
      makeModel(),
      false,
      [],
      undefined,
      undefined,
      false,
      true
    )
    expect(tools?.[FS_READ_TOOL_NAME]).toBeDefined()
    expect(tools?.client_tool).toBeDefined()
  })
})
