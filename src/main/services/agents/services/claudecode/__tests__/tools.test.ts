import { beforeEach, describe, expect, it, vi } from 'vitest'

import { builtinTools, getExposedBuiltinTools, getRuntimeAllowedTools } from '../tools'

const serviceMocks = vi.hoisted(() => ({
  isWin: false,
  query: vi.fn(),
  promptForToolApproval: vi.fn(),
  updateSession: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/user-data'),
    getVersion: vi.fn(() => 'test')
  }
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: serviceMocks.query
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      silly: vi.fn(),
      warn: vi.fn()
    }))
  }
}))

vi.mock('@main/constant', () => ({
  get isWin() {
    return serviceMocks.isWin
  }
}))

vi.mock('@main/apiServer/config', () => ({
  config: { get: vi.fn(async () => ({ host: '127.0.0.1', port: 1234, apiKey: 'api-key' })) }
}))
vi.mock('@main/apiServer/utils', () => ({
  validateModelId: vi.fn(async () => ({
    valid: true,
    modelId: 'claude-test',
    provider: {
      id: 'anthropic',
      type: 'anthropic',
      apiKey: 'provider-key',
      apiHost: 'https://api.anthropic.com'
    }
  }))
}))
vi.mock('@main/mcpServers/assistant', () => ({ default: class AssistantServer {} }))
vi.mock('@main/mcpServers/claw', () => ({ default: class ClawServer {} }))
vi.mock('@main/mcpServers/skills', () => ({
  default: class SkillsServer {
    mcpServer = {}
  }
}))
vi.mock('@main/mcpServers/workspaceMemory', () => ({
  default: class WorkspaceMemoryServer {
    mcpServer = {}
  }
}))
vi.mock('@main/services/ConfigManager', () => ({
  configManager: {
    get: vi.fn(() => ''),
    getLanguage: vi.fn(() => 'en-US'),
    getTheme: vi.fn(() => 'light')
  }
}))
vi.mock('@main/services/agents/skills/SkillService', () => ({
  skillService: { reconcileAgentSkills: vi.fn(async () => undefined) }
}))
vi.mock('@main/services/agents/services/AgentService', () => ({
  agentService: { getAgent: vi.fn(async () => null) }
}))
vi.mock('@main/services/agents/services/ChannelService', () => ({
  channelService: {
    findBySessionId: vi.fn(async () => undefined),
    listChannels: vi.fn(async () => [])
  }
}))
vi.mock('@main/services/agents/services/SessionService', () => ({
  sessionService: {
    listSlashCommands: vi.fn(async () => []),
    updateSession: serviceMocks.updateSession
  }
}))
vi.mock('@main/services/agents/services/builtin/BuiltinAgentProvisioner', () => ({
  isProvisioned: vi.fn(() => true),
  provisionBuiltinAgent: vi.fn()
}))
vi.mock('@main/services/agents/services/cherryclaw/prompt', () => ({
  PromptBuilder: class PromptBuilder {
    buildFactsSection = vi.fn(async () => undefined)
    buildToolGuidance = vi.fn(() => '')
  }
}))
vi.mock('@main/services/proxy/nodeProxy', () => ({ getProxyEnvironment: vi.fn(() => ({})) }))
vi.mock('@main/utils/bundledBinaries', () => ({
  resolveClaudeExecutablePath: vi.fn(() => '/tmp/claude')
}))
vi.mock('@main/utils/process', () => ({
  autoDiscoverGitBash: vi.fn(() => null),
  getBinaryPath: vi.fn(async () => '/tmp/bun')
}))
vi.mock('@main/utils/shell-env', () => ({ default: vi.fn(async () => ({})) }))
vi.mock('../tool-permissions', () => ({
  promptForToolApproval: serviceMocks.promptForToolApproval
}))

describe('Claude Code builtin tools', () => {
  it('registers permission-controlled PowerShell metadata', () => {
    expect(builtinTools.find((tool) => tool.id === 'PowerShell')).toEqual({
      id: 'PowerShell',
      name: 'PowerShell',
      description: 'Executes PowerShell commands in your environment',
      requirePermissions: true,
      type: 'builtin'
    })
  })

  it.each([
    ['win32', true],
    ['darwin', false],
    ['linux', false]
  ] as const)('exposes PowerShell metadata on %s: %s', (platform, expected) => {
    const tools = getExposedBuiltinTools(platform)

    expect(tools.some((tool) => tool.id === 'PowerShell')).toBe(expected)
    expect(tools.some((tool) => tool.id === 'Bash')).toBe(true)
  })
})

describe('getRuntimeAllowedTools', () => {
  it.each([
    ['win32', ['PowerShell', 'Bash']],
    ['darwin', ['Bash']],
    ['linux', ['Bash']]
  ] as const)('builds the runtime authorization copy for %s', (platform, expected) => {
    const persisted = ['PowerShell', 'Bash']

    expect(getRuntimeAllowedTools(persisted, platform)).toEqual(expected)
    expect(persisted).toEqual(['PowerShell', 'Bash'])
  })

  it('preserves undefined and empty runtime lists', () => {
    expect(getRuntimeAllowedTools(undefined, 'linux')).toBeUndefined()
    expect(getRuntimeAllowedTools([], 'linux')).toEqual([])
  })
})

describe('ClaudeCodeService runtime authorization wiring', () => {
  beforeEach(() => {
    serviceMocks.query.mockReset()
    serviceMocks.promptForToolApproval.mockReset()
    serviceMocks.updateSession.mockReset()
    serviceMocks.promptForToolApproval.mockResolvedValue({ behavior: 'deny', message: 'approval required' })
    serviceMocks.query.mockImplementation(({ options }) => {
      return (async function* () {
        void options
        yield* []
      })()
    })
  })

  it.each([
    ['non-Windows', false, false],
    ['Windows', true, true]
  ])('handles PowerShell consistently in both runtime authorization channels on %s', async (_, windows, expected) => {
    serviceMocks.isWin = windows
    const { default: ClaudeCodeService } = await import('../index')
    const service = new ClaudeCodeService()
    const session = {
      id: `session-${windows}`,
      agent_id: 'agent-test',
      agent_type: 'claude-code',
      accessible_paths: ['/tmp/claude-tools-test'],
      allowed_tools: ['PowerShell', 'Bash'],
      configuration: {},
      instructions: '',
      mcps: [],
      model: 'anthropic:claude-test'
    }

    await service.invoke('hello', session as never, new AbortController())
    await vi.waitFor(() => expect(serviceMocks.query).toHaveBeenCalledTimes(1))

    const options = serviceMocks.query.mock.calls[0][0].options
    expect(options.allowedTools).toContain('Bash')
    expect(options.allowedTools.includes('PowerShell')).toBe(expected)

    const permission = await options.canUseTool(
      'PowerShell',
      { command: 'Get-Date' },
      {
        signal: new AbortController().signal,
        suggestions: [],
        toolUseID: 'tool-powershell'
      }
    )
    expect(permission.behavior === 'allow').toBe(expected)
    expect(serviceMocks.promptForToolApproval).toHaveBeenCalledTimes(expected ? 0 : 1)

    expect(session.allowed_tools).toEqual(['PowerShell', 'Bash'])
    expect(serviceMocks.updateSession).not.toHaveBeenCalled()
  })
})
