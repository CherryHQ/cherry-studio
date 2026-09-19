import { describe, expect, it } from 'vitest'

import type { McpRuntimeStatus } from '@shared/data/cache/cacheValueTypes'
import type { ModelHealthMemory } from '@shared/data/preference/preferenceTypes'
import { CHERRYAI_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { MODEL_HEALTH_STALE_AFTER_MS } from '@shared/utils/modelHealth'

import { summarizeHealth } from '../healthSummary'

function makeProvider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    id,
    name: id,
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {},
    isEnabled: true,
    ...overrides
  }
}

function makeModel(id: string, providerId: string, overrides: Partial<Model> = {}): Model {
  return {
    id: `${providerId}::${id}`,
    providerId,
    name: id,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false,
    ...overrides
  }
}

function makeMcpServer(id: string, overrides: Partial<McpServer> = {}): McpServer {
  return { id, name: id, isActive: true, ...overrides }
}

const noHealth: ModelHealthMemory = {}
const noMcpServers: McpServer[] = []
const noMcpStatuses: Record<string, McpRuntimeStatus | undefined> = {}

function summarize(input: {
  providers?: Provider[]
  models?: Model[]
  modelHealth?: ModelHealthMemory
  mcpServers?: McpServer[]
  mcpStatuses?: Record<string, McpRuntimeStatus | undefined>
}) {
  return summarizeHealth({
    providers: input.providers ?? [],
    models: input.models ?? [],
    modelHealth: input.modelHealth ?? noHealth,
    mcpServers: input.mcpServers ?? noMcpServers,
    mcpStatuses: input.mcpStatuses ?? noMcpStatuses
  })
}

describe('summarizeHealth providers', () => {
  it('counts an enabled provider with an enabled key as connected', () => {
    const provider = makeProvider('openai', { apiKeys: [{ id: 'k1', isEnabled: true }] })
    expect(summarize({ providers: [provider] }).providers).toEqual({ enabledCount: 1, connectedCount: 1 })
  })

  it('counts a credential-free local provider as connected with zero keys', () => {
    const provider = makeProvider('lmstudio', { authOptional: true })
    expect(summarize({ providers: [provider] }).providers).toEqual({ enabledCount: 1, connectedCount: 1 })
  })

  it('does not count a provider whose only key is disabled as connected', () => {
    const provider = makeProvider('openai', { apiKeys: [{ id: 'k1', isEnabled: false }] })
    expect(summarize({ providers: [provider] }).providers).toEqual({ enabledCount: 1, connectedCount: 0 })
  })

  it('excludes a disabled provider from both the enabled and connected counts', () => {
    const provider = makeProvider('openai', { isEnabled: false, apiKeys: [{ id: 'k1', isEnabled: true }] })
    expect(summarize({ providers: [provider] }).providers).toEqual({ enabledCount: 0, connectedCount: 0 })
  })

  it('excludes the managed CherryAI provider, which this fork can never route to regardless of credentials', () => {
    const provider = makeProvider(CHERRYAI_PROVIDER_ID, { apiKeys: [{ id: 'k1', isEnabled: true }] })
    expect(summarize({ providers: [provider] }).providers).toEqual({ enabledCount: 0, connectedCount: 0 })
  })
})

describe('summarizeHealth keys', () => {
  it('counts only enabled keys under enabled providers', () => {
    const providers = [
      makeProvider('openai', {
        apiKeys: [
          { id: 'k1', isEnabled: true },
          { id: 'k2', isEnabled: false }
        ]
      }),
      makeProvider('groq', { isEnabled: false, apiKeys: [{ id: 'k3', isEnabled: true }] })
    ]
    expect(summarize({ providers }).keys).toEqual({ enabledCount: 1 })
  })
})

