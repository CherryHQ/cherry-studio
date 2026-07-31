import { ENDPOINT_TYPE, type Model, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
  finalizeWebToolRoutes,
  isBuiltinWebFetchAvailable,
  isBuiltinWebSearchAvailable,
  isServerToolModelEligible,
  resolveWebToolRoutes
} from '@shared/utils/provider'
import { describe, expect, it } from 'vitest'

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

const provider = (modelScope: 'all-chat-models' | 'model-dependent'): Provider =>
  ({ serverTools: [{ id: SERVER_TOOL.WEB_SEARCH, modelScope }] }) as Provider

describe('server-tool model eligibility', () => {
  it('uses generated registry eligibility without a generic model capability', () => {
    const claude = model('claude-sonnet-4-6')

    expect(claude.capabilities).not.toContain('web-search')
    expect(isServerToolModelEligible(claude, SERVER_TOOL.WEB_SEARCH)).toBe(true)
    expect(isBuiltinWebSearchAvailable(claude, provider('model-dependent'))).toBe(true)
  })

  it('keeps unknown custom models ineligible for model-dependent tools', () => {
    const custom = model('private-model')

    expect(isBuiltinWebSearchAvailable(custom, provider('model-dependent'))).toBe(false)
    expect(isBuiltinWebSearchAvailable(custom, { serverTools: [] } as unknown as Provider)).toBe(false)
  })

  it('rejects non-chat models even when their ids are otherwise eligible', () => {
    const embedding = model('claude-sonnet-4-6', {
      capabilities: [MODEL_CAPABILITY.EMBEDDING]
    })

    expect(isServerToolModelEligible(embedding, SERVER_TOOL.WEB_SEARCH)).toBe(false)
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
    expect(resolveWebToolRoutes(claude, serverProvider, { ...bothEnabled, clientToolsPreferred: true })).toEqual({
      webSearch: 'client',
      webFetch: 'client'
    })
    expect(resolveWebToolRoutes(claude, serverProvider, { ...bothEnabled, clientToolsPreferred: false })).toEqual({
      webSearch: 'server',
      webFetch: 'server'
    })
  })

  it('falls back only when the preferred side has no enabled capability', () => {
    expect(
      resolveWebToolRoutes(claude, { serverTools: [] } as unknown as Provider, {
        ...bothEnabled,
        clientToolsPreferred: false
      })
    ).toEqual({
      webSearch: 'client',
      webFetch: 'client'
    })
  })

  it('never mixes client and server tools when the selected side lacks one capability', () => {
    expect(
      resolveWebToolRoutes(claude, provider('all-chat-models'), {
        ...bothEnabled,
        clientToolsPreferred: false
      })
    ).toEqual({ webSearch: 'server', webFetch: 'none', reasons: { webFetch: 'no-backend' } })
    expect(
      resolveWebToolRoutes(claude, serverProvider, {
        ...bothEnabled,
        clientSearchAvailable: false,
        clientToolsPreferred: true
      })
    ).toEqual({ webSearch: 'none', webFetch: 'client', reasons: { webSearch: 'no-backend' } })
  })

  it('recognizes provider-native URL fetch for supported model families', () => {
    expect(isBuiltinWebFetchAvailable(claude, serverProvider)).toBe(true)
    expect(isBuiltinWebFetchAvailable(model('private-model'), serverProvider)).toBe(false)
  })

  it('honors the declaration vendors narrowing (Vertex url-context is Gemini-only)', () => {
    const vertexLike = {
      serverTools: [{ id: SERVER_TOOL.URL_CONTEXT, modelScope: 'model-dependent', vendors: ['gemini'] }]
    } as Provider
    expect(isBuiltinWebFetchAvailable(model('gemini-2.5-pro'), vertexLike)).toBe(true)
    expect(isBuiltinWebFetchAvailable(claude, vertexLike)).toBe(false)
  })

  it('reports model-unsupported when only client backends exist for a non-function-calling model', () => {
    expect(
      resolveWebToolRoutes(model('private-model'), { serverTools: [] } as unknown as Provider, {
        ...bothEnabled,
        clientToolsPreferred: true
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
        clientToolsPreferred: false,
        hasFunctionToolSignals: true
      })
    ).toEqual({ webSearch: 'client', webFetch: 'client' })
  })

  it('reports the conflict when no client fallback exists', () => {
    expect(
      resolveWebToolRoutes(gemini25, geminiProvider, {
        webSearchEnabled: true,
        clientSearchAvailable: false,
        clientFetchAvailable: false,
        clientToolsPreferred: false,
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
        clientToolsPreferred: false,
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
        clientToolsPreferred: false,
        reasoningEffort: 'high'
      })
    ).toMatchObject({ webSearch: 'server' })
  })
})

describe('finalizeWebToolRoutes', () => {
  const gemini25 = model('gemini-2.5-pro', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
  const gemini3 = model('gemini-3-pro-preview', { capabilities: [MODEL_CAPABILITY.FUNCTION_CALL] })
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
