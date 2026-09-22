import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput } from '../../types'

const mocks = vi.hoisted(() => ({
  harnessOptions: undefined as Record<string, any> | undefined,
  getShellEnv: vi.fn(),
  resolveBun: vi.fn(),
  usesDshGateway: vi.fn(),
  getGatewayConfig: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const get = result.application.getContainer().get.bind(result.application.getContainer())
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ApiGatewayService') return { getCurrentConfig: mocks.getGatewayConfig }
    return get(name)
  })
  return result
})

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../dshConnectionSignature', () => ({
  DshInvalidConnectionSnapshotError: class extends Error {},
  captureDshConnectionSnapshot: vi.fn(() =>
    Promise.resolve({
      signature: 'sig-1',
      agent: { id: 'agent-1', configuration: {}, disabledTools: [] },
      session: { agentId: 'agent-1', workspace: { path: '/workspace' } },
      provider: {},
      model: {},
      enabledApiKeys: [],
      additionalSkillPaths: [],
      mcpServerSnapshots: [],
      linkedChannel: null
    })
  )
}))
vi.mock('../modelInjection', () => ({
  resolveDshProviderInjectionFromSnapshot: vi.fn(() => ({
    providerName: 'deepseek',
    api: 'openai-completions',
    baseUrl: 'http://127.0.0.1:23333',
    modelId: 'deepseek-chat',
    apiKey: 'key',
    modelConfig: { id: 'deepseek-chat', contextWindow: 128_000, maxTokens: 8192 },
    usageCapture: { owner: 'provider-calls' }
  })),
  usesDshGateway: mocks.usesDshGateway
}))
vi.mock('../compositionBuilder', () => ({
  buildDshCompositionYaml: vi.fn(() => 'plugins: []'),
  resolveDshRuntimeBinPath: vi.fn(() => '/dsh/bin')
}))
vi.mock('../bunRuntime', () => ({ resolveDshBunRuntime: mocks.resolveBun }))
vi.mock('../DshBridgeServer', () => ({
  DshBridgeServer: vi.fn(function DshBridgeServerMock() {
    return {
      socketPath: '/tmp/dsh.sock',
      authenticationToken: 'bridge-token',
      listen: vi.fn().mockResolvedValue(undefined),
      whenReady: vi.fn().mockResolvedValue(undefined),
      request: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    }
  })
}))
vi.mock('../DshCherryToolBridge', () => ({
  buildDshCherryToolBridge: vi.fn().mockResolvedValue({
    tools: [],
    callTool: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined)
  }),
  buildDshCherryToolName: (server: string, tool: string) => `mcp__${server}__${tool}`,
  warmDshMcpToolCatalogs: vi.fn().mockResolvedValue(undefined),
  DSH_AUTO_APPROVED_BRIDGED_TOOLS: new Set<string>(),
  DSH_APPROVAL_REQUIRED_BRIDGED_TOOLS: new Set<string>(),
  DSH_NON_BYPASSABLE_APPROVAL_BRIDGED_TOOLS: new Set<string>()
}))
vi.mock('../dshSdk', () => ({
  loadDshSdk: vi.fn().mockResolvedValue({
    HarnessClient: vi.fn(function HarnessClientMock(options: Record<string, unknown>) {
      mocks.harnessOptions = options
      return {
        start: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(() => ({ async *[Symbol.asyncIterator]() {}, close: vi.fn() })),
        close: vi.fn().mockResolvedValue(undefined)
      }
    })
  })
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: mocks.getShellEnv,
  getPathFromEnvironment: (env: Record<string, string | undefined>) =>
    Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1]
}))
vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  ensureAgentDataDirectory: vi.fn().mockResolvedValue('/agent-data')
}))
vi.mock('@main/ai/runtime/agentPrompt', () => ({
  buildAgentRuntimePrompt: vi.fn().mockResolvedValue({ base: { kind: 'native' }, append: '' })
}))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({ buildAgentMcpServers: vi.fn(() => []) }))
vi.mock('@main/ai/runtime/citationsGuidance', () => ({ buildCitationsGuidance: vi.fn(() => '') }))
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: vi.fn((text: string) => text) }))

const { DshRuntimeConnection } = await import('../DshRuntimeConnection')

