import { describe, expect, it } from 'vitest'

import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  finalizeWebToolRoutes,
  isBuiltinWebFetchAvailable,
  isBuiltinWebSearchAvailable,
  isServerToolModelEligible,
  resolveWebToolRoutes
} from '@shared/utils/provider'

const model = (apiModelId: string, overrides: Partial<Model> = {}): Model => ({
  id: `provider::${apiModelId}`,
  providerId: 'provider',
  apiModelId,
  name: apiModelId,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false,
  ...overrides
})

const provider = (modelScope: 'all-chat-models' | 'model-dependent', id = 'anthropic'): Provider =>
  ({ id, serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope }] }) as Provider

describe('server-tool model eligibility', () => {
  it.each(['gemini', 'vertexai', 'cherryin', 'aihubmix'])(
    'keeps Gemini 4 search and URL context alongside function tools on %s',
    (providerId) => {
      const argon = model('google/gemini-4-argon', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
      const host = {
        id: providerId,
        serverTools: [
          { id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' },
          { id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent' }
        ]
      } as Provider
      expect(isBuiltinWebSearchAvailable(argon, host)).toBe(true)
      expect(isBuiltinWebFetchAvailable(argon, host)).toBe(true)
      expect(
        resolveWebToolRoutes(argon, host, {
          webSearchEnabled: true,
          modelToolsPreferred: true,
          clientSearchAvailable: false,
          clientFetchAvailable: false,
          hasFunctionToolSignals: true
        })
      ).toMatchObject({ webSearch: 'server', webFetch: 'server' })
    }
  )

  it('uses generated registry eligibility without a generic model capability', () => {
    const claude = model('claude-sonnet-4-6')

    expect(claude.capabilities).not.toContain('web-search')
    expect(isServerToolModelEligible(claude, { id: 'anthropic' }, SERVER_TOOL.WEB_SEARCH)).toBe(true)
    expect(isBuiltinWebSearchAvailable(claude, provider('model-dependent'))).toBe(true)
  })

  it('keeps unknown custom models ineligible for model-dependent tools', () => {
    const custom = model('private-model')

    expect(isBuiltinWebSearchAvailable(custom, provider('model-dependent'))).toBe(false)
    expect(isBuiltinWebSearchAvailable(custom, { id: 'custom', serverTools: [] })).toBe(false)
  })

  it.each(['deepseek-v3', 'deepseek-v3.2', 'deepseek-v4-flash', 'deepseek-v4-pro'])(
    'keeps Bailian-owned DeepSeek web-search eligibility for %s',
    (modelId) => {
      expect(isBuiltinWebSearchAvailable(model(modelId), provider('model-dependent', 'dashscope'))).toBe(true)
    }
  )

  it('narrows official DeepSeek web search to its Responses endpoint', () => {
    const deepseek = {
      id: 'deepseek',
      serverTools: [
        {
          id: SERVER_TOOL.WEB_SEARCH,
          modelScope: 'model-dependent',
          endpointTypes: [ENDPOINT_TYPE.OPENAI_RESPONSES]
        }
      ]
    } as Provider
    const flash = model('deepseek-flash', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
    const route = (endpointType: (typeof ENDPOINT_TYPE)[keyof typeof ENDPOINT_TYPE]) =>
      resolveWebToolRoutes(flash, deepseek, {
        webSearchEnabled: true,
        clientSearchAvailable: true,
        clientFetchAvailable: false,
        modelToolsPreferred: true,
        endpointType
      })

    expect(route(ENDPOINT_TYPE.OPENAI_RESPONSES)).toMatchObject({ webSearch: 'server' })
    expect(route(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)).toMatchObject({ webSearch: 'client' })
    expect(route(ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toMatchObject({ webSearch: 'client' })
    expect(isBuiltinWebSearchAvailable(model('deepseek-v3.2'), deepseek, ENDPOINT_TYPE.OPENAI_RESPONSES)).toBe(false)
  })

  it('rejects non-chat models even when their ids are otherwise eligible', () => {
    const embedding = model('claude-sonnet-4-6', {
      capabilities: [MODEL_CAPABILITY.EMBEDDING]
    })

    expect(isServerToolModelEligible(embedding, { id: 'anthropic' }, SERVER_TOOL.WEB_SEARCH)).toBe(false)
  })

  // Gateways serve namespaced ids (`google/gemini-3-1-pro-preview`). VENDOR_PATTERNS are anchored, so
  // an unstripped namespace matches nothing and `vendors` narrowing withheld the tool from every
  // model whose vendor slug differs from its namespace — cherryin's Gemini and Claude lines both.
  it('narrows by vendor through a gateway namespace prefix', () => {
    const cherryin = {
      id: 'cherryin',
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent', vendors: ['gemini', 'openai'] }]
    } as unknown as Provider

    expect(isBuiltinWebSearchAvailable(model('google/gemini-3-1-pro-preview'), cherryin)).toBe(true)
    expect(isBuiltinWebSearchAvailable(model('openai/gpt-5.5'), cherryin)).toBe(true)
    // Still excluded: its vendor is simply not on the declaration.
    expect(isBuiltinWebSearchAvailable(model('deepseek/deepseek-v3.2'), cherryin)).toBe(false)
  })

  // Ark's wire ids are dated snapshots (`doubao-seed-2-1-pro-260628`), while the catalog keys the
  // undated canonical — eligibility must survive the date stamp or built-in search vanishes for
  // exactly the models that carry it.
  it('stays eligible when the wire id carries an Ark date snapshot', () => {
    const dated = model('doubao-seed-2-1-pro-260628', { providerId: 'doubao' })

    expect(isBuiltinWebSearchAvailable(dated, provider('model-dependent', 'doubao'))).toBe(true)
  })

  // A gateway whose declaration narrows to `gemini` resolves the same google tool factory through the
  // model's `<host>.google` provider segment, so pre-3 Gemini hits the same native-vs-function-tool
  // conflict there. Keying the guard to the host id let cherryin/aihubmix ship the unsupported combo.
  it.each(['cherryin', 'aihubmix'])('applies the Gemini tool conflict on %s, not just gemini hosts', (providerId) => {
    const gateway = {
      id: providerId,
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent', vendors: ['gemini', 'openai'] }]
    } as unknown as Provider
    const gemini25 = model('google/gemini-2.5-pro', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })

    expect(
      resolveWebToolRoutes(gemini25, gateway, {
        webSearchEnabled: true,
        clientSearchAvailable: false,
        clientFetchAvailable: false,
        modelToolsPreferred: true,
        hasFunctionToolSignals: true
      })
    ).toMatchObject({ webSearch: 'none', reasons: { webSearch: 'gemini-function-tool-conflict' } })

    // Gemini 3 combines them, so the same gateway keeps the server route.
    expect(
      resolveWebToolRoutes(
        model('google/gemini-3-1-pro-preview', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] }),
        {
          ...gateway
        },
        {
          webSearchEnabled: true,
          clientSearchAvailable: false,
          clientFetchAvailable: false,
          modelToolsPreferred: true,
          hasFunctionToolSignals: true
        }
      )
    ).toMatchObject({ webSearch: 'server' })
  })

  it('keeps provider-wide tools independent from model-dependent eligibility', () => {
    expect(isBuiltinWebSearchAvailable(model('private-model'), provider('all-chat-models'))).toBe(true)
  })
})

describe('web-tool routing', () => {
  const claude = model('claude-sonnet-4-6', {
    capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
  })
  const serverProvider = {
    id: 'anthropic',
    serverTools: [
      { id: SERVER_TOOL.WEB_SEARCH, modelScope: 'all-chat-models' },
      { id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent' }
    ]
  } as Provider
  const bothEnabled = {
    webSearchEnabled: true,
    clientSearchAvailable: true,
    clientFetchAvailable: true
  }

  it('selects the preferred side for both search and fetch when both sides are available', () => {
    expect(resolveWebToolRoutes(claude, serverProvider, { ...bothEnabled, modelToolsPreferred: true })).toEqual({
      webSearch: 'server',
      webFetch: 'server'
    })
    expect(resolveWebToolRoutes(claude, serverProvider, { ...bothEnabled, modelToolsPreferred: false })).toEqual({
      webSearch: 'client',
      webFetch: 'client'
    })
  })

  it.each([
    {
      name: 'configured services when model-native tools are unavailable',
      provider: { serverTools: [] } as unknown as Provider,
      clientSearchAvailable: true,
      clientFetchAvailable: true,
      modelToolsPreferred: true,
      expected: { webSearch: 'client', webFetch: 'client' }
    },
    {
      name: 'model-native tools when configured services are unavailable',
      provider: serverProvider,
      clientSearchAvailable: false,
      clientFetchAvailable: false,
      modelToolsPreferred: false,
      expected: { webSearch: 'server', webFetch: 'server' }
    },
    {
      name: 'no tools when neither side is available',
      provider: { serverTools: [] } as unknown as Provider,
      clientSearchAvailable: false,
      clientFetchAvailable: false,
      modelToolsPreferred: true,
      expected: {
        webSearch: 'none',
        webFetch: 'none',
        reasons: { webSearch: 'no-backend', webFetch: 'no-backend' }
      }
    }
  ])('falls back to $name', ({ provider, expected, ...options }) => {
    expect(resolveWebToolRoutes(claude, provider, { webSearchEnabled: true, ...options })).toEqual(expected)
  })

  it('routes each capability through its preferred side and then the available fallback', () => {
    expect(
      resolveWebToolRoutes(claude, provider('all-chat-models'), {
        ...bothEnabled,
        modelToolsPreferred: true
      })
    ).toEqual({ webSearch: 'server', webFetch: 'client' })
    expect(
      resolveWebToolRoutes(claude, serverProvider, {
        ...bothEnabled,
        clientSearchAvailable: false,
        modelToolsPreferred: false
      })
    ).toEqual({ webSearch: 'server', webFetch: 'client' })
  })

  it('recognizes provider-native URL fetch for supported model families', () => {
    expect(isBuiltinWebFetchAvailable(claude, serverProvider)).toBe(true)
    expect(isBuiltinWebFetchAvailable(model('private-model'), serverProvider)).toBe(false)
  })

  it('honors the declaration vendors narrowing (Vertex url-context is Gemini-only)', () => {
    const vertexLike = {
      id: 'vertexai',
      serverTools: [{ id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent', vendors: ['gemini'] }]
    } as Provider
    expect(isBuiltinWebFetchAvailable(model('gemini-2.5-pro'), vertexLike)).toBe(true)
    expect(isBuiltinWebFetchAvailable(claude, vertexLike)).toBe(false)
  })

  // A gateway serves the underlying vendor's native tool; a model whose vendor
  // owns no tool factory must not claim the capability (it would route to the
  // server side and inject nothing while the client tools stay withheld).
  it('keeps unservable vendors off a gateway declaration', () => {
    const gatewayLike = {
      id: 'cherryin',
      serverTools: [
        { id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent', vendors: ['anthropic', 'gemini', 'openai'] }
      ]
    } as Provider
    expect(isBuiltinWebSearchAvailable(claude, gatewayLike)).toBe(true)
    expect(isBuiltinWebSearchAvailable(model('deepseek-v4-pro'), gatewayLike)).toBe(false)
  })

  it('reports model-unsupported when only client backends exist for a non-function-calling model', () => {
    expect(
      resolveWebToolRoutes(model('private-model'), { serverTools: [] } as unknown as Provider, {
        ...bothEnabled,
        modelToolsPreferred: false
      })
    ).toEqual({
      webSearch: 'none',
      webFetch: 'none',
      reasons: { webSearch: 'model-unsupported', webFetch: 'model-unsupported' }
    })
  })
})

describe('conflict-aware routing', () => {
  const gemini25 = model('gemini-2.5-pro', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
  const geminiProvider = {
    id: 'gemini',
    serverTools: [
      { id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' },
      { id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent' }
    ]
  } as Provider

  it('falls back to the client side when function-tool signals conflict with Gemini native tools', () => {
    expect(
      resolveWebToolRoutes(gemini25, geminiProvider, {
        webSearchEnabled: true,
        clientSearchAvailable: true,
        clientFetchAvailable: true,
        modelToolsPreferred: true,
        hasFunctionToolSignals: true
      })
    ).toEqual({ webSearch: 'client', webFetch: 'client' })
  })

  it('coordinates web routes to the side with broader coverage when pre-3 Gemini cannot mix them', () => {
    const searchOnlyProvider = {
      id: 'gemini',
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' }]
    } as Provider

    expect(
      resolveWebToolRoutes(gemini25, searchOnlyProvider, {
        webSearchEnabled: true,
        clientSearchAvailable: true,
        clientFetchAvailable: true,
        modelToolsPreferred: true
      })
    ).toEqual({ webSearch: 'client', webFetch: 'client' })
  })

  it('reports the conflict when no client fallback exists', () => {
    expect(
      resolveWebToolRoutes(gemini25, geminiProvider, {
        webSearchEnabled: true,
        clientSearchAvailable: false,
        clientFetchAvailable: false,
        modelToolsPreferred: true,
        hasFunctionToolSignals: true
      })
    ).toEqual({
      webSearch: 'none',
      webFetch: 'none',
      reasons: { webSearch: 'gemini-function-tool-conflict', webFetch: 'gemini-function-tool-conflict' }
    })
  })

  it('suppresses OpenAI native search under minimal reasoning effort', () => {
    const gpt5 = model('gpt-5', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING] })
    const openaiProvider = {
      id: 'openai',
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_RESPONSES,
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' }]
    } as Provider
    expect(
      resolveWebToolRoutes(gpt5, openaiProvider, {
        webSearchEnabled: true,
        clientSearchAvailable: false,
        clientFetchAvailable: false,
        modelToolsPreferred: true,
        reasoningEffort: 'minimal'
      })
    ).toEqual({
      webSearch: 'none',
      webFetch: 'none',
      reasons: { webSearch: 'openai-minimal-reasoning', webFetch: 'no-backend' }
    })
    expect(
      resolveWebToolRoutes(gpt5, openaiProvider, {
        webSearchEnabled: true,
        clientSearchAvailable: false,
        clientFetchAvailable: false,
        modelToolsPreferred: true,
        reasoningEffort: 'high'
      })
    ).toMatchObject({ webSearch: 'server' })
  })
})

describe('finalizeWebToolRoutes', () => {
  const gemini25 = model('gemini-2.5-pro', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
  const gemini3 = model('gemini-3-1-pro-preview', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
  const geminiProvider = { id: 'gemini', serverTools: [] } as unknown as Provider
  const openrouterLike = { id: 'openrouter', serverTools: [] } as unknown as Provider

  it('withdraws surviving server routes for pre-3 Gemini once real function tools are known', () => {
    expect(finalizeWebToolRoutes({ webSearch: 'server', webFetch: 'server' }, gemini25, geminiProvider, true)).toEqual({
      webSearch: 'none',
      webFetch: 'none',
      reasons: { webSearch: 'gemini-function-tool-conflict', webFetch: 'gemini-function-tool-conflict' }
    })
  })

  it('spares non-google server search implementations', () => {
    expect(finalizeWebToolRoutes({ webSearch: 'server', webFetch: 'none' }, gemini25, openrouterLike, true)).toEqual({
      webSearch: 'server',
      webFetch: 'none'
    })
  })

  it('keeps routes untouched without a conflict', () => {
    const routes = { webSearch: 'server', webFetch: 'server' } as const
    expect(finalizeWebToolRoutes(routes, gemini25, geminiProvider, false)).toBe(routes)
    expect(finalizeWebToolRoutes(routes, gemini3, geminiProvider, true)).toBe(routes)
    const clientRoutes = { webSearch: 'client', webFetch: 'client' } as const
    expect(finalizeWebToolRoutes(clientRoutes, gemini25, geminiProvider, true)).toBe(clientRoutes)
  })
})

describe('DashScope hosted search endpoint contract', () => {
  const chat = ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
  const responses = ENDPOINT_TYPE.OPENAI_RESPONSES
  const host = (id = 'dashscope'): Provider =>
    ({
      id,
      presetProviderId: 'dashscope',
      defaultChatEndpoint: chat,
      serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent' }]
    }) as Provider
  const route = (m: Model, p: Provider, endpointType: typeof chat | typeof responses, overrides = {}) =>
    resolveWebToolRoutes(m, p, {
      webSearchEnabled: true,
      modelToolsPreferred: true,
      clientSearchAvailable: true,
      clientFetchAvailable: false,
      endpointType,
      ...overrides
    })

  describe.each(['dashscope', 'user-copy-1'])('%s', (providerId) => {
    it.each([
      ['glm-5-2', 'glm-5.2'],
      ['kimi-k3', 'kimi/kimi-k3'],
      ['kimi-k3', 'kimi-k3']
    ])('retains %s / %s only for Responses search', (canonicalId, wireId) => {
      const p = host(providerId)
      const m = model(wireId, {
        id: `${providerId}::${canonicalId}`,
        providerId,
        capabilities: [MODEL_CAPABILITY.FUNCTION_CALL]
      })
      expect(isServerToolModelEligible(m, p, SERVER_TOOL.WEB_SEARCH)).toBe(true)
      expect(isBuiltinWebSearchAvailable(m, p, chat)).toBe(false)
      expect(isBuiltinWebSearchAvailable(m, p, responses)).toBe(true)
      expect(isBuiltinWebSearchAvailable(m, p, ENDPOINT_TYPE.ANTHROPIC_MESSAGES)).toBe(false)
      expect(isBuiltinWebSearchAvailable(m, p)).toBe(false)
      const responseFirst = { ...m, endpointTypes: [responses, chat] }
      expect(isBuiltinWebSearchAvailable(responseFirst, p)).toBe(true)
      expect(isBuiltinWebSearchAvailable(responseFirst, p, chat)).toBe(false)
      expect(isBuiltinWebSearchAvailable({ ...m, endpointTypes: [chat, responses] }, p, responses)).toBe(true)
      expect(isBuiltinWebSearchAvailable(m, { ...p, defaultChatEndpoint: responses })).toBe(true)
      expect(route(m, p, chat)).toMatchObject({ webSearch: 'client' })
      expect(route(m, p, responses)).toMatchObject({ webSearch: 'server' })
      expect(route(m, p, chat, { clientSearchAvailable: false })).toMatchObject({
        webSearch: 'none',
        reasons: { webSearch: 'no-backend' }
      })
      expect(route(m, p, responses, { clientSearchAvailable: false })).toMatchObject({ webSearch: 'server' })
      expect(route({ ...m, capabilities: [] }, p, chat)).toMatchObject({
        webSearch: 'none',
        reasons: { webSearch: 'model-unsupported' }
      })
      expect(route(m, p, responses, { webSearchEnabled: false })).toMatchObject({ webSearch: 'none' })
      for (const apiModelId of [undefined, '']) {
        const fallback: Model = { ...m, id: `${providerId}::${wireId}`, apiModelId }
        expect(isBuiltinWebSearchAvailable(fallback, p, chat)).toBe(false)
        expect(isBuiltinWebSearchAvailable(fallback, p, responses)).toBe(true)
      }
    })
  })

  it('restricts all-chat declarations without bypassing other availability gates', () => {
    const m = model('glm-5.2')
    const p = host()
    const allChat = { ...p, serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'all-chat-models' as const }] }
    expect(isBuiltinWebSearchAvailable(m, allChat, chat)).toBe(false)
    expect(isBuiltinWebSearchAvailable(m, allChat, responses)).toBe(true)
    expect(isBuiltinWebSearchAvailable(m, { ...p, serverTools: [] }, responses)).toBe(false)
    expect(isBuiltinWebSearchAvailable({ ...m, capabilities: [MODEL_CAPABILITY.EMBEDDING] }, p, responses)).toBe(false)
    expect(
      isBuiltinWebSearchAvailable(
        m,
        {
          ...p,
          serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent', vendors: ['openai'] }]
        },
        responses
      )
    ).toBe(false)
    expect(
      isBuiltinWebSearchAvailable(
        m,
        {
          ...p,
          serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope: 'model-dependent', endpointTypes: [chat] }]
        },
        responses
      )
    ).toBe(false)
    const unrelated = { ...allChat, id: 'custom', presetProviderId: undefined }
    expect(isBuiltinWebSearchAvailable(m, unrelated, chat)).toBe(true)
  })

  it.each(['GLM-5.2', 'other/glm-5.2', 'other/kimi-k3', 'glm-5.2-2026-10-01', 'glm-5-2'])(
    'rejects undocumented wire spelling %s on both endpoints',
    (wireId) => {
      const m = model(wireId, { apiModelId: undefined })
      expect(isBuiltinWebSearchAvailable(m, host(), chat)).toBe(false)
      expect(isBuiltinWebSearchAvailable(m, host(), responses)).toBe(false)
    }
  )

  it('uses apiModelId over a stale canonical stored id', () => {
    const m = model('glm-5.3', { id: 'dashscope::glm-5-2' })
    expect(isBuiltinWebSearchAvailable(m, host(), chat)).toBe(false)
    expect(isBuiltinWebSearchAvailable(m, host(), responses)).toBe(false)
  })

  it.each([
    'glm-4',
    'glm-4-1v',
    'glm-4-5',
    'glm-4-5-air',
    'glm-4-5-flash',
    'glm-4-5v',
    'glm-4-6',
    'glm-4-6v',
    'glm-4-7',
    'glm-4-7-flash',
    'glm-4-7-flashx',
    'glm-4-7-maas',
    'glm-4-air',
    'glm-4-airx',
    'glm-4-flash',
    'glm-4-flashx',
    'glm-4-long',
    'glm-4-plus',
    'glm-5',
    'glm-5-1',
    'glm-5-2-fast',
    'glm-5-3',
    'glm-5-3-fast',
    'glm-5-3-flash',
    'glm-5-maas',
    'glm-5-turbo',
    'kimi-k2',
    'kimi-k2-5',
    'kimi-k2-6',
    'kimi-k2-7-code',
    'kimi-k2-7-code-highspeed',
    'kimi-k2-instruct',
    'kimi-k2-thinking-maas',
    'kimi-k3-1-pro',
    'kimi-k3-1-pro-highspeed',
    'kimi-k3-fast',
    'kimi-latest'
  ])('removes registry search eligibility for %s', (id) => {
    expect(isServerToolModelEligible(model(id), host(), SERVER_TOOL.WEB_SEARCH)).toBe(false)
  })

  it.each(['glm-4.7', 'glm-5.1', 'glm-5.2-fast', 'kimi-k2.7-code', 'kimi/kimi-k3-fast'])(
    'falls back for unlisted hosted wire id %s',
    (id) => {
      const m = model(id, { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
      for (const endpoint of [chat, responses]) {
        expect(isBuiltinWebSearchAvailable(m, host(), endpoint)).toBe(false)
        expect(route(m, host(), endpoint)).toMatchObject({ webSearch: 'client' })
        expect(route(m, host(), endpoint, { clientSearchAvailable: false })).toMatchObject({
          webSearch: 'none',
          reasons: { webSearch: 'no-backend' }
        })
      }
    }
  )
})
