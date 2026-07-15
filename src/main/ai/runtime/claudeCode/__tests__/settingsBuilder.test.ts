import type * as NodeModule from 'node:module'
import path from 'node:path'

import {
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES,
  toCherryBuiltinRuntimeName
} from '@main/ai/tools/adapters/claudeCode/cherryBuiltinApproval'
import { KB_MANAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import { CHANNEL_SECURITY_PROMPT } from '@shared/ai/claudecode/constants'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  listSkills: vi.fn(),
  listLocalSkills: vi.fn(),
  modelGetByKey: vi.fn(),
  findBySessionId: vi.fn(),
  createSdkMcpServerInstance: vi.fn(),
  createToolPolicySnapshot: vi.fn(),
  warmToolsCache: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
  findByIdOrName: vi.fn(),
  applicationGet: vi.fn(),
  applicationGetPath: vi.fn(),
  getShellEnv: vi.fn(),
  getBinaryPath: vi.fn(),
  getProxyEnvironment: vi.fn(),
  getPathStatus: vi.fn(),
  getAppLanguage: vi.fn(),
  resolveRequire: vi.fn(),
  loggerWarn: vi.fn(),
  platform: { isMac: false },
  isWin: false
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
    withContext: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: mocks.loggerWarn, error: vi.fn() }))
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: mocks.getAgent }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    findBySessionId: mocks.findBySessionId
  }
}))

vi.mock('@data/services/McpServerService', () => ({
  mcpServerService: {
    list: vi.fn(() => ({ items: [] })),
    findByIdOrName: mocks.findByIdOrName
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: mocks.modelGetByKey }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { list: vi.fn(() => []) }
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: { list: mocks.listSkills, listLocal: mocks.listLocalSkills }
}))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  isProvisioned: vi.fn(() => true),
  loadBuiltinAgentDefinition: vi.fn(),
  provisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: vi.fn(() => ({ buildSystemPrompt: vi.fn(async () => 'soul prompt') }))
}))

vi.mock('@main/ai/mcp/servers/assistant', () => ({
  default: vi.fn(() => ({ mcpServer: {} }))
}))

vi.mock('@main/ai/runtime/claudeCode/createSdkMcpServerInstance', () => ({
  createSdkMcpServerInstance: mocks.createSdkMcpServerInstance
}))

vi.mock('@main/ai/tools/adapters/claudeCode/agentTools', () => ({
  createClaudeAgentToolPolicySnapshot: mocks.createToolPolicySnapshot
}))

vi.mock('@application', () => ({
  application: {
    get: mocks.applicationGet,
    getPath: mocks.applicationGetPath
  }
}))

vi.mock('@main/core/platform', () => ({
  isLinux: false,
  get isWin() {
    return mocks.isWin
  },
  get isMac() {
    return mocks.platform.isMac
  }
}))

vi.mock('@main/services/proxy/proxyEnv', () => ({
  getProxyEnvironment: mocks.getProxyEnvironment
}))

vi.mock('@main/utils/asar', () => ({
  toAsarUnpackedPath: (input: string) => input
}))

vi.mock('@main/utils/file', () => ({
  getPathStatus: mocks.getPathStatus
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: mocks.getAppLanguage,
  t: (key: string, params?: Record<string, unknown>) => {
    if (params?.path) return `${key}:${params.path}`
    return key
  }
}))

vi.mock('@main/utils/binaryResolver', () => ({
  getBinaryPath: mocks.getBinaryPath
}))

vi.mock('@main/utils/commandResolver', () => ({
  autoDiscoverGitBash: vi.fn(() => null)
}))

vi.mock('@main/utils/rtk', () => ({
  rtkRewrite: vi.fn()
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: mocks.getShellEnv
}))

vi.mock('../ToolApprovalRegistry', () => ({
  toolApprovalRegistry: {
    abort: vi.fn(),
    register: vi.fn()
  }
}))

const { buildClaudeCodeSessionSettings, disposeToolPolicySnapshot } = await import('../settingsBuilder')

