import type * as NodeModule from 'node:module'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  reconcileAgentSkills: vi.fn(),
  modelGetByKey: vi.fn(),
  findBySessionId: vi.fn(),
  createToolPolicySnapshot: vi.fn(),
  applicationGet: vi.fn(),
  applicationGetPath: vi.fn(),
  getLoginShellEnvironment: vi.fn(),
  getBinaryPath: vi.fn(),
  getProxyEnvironment: vi.fn(),
  getPathStatus: vi.fn(),
  getAppLanguage: vi.fn(),
  resolveRequire: vi.fn()
}))

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeModule>()
  return {
    ...actual,
    createRequire: vi.fn(() => ({
      resolve: mocks.resolveRequire
    }))
  }
})

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '1.0.0-test') }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    findBySessionId: mocks.findBySessionId,
    listChannels: vi.fn(async () => [])
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    list: vi.fn(async () => ({ items: [] })),
    findByIdOrName: vi.fn()
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.modelGetByKey }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { list: vi.fn(async () => []) }
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: { reconcileAgentSkills: mocks.reconcileAgentSkills }
}))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  isProvisioned: vi.fn(() => true),
  provisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/ai/agents/cherryclaw/prompt', () => ({
  PromptBuilder: vi.fn(() => ({ buildSystemPrompt: vi.fn(async () => 'soul prompt') }))
}))

vi.mock('@main/ai/mcp/servers/assistant', () => ({
  default: vi.fn(() => ({ mcpServer: {} }))
}))

vi.mock('@main/ai/mcp/servers/claw', () => ({
  default: vi.fn(() => ({ mcpServer: {} }))
}))

vi.mock('@main/ai/runtime/claudeCode/createSdkMcpServerInstance', () => ({
  createSdkMcpServerInstance: vi.fn()
}))

vi.mock('@main/ai/tools/adapters/claudeCode/agentTools', () => ({
  createClaudeAgentToolPolicySnapshot: mocks.createToolPolicySnapshot
}))

vi.mock('@main/core/application', () => ({
  application: {
    get: mocks.applicationGet,
    getPath: mocks.applicationGetPath
  }
}))

vi.mock('@main/core/platform', () => ({
  isLinux: false,
  isWin: false
}))

vi.mock('@main/services/proxy/nodeProxy', () => ({
  getProxyEnvironment: mocks.getProxyEnvironment
}))

vi.mock('@main/utils', () => ({
  toAsarUnpackedPath: (input: string) => input
}))

vi.mock('@main/utils/file/pathStatus', () => ({
  getPathStatus: mocks.getPathStatus
}))

vi.mock('@main/utils/language', () => ({
  getAppLanguage: mocks.getAppLanguage,
  t: (key: string, params?: Record<string, unknown>) => {
    if (params?.path) return `${key}:${params.path}`
    return key
  }
}))

vi.mock('@main/utils/process', () => ({
  autoDiscoverGitBash: vi.fn(() => null),
  getBinaryPath: mocks.getBinaryPath
}))

vi.mock('@main/utils/rtk', () => ({
  rtkRewrite: vi.fn()
}))

vi.mock('@main/utils/shell-env', () => ({
  default: mocks.getLoginShellEnvironment
}))

vi.mock('../ToolApprovalRegistry', () => ({
  toolApprovalRegistry: {
    abort: vi.fn(),
    register: vi.fn()
  }
}))

const { buildClaudeCodeSessionSettings } = await import('../settingsBuilder')

describe('buildClaudeCodeSessionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveRequire.mockImplementation((specifier: string) => {
      if (specifier === '@anthropic-ai/claude-agent-sdk') return '/sdk/index.js'
      return `/native/${specifier}/claude`
    })
    mocks.getAgent.mockResolvedValue({
      id: 'agent-1',
      type: 'claude-code',
      instructions: 'Follow instructions.',
      model: 'anthropic::claude-sonnet',
      planModel: 'anthropic::claude-sonnet',
      smallModel: 'anthropic::claude-haiku',
      mcps: [],
      allowedTools: [],
      configuration: {}
    })
    mocks.modelGetByKey.mockResolvedValue({ apiModelId: 'claude-api' })
    mocks.findBySessionId.mockResolvedValue(null)
    mocks.createToolPolicySnapshot.mockResolvedValue({ resolve: vi.fn(), isDisabled: vi.fn(() => false) })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') {
        return { get: vi.fn(() => undefined) }
      }
      if (name === 'McpCatalogService') {
        return { listTools: vi.fn(async () => []) }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.applicationGetPath.mockImplementation((key: string) => `/app/${key}`)
    mocks.getLoginShellEnvironment.mockResolvedValue({})
    mocks.getBinaryPath.mockResolvedValue('/usr/local/bin/bun')
    mocks.getProxyEnvironment.mockReturnValue({})
    mocks.getPathStatus.mockResolvedValue({ ok: true, kind: 'directory' })
    mocks.getAppLanguage.mockReturnValue('en-US')
    mocks.reconcileAgentSkills.mockResolvedValue(undefined)
  })

  it('reconciles enabled skills into the session workspace before returning settings', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(mocks.reconcileAgentSkills).toHaveBeenCalledWith('agent-1', '/workspace/project')
    expect(settings.cwd).toBe('/workspace/project')
  })

  it('wires a PreToolUse steer hook that drains the holder and injects it as additionalContext', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    // The session-scoped steer holder is wired onto the settings — the driver reads it from here and
    // the connection's redirect() fills `pending`. Without it the whole agent steer is inert.
    expect(settings.steerHolder).toBeDefined()

    const preToolUse = settings.hooks?.PreToolUse?.[0]?.hooks
    expect(preToolUse).toHaveLength(3) // disabledToolHook + rtkRewriteHook + steerHook

    const steerHook = preToolUse![2] as unknown as (input: {
      hook_event_name: string
    }) => Promise<{ continue?: boolean; hookSpecificOutput?: { additionalContext?: string } }>

    // No queued steer → the hook no-ops.
    expect(await steerHook({ hook_event_name: 'PreToolUse' })).toEqual({})

    // A steer stashed mid-turn is drained and injected as additionalContext (model redirects without
    // aborting); `onInjected` fires so the connection can arm its steer-boundary.
    const onInjected = vi.fn()
    settings.steerHolder!.onInjected = onInjected
    settings.steerHolder!.pending.push({
      message: { data: { parts: [{ type: 'text', text: 'change direction now' }] } }
    } as never)

    const output = await steerHook({ hook_event_name: 'PreToolUse' })

    expect(output.continue).toBe(true)
    expect(output.hookSpecificOutput?.additionalContext).toContain('change direction now')
    expect(settings.steerHolder!.pending).toHaveLength(0) // drained in place
    expect(onInjected).toHaveBeenCalledTimes(1)
  })
})