const connectInput = {
  sessionId: 'session-1',
  agentId: 'agent-1',
  modelId: 'deepseek::deepseek-chat'
} as unknown as AgentRuntimeConnectInput

const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'SOCKS_PROXY',
  'socks_proxy',
  'grpc_proxy',
  'NO_PROXY',
  'no_proxy',
  'CHERRY_STUDIO_NODE_PROXY_RULES',
  'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES'
]

const clearProxyEnv = () => {
  for (const key of PROXY_ENV_KEYS) vi.stubEnv(key, '')
}

beforeEach(() => {
  mocks.harnessOptions = undefined
  mocks.resolveBun.mockReset().mockResolvedValue('/bundled/bun')
  mocks.usesDshGateway.mockReset().mockReturnValue(true)
  mocks.getGatewayConfig.mockReset().mockReturnValue({ enabled: true, host: '127.0.0.1', port: 23333 })
  mocks.getShellEnv.mockReset().mockResolvedValue({
    PATH: ['/opt/homebrew/bin', '/usr/bin'].join(':'),
    HOME: '/Users/tester'
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('DshRuntimeConnection proxy inheritance', () => {
  it('forwards the applied proxy into the dsh child and keeps loopback direct', async () => {
    // Corporate proxy-only network with a local dsh gateway (#20933): the child
    // must inherit the configured proxy while the 127.0.0.1 gateway stays direct.
    clearProxyEnv()
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:8080')
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.corp.example:8080')
    vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_RULES', 'http://proxy.corp.example:8080')
    vi.stubEnv('CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES', 'localhost,127.0.0.1,::1')

    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv

    expect(env.HTTP_PROXY).toBe('http://proxy.corp.example:8080')
    expect(env.HTTPS_PROXY).toBe('http://proxy.corp.example:8080')
    expect(env.CHERRY_STUDIO_NODE_PROXY_RULES).toBe('http://proxy.corp.example:8080')
    for (const rule of ['localhost', '127.0.0.1', '::1']) {
      expect(String(env.NO_PROXY).split(',')).toContain(rule)
    }
    expect(env.CHERRY_DSH_API_KEY).toBe('key')
    await connection.close()
  })

  it('preserves a custom bypass list while adding loopback', async () => {
    clearProxyEnv()
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:8080')
    vi.stubEnv('NO_PROXY', 'corp-internal.example')

    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv
    const rules = String(env.NO_PROXY).split(',')

    expect(rules).toContain('corp-internal.example')
    expect(rules).toContain('127.0.0.1')
    await connection.close()
  })

  it('leaves the spawn env without proxy keys when no proxy is configured', async () => {
    // No proxy active: the replacement env must come back untouched, with no
    // bypass rules injected for a proxy that does not exist.
    clearProxyEnv()

    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv

    for (const key of PROXY_ENV_KEYS) {
      expect(env).not.toHaveProperty(key)
    }
    expect(env.CHERRY_DSH_API_KEY).toBe('key')
    await connection.close()
  })

  it('bypasses a non-default gateway host while keeping provider traffic proxied', async () => {
    // F1: a gateway bound to 127.0.0.2 must stay direct even though it is not
    // in the default loopback set; the external provider must remain proxied.
    clearProxyEnv()
    mocks.getGatewayConfig.mockReturnValue({ enabled: true, host: '127.0.0.2', port: 23333 })
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:8080')
    vi.stubEnv('HTTPS_PROXY', 'http://proxy.corp.example:8080')

    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv
    const rules = String(env.NO_PROXY).split(',')

    expect(env.HTTP_PROXY).toBe('http://proxy.corp.example:8080')
    expect(rules).toContain('127.0.0.2')
    expect(rules).toContain('127.0.0.1')
    await connection.close()
  })

  it('never bypasses an external provider host on direct routes', async () => {
    clearProxyEnv()
    mocks.usesDshGateway.mockReturnValue(false)
    vi.stubEnv('HTTP_PROXY', 'http://proxy.corp.example:8080')

    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv

    expect(env.HTTP_PROXY).toBe('http://proxy.corp.example:8080')
    expect(String(env.NO_PROXY ?? '')).not.toContain('deepseek')
    await connection.close()
  })
})
