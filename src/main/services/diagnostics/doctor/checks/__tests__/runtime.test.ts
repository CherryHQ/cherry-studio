import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { Provider } from '@shared/data/types/provider'

const services = vi.hoisted(() => ({
  ready: true,
  getToolInventory: vi.fn(),
  hasCustomDependencyDefinition: vi.fn(),
  checkClaudeLogin: vi.fn(),
  listAgents: vi.fn(),
  getProviderByProviderId: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    BinaryManager: {
      get isReady() {
        return services.ready
      },
      getToolInventory: services.getToolInventory,
      hasCustomDependencyDefinition: services.hasCustomDependencyDefinition
    },
    CodeCliService: {
      get isReady() {
        return services.ready
      },
      checkClaudeLogin: services.checkClaudeLogin
    }
  } as never)
})
vi.mock('@main/data/services/AgentService', () => ({
  agentService: { listAgents: services.listAgents }
}))
vi.mock('@main/data/services/ProviderService', () => ({
  providerService: { getByProviderId: services.getProviderByProviderId }
}))

const { claudeLogin, managedTools } = await import('../runtime')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

const agent = (model: AgentEntity['model'] = 'claude-code::sonnet'): AgentEntity => ({
  id: 'agent-1',
  type: 'claude-code',
  name: 'Agent',
  model,
  modelName: 'Claude',
  orderKey: 'a',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z'
})

const provider = (id: string, authMethods: Provider['authMethods']): Provider => ({
  id,
  name: id,
  authMethods,
  reportsActualCost: false,
  apiKeys: [],
  authType: 'api-key',
  settings: {},
  isEnabled: true
})

beforeEach(() => {
  vi.clearAllMocks()
  services.ready = true
  services.getToolInventory.mockResolvedValue([])
  services.hasCustomDependencyDefinition.mockReturnValue(false)
  services.checkClaudeLogin.mockResolvedValue(true)
  services.listAgents.mockReturnValue({ agents: [], total: 0 })
  services.getProviderByProviderId.mockReturnValue(provider('claude-code', ['external-cli']))
})

describe('runtime-managed-tools', () => {
  it('does not declare failed initialization healthy', async () => {
    services.ready = false
    await expect(managedTools.run(ctx)).rejects.toThrow('not ready')
  })
  it('rejects an inventory containing unknown entries', async () => {
    services.getToolInventory.mockResolvedValue([{ name: 'uv', status: 'unknown' }])
    await expect(managedTools.run(ctx)).rejects.toThrow('incomplete')
  })

  it('does not treat an uninstalled tool as broken', async () => {
    services.getToolInventory.mockResolvedValue([
      { name: 'bun', status: 'ready' },
      { name: 'fd', status: 'not_installed' }
    ])
    await expect(managedTools.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns for failed operations or broken managed installations', async () => {
    services.getToolInventory.mockResolvedValue([
      { name: 'bun', status: 'failed' },
      { name: 'fd', status: 'ready' },
      { name: 'uv', status: 'failed' }
    ])
    await expect(managedTools.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'failed', params: { count: 2 } },
      actions: [{ kind: 'navigate', target: '/settings/dependencies' }],
      evidence: [{ key: 'tools', value: 'bun, uv', dataClass: 'local_only' }]
    })
  })

  it('does not send users to Dependencies for an unmanaged runtime failure', async () => {
    services.getToolInventory.mockResolvedValue([{ name: 'python', status: 'failed', recipe: 'python' }])

    await expect(managedTools.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'app-bug',
      detail: { variant: 'failed', params: { count: 1 } },
      actions: [],
      evidence: [{ key: 'tools', value: 'python', dataClass: 'local_only' }]
    })
  })

  it('keeps a failed Code CLI actionable on its own management page', async () => {
    services.getToolInventory.mockResolvedValue([{ name: 'codex', status: 'failed', recipe: 'npm:@openai/codex' }])

    await expect(managedTools.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      actions: [{ kind: 'navigate', target: '/app/code' }]
    })
  })

  it('offers Dependencies for a persisted custom tool', async () => {
    services.getToolInventory.mockResolvedValue([{ name: 'custom-tool', status: 'failed' }])
    services.hasCustomDependencyDefinition.mockReturnValue(true)

    await expect(managedTools.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      actions: [{ kind: 'navigate', target: '/settings/dependencies' }]
    })
  })

  it('does not keep probing after cancellation', async () => {
    const controller = new AbortController()
    services.getToolInventory.mockImplementation(async () => {
      controller.abort()
      return [{ name: 'python', status: 'failed' }]
    })

    await expect(managedTools.run({ ...ctx, signal: controller.signal })).rejects.toThrow()
  })
})

describe('runtime-claude-login', () => {
  it('does not claim the login state of an uninitialized service', async () => {
    services.ready = false
    services.listAgents.mockReturnValue({ agents: [agent()] })
    await expect(claudeLogin.run(ctx)).rejects.toThrow('not ready')
  })

  it('propagates login query failures', async () => {
    services.listAgents.mockReturnValue({ agents: [agent()] })
    services.checkClaudeLogin.mockRejectedValue(new Error('keychain locked'))
    await expect(claudeLogin.run(ctx)).rejects.toThrow('keychain locked')
  })
  it('does not require a CLI login when no Claude Code agent exists', async () => {
    await expect(claudeLogin.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(services.checkClaudeLogin).not.toHaveBeenCalled()
  })

  it('does not require a CLI login for a Claude Code agent using an API-key provider', async () => {
    services.listAgents.mockReturnValue({ agents: [agent('anthropic::claude-sonnet')] })
    services.getProviderByProviderId.mockReturnValue(provider('anthropic', ['api-key']))
    services.checkClaudeLogin.mockResolvedValue(false)

    await expect(claudeLogin.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(services.checkClaudeLogin).not.toHaveBeenCalled()
  })

  it('passes when a Claude Code agent has a usable CLI login', async () => {
    services.listAgents.mockReturnValue({ agents: [agent()], total: 1 })
    await expect(claudeLogin.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns and links to login when a Claude Code agent has no CLI login', async () => {
    services.listAgents.mockReturnValue({ agents: [agent()], total: 1 })
    services.checkClaudeLogin.mockResolvedValue(false)

    await expect(claudeLogin.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'not_logged_in' },
      actions: [{ kind: 'navigate', target: '/settings/provider?id=claude-code' }]
    })
  })
})
