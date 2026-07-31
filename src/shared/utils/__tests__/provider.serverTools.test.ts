import { type Model, MODEL_CAPABILITY, SERVER_TOOL } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import {
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
    urlContextEnabled: true,
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
    expect(resolveWebToolRoutes(claude, { serverTools: [] }, { ...bothEnabled, clientToolsPreferred: false })).toEqual({
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
    ).toEqual({ webSearch: 'server', webFetch: 'none' })
    expect(
      resolveWebToolRoutes(claude, serverProvider, {
        ...bothEnabled,
        clientSearchAvailable: false,
        clientToolsPreferred: true
      })
    ).toEqual({ webSearch: 'none', webFetch: 'client' })
  })

  it('recognizes provider-native URL fetch for supported model families', () => {
    expect(isBuiltinWebFetchAvailable(claude, serverProvider)).toBe(true)
    expect(isBuiltinWebFetchAvailable(model('private-model'), serverProvider)).toBe(false)
  })

  it('returns none when neither side can serve an enabled capability', () => {
    expect(
      resolveWebToolRoutes(
        model('private-model'),
        { serverTools: [] },
        {
          ...bothEnabled,
          clientToolsPreferred: true
        }
      )
    ).toEqual({ webSearch: 'none', webFetch: 'none' })
  })
})
