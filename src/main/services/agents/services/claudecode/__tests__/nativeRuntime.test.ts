import { setImmediate as waitForImmediate } from 'node:timers/promises'

import { describe, expect, it, vi } from 'vitest'

const resolverError = new Error('Claude executable is unavailable for test platform')

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/tmp/app'),
    getPath: vi.fn(() => '/tmp/user-data'),
    getVersion: vi.fn(() => 'test')
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    }))
  }
}))

vi.mock('@main/apiServer/config', () => ({ config: { get: vi.fn() } }))
vi.mock('@main/apiServer/utils', () => ({ validateModelId: vi.fn() }))
vi.mock('@main/mcpServers/assistant', () => ({ default: class AssistantServer {} }))
vi.mock('@main/mcpServers/claw', () => ({ default: class ClawServer {} }))
vi.mock('@main/mcpServers/skills', () => ({ default: class SkillsServer {} }))
vi.mock('@main/mcpServers/workspaceMemory', () => ({ default: class WorkspaceMemoryServer {} }))
vi.mock('@main/services/ConfigManager', () => ({ configManager: {} }))
vi.mock('@main/services/agents/skills/SkillService', () => ({ skillService: {} }))
vi.mock('@main/services/agents/services/AgentService', () => ({ agentService: {} }))
vi.mock('@main/services/agents/services/ChannelService', () => ({ channelService: {} }))
vi.mock('@main/services/agents/services/SessionService', () => ({ sessionService: {} }))
vi.mock('@main/services/agents/services/cherryclaw/prompt', () => ({
  PromptBuilder: class PromptBuilder {}
}))
vi.mock('@main/services/agents/services/builtin/BuiltinAgentProvisioner', () => ({
  isProvisioned: vi.fn(),
  provisionBuiltinAgent: vi.fn()
}))
vi.mock('../tool-permissions', () => ({ promptForToolApproval: vi.fn() }))

vi.mock('@main/utils/bundledBinaries', () => ({
  resolveClaudeExecutablePath: vi.fn(() => {
    throw resolverError
  })
}))

describe('ClaudeCodeService native runtime', () => {
  it('resolves invoke before emitting one resolver failure to a newly registered listener', async () => {
    const { default: ClaudeCodeService } = await import('../index')
    const service = new ClaudeCodeService()

    const invokePromise = service.invoke(
      'hello',
      {
        accessible_paths: ['/tmp/claude-native-runtime-test']
      } as never,
      new AbortController()
    )
    await expect(invokePromise).resolves.toBeDefined()
    const stream = await invokePromise

    const listener = vi.fn()
    stream.on('data', listener)

    await waitForImmediate()
    await waitForImmediate()

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({
      type: 'error',
      error: resolverError
    })
  })
})
