import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  ready: true,
  getToolInventory: vi.fn(),
  checkClaudeLogin: vi.fn(),
  listAgents: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    BinaryManager: {
      get isReady() {
        return services.ready
      },
      getToolInventory: services.getToolInventory
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

const { claudeLogin, managedTools } = await import('../runtime')
const signal = new AbortController().signal
const ctx = { signal, share: <T>(_key: string, factory: (signal: AbortSignal) => Promise<T>) => factory(signal) }

beforeEach(() => {
  vi.clearAllMocks()
  services.ready = true
  services.getToolInventory.mockResolvedValue([])
  services.checkClaudeLogin.mockResolvedValue(true)
  services.listAgents.mockReturnValue({ agents: [], total: 0 })
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
})

describe('runtime-claude-login', () => {
  it('does not claim the login state of an uninitialized service', async () => {
    services.ready = false
    services.listAgents.mockReturnValue({ agents: [{ type: 'claude-code' }] })
    await expect(claudeLogin.run(ctx)).rejects.toThrow('not ready')
  })

  it('propagates login query failures', async () => {
    services.listAgents.mockReturnValue({ agents: [{ type: 'claude-code' }] })
    services.checkClaudeLogin.mockRejectedValue(new Error('keychain locked'))
    await expect(claudeLogin.run(ctx)).rejects.toThrow('keychain locked')
  })
  it('does not require a CLI login when no Claude Code agent exists', async () => {
    await expect(claudeLogin.run(ctx)).resolves.toEqual({ status: 'pass' })
    expect(services.checkClaudeLogin).not.toHaveBeenCalled()
  })

  it('passes when a Claude Code agent has a usable CLI login', async () => {
    services.listAgents.mockReturnValue({ agents: [{ id: 'agent-1', type: 'claude-code' }], total: 1 })
    await expect(claudeLogin.run(ctx)).resolves.toEqual({ status: 'pass' })
  })

  it('warns and links to login when a Claude Code agent has no CLI login', async () => {
    services.listAgents.mockReturnValue({ agents: [{ id: 'agent-1', type: 'claude-code' }], total: 1 })
    services.checkClaudeLogin.mockResolvedValue(false)

    await expect(claudeLogin.run(ctx)).resolves.toMatchObject({
      status: 'warn',
      attribution: 'user-fixable',
      detail: { variant: 'not_logged_in' },
      actions: [{ kind: 'navigate', target: '/settings/provider?id=claude-code' }]
    })
  })
})