describe('summarizeHealth models', () => {
  const provider = makeProvider('openai', { apiKeys: [{ id: 'k1', isEnabled: true }] })

  it('counts a model with a successful health record as healthy, not unchecked', () => {
    const model = makeModel('gpt', 'openai')
    const health: ModelHealthMemory = { [model.id]: { ok: true, checkedAt: Date.now() } }
    expect(summarize({ providers: [provider], models: [model], modelHealth: health }).models).toEqual({
      healthyCount: 1,
      unhealthyCount: 0,
      uncheckedCount: 0
    })
  })

  it('counts a model with a failed health record as unhealthy, not healthy', () => {
    const model = makeModel('gpt', 'openai')
    const health: ModelHealthMemory = { [model.id]: { ok: false, checkedAt: Date.now() } }
    expect(summarize({ providers: [provider], models: [model], modelHealth: health }).models).toEqual({
      healthyCount: 0,
      unhealthyCount: 1,
      uncheckedCount: 0
    })
  })

  it('counts a failed health record older than the staleness window as unchecked, not unhealthy', () => {
    const model = makeModel('gpt', 'openai')
    const health: ModelHealthMemory = {
      [model.id]: { ok: false, checkedAt: Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1 }
    }
    expect(summarize({ providers: [provider], models: [model], modelHealth: health }).models).toEqual({
      healthyCount: 0,
      unhealthyCount: 0,
      uncheckedCount: 1
    })
  })

  it('counts a successful health record older than the staleness window as unchecked too', () => {
    // An old ok: true is not evidence the model still answers, so it must not read as healthy either.
    const model = makeModel('gpt', 'openai')
    const health: ModelHealthMemory = {
      [model.id]: { ok: true, checkedAt: Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1 }
    }
    expect(summarize({ providers: [provider], models: [model], modelHealth: health }).models).toEqual({
      healthyCount: 0,
      unhealthyCount: 0,
      uncheckedCount: 1
    })
  })

  it('counts a model with no health record as unchecked, defaulting neither healthy nor unhealthy', () => {
    const model = makeModel('gpt', 'openai')
    expect(summarize({ providers: [provider], models: [model] }).models).toEqual({
      healthyCount: 0,
      unhealthyCount: 0,
      uncheckedCount: 1
    })
  })

  it('excludes a model whose provider is disabled', () => {
    const disabled = makeProvider('groq', { isEnabled: false })
    const model = makeModel('llama', 'groq')
    const health: ModelHealthMemory = { [model.id]: { ok: true, checkedAt: 1 } }
    expect(summarize({ providers: [disabled], models: [model], modelHealth: health }).models).toEqual({
      healthyCount: 0,
      unhealthyCount: 0,
      uncheckedCount: 0
    })
  })
})

describe('summarizeHealth localRuntimes', () => {
  it('marks a local provider unknown when none of its models have ever been probed', () => {
    const provider = makeProvider('lmstudio', { authOptional: true, name: 'LM Studio' })
    const model = makeModel('llama-3', 'lmstudio')
    expect(summarize({ providers: [provider], models: [model] }).localRuntimes).toEqual([
      { providerId: 'lmstudio', name: 'LM Studio', state: 'unknown' }
    ])
  })

  it('reports the freshest probe result, not an older one, when a local provider has several models', () => {
    const provider = makeProvider('lmstudio', { authOptional: true, name: 'LM Studio' })
    const older = makeModel('a', 'lmstudio')
    const newer = makeModel('b', 'lmstudio')
    const now = Date.now()
    const health: ModelHealthMemory = {
      [older.id]: { ok: true, checkedAt: now - 2000 },
      [newer.id]: { ok: false, checkedAt: now - 1000 }
    }
    expect(summarize({ providers: [provider], models: [older, newer], modelHealth: health }).localRuntimes).toEqual([
      { providerId: 'lmstudio', name: 'LM Studio', state: 'down', checkedAt: now - 1000 }
    ])
  })

  it('falls back to unknown once the freshest probe result has itself gone stale', () => {
    const provider = makeProvider('lmstudio', { authOptional: true, name: 'LM Studio' })
    const model = makeModel('a', 'lmstudio')
    const health: ModelHealthMemory = {
      [model.id]: { ok: false, checkedAt: Date.now() - MODEL_HEALTH_STALE_AFTER_MS - 1 }
    }
    expect(summarize({ providers: [provider], models: [model], modelHealth: health }).localRuntimes).toEqual([
      { providerId: 'lmstudio', name: 'LM Studio', state: 'unknown' }
    ])
  })

  it('does not list a credentialed provider under localRuntimes even when it is connected', () => {
    const provider = makeProvider('openai', { apiKeys: [{ id: 'k1', isEnabled: true }] })
    expect(summarize({ providers: [provider] }).localRuntimes).toEqual([])
  })
})

describe('summarizeHealth mcp', () => {
  it('counts an installed-but-inactive server toward installed, not active', () => {
    const servers = [makeMcpServer('browser', { isActive: false })]
    expect(summarize({ mcpServers: servers }).mcp).toEqual({ installedCount: 1, activeCount: 0 })
  })

  it('counts an installed and active server toward both', () => {
    const servers = [makeMcpServer('browser', { isActive: true })]
    expect(summarize({ mcpServers: servers }).mcp).toEqual({ installedCount: 1, activeCount: 1 })
  })

  it('reports the most recent error across servers as lastError, not an older one', () => {
    const servers = [makeMcpServer('memory'), makeMcpServer('filesystem')]
    const statuses: Record<string, McpRuntimeStatus> = {
      memory: { state: 'error', lastCheckedAt: 1000, lastError: 'stale failure' },
      filesystem: { state: 'error', lastCheckedAt: 2000, lastError: 'connection refused' }
    }
    expect(summarize({ mcpServers: servers, mcpStatuses: statuses }).mcp.lastError).toEqual({
      serverName: 'filesystem',
      message: 'connection refused',
      at: 2000
    })
  })

  it('reports no lastError when no server is currently in the error state', () => {
    const servers = [makeMcpServer('memory')]
    const statuses: Record<string, McpRuntimeStatus> = { memory: { state: 'connected', lastCheckedAt: 1000 } }
    expect(summarize({ mcpServers: servers, mcpStatuses: statuses }).mcp.lastError).toBeUndefined()
  })
})
