import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput, AgentRuntimeTraceContext } from '../../types'

const runtimeMocks = vi.hoisted(() => ({
  snapshot: undefined as any,
  bridgeRequest: vi.fn(),
  getShellEnv: vi.fn()
}))

const baseSnapshot = () => ({
  signature: 'sig-1',
  agent: { id: 'agent-1', configuration: {}, disabledTools: [] },
  session: { agentId: 'agent-1', workspace: { path: '/new-workspace' } },
  provider: {},
  model: {},
  enabledApiKeys: [],
  additionalSkillPaths: [],
  mcpServerSnapshots: [],
  linkedChannel: null
})

const baseInjection = () => ({
  providerName: 'deepseek',
  api: 'openai-completions',
  baseUrl: 'https://api.deepseek.com',
  modelId: 'deepseek-chat',
  apiKey: 'key',
  modelConfig: { id: 'deepseek-chat', contextWindow: 128_000, maxTokens: 8192 },
  usageCapture: { owner: 'provider-calls' }
})

/** Push-driven stand-in for the SDK's notification subscription. */
class FakeSubscription {
  private readonly pending: unknown[] = []
  private wake?: () => void
  private closed = false

  close(): void {
    this.closed = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (!this.closed) {
      while (this.pending.length > 0) yield this.pending.shift()
      if (this.closed) return
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
  }
}

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('../dshConnectionSignature', () => ({
  DshInvalidConnectionSnapshotError: class extends Error {},
  captureDshConnectionSnapshot: vi.fn(() => Promise.resolve(runtimeMocks.snapshot))
}))
vi.mock('../modelInjection', () => ({
  resolveDshProviderInjectionFromSnapshot: vi.fn(() => baseInjection()),
  usesDshGateway: vi.fn().mockReturnValue(false)
}))
vi.mock('../compositionBuilder', () => ({
  buildDshCompositionYaml: vi.fn(() => 'plugins: []'),
  resolveDshRuntimeBinPath: vi.fn(() => '/dsh/bin')
}))
vi.mock('../DshBridgeServer', () => ({
  DshBridgeServer: vi.fn(function DshBridgeServerMock() {
    return {
      socketPath: '/tmp/dsh.sock',
      authenticationToken: 'bridge-token',
      listen: vi.fn().mockResolvedValue(undefined),
      whenReady: vi.fn().mockResolvedValue(undefined),
      request: runtimeMocks.bridgeRequest,
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
    HarnessClient: vi.fn(function HarnessClientMock() {
      return {
        start: vi.fn(),
        initialize: vi.fn().mockResolvedValue(undefined),
        subscribe: vi.fn(() => new FakeSubscription()),
        close: vi.fn().mockResolvedValue(undefined)
      }
    })
  })
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: runtimeMocks.getShellEnv,
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

const traceContext: AgentRuntimeTraceContext = {
  topicId: 'topic-1',
  traceId: 'a'.repeat(32),
  rootSpanId: 'b'.repeat(16),
  sessionId: 'session-1',
  turnId: 'turn-1'
}

const connectInput = {
  sessionId: 'session-1',
  agentId: 'agent-1',
  modelId: 'deepseek::deepseek-chat',
  resumeToken: 'session-1',
  trace: traceContext
} as unknown as AgentRuntimeConnectInput

beforeEach(() => {
  runtimeMocks.snapshot = baseSnapshot()
  runtimeMocks.getShellEnv.mockReset().mockResolvedValue({
    PATH: ['/usr/bin'].join(path.delimiter),
    HOME: '/Users/tester'
  })
  runtimeMocks.bridgeRequest.mockReset().mockImplementation((method: string) => {
    if (method === 'session/open') return Promise.resolve({ status: 'opened' })
    return Promise.resolve({})
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('DshRuntimeConnection session/open cwd recovery', () => {
  it('fails the turn with an explicit recovery error on a cwd-mismatch outcome', async () => {
    runtimeMocks.bridgeRequest.mockImplementation((method: string, params: Record<string, unknown>) => {
      if (method === 'session/open') {
        expect(params).toMatchObject({ sessionId: 'session-1', cwd: '/new-workspace', resume: true })
        return Promise.resolve({
          status: 'cwd-mismatch',
          persistedCwd: '/old-workspace',
          requestedCwd: '/new-workspace'
        })
      }
      return Promise.resolve({})
    })

    await expect(new DshRuntimeConnection(connectInput).start()).rejects.toThrow(
      'dsh session "session-1" was persisted in another workspace (persisted cwd "/old-workspace" does not match requested cwd "/new-workspace"). Start a new session for the new workspace, or switch back to the original workspace to resume it — the persisted history was left untouched.'
    )
  })

  it('maps a legacy untyped mismatch throw to the same recovery error', async () => {
    runtimeMocks.bridgeRequest.mockImplementation((method: string) => {
      if (method === 'session/open') {
        return Promise.reject(new Error('persisted dsh session cwd "/old-workspace" does not match "/new-workspace"'))
      }
      return Promise.resolve({})
    })

    await expect(new DshRuntimeConnection(connectInput).start()).rejects.toThrow(
      'dsh session "session-1" was persisted in another workspace (persisted cwd "/old-workspace" does not match requested cwd "/new-workspace")'
    )
  })

  it('passes through unrelated session/open failures unchanged', async () => {
    runtimeMocks.bridgeRequest.mockImplementation((method: string) => {
      if (method === 'session/open') return Promise.reject(new Error('dsh bridge exploded'))
      return Promise.resolve({})
    })

    await expect(new DshRuntimeConnection(connectInput).start()).rejects.toThrow('dsh bridge exploded')
  })

  it('passes through mismatch-like messages whose paths do not parse', async () => {
    const message = 'persisted dsh session cwd /old-workspace does not match /new-workspace'
    runtimeMocks.bridgeRequest.mockImplementation((method: string) => {
      if (method === 'session/open') return Promise.reject(new Error(message))
      return Promise.resolve({})
    })

    await expect(new DshRuntimeConnection(connectInput).start()).rejects.toThrow(message)
  })

  it('starts normally when the session opens under the requested cwd', async () => {
    const connection = await new DshRuntimeConnection(connectInput).start()
    expect(connection).toBeDefined()
    await connection.close()
  })
})
