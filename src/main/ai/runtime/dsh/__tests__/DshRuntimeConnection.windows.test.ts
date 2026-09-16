import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeConnectInput } from '../../types'

// Pin the Windows code path. This cannot live in DshRuntimeConnection.trace.test.ts:
// mocking the platform module there flips the PATH separator to `;` and breaks that
// file's own PATH assertions.
vi.mock('@main/core/platform', () => ({
  isWin: true,
  isMac: false,
  isLinux: false,
  isDev: false,
  isPortable: false,
  isDarwinX64: false,
  isWinArm64: false
}))

const mocks = vi.hoisted(() => ({
  harnessOptions: undefined as Record<string, any> | undefined,
  getShellEnv: vi.fn()
}))

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
      session: { agentId: 'agent-1', workspace: { path: 'C:\\workspace' } },
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
    baseUrl: 'https://api.deepseek.com',
    modelId: 'deepseek-chat',
    apiKey: 'key',
    modelConfig: { id: 'deepseek-chat', contextWindow: 128_000, maxTokens: 8192 },
    usageCapture: { owner: 'provider-calls' }
  })),
  usesDshGateway: vi.fn(() => false)
}))
vi.mock('../compositionBuilder', () => ({
  buildDshCompositionYaml: vi.fn(() => 'plugins: []'),
  resolveDshRuntimeBinPath: vi.fn(() => 'C:\\dsh\\bin')
}))
vi.mock('../DshBridgeServer', () => ({
  DshBridgeServer: vi.fn(function DshBridgeServerMock() {
    return {
      socketPath: '\\\\.\\pipe\\dsh',
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
  ensureAgentDataDirectory: vi.fn().mockResolvedValue('C:\\agent-data')
}))
vi.mock('@main/ai/runtime/agentPrompt', () => ({
  buildAgentRuntimePrompt: vi.fn().mockResolvedValue({ base: { kind: 'native' }, append: '' })
}))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({ buildAgentMcpServers: vi.fn(() => []) }))
vi.mock('@main/ai/runtime/citationsGuidance', () => ({ buildCitationsGuidance: vi.fn(() => '') }))
vi.mock('@main/ai/steerReminder', () => ({ wrapSteerReminder: vi.fn((text: string) => text) }))

const { DshRuntimeConnection } = await import('../DshRuntimeConnection')

// No `trace` field: the connection only records spans when the host supplies a
// trace context, and this test is about the spawn env.
const connectInput = {
  sessionId: 'session-1',
  agentId: 'agent-1',
  modelId: 'deepseek::deepseek-chat'
} as unknown as AgentRuntimeConnectInput

beforeEach(() => {
  mocks.harnessOptions = undefined
  mocks.getShellEnv.mockReset().mockResolvedValue({
    Path: 'C:\\Users\\tester\\bin;C:\\Windows\\system32',
    SystemRoot: 'C:\\Windows',
    SystemDrive: 'C:',
    ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    PATHEXT: '.COM;.EXE;.BAT',
    TEMP: 'C:\\Users\\tester\\Temp',
    USERPROFILE: 'C:\\Users\\tester',
    DEEPSEEK_API_KEY: 'do-not-forward'
  })
})

describe('DshRuntimeConnection on Windows', () => {
  it('spawns the runtime with the Windows system baseline', async () => {
    // Without it the child - process.execPath under ELECTRON_RUN_AS_NODE - cannot
    // resolve the system DLLs and exits with a Windows exception code seconds after
    // spawn, which is the crash in #19753.
    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv

    expect(env).toMatchObject({
      SystemRoot: 'C:\\Windows',
      SystemDrive: 'C:',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT',
      TEMP: 'C:\\Users\\tester\\Temp',
      USERPROFILE: 'C:\\Users\\tester'
    })
    await connection.close()
  })

  it('still keeps the rest of the host environment out of the child', async () => {
    // The baseline is a fixed list, not a passthrough: the scoping the surrounding
    // code calls deliberate has to survive it.
    const connection = await new DshRuntimeConnection(connectInput).start()
    const env = mocks.harnessOptions?.env as NodeJS.ProcessEnv

    expect(env).not.toHaveProperty('DEEPSEEK_API_KEY')
    expect(env.CHERRY_DSH_API_KEY).toBe('key')
    await connection.close()
  })
})