describe('buildClaudeCodeSessionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The per-session snapshot registry is module-level state; reset session-1 (reused across
    // tests) so each build creates a fresh snapshot instead of refreshing a prior test's instance.
    disposeToolPolicySnapshot('session-1')
    mocks.resolveRequire.mockImplementation((specifier: string) => {
      if (specifier === '@anthropic-ai/claude-agent-sdk') return '/sdk/index.js'
      return `/native/${specifier}/claude`
    })
    mocks.getAgent.mockReturnValue({
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
    mocks.modelGetByKey.mockReturnValue({ apiModelId: 'claude-api' })
    mocks.findBySessionId.mockReturnValue(null)
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    mocks.warmToolsCache.mockResolvedValue(undefined)
    mocks.findByIdOrName.mockImplementation((idOrName: string) => ({ id: idOrName, name: idOrName }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') {
        return { get: vi.fn(() => undefined) }
      }
      if (name === 'McpCatalogService') {
        return { listTools: vi.fn(async () => []), warmToolsCache: mocks.warmToolsCache }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.applicationGetPath.mockImplementation((key: string) => `/app/${key}`)
    mocks.platform.isMac = false
    mocks.getShellEnv.mockResolvedValue({})
    mocks.getBinaryPath.mockResolvedValue('/usr/local/bin/bun')
    mocks.getProxyEnvironment.mockReturnValue({})
    mocks.getPathStatus.mockResolvedValue({ ok: true, kind: 'directory' })
    mocks.getAppLanguage.mockReturnValue('en-US')
    mocks.isWin = false
    mocks.listSkills.mockResolvedValue([])
    mocks.listLocalSkills.mockResolvedValue([])
  })

  it('builds the SDK skill whitelist from the DB and workspace before returning settings', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(mocks.listSkills).toHaveBeenCalledWith({ agentId: 'agent-1' })
    expect(mocks.listLocalSkills).toHaveBeenCalledWith('/workspace/project')
    expect(settings.cwd).toBe('/workspace/project')
    expect(settings.settings).toMatchObject({ autoCompactEnabled: true })
  })

  it('builds configured MCP bridges from the request snapshot instead of re-reading edited rows', async () => {
    const materializedServer = {
      id: 'mcp-1',
      name: 'Old server',
      type: 'stdio',
      command: 'npx old-server'
    }
    const editedServer = { ...materializedServer, name: 'New server', command: 'npx new-server' }
    const agent = {
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: ['mcp-1'],
      allowedTools: [],
      configuration: {}
    }
    mocks.getAgent.mockReturnValue(agent)
    mocks.findByIdOrName.mockReturnValue(editedServer)
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    await buildClaudeCodeSessionSettings(
      session as never,
      {} as never,
      { mcpServerSnapshots: new Map([['mcp-1', materializedServer as never]]) },
      agent as never
    )

    expect(mocks.createSdkMcpServerInstance).toHaveBeenCalledWith('mcp-1', materializedServer)
  })

  it('loads the user setting source so managed skills under CLAUDE_CONFIG_DIR can be discovered', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.settingSources).toEqual(['user', 'project', 'local'])
  })

  it('whitelists by directory name only, excludes disabled, never lets a shared SKILL.md name leak through', async () => {
    mocks.listSkills.mockResolvedValue([
      // Enabled and disabled skills deliberately share a SKILL.md `name` ('pdf').
      // The whitelist must key on the unique folderName so the disabled skill
      // is not un-hidden by the enabled one's name.
      { id: 'skill-1', folderName: 'pdf-tools', name: 'pdf', isEnabled: true },
      { id: 'skill-2', folderName: 'pdf-legacy', name: 'pdf', isEnabled: false }
    ])
    // Workspace project skill under cwd/.claude/skills — must be in the whitelist or the
    // SDK filters the user's own project skill out. Keyed by its directory name (filename).
    mocks.listLocalSkills.mockResolvedValue([{ name: 'Project Skill', filename: 'my-project-skill' }])
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.skills).toEqual(['pdf-tools', 'my-project-skill'])
    expect(settings.skills).not.toContain('pdf') // shared SKILL.md name never whitelisted
    expect(settings.skills).not.toContain('pdf-legacy') // disabled skill excluded
    expect(settings.skills?.some((skill) => path.isAbsolute(skill))).toBe(false)
  })

  it('resolves the plan (sonnet) and small (haiku) model env keys from their own model ids', async () => {
    // Each of the three model lookups must resolve independently from its own key/provider.
    mocks.modelGetByKey.mockImplementation((providerId: string, modelId: string) => {
      if (modelId === 'claude-sonnet') return { apiModelId: 'sonnet-api' }
      if (modelId === 'claude-haiku') return { apiModelId: 'haiku-api' }
      throw new Error(`model ${providerId}::${modelId} not in table`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    // agent.model = planModel = claude-sonnet, smallModel = claude-haiku (see the beforeEach agent).
    expect(settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'sonnet-api',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'sonnet-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-api'
    })
  })

  it('falls back each model env key to its own raw id when that model is absent from the table', async () => {
    // Only the small (haiku) model is missing — the others must NOT be forced to fall back, and the
    // haiku key must fall back to its OWN raw id (not the main model's).
    mocks.modelGetByKey.mockImplementation((_providerId: string, modelId: string) => {
      if (modelId === 'claude-haiku') throw new Error('haiku not in table')
      return { apiModelId: `${modelId}-api` }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.env).toMatchObject({
      ANTHROPIC_MODEL: 'claude-sonnet-api',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-api',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku'
    })
  })

  it('denies a disabled tool via a PreToolUse hook so the gate fires in all permission modes', async () => {
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn((tool: string) => tool === 'Bash'),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    const disabledSession = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const disabledSettings = await buildClaudeCodeSessionSettings(disabledSession as never, {} as never)

    const hooks = disabledSettings.hooks?.PreToolUse?.[0]?.hooks ?? []
    const runHooks = (toolName: string) =>
      Promise.all(
        hooks.map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: {} } as never,
            'tool-use-1',
            {} as never
          )
        )
      )

    const disabled = await runHooks('Bash')
    expect(disabled).toContainEqual(
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
    )

    const enabled = await runHooks('Read')
    expect(
      enabled.every(
        (out) =>
          (out as { hookSpecificOutput?: { permissionDecision?: string } })?.hookSpecificOutput?.permissionDecision !==
          'deny'
      )
    ).toBe(true)
  })

  it('passes agent disabledTools through to SDK disallowedTools', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: ['Bash', 'Read'],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read']))
    // The injected cherry-tools/agent-memory servers are always pre-approved via the allowlist.
    expect(settings.allowedTools).toEqual(expect.arrayContaining(['mcp__cherry-tools__cron', 'mcp__agent-memory__*']))
  })

  it('composes disallowedTools: globals + EnterWorktree (no .git cwd) + dedup', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const disallowed = settings.disallowedTools ?? []

    // GLOBALLY_DISALLOWED_TOOLS always blocked; EnterWorktree blocked because the cwd has no .git.
    expect(disallowed).toEqual(expect.arrayContaining(['WebSearch', 'WebFetch', 'EnterWorktree']))
    // The `new Set` dedup holds — no entry appears twice even when registry + globals overlap.
    expect(new Set(disallowed).size).toBe(disallowed.length)
  })

  it('leaves interactive tools available for plain agents (only registry-disabled tools blocked)', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const disallowed = settings.disallowedTools ?? []

    // Interactive tools are no longer blanket-disabled now that the soul-mode overlay is gone.
    expect(disallowed).not.toEqual(expect.arrayContaining(['AskUserQuestion']))
    expect(disallowed).not.toEqual(expect.arrayContaining(['EnterPlanMode']))
    // Tools classified `disabled` in the declarative registry stay blocked.
    expect(disallowed).toEqual(expect.arrayContaining(['CronCreate', 'NotebookEdit', 'TodoWrite']))
    expect(new Set(disallowed).size).toBe(disallowed.length)
  })

  it('does not bake headless-only interactive denials into disallowedTools', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    // Busy interactive follow-ups may reuse a warm connection. Keep these denials in the per-turn
    // canUseTool gate / PreToolUse hook so the next interactive turn can recover without reconnecting.
    expect(settings.disallowedTools ?? []).not.toEqual(
      expect.arrayContaining(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode'])
    )
    expect(settings.disallowedTools ?? []).not.toContain('mcp__cherry-tools__notify')
  })

  it('denies interactive no-responder tools at tool fire time for the current headless turn', async () => {
    const isCurrentTurnHeadless = vi.fn(() => true)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { isCurrentTurnHeadless }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    for (const toolName of ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree']) {
      const result = await settings.canUseTool?.(toolName, {}, {
        signal: { aborted: false },
        toolUseID: 'tool-use-1'
      } as never)

      expect(result).toEqual({
        behavior: 'deny',
        message:
          'This channel or scheduled turn has no interactive responder, so proceed without asking the user and state your assumptions instead.'
      })
    }
    expect(isCurrentTurnHeadless).toHaveBeenCalledWith('session-1')
  })

  it('denies interactive no-responder tools via PreToolUse so the gate fires under bypassPermissions', async () => {
    // The SDK skips `canUseTool` for auto-approved paths (bypassPermissions / acceptEdits), so the
    // per-turn denial must also run as a PreToolUse hook (which fires in every permission mode) or a
    // headless bypass run could reach AskUserQuestion / EnterPlanMode and stall on a prompt no one answers.
    const isCurrentTurnHeadless = vi.fn(() => true)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { isCurrentTurnHeadless }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    for (const toolName of ['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree']) {
      const results = await Promise.all(
        (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: {} } as never,
            'tool-use-1',
            {} as never
          )
        )
      )
      expect(results).toContainEqual(
        expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
      )
    }
    expect(isCurrentTurnHeadless).toHaveBeenCalledWith('session-1')
  })

  it('does not deny interactive tools via PreToolUse for the current interactive turn', async () => {
    const isCurrentTurnHeadless = vi.fn(() => false)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { isCurrentTurnHeadless }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const results = await Promise.all(
      (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
        hook(
          { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} } as never,
          'tool-use-1',
          {} as never
        )
      )
    )
    expect(results).not.toContainEqual(
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
    )
  })

  it('denies mutating config actions via PreToolUse for the current headless turn', async () => {
    const isCurrentTurnHeadless = vi.fn(() => true)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { isCurrentTurnHeadless }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const runConfigAction = (action: string) =>
      Promise.all(
        (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
          hook(
            {
              hook_event_name: 'PreToolUse',
              tool_name: 'mcp__cherry-tools__config',
              tool_input: { action }
            } as never,
            'tool-use-1',
            {} as never
          )
        )
      )

    for (const action of ['add_channel', 'complete_bootstrap', 'reset_bootstrap']) {
      await expect(runConfigAction(action)).resolves.toContainEqual(
        expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
      )
    }

    await expect(runConfigAction('status')).resolves.not.toContainEqual(
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
    )
  })

  it('does not deny AskUserQuestion at tool fire time for the current interactive turn', async () => {
    const isCurrentTurnHeadless = vi.fn(() => false)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { isCurrentTurnHeadless }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(() => ({ approval: 'auto' })),
      isDisabled: vi.fn(() => false),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const result = await settings.canUseTool?.('AskUserQuestion', { prompt: 'Need input?' }, {
      signal: { aborted: false },
      toolUseID: 'tool-use-1'
    } as never)

    expect(isCurrentTurnHeadless).toHaveBeenCalledWith('session-1')
    expect(result).toEqual({ behavior: 'allow', updatedInput: { prompt: 'Need input?' } })
  })

  it('keeps AskUserQuestion available for channel-linked interactive sessions', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1' })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.disallowedTools ?? []).not.toContain('AskUserQuestion')
  })

  it('assistant role adds interactive no-responder tools to disallowedTools', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'assistant' }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    expect(settings.disallowedTools ?? []).toEqual(
      expect.arrayContaining(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree'])
    )
  })

  it('injects and auto-approves Assistant MCP tools for a local assistant session', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'assistant' }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.mcpServers?.assistant).toBeDefined()
    // Only navigate is pre-approved. diagnose reads local logs/source/config and must go through
    // per-call approval — a namespace wildcard would silently re-include it.
    expect(settings.allowedTools).toContain('mcp__assistant__navigate')
    expect(settings.allowedTools).not.toContain('mcp__assistant__*')
    expect(settings.allowedTools).not.toContain('mcp__assistant__diagnose')
    const snapshotOptions = mocks.createToolPolicySnapshot.mock.calls.at(-1)?.[1]
    expect(snapshotOptions.autoAllowRuntimeNames).toContain('mcp__assistant__navigate')
    expect(snapshotOptions.autoAllowRuntimeNames).not.toContain('mcp__assistant__diagnose')
    expect(snapshotOptions.autoAllowRuntimeNamePrefixes ?? []).toEqual([])
  })

  it('uses one captured channel snapshot for Assistant MCP, approval, and prompt policy', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1' })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      instructions: 'Follow instructions.',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'assistant' }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never, {
      linkedChannelSnapshot: null
    })

    expect(settings.mcpServers?.assistant).toBeDefined()
    expect(settings.allowedTools).toContain('mcp__assistant__navigate')
    expect(settings.systemPrompt).not.toContain(CHANNEL_SECURITY_PROMPT)
    expect(mocks.findBySessionId).not.toHaveBeenCalled()
  })

  it('excludes Assistant MCP capability for channel-linked sessions', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1' })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'assistant' }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.mcpServers?.assistant).toBeUndefined()
    expect(settings.allowedTools).not.toContain('mcp__assistant__navigate')
    const snapshotOptions = mocks.createToolPolicySnapshot.mock.calls.at(-1)?.[1]
    expect(snapshotOptions.autoAllowRuntimeNames).not.toContain('mcp__assistant__navigate')
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
    // headlessInteractiveToolHook + headlessConfigMutationHook + disabledToolHook + dependencyIsolationHook + rtkRewriteHook + steerHook
    expect(preToolUse).toHaveLength(6)

    const steerHook = preToolUse![5] as unknown as (input: {
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

  it('keeps an empty-text steer pending when the PreToolUse hook cannot inject it', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const preToolUse = settings.hooks?.PreToolUse?.[0]?.hooks
    const steerHook = preToolUse![5] as unknown as (input: {
      hook_event_name: string
    }) => Promise<{ continue?: boolean; hookSpecificOutput?: { additionalContext?: string } }>
    const onInjected = vi.fn()
    settings.steerHolder!.onInjected = onInjected
    const emptySteer = { message: { data: { parts: [{ type: 'text', text: '   ' }] } } } as never
    settings.steerHolder!.pending.push(emptySteer)

    await expect(steerHook({ hook_event_name: 'PreToolUse' })).resolves.toEqual({})

    expect(settings.steerHolder!.pending).toEqual([emptySteer])
    expect(onInjected).not.toHaveBeenCalled()
  })

  it('hands the real kb_manage approval exception to the tool-policy snapshot (production gate wiring)', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    await buildClaudeCodeSessionSettings(session as never, {} as never)

    // settingsBuilder must derive the approval exceptions from the shared constant and pass them to the
    // snapshot. The agentTools test proves those options gate kb_manage; this proves settingsBuilder
    // actually supplies them — dropping `.map(toCherryBuiltinRuntimeName)` or the exceptions fails here.
    const exceptions = CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.map(toCherryBuiltinRuntimeName)
    expect(exceptions).toContain(toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME))
    expect(mocks.createToolPolicySnapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        autoAllowRuntimeNames: expect.arrayContaining(['mcp__cherry-tools__notify']),
        autoAllowRuntimeNameExceptions: exceptions
      })
    )
    // No prefix-based auto-approval anywhere: a namespace prefix would silently pre-approve
    // future sensitive tools (e.g. assistant diagnose). Auto-approval is explicit names only.
    const snapshotOptions = mocks.createToolPolicySnapshot.mock.calls.at(-1)?.[1]
    expect(snapshotOptions.autoAllowRuntimeNamePrefixes ?? []).toEqual([])
  })

  it('redacts proxy credentials and URL components in the assembled assistant context', async () => {
    const preferenceGet = vi.fn((key: string) => {
      if (key === 'app.proxy.url') return 'http://user:pass@proxy.example:8080/path?token=secret#frag'
      return undefined
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: preferenceGet }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'assistant' }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(typeof settings.systemPrompt).toBe('string')
    const proxyLine = (settings.systemPrompt as string).split('\n').find((line) => line.startsWith('- Proxy:'))
    expect(proxyLine).toBe('- Proxy: http://proxy.example:8080')
    expect(proxyLine).not.toContain('user')
    expect(proxyLine).not.toContain('pass')
    expect(proxyLine).not.toContain('token=secret')
    expect(proxyLine).not.toContain('/path')
  })

  // Warm-pool correctness: hooks baked at prewarm must resolve session state by id at fire-time, so
  // a warm-hit connection's live updates (snapshot refresh / re-bound emitter / new steer holder)
  // reach the running subprocess instead of a stale per-build instance.
  describe('warm-pool session-state resolution', () => {
    const sessionWith = (id: string) =>
      ({ id, agentId: 'agent-1', workspace: { type: 'user', path: '/workspace/project' } }) as never

    const preToolUseHooks = (settings: Awaited<ReturnType<typeof buildClaudeCodeSessionSettings>>) =>
      settings.hooks?.PreToolUse?.[0]?.hooks ?? []

    const runHooks = (settings: Awaited<ReturnType<typeof buildClaudeCodeSessionSettings>>, toolName: string) =>
      Promise.all(
        preToolUseHooks(settings).map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: {} } as never,
            'tool-use-1',
            {} as never
          )
        )
      )

    it('reuses one snapshot per session so a warm-hit refresh is seen by the prewarm-baked hook (Bug A)', async () => {
      // Each create returns a fresh stateful snapshot; `update()` simulates the connect-time policy
      // disabling Bash. With the fix, both builds share one snapshot and the prewarm hook sees it.
      const created: Array<{ update: ReturnType<typeof vi.fn> }> = []
      mocks.createToolPolicySnapshot.mockImplementation(async () => {
        const disabled = new Set<string>()
        const snap = {
          resolve: vi.fn(),
          isDisabled: (tool: string) => disabled.has(tool),
          update: vi.fn(async () => {
            disabled.add('Bash')
          }),
          setPermissionMode: vi.fn()
        }
        created.push(snap)
        return snap
      })

      const prewarm = await buildClaudeCodeSessionSettings(sessionWith('warm-a'), {} as never)
      await buildClaudeCodeSessionSettings(sessionWith('warm-a'), {} as never)

      // Deduped: created once, refreshed (not recreated) on the second build.
      expect(mocks.createToolPolicySnapshot).toHaveBeenCalledTimes(1)
      expect(created).toHaveLength(1)
      expect(created[0].update).toHaveBeenCalledTimes(1)

      // The prewarm-baked disabled-tool hook now denies Bash because it reads the refreshed snapshot.
      const out = await runHooks(prewarm, 'Bash')
      expect(out).toContainEqual(
        expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
      )
    })

    it('steers via the live holder after the original is disposed and rebuilt (Bug B)', async () => {
      const prewarm = await buildClaudeCodeSessionSettings(sessionWith('warm-b'), {} as never)
      // Simulate the connection that prewarm baked for closing — disposes + evicts the holder.
      prewarm.steerHolder?.dispose()

      // Reconnect builds a brand-new holder; the host stashes a steer into it via redirect().
      const reconnect = await buildClaudeCodeSessionSettings(sessionWith('warm-b'), {} as never)
      const onInjected = vi.fn()
      reconnect.steerHolder!.onInjected = onInjected
      reconnect.steerHolder!.pending.push({
        message: { data: { parts: [{ type: 'text', text: 'go north instead' }] } }
      } as never)

      // The prewarm-baked steer hook resolves the live holder by id → injects the steer.
      const out = await runHooks(prewarm, 'Read')
      const additionalContexts = out.map(
        (o) => (o as { hookSpecificOutput?: { additionalContext?: string } })?.hookSpecificOutput?.additionalContext
      )
      expect(additionalContexts).toContainEqual(expect.stringContaining('go north instead'))
      expect(onInjected).toHaveBeenCalledTimes(1)
    })

    it('approves via the re-bound emitter after the original is disposed and rebuilt (approval)', async () => {
      const prewarm = await buildClaudeCodeSessionSettings(sessionWith('warm-c'), {} as never)
      // The emitter the prewarm built is disposed when its connection closes.
      prewarm.approvalEmitter?.dispose?.()

      // Reconnect builds a fresh emitter holder and binds the live stream's emit.
      const reconnect = await buildClaudeCodeSessionSettings(sessionWith('warm-c'), {} as never)
      const boundEmit = vi.fn()
      reconnect.approvalEmitter!.emit = boundEmit

      // The prewarm-baked canUseTool resolves the emitter by id → emits on the live one. The returned
      // promise stays pending on the approval (never resolves here), so we do NOT await it — the emit
      // fires synchronously while constructing that promise.
      const pending = prewarm.canUseTool!('SomeTool', {}, { signal: { aborted: false }, toolUseID: 'tu-1' } as never)
      void pending
      expect(boundEmit).toHaveBeenCalledTimes(1)
      expect(boundEmit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tool-approval-request' }))
    })

    it('disposeToolPolicySnapshot evicts the snapshot so the next build recreates it (dispose)', async () => {
      await buildClaudeCodeSessionSettings(sessionWith('warm-d'), {} as never)
      disposeToolPolicySnapshot('warm-d')
      await buildClaudeCodeSessionSettings(sessionWith('warm-d'), {} as never)
      expect(mocks.createToolPolicySnapshot).toHaveBeenCalledTimes(2)
    })
  })

  // The claude-code login provider must NOT inject an API key — it relies on the Claude Agent SDK
  // falling back to the Claude Code CLI subscription credential, which only happens when no
  // ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is present in the environment.
  describe('claude-code login provider env', () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    it('keeps the user setting source isolated when using the real CLI config', async () => {
      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.settingSources).toEqual(['project', 'local'])
    })

    it('strips every inherited Anthropic credential channel and points CLAUDE_CONFIG_DIR at the shell config dir', async () => {
      mocks.getShellEnv.mockResolvedValue({
        ANTHROPIC_API_KEY: 'sk-shell',
        ANTHROPIC_AUTH_TOKEN: 'tok-shell',
        ANTHROPIC_BASE_URL: 'https://shell.example',
        ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer sk-shell',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-shell',
        CLAUDE_CONFIG_DIR: '/home/me/.claude'
      })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env).not.toHaveProperty('ANTHROPIC_API_KEY')
      expect(settings.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
      expect(settings.env).not.toHaveProperty('ANTHROPIC_BASE_URL')
      // Any of these could silently override the subscription OAuth fallback, so they must be stripped too.
      expect(settings.env).not.toHaveProperty('ANTHROPIC_CUSTOM_HEADERS')
      expect(settings.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN')
      expect(settings.env!.CLAUDE_CODE_USE_VERTEX).toBe('0')
      // Non-mac (platform mock has no isMac): reuse the user's real config dir from the login shell.
      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe('/home/me/.claude')
    })

    it('falls back CLAUDE_CONFIG_DIR to ~/.claude when the shell does not set it', async () => {
      mocks.getShellEnv.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-shell' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env).not.toHaveProperty('ANTHROPIC_API_KEY')
      // application.getPath('sys.home') is mocked to '/app/sys.home'.
      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe('/app/sys.home/.claude')
    })

    it('falls back CLAUDE_CONFIG_DIR to ~/.claude when the shell exports it empty', async () => {
      // An empty CLAUDE_CONFIG_DIR must not pass through (it would point the SDK at /.credentials.json);
      // the fallback uses || so it matches CodeCliService's login probe rather than diverging from it.
      mocks.getShellEnv.mockResolvedValue({ CLAUDE_CONFIG_DIR: '' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe('/app/sys.home/.claude')
    })

    it('leaves CLAUDE_CONFIG_DIR unset on macOS so the Agent SDK can read the Keychain login', async () => {
      mocks.platform.isMac = true
      mocks.getShellEnv.mockResolvedValue({ CLAUDE_CONFIG_DIR: '/Users/me/.claude' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    })

    it('blocks a reserved agent env_var override but passes through non-reserved keys', async () => {
      // env_vars come from the *agent* config, not the provider. CLAUDE_CODE_USE_VERTEX
      // is a runtime-forced routing flag (like CLAUDE_CODE_USE_BEDROCK) an agent must not
      // flip on; a non-reserved key must still pass through.
      mocks.getShellEnv.mockResolvedValue({})
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        type: 'claude-code',
        instructions: 'Follow instructions.',
        model: 'anthropic::claude-sonnet',
        planModel: 'anthropic::claude-sonnet',
        smallModel: 'anthropic::claude-haiku',
        mcps: [],
        allowedTools: [],
        configuration: { env_vars: { CLAUDE_CODE_USE_VERTEX: '1', CHERRY_CUSTOM_VAR: 'passthrough' } }
      })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env!.CLAUDE_CODE_USE_VERTEX).toBe('0')
      expect(settings.env!.CHERRY_CUSTOM_VAR).toBe('passthrough')
    })

    it('leaves inherited Anthropic credentials intact for a non-login provider', async () => {
      mocks.getShellEnv.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-shell' })

      const settings = await buildClaudeCodeSessionSettings(session as never, { id: 'anthropic' } as never)

      expect(settings.env!.ANTHROPIC_API_KEY).toBe('sk-shell')
    })
  })

  describe('MCP tool cache warming', () => {
    const sessionWithMcps = (mcps: string[]) => {
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        type: 'claude-code',
        model: 'anthropic::claude-sonnet',
        mcps,
        allowedTools: [],
        configuration: {}
      })
      return {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      }
    }

    it('warms each configured MCP server once via warmToolsCache', async () => {
      const session = sessionWithMcps(['srv-a', 'srv-b'])

      await buildClaudeCodeSessionSettings(session as never, {} as never)

      expect(mocks.warmToolsCache).toHaveBeenCalledTimes(2)
      expect(mocks.warmToolsCache).toHaveBeenCalledWith('srv-a')
      expect(mocks.warmToolsCache).toHaveBeenCalledWith('srv-b')
    })

    it('does not stall the build when a server never responds (issue #16242 guard)', async () => {
      // A dead/slow server returns a never-resolving warm promise. The bounded race must let the
      // build finish; without the timeout race this build would hang forever.
      mocks.warmToolsCache.mockReturnValue(new Promise<never>(() => {}))
      const session = sessionWithMcps(['srv-dead'])

      vi.useFakeTimers()
      try {
        const build = buildClaudeCodeSessionSettings(session as never, {} as never)
        // Advance past MCP_WARM_TIMEOUT_MS (3_000ms) so the warm race resolves via timeout.
        await vi.advanceTimersByTimeAsync(3_000)
        await expect(build).resolves.toBeDefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it('tolerates a rejecting server and still resolves', async () => {
      mocks.warmToolsCache.mockImplementation((serverId: string) =>
        serverId === 'srv-a' ? Promise.reject(new Error('boom')) : Promise.resolve()
      )
      const session = sessionWithMcps(['srv-a', 'srv-b'])

      await expect(buildClaudeCodeSessionSettings(session as never, {} as never)).resolves.toBeDefined()
    })

    it('skips warming entirely when the agent has no MCP servers', async () => {
      const session = sessionWithMcps([])

      await buildClaudeCodeSessionSettings(session as never, {} as never)

      expect(mocks.warmToolsCache).not.toHaveBeenCalled()
    })

    it('reconciles the session snapshot and tool metadata once a timed-out warm completes', async () => {
      // The refresh outlives the 3s cap; the cache-only listTools stays cold until it lands. Once it
      // does, the SDK bridge may expose the tools, so the session snapshot + metadata must follow.
      let resolveRefresh!: () => void
      mocks.warmToolsCache.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
      )
      let cachedTools: Array<Record<string, unknown>> = []
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') {
          return { listTools: vi.fn(() => cachedTools), warmToolsCache: mocks.warmToolsCache }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const snapshot = {
        resolve: vi.fn(),
        isDisabled: vi.fn(() => false),
        update: vi.fn(),
        setPermissionMode: vi.fn()
      }
      mocks.createToolPolicySnapshot.mockResolvedValue(snapshot)
      const session = sessionWithMcps(['srv-a'])

      vi.useFakeTimers()
      const build = buildClaudeCodeSessionSettings(session as never, {} as never)
      try {
        await vi.advanceTimersByTimeAsync(3_000)
      } finally {
        vi.useRealTimers()
      }
      const settings = await build

      // Built from the cold cache: metadata is an empty (shared-by-reference) map, snapshot untouched.
      expect(settings.mcpToolMetadata).toEqual({})
      expect(snapshot.update).not.toHaveBeenCalled()

      // The in-flight refresh lands: the reconciliation rebuilds the snapshot from the live agent
      // and fills the same metadata object the settings (and stream adapter) hold.
      cachedTools = [{ id: 'tool-x', name: 'tool_x', description: 'X' }]
      resolveRefresh()
      await vi.waitFor(() => {
        expect(snapshot.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1' }))
        expect(settings.mcpToolMetadata).toMatchObject({
          'mcp__srv-a__tool_x': expect.objectContaining({ name: 'tool_x', serverId: 'srv-a' })
        })
      })
    })

    it('registers no reconciliation when the warm completes within the cap', async () => {
      const snapshot = {
        resolve: vi.fn(),
        isDisabled: vi.fn(() => false),
        update: vi.fn(),
        setPermissionMode: vi.fn()
      }
      mocks.createToolPolicySnapshot.mockResolvedValue(snapshot)
      const session = sessionWithMcps(['srv-a'])

      const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
      await new Promise((resolve) => setImmediate(resolve))

      expect(snapshot.update).not.toHaveBeenCalled()
      expect(settings.mcpToolMetadata).toBeUndefined()
    })
  })
})
