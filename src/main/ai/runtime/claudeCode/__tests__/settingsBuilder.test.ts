import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import type * as NodeModule from 'node:module'
import os from 'node:os'
import path from 'node:path'

import {
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/toolApproval/builtinToolPolicy'
import type * as UserDataSqliteGuard from '@main/ai/toolApproval/userDataSqliteGuard'
import { KB_MANAGE_TOOL_NAME } from '@shared/ai/builtinTools'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({ approval: 'required' }).map(toMcpRuntimeName)
const BYPASSABLE_APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({
  approval: 'required',
  bypassApproval: 'lift'
}).map(toMcpRuntimeName)
const NON_BYPASSABLE_APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({
  approval: 'required',
  bypassApproval: 'enforce'
}).map(toMcpRuntimeName)
const NON_HOST_MCP_SERVERS: ReadonlySet<string> = new Set(['cherry-tools', 'agent-memory', 'skills', 'mcp-manager'])
const NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({
  approval: 'required',
  mountedServers: NON_HOST_MCP_SERVERS
}).map(toMcpRuntimeName)
const ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES = listBuiltinToolPolicies({ approval: 'required' })
  .filter((entry) => !NON_HOST_MCP_SERVERS.has(entry.serverName))
  .map(toMcpRuntimeName)

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getBuiltinAgentPluginDirectory: vi.fn(),
  loadBuiltinAgentDefinition: vi.fn(),
  createAssistantServer: vi.fn(() => ({ mcpServer: {} })),
  createAssistantFileToolsServer: vi.fn(() => ({ mcpServer: {} })),
  listSkills: vi.fn(),
  listLocalSkillFolderNames: vi.fn(),
  getSkillPluginDirectory: vi.fn(),
  checkSkillRuntimeDependencies: vi.fn(),
  modelGetByKey: vi.fn(),
  findBySessionId: vi.fn(),
  createMcpBridgeServer: vi.fn(),
  createToolPolicySnapshot: vi.fn(),
  warmToolsCache: vi.fn<(serverId: string) => Promise<void>>(async () => undefined),
  listMcpTools: vi.fn(),
  onToolsCacheUpdated: vi.fn(),
  mcpSubscriptionDispose: vi.fn(),
  findByIdOrName: vi.fn(),
  applicationGet: vi.fn(),
  applicationGetPath: vi.fn(),
  getShellEnv: vi.fn(),
  refreshShellEnv: vi.fn(),
  getBinaryPath: vi.fn(),
  getProxyEnvironment: vi.fn(),
  getPathStatus: vi.fn(),
  ensureAgentDataDirectory: vi.fn(),
  ensureAgentStorageDirectory: vi.fn(),
  buildPrompt: vi.fn(),
  getAppLanguage: vi.fn(),
  resolveRequire: vi.fn(),
  loggerWarn: vi.fn(),
  approvalRegister: vi.fn(),
  recordToolExecutionTiming: vi.fn(),
  getTurnTrustedNotifyChannels: vi.fn(),
  rtkRewrite: vi.fn(),
  createAgentsMdLoader: vi.fn(),
  loadAgentsMdInitialContext: vi.fn(),
  agentsMdHook: vi.fn(async () => ({})),
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

vi.mock('@main/ai/toolApproval/userDataSqliteGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof UserDataSqliteGuard>()),
  evaluateUserDataSqliteGuard: vi.fn(async () => undefined)
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
  skillService: {
    list: mocks.listSkills,
    listLocalFolderNames: mocks.listLocalSkillFolderNames,
    getSkillPluginDirectory: mocks.getSkillPluginDirectory
  }
}))

vi.mock('../skillDependencies', () => ({
  SKILL_TOOL_NAME: 'Skill',
  buildPluginDirectoryIndex: vi.fn(async () => new Map()),
  checkSkillRuntimeDependencies: mocks.checkSkillRuntimeDependencies
}))

vi.mock('@main/ai/agents/builtin/BuiltinAgentProvisioner', () => ({
  getBuiltinAgentPluginDirectory: mocks.getBuiltinAgentPluginDirectory,
  loadBuiltinAgentDefinition: mocks.loadBuiltinAgentDefinition,
  provisionBuiltinAgent: vi.fn()
}))

vi.mock('@main/ai/agents/prompt', () => ({
  PromptBuilder: vi.fn(() => ({
    buildPromptParts: mocks.buildPrompt,
    buildMemoriesSection: vi.fn(async () => undefined)
  }))
}))

vi.mock('@main/ai/mcp/servers/assistant', () => ({ default: mocks.createAssistantServer }))

vi.mock('@main/ai/mcp/servers/AssistantFileToolsServer', () => ({
  AssistantFileToolsServer: mocks.createAssistantFileToolsServer
}))

vi.mock('@main/ai/mcp/createMcpBridgeServer', () => ({
  createMcpBridgeServer: mocks.createMcpBridgeServer
}))

vi.mock('@main/ai/tools/adapters/claudeCode/agentTools', () => ({
  createClaudeAgentToolPolicySnapshot: mocks.createToolPolicySnapshot
}))

vi.mock('@application', () => ({
  application: {
    // Session-keyed live state always resolves to the one real service instance (created below),
    // so the many per-test `applicationGet` overrides don't each have to register it.
    get: (name: string) => {
      if (name === 'ClaudeCodeSessionStateService') return sessionStateService
      if (name === 'AgentSessionRuntimeService') {
        try {
          return { getTurnTrustedNotifyChannels: mocks.getTurnTrustedNotifyChannels, ...mocks.applicationGet(name) }
        } catch {
          return { getTurnTrustedNotifyChannels: mocks.getTurnTrustedNotifyChannels }
        }
      }
      return mocks.applicationGet(name)
    },
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
  CHERRY_NODE_PROXY_BYPASS_RULES_ENV: 'CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES',
  CHERRY_NODE_PROXY_RULES_ENV: 'CHERRY_STUDIO_NODE_PROXY_RULES',
  getProxyEnvironment: mocks.getProxyEnvironment
}))

vi.mock('@main/utils/asar', () => ({
  toAsarUnpackedPath: (input: string) => input
}))

vi.mock('@main/utils/file', () => ({
  getPathStatus: mocks.getPathStatus,
  isPathInside: (child: string, parent: string) => {
    const relative = path.relative(path.resolve(parent), path.resolve(child))
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
  }
}))

vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  ensureAgentDataDirectory: mocks.ensureAgentDataDirectory,
  ensureAgentStorageDirectory: mocks.ensureAgentStorageDirectory
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
  rtkRewrite: mocks.rtkRewrite
}))

vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: mocks.getShellEnv,
  refreshShellEnv: mocks.refreshShellEnv
}))

vi.mock('@main/ai/toolApproval/ToolApprovalRegistry', () => ({
  toolApprovalRegistry: {
    abort: vi.fn(),
    register: mocks.approvalRegister
  }
}))

vi.mock('../AgentsMdLoader', () => ({
  AgentsMdLoader: {
    create: mocks.createAgentsMdLoader
  }
}))

const {
  assertClaudeCodeWorkspaceDirectory,
  buildClaudeCodeSessionSettings,
  disposeToolPolicySnapshot,
  prepareClaudeCodeWorkspaceDirectory,
  registerMcpSessionCatalogSync
} = await import('../settingsBuilder')
const { ClaudeCodeSessionStateService } = await import('../ClaudeCodeSessionStateService')
// One real instance per test file — the facade resolves it via application.get, and the real Maps
// preserve the warm-pool resolve-by-id semantics the Bug A/Bug B and dispose tests exercise.
const sessionStateService = new ClaudeCodeSessionStateService()

function systemPromptText(systemPrompt: unknown): string {
  if (typeof systemPrompt === 'string') return systemPrompt
  if (Array.isArray(systemPrompt)) return systemPrompt.join('\n')
  if (systemPrompt && typeof systemPrompt === 'object' && 'append' in systemPrompt) {
    const append = (systemPrompt as { append?: unknown }).append
    return typeof append === 'string' ? append : ''
  }
  return ''
}

describe('buildClaudeCodeSessionSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.approvalRegister.mockReturnValue(true)
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
    mocks.getTurnTrustedNotifyChannels.mockReturnValue(undefined)
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      getPermissionMode: vi.fn(() => undefined),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    mocks.warmToolsCache.mockResolvedValue(undefined)
    mocks.listMcpTools.mockReturnValue([])
    mocks.onToolsCacheUpdated.mockReturnValue({ dispose: mocks.mcpSubscriptionDispose })
    mocks.findByIdOrName.mockImplementation((idOrName: string) => ({ id: idOrName, name: idOrName }))
    mocks.loadAgentsMdInitialContext.mockResolvedValue(undefined)
    mocks.agentsMdHook.mockResolvedValue({})
    mocks.createAgentsMdLoader.mockResolvedValue({
      loadInitialContext: mocks.loadAgentsMdInitialContext,
      createPreToolUseHook: () => mocks.agentsMdHook
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') {
        return { get: vi.fn(() => undefined) }
      }
      if (name === 'McpCatalogService') {
        return {
          listTools: mocks.listMcpTools,
          warmToolsCache: mocks.warmToolsCache,
          onToolsCacheUpdated: mocks.onToolsCacheUpdated
        }
      }
      if (name === 'AgentSessionRuntimeService') {
        // Default to a live interactive turn so the approval path is exercised; the out-of-turn and
        // headless gates are asserted by tests that override this.
        return {
          getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
          recordToolExecutionTiming: mocks.recordToolExecutionTiming
        }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    // The per-session snapshot registry is service-held state shared across tests; reset session-1
    // (reused throughout) so each build creates a fresh snapshot instead of refreshing a prior
    // test's instance. Must run after the application.get implementation above is in place.
    disposeToolPolicySnapshot('session-1')
    mocks.applicationGetPath.mockImplementation((key: string) => `/app/${key}`)
    mocks.platform.isMac = false
    mocks.getShellEnv.mockResolvedValue({})
    mocks.refreshShellEnv.mockResolvedValue({})
    mocks.getBinaryPath.mockResolvedValue('/usr/local/bin/bun')
    mocks.getProxyEnvironment.mockReturnValue({})
    mocks.getPathStatus.mockResolvedValue({ ok: true, kind: 'directory' })
    mocks.ensureAgentDataDirectory.mockImplementation(async (root: string, agentId: string) => path.join(root, agentId))
    mocks.buildPrompt.mockResolvedValue({ base: { kind: 'native' }, context: 'soul prompt' })
    mocks.getAppLanguage.mockReturnValue('en-US')
    mocks.rtkRewrite.mockResolvedValue(null)
    mocks.isWin = false
    mocks.listSkills.mockResolvedValue([])
    mocks.listLocalSkillFolderNames.mockResolvedValue([])
    mocks.getSkillPluginDirectory.mockReturnValue('/app/feature.agents.claude.root')
    mocks.checkSkillRuntimeDependencies.mockResolvedValue({})
    mocks.getBuiltinAgentPluginDirectory.mockReturnValue(undefined)
    mocks.loadBuiltinAgentDefinition.mockReturnValue(undefined)
  })

  it('preserves managed CLI paths from the login-shell environment', async () => {
    mocks.getShellEnv.mockResolvedValue({
      PATH: '/managed/shims:/usr/bin',
      MISE_DATA_DIR: '/managed',
      MISE_CONFIG_DIR: '/managed/config',
      MISE_CACHE_DIR: '/managed/cache',
      MISE_STATE_DIR: '/managed/state',
      MISE_SHIMS_DIR: '/managed/shims'
    })

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(settings.env).toMatchObject({
      PATH: '/managed/shims:/usr/bin',
      MISE_DATA_DIR: '/managed',
      MISE_CONFIG_DIR: '/managed/config',
      MISE_CACHE_DIR: '/managed/cache',
      MISE_STATE_DIR: '/managed/state',
      MISE_SHIMS_DIR: '/managed/shims'
    })
  })

  it.each(['PostToolUse', 'PostToolUseFailure'] as const)(
    'captures %s duration through the live Agent runtime owner',
    async (hookEventName) => {
      const settings = await buildClaudeCodeSessionSettings(
        {
          id: 'session-1',
          agentId: 'agent-1',
          workspace: { type: 'user', path: '/workspace/project' }
        } as never,
        {} as never
      )
      const hook = settings.hooks?.[hookEventName]?.[0]?.hooks[0]

      await hook?.(
        {
          hook_event_name: hookEventName,
          tool_use_id: 'tool-1',
          tool_name: 'Bash',
          duration_ms: 750
        } as never,
        'tool-use-1',
        { signal: { aborted: false } } as never
      )

      expect(mocks.recordToolExecutionTiming).toHaveBeenCalledWith('session-1', {
        toolCallId: 'tool-1',
        toolName: 'Bash',
        durationMs: 750
      })
    }
  )

  it('builds the SDK skill whitelist from the DB and workspace before returning settings', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never, { fastMode: true })

    expect(mocks.listSkills).toHaveBeenCalledWith({ agentId: 'agent-1' })
    expect(mocks.listLocalSkillFolderNames).toHaveBeenCalledWith('/workspace/project')
    expect(settings.cwd).toBe('/workspace/project')
    expect(settings.additionalDirectories).toEqual([path.join('/app/feature.agents.data', 'agent-1')])
    expect(mocks.buildPrompt).toHaveBeenCalledWith(
      '/workspace/project',
      expect.anything(),
      true,
      path.join('/app/feature.agents.data', 'agent-1')
    )
    expect(settings.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
    expect(systemPromptText(settings.systemPrompt)).not.toContain('## Current Workspace')
    expect(settings.settings).toMatchObject({ autoCompactEnabled: true, autoMemoryEnabled: false, fastMode: true })
    expect(settings).not.toHaveProperty('fastMode')
    expect(settings.forwardSubagentText).toBe(true)
  })

  async function runSkillDependencyHook(hookName: 'toolGuardHook' | 'skillDependencyAdvisoryHook') {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    const hook = settings.hooks?.PreToolUse?.[0]?.hooks.find((candidate) => candidate.name === hookName)
    return hook?.(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Skill',
        tool_input: { skill: 'parallel-web-search', args: 'latest React release' }
      } as never,
      'tool-use-1',
      {} as never
    )
  }

  it('denies a skill before forked execution when a declared dependency is provably absent', async () => {
    mocks.checkSkillRuntimeDependencies.mockResolvedValue({
      deny: 'Skill "parallel-web-search" cannot run: its forked subagent "parallel:parallel-subagent" is not installed.'
    })

    expect(await runSkillDependencyHook('toolGuardHook')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          'Skill "parallel-web-search" cannot run: its forked subagent "parallel:parallel-subagent" is not installed.'
      }
    })
  })

  it('lets an unresolved dependency through as context instead of a permission decision', async () => {
    mocks.checkSkillRuntimeDependencies.mockResolvedValue({
      warning: 'Skill "parallel-web-search" may be missing runtime dependencies.'
    })

    expect(await runSkillDependencyHook('skillDependencyAdvisoryHook')).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'Skill "parallel-web-search" may be missing runtime dependencies.'
      }
    })
  })

  it('appends root AGENTS.md context and wires lazy nested-instruction loading', async () => {
    mocks.loadAgentsMdInitialContext.mockResolvedValue('ROOT AGENTS INSTRUCTIONS')

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(mocks.createAgentsMdLoader).toHaveBeenCalledWith('/workspace/project')
    expect(systemPromptText(settings.systemPrompt)).toContain('ROOT AGENTS INSTRUCTIONS')
    expect(settings.hooks?.PreToolUse?.[0]?.hooks).toContain(mocks.agentsMdHook)
  })

  // The 400 this whole path exists to prevent: a turn is billed `input + max_tokens` against the
  // context limit, so the declared budget plus the pinned request must never exceed the window.
  it.each([
    ['1M window, cap restating it (deepseek-v4-pro)', 1_048_600, 1_048_600],
    ['1M window, real 393K cap (deepseek-v4-flash)', 1_048_576, 393_216],
    ['1M window, no declared cap', 1_048_576, undefined],
    ['256K window, 64K cap', 262_144, 64_000],
    ['128K window, cap at half the window', 128_000, 64_000],
    ['exactly at the Claude Code floor', 100_000, 8_192]
  ])('keeps the budget plus its pinned request inside the window (%s)', async (_l, contextWindow, maxOutputTokens) => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow, maxOutputTokens }
    )

    const budget = (settings.settings as { autoCompactWindow?: number }).autoCompactWindow ?? 0
    const pinned = Number(settings.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS)
    // The window is declared as itself; only the budget carries the reservation.
    expect(settings.env).toMatchObject({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextWindow) })
    expect(pinned).toBeGreaterThanOrEqual(8_192)
    // 33,000 is the CLI's own reserve, which moves the trigger below the declared budget.
    expect(budget - 33_000 + pinned).toBeLessThanOrEqual(contextWindow)
  })

  // #18318: the budget subtracted the model's declared cap whole, which for the 83 catalog entries
  // that restate their context window drove it to zero and floored a 1M model at 100K.
  it('does not collapse a 1M model to the compaction floor', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow: 1_048_600, maxOutputTokens: 1_048_600 }
    )

    expect((settings.settings as { autoCompactWindow?: number }).autoCompactWindow).toBeGreaterThan(800_000)
  })

  // The CLI has no table for third-party models, so without the pin they would request its generic
  // 32,000 however much the model actually supports.
  it('pins a third-party output cap the CLI cannot know', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow: 1_048_576, maxOutputTokens: 65_536 }
    )

    expect(settings.env).toMatchObject({ CLAUDE_CODE_MAX_OUTPUT_TOKENS: '65536' })
  })

  it('never pins above the ceiling the CLI would clamp to anyway', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow: 1_048_576, maxOutputTokens: 393_216 }
    )

    expect(settings.env).toMatchObject({ CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000' })
  })

  it('defaults the compaction trigger percentage and lets an agent env override win', async () => {
    // No context window declared — the percentage still applies.
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      {}
    )
    expect(settings.env).toMatchObject({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '80' })

    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      instructions: 'Follow instructions.',
      model: 'anthropic::claude-sonnet',
      planModel: 'anthropic::claude-sonnet',
      smallModel: 'anthropic::claude-haiku',
      mcps: [],
      allowedTools: [],
      configuration: { env_vars: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '60' } }
    })
    const overridden = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      {}
    )
    expect(overridden.env).toMatchObject({ CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '60' })
  })

  it('floors the budget at the Claude Code minimum instead of dropping the setting', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow: 128_000 }
    )

    // The declared 64,000 plus a floored budget would outrun the window, so the request is held to
    // the CLI default and the budget floors rather than being omitted.
    expect(settings.settings).toMatchObject({ autoCompactEnabled: true, autoCompactWindow: 100_000 })
    expect(settings.env).toMatchObject({
      CLAUDE_CODE_MAX_CONTEXT_TOKENS: '128000'
    })
  })

  it('clamps the auto-compact window above Claude Code limits without shrinking the declared window', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      // Wide enough that the budget would exceed the SDK's accepted maximum.
      { contextWindow: 2_000_000 }
    )

    expect((settings.settings as { autoCompactWindow?: number }).autoCompactWindow).toBe(1_000_000)
    expect(settings.env).toMatchObject({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: '2000000' })
  })

  it.each([undefined, 64_000, 99_999])(
    'omits a model context window below Claude Code limits (%s)',
    async (contextWindow) => {
      const settings = await buildClaudeCodeSessionSettings(
        {
          id: 'session-1',
          agentId: 'agent-1',
          workspace: { type: 'user', path: '/workspace/project' }
        } as never,
        {} as never,
        { contextWindow }
      )

      expect(settings.settings).toMatchObject({ autoCompactEnabled: true })
      expect(settings.settings).not.toHaveProperty('autoCompactWindow')
      expect(settings.env).not.toHaveProperty('CLAUDE_CODE_MAX_CONTEXT_TOKENS')
      // Without a budget there is nothing to reserve against, so the CLI keeps its own output default.
      expect(settings.env).not.toHaveProperty('CLAUDE_CODE_MAX_OUTPUT_TOKENS')
    }
  )

  // The SDK rejects a window outside 100K-1M, so both boundaries must land inside it.
  it.each([100_000, 1_000_000])('accepts the inclusive Claude Code boundary %i', async (contextWindow) => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow }
    )

    const budget = (settings.settings as { autoCompactWindow?: number }).autoCompactWindow
    expect(budget).toBeGreaterThanOrEqual(100_000)
    expect(budget).toBeLessThanOrEqual(1_000_000)
    // At the inclusive floor the window leaves no room above the budget; the request must stay
    // usable rather than collapse to a token.
    expect(settings.env).toMatchObject({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(contextWindow) })
  })

  // The CLI clamps `max_tokens` here, so pinning anything higher would reserve room no request can
  // consume — which is how a catalog cap that restates the window used to reach the budget.
  it('preserves an explicit maximum context window environment override', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      instructions: 'Follow instructions.',
      model: 'anthropic::claude-sonnet',
      planModel: 'anthropic::claude-sonnet',
      smallModel: 'anthropic::claude-haiku',
      mcps: [],
      allowedTools: [],
      configuration: { env_vars: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072' } }
    })

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { contextWindow: 256_000 }
    )

    // The explicit override wins for the env var; the budget still tracks the real window.
    expect(settings.env).toMatchObject({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: '131072' })
    expect((settings.settings as { autoCompactWindow?: number }).autoCompactWindow).toBeGreaterThan(131_072)
  })

  it('captures the selected model name for runtime context and falls back for direct callers', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      instructions: 'Follow instructions.',
      model: 'anthropic::claude-sonnet',
      modelName: 'Claude Sonnet',
      mcps: [],
      allowedTools: [],
      configuration: {
        runtime_context_enabled: true,
        runtime_context_prompt: 'Current time: {{time}}'
      }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never, {
      runtimeContextModelName: 'Pinned Claude Opus'
    })

    expect(settings.runtimeContext).toEqual({
      template: 'Current time: {{time}}',
      modelName: 'Pinned Claude Opus'
    })
    expect(settings.systemPrompt as string).not.toContain('Current time:')

    const directSettings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    expect(directSettings.runtimeContext?.modelName).toBe('Claude Sonnet')
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

    expect(mocks.createMcpBridgeServer).toHaveBeenCalledWith('mcp-1', materializedServer)
  })

  it('loads the user setting source so managed skills under CLAUDE_CONFIG_DIR can be discovered', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.settingSources).toEqual(['user', 'project', 'local'])
    expect(settings.settings).toMatchObject({ fastMode: false })
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
    mocks.listLocalSkillFolderNames.mockResolvedValue(['my-project-skill'])
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

  it('adds loopback bypass rules to the final Agent proxy environment', async () => {
    const proxyUrl = 'http://remote-proxy.example:7890'
    mocks.getProxyEnvironment.mockReturnValue({
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl
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
      configuration: { env_vars: { no_proxy: 'service.internal; LOCALHOST' } }
    })

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(settings.env).toMatchObject({
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      no_proxy: 'service.internal,LOCALHOST,127.0.0.1,::1,[::1]',
      NO_PROXY: 'service.internal,LOCALHOST,127.0.0.1,::1,[::1]'
    })
  })

  it('refreshes a cached Cherry proxy after the current proxy is disabled', async () => {
    const staleProxyUrl = 'http://stale-cherry-proxy.example:7890'
    mocks.getShellEnv.mockResolvedValue({
      CHERRY_STUDIO_NODE_PROXY_RULES: staleProxyUrl,
      CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: 'stale.internal',
      HTTP_PROXY: staleProxyUrl,
      HTTPS_PROXY: staleProxyUrl,
      http_proxy: staleProxyUrl,
      https_proxy: staleProxyUrl,
      ALL_PROXY: staleProxyUrl,
      all_proxy: staleProxyUrl,
      grpc_proxy: staleProxyUrl,
      NO_PROXY: 'stale.internal',
      no_proxy: 'stale.internal'
    })
    mocks.getProxyEnvironment.mockReturnValue({})

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(settings.env).not.toHaveProperty('CHERRY_STUDIO_NODE_PROXY_RULES')
    expect(settings.env).not.toHaveProperty('CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES')
    expect(settings.env).not.toHaveProperty('HTTP_PROXY')
    expect(settings.env).not.toHaveProperty('HTTPS_PROXY')
    expect(settings.env).not.toHaveProperty('NO_PROXY')
    expect(settings.env).not.toHaveProperty('no_proxy')
    expect(mocks.refreshShellEnv).toHaveBeenCalledOnce()
  })

  it('preserves an equal user-owned proxy value produced by the refreshed login shell', async () => {
    const proxyUrl = 'http://stale-cherry-proxy.example:7890'
    mocks.getShellEnv.mockResolvedValue({
      CHERRY_STUDIO_NODE_PROXY_RULES: proxyUrl,
      CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: 'stale.internal',
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      NO_PROXY: 'stale.internal'
    })
    mocks.refreshShellEnv.mockResolvedValue({
      HTTP_PROXY: proxyUrl,
      NO_PROXY: 'stale.internal'
    })
    mocks.getProxyEnvironment.mockReturnValue({})

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(settings.env).toMatchObject({
      HTTP_PROXY: proxyUrl,
      NO_PROXY: 'stale.internal,localhost,127.0.0.1,::1,[::1]',
      no_proxy: 'stale.internal,localhost,127.0.0.1,::1,[::1]'
    })
    expect(settings.env).not.toHaveProperty('HTTPS_PROXY')
    expect(settings.env).not.toHaveProperty('CHERRY_STUDIO_NODE_PROXY_RULES')
    expect(settings.env).not.toHaveProperty('CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES')
    expect(mocks.refreshShellEnv).toHaveBeenCalledOnce()
  })

  it('does not refresh when cached Cherry markers match the current proxy', async () => {
    const proxyUrl = 'http://current-cherry-proxy.example:7890'
    const currentProxyEnvironment = {
      CHERRY_STUDIO_NODE_PROXY_RULES: proxyUrl,
      CHERRY_STUDIO_NODE_PROXY_BYPASS_RULES: '',
      HTTP_PROXY: proxyUrl
    }
    mocks.getShellEnv.mockResolvedValue(currentProxyEnvironment)
    mocks.getProxyEnvironment.mockReturnValue(currentProxyEnvironment)

    await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(mocks.refreshShellEnv).not.toHaveBeenCalled()
  })

  it('denies a disabled tool via a PreToolUse hook so the gate fires in all permission modes', async () => {
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn((tool: string) => tool === 'Bash'),
      getPermissionMode: vi.fn(() => undefined),
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

  it('denies image Read calls before text-only model sessions can persist image tool results', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never,
      { supportsImages: false }
    )
    const hooks = settings.hooks?.PreToolUse?.[0]?.hooks ?? []
    const runHooks = (filePath: string) =>
      Promise.all(
        hooks.map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: filePath } } as never,
            'tool-use-1',
            {} as never
          )
        )
      )

    const imageRead = await runHooks('/workspace/project/assets/Preview.png')
    expect(imageRead).toContainEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: 'deny',
          permissionDecisionReason: expect.stringContaining('does not support image input')
        })
      })
    )

    const sourceRead = await runHooks('/workspace/project/src/Game.cs')
    expect(
      sourceRead.every(
        (out) =>
          (out as { hookSpecificOutput?: { permissionDecision?: string } })?.hookSpecificOutput?.permissionDecision !==
          'deny'
      )
    ).toBe(true)
  })

  it('blocks permanent deletion and destructive Bash for protected built-in Agents', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      configuration: { builtin_role: 'assistant', permission_mode: 'bypassPermissions' }
    })
    const assistantSettings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const hookOutputs = async (settings: typeof assistantSettings, toolName: string, toolInput: unknown) =>
      Promise.all(
        (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput } as never,
            'tool-use-1',
            {} as never
          )
        )
      )
    const denyReasonOf = async (settings: typeof assistantSettings, toolName: string, toolInput: unknown) => {
      const outputs = (await hookOutputs(settings, toolName, toolInput)) as Array<{
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string }
      }>
      return outputs.find((out) => out?.hookSpecificOutput?.permissionDecision === 'deny')?.hookSpecificOutput
        ?.permissionDecisionReason
    }

    for (const [toolName, toolInput] of [
      ['Bash', { command: 'rm -rf ./output' }],
      ['mcp__filesystem__delete', { path: 'output' }]
    ] as const) {
      await expect(denyReasonOf(assistantSettings, toolName, toolInput)).resolves.toContain(
        'mcp__assistant-files__move_to_trash'
      )
    }
    await expect(denyReasonOf(assistantSettings, 'Bash', { command: 'pnpm test' })).resolves.toBeUndefined()

    mocks.getAgent.mockReturnValue({
      id: 'support-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      configuration: { builtin_role: 'support', permission_mode: 'bypassPermissions' }
    })
    const supportSettings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-support',
        agentId: 'support-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    await expect(denyReasonOf(supportSettings, 'Bash', { command: 'rm -rf ./output' })).resolves.toContain(
      'must never permanently delete data'
    )

    mocks.getAgent.mockReturnValue({
      id: 'agent-2',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      configuration: { permission_mode: 'bypassPermissions' }
    })
    const normalSettings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-normal',
        agentId: 'agent-2',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    await expect(denyReasonOf(normalSettings, 'Bash', { command: 'rm -rf ./output' })).resolves.toBeUndefined()
  })

  it('gates Support and Assistant Bash per mode: ask interactively, lifted by bypassPermissions, denied headless', async () => {
    let interactionState = { currentTurn: 'interactive', userResponse: 'stream' }
    // The guard reads the LIVE permission mode from the session snapshot, so a warm connection
    // honors a mid-session mode switch; drive it through this mutable fn.
    let permissionMode: string | undefined = undefined
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      getPermissionMode: vi.fn(() => permissionMode),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') {
        return {
          listTools: mocks.listMcpTools,
          warmToolsCache: mocks.warmToolsCache,
          onToolsCacheUpdated: mocks.onToolsCacheUpdated
        }
      }
      if (name === 'AgentSessionRuntimeService') {
        return {
          getInteractionState: () => interactionState,
          recordToolExecutionTiming: mocks.recordToolExecutionTiming
        }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      configuration: { builtin_role: 'support', permission_mode: 'bypassPermissions' }
    })
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const hooks = settings.hooks?.PreToolUse?.[0]?.hooks ?? []
    const permissionDecisions = async (toolName: string, toolInput: Record<string, unknown>) =>
      Promise.all(
        hooks.map(async (hook) => {
          const output = await hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput } as never,
            'tool-use-1',
            {} as never
          )
          return (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
            ?.permissionDecision
        })
      )

    const directGhCommand = 'gh issue create --repo CherryHQ/cherry-studio --title "Bug" --body-file report.md'
    const bashCommands = [
      directGhCommand,
      `bash -lc 'gh issue create --repo CherryHQ/cherry-studio --title "Bug" --body-file report.md'`,
      'pnpm test'
    ]
    // Interactive default mode: every Support Bash call requires a live per-call decision.
    for (const command of bashCommands) {
      await expect(permissionDecisions('Bash', { command })).resolves.toContain('ask')
    }

    // bypassPermissions is the user's explicit opt-out of per-call approval: the ask disappears.
    // (Net behavior is unchanged — before the guard table, the hook's ask was auto-pierced by the
    // mode in canUseTool; now it is simply not raised.)
    permissionMode = 'bypassPermissions'
    for (const command of bashCommands) {
      await expect(permissionDecisions('Bash', { command })).resolves.not.toContain('ask')
    }

    // Headless denial is not an approval and survives bypassPermissions.
    interactionState = { currentTurn: 'headless', userResponse: 'unavailable' }
    for (const command of bashCommands) {
      await expect(permissionDecisions('Bash', { command })).resolves.toContain('deny')
    }
    permissionMode = undefined
    for (const command of bashCommands) {
      await expect(permissionDecisions('Bash', { command })).resolves.toContain('deny')
    }
    await expect(permissionDecisions('Write', { file_path: 'feedback.md', content: 'draft' })).resolves.not.toContain(
      'deny'
    )
    await expect(permissionDecisions('mcp__assistant__product_info', {})).resolves.not.toContain('deny')

    mocks.getAgent.mockReturnValue({
      id: 'assistant-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      configuration: { builtin_role: 'assistant', permission_mode: 'bypassPermissions' }
    })
    interactionState = { currentTurn: 'interactive', userResponse: 'stream' }
    const assistantSettings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-assistant',
        agentId: 'assistant-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const assistantHooks = assistantSettings.hooks?.PreToolUse?.[0]?.hooks ?? []
    const assistantDecisions = async (command: string) =>
      Promise.all(
        assistantHooks.map(async (hook) => {
          const output = await hook(
            { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } } as never,
            'tool-use-assistant',
            {} as never
          )
          return (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
            ?.permissionDecision
        })
      )

    // Assistant feedback submission: ask in default mode, lifted by bypass, denied headless.
    await expect(assistantDecisions(directGhCommand)).resolves.toContain('ask')
    await expect(assistantDecisions('pnpm test')).resolves.not.toContain('ask')
    permissionMode = 'bypassPermissions'
    await expect(assistantDecisions(directGhCommand)).resolves.not.toContain('ask')
    interactionState = { currentTurn: 'headless', userResponse: 'unavailable' }
    await expect(assistantDecisions(directGhCommand)).resolves.toContain('deny')
  })

  it('forces file-tool paths outside the session workspace through approval', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }
    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const hooks = settings.hooks?.PreToolUse?.[0]?.hooks ?? []
    const runHooks = (toolName: string, toolInput: Record<string, unknown>) =>
      Promise.all(
        hooks.map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput } as never,
            'tool-use-1',
            {} as never
          )
        )
      )
    const permissionDecisions = async (toolName: string, toolInput: Record<string, unknown>) =>
      (await runHooks(toolName, toolInput)).map(
        (output) =>
          (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision
      )

    for (const [toolName, toolInput] of [
      ['Read', { file_path: '/outside/read.txt' }],
      ['Write', { file_path: '/outside/write.txt' }],
      ['Edit', { file_path: '/outside/edit.txt' }],
      ['NotebookEdit', { notebook_path: '/outside/notebook.ipynb' }],
      ['Glob', { path: '/outside' }],
      ['Grep', { path: '../outside' }]
    ] as const) {
      await expect(permissionDecisions(toolName, toolInput)).resolves.toContain('ask')
    }

    await expect(permissionDecisions('Read', { file_path: '/workspace/project/src/index.ts' })).resolves.not.toContain(
      'ask'
    )
    await expect(permissionDecisions('Write', { file_path: 'output.html' })).resolves.not.toContain('ask')
    await expect(
      permissionDecisions('Read', { file_path: '/app/feature.agents.data/agent-1/SOUL.md' })
    ).resolves.not.toContain('ask')
    await expect(permissionDecisions('Glob', { path: '/workspace/project' })).resolves.not.toContain('ask')
    await expect(permissionDecisions('Glob', {})).resolves.not.toContain('ask')
    await expect(permissionDecisions('Bash', { command: 'cat /outside/read.txt' })).resolves.not.toContain('ask')
  })

  it('lifts the workspace-escape ask under bypassPermissions (net-equivalent: the mode auto-pierced it before)', async () => {
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      getPermissionMode: vi.fn(() => 'bypassPermissions'),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    const settings = await buildClaudeCodeSessionSettings(
      { id: 'session-1', agentId: 'agent-1', workspace: { type: 'user', path: '/workspace/project' } } as never,
      {} as never
    )
    const decisions = await Promise.all(
      (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map(async (hook) => {
        const output = await hook(
          { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/outside/edit.txt' } } as never,
          'tool-use-1',
          {} as never
        )
        return (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
          ?.permissionDecision
      })
    )
    expect(decisions).not.toContain('ask')
    expect(decisions).not.toContain('deny')
  })

  it.runIf(process.platform !== 'win32')(
    'does not reinterpret a workspace-relative path against the agent data directory',
    async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-path-hook-'))
      const workspacePath = path.join(tempRoot, 'workspace')
      const agentDataPath = path.join(tempRoot, 'agent-data')
      const outsidePath = path.join(tempRoot, 'outside')
      await Promise.all([
        mkdir(workspacePath),
        mkdir(path.join(agentDataPath, 'memory'), { recursive: true }),
        mkdir(outsidePath)
      ])
      await symlink(outsidePath, path.join(workspacePath, 'memory'))
      mocks.ensureAgentDataDirectory.mockResolvedValue(agentDataPath)

      try {
        const session = {
          id: 'session-1',
          agentId: 'agent-1',
          workspace: { type: 'user', path: workspacePath }
        }
        const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
        const hooks = settings.hooks?.PreToolUse?.[0]?.hooks ?? []
        const decisions = await Promise.all(
          hooks.map((hook) =>
            hook(
              {
                hook_event_name: 'PreToolUse',
                tool_name: 'Read',
                tool_input: { file_path: 'memory/passwd' }
              } as never,
              'tool-use-1',
              {} as never
            )
          )
        )

        expect(
          decisions.map(
            (output) =>
              (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
                ?.permissionDecision
          )
        ).toContain('ask')
      } finally {
        await rm(tempRoot, { recursive: true, force: true })
      }
    }
  )

  it('lifts ordinary approvals under bypassPermissions but preserves the delegation ceiling', async () => {
    let permissionMode: string | undefined = undefined
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      getPermissionMode: vi.fn(() => permissionMode),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      configuration: { builtin_role: 'assistant', permission_mode: 'bypassPermissions' }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const hooks = settings.hooks?.PreToolUse?.[0]?.hooks ?? []
    const permissionDecisions = async (toolName: string) =>
      Promise.all(
        hooks.map(async (hook) => {
          const output = await hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: {} } as never,
            'tool-use-1',
            {} as never
          )
          return (output as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput
            ?.permissionDecision
        })
      )

    expect(settings.permissionMode).toBe('bypassPermissions')
    const requiredTools = APPROVAL_REQUIRED_RUNTIME_NAMES
    // Default mode (live snapshot mode undefined): the explicit per-call approval list always asks.
    for (const toolName of requiredTools) {
      await expect(permissionDecisions(toolName)).resolves.toContain('ask')
    }
    // Full Access lifts ordinary per-call approval, but cross-Session delegation still asks.
    permissionMode = 'bypassPermissions'
    for (const toolName of BYPASSABLE_APPROVAL_REQUIRED_RUNTIME_NAMES) {
      await expect(permissionDecisions(toolName)).resolves.not.toContain('ask')
    }
    for (const toolName of NON_BYPASSABLE_APPROVAL_REQUIRED_RUNTIME_NAMES) {
      await expect(permissionDecisions(toolName)).resolves.toContain('ask')
    }
    permissionMode = undefined
    for (const toolName of ['Bash', 'mcp__assistant__navigate', 'mcp__assistant__product_info']) {
      await expect(permissionDecisions(toolName)).resolves.not.toContain('ask')
    }
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
    expect(settings.allowedTools).toEqual(
      expect.arrayContaining(['mcp__cherry-tools__cron', 'mcp__agent-memory__memory'])
    )
  })

  it('does not auto-approve disabled MCP tools', async () => {
    const disabledTools = ['mcp__cherry-tools__web_fetch', 'mcp__agent-memory__memory']
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools,
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.disallowedTools).toEqual(expect.arrayContaining(disabledTools))
    for (const toolName of disabledTools) expect(settings.allowedTools).not.toContain(toolName)
    expect(settings.allowedTools).toContain('mcp__cherry-tools__web_search')
  })

  it('appends web-only citation guidance to the system prompt by default', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    const systemPrompt = systemPromptText(settings.systemPrompt)
    expect(systemPrompt).toContain('## Citations')
    expect(systemPrompt).toContain('mcp__cherry-tools__web_search')
    expect(systemPrompt).not.toContain('mcp__cherry-tools__kb_search')
  })

  it('includes kb_search in citation guidance when the agent has bound knowledge bases', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      knowledgeBaseIds: ['kb-1'],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(systemPromptText(settings.systemPrompt)).toContain('mcp__cherry-tools__kb_search')
  })

  // The kb_* tools are exposed from the resolved scope, so an unbound Agent still gets them from the
  // frozen composer selection alone — the guidance has to follow, or those results never get cited.
  it('includes kb_search in citation guidance for a composer-only selection on an unbound Agent', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      knowledgeBaseIds: [],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never, {
      knowledgeBaseIds: ['kb-selected']
    })

    expect(systemPromptText(settings.systemPrompt)).toContain('mcp__cherry-tools__kb_search')
  })

  it('omits citation guidance when both web tools are disabled and no knowledge base is bound', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: ['mcp__cherry-tools__web_search', 'mcp__cherry-tools__web_fetch'],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(systemPromptText(settings.systemPrompt)).not.toContain('## Citations')
  })

  it('omits citation guidance when dependency propagation blocks every lookup tool', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      knowledgeBaseIds: ['kb-1'],
      disabledTools: ['mcp__cherry-tools__web_search', 'mcp__cherry-tools__web_fetch', 'mcp__cherry-tools__kb_search'],
      configuration: {}
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.disallowedTools).toEqual(expect.arrayContaining(['mcp__cherry-tools__kb_read']))
    expect(systemPromptText(settings.systemPrompt)).not.toContain('## Citations')
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
    const getInteractionState = vi.fn(() => ({ currentTurn: 'headless', userResponse: 'unavailable' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const toolsRequiringAResponder = [
      'AskUserQuestion',
      'EnterPlanMode',
      'ExitPlanMode',
      'EnterWorktree',
      ...NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES
    ]
    for (const toolName of toolsRequiringAResponder) {
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
    expect(getInteractionState).toHaveBeenCalledWith('session-1')
  })

  it('lifts the fire-time headless denial under bypassPermissions only for liftable approvals', async () => {
    const getInteractionState = vi.fn(() => ({ currentTurn: 'headless', userResponse: 'unavailable' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      getPermissionMode: vi.fn(() => 'bypassPermissions'),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const decide = (toolName: string) =>
      settings.canUseTool?.(toolName, {}, { signal: { aborted: false }, toolUseID: 'tool-use-1' } as never)

    const liftable = listBuiltinToolPolicies({
      approval: 'required',
      bypassApproval: 'lift',
      mountedServers: NON_HOST_MCP_SERVERS
    }).map(toMcpRuntimeName)
    for (const toolName of liftable) {
      await expect(decide(toolName)).resolves.toEqual({ behavior: 'allow', updatedInput: {} })
    }
    // The delegation ceiling and tools whose whole function is a user-authored answer still deny.
    for (const toolName of [...NON_BYPASSABLE_APPROVAL_REQUIRED_RUNTIME_NAMES, 'AskUserQuestion', 'EnterPlanMode']) {
      await expect(decide(toolName)).resolves.toEqual({
        behavior: 'deny',
        message:
          'This channel or scheduled turn has no interactive responder, so proceed without asking the user and state your assumptions instead.'
      })
    }
  })

  it('surfaces the normalized ExitPlanMode plan before denying a headless turn', async () => {
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') {
        return { getInteractionState: () => ({ currentTurn: 'headless', userResponse: 'unavailable' }) }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const emitInput = vi.fn()
    settings.approvalEmitter!.emitInput = emitInput
    const input = { plan: '# Release plan\n\n1. Add the regression test' }

    const result = await settings.canUseTool?.('ExitPlanMode', input, {
      signal: { aborted: false },
      toolUseID: 'exit-plan-1'
    } as never)

    expect(emitInput).toHaveBeenCalledWith({
      toolCallId: 'exit-plan-1',
      toolName: 'ExitPlanMode',
      input
    })
    expect(result).toEqual({
      behavior: 'deny',
      message:
        'This channel or scheduled turn has no interactive responder, so proceed without asking the user and state your assumptions instead.'
    })
  })

  it('surfaces the normalized ExitPlanMode plan before requesting interactive approval', async () => {
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const emitInput = vi.fn()
    const emit = vi.fn()
    settings.approvalEmitter!.emitInput = emitInput
    settings.approvalEmitter!.emit = emit
    const input = { plan: '# Release plan\n\n1. Add the regression test' }

    void settings.canUseTool?.('ExitPlanMode', input, {
      signal: { aborted: false },
      toolUseID: 'exit-plan-1'
    } as never)

    expect(emitInput).toHaveBeenCalledWith({
      toolCallId: 'exit-plan-1',
      toolName: 'ExitPlanMode',
      input
    })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'exit-plan-1', input }))
    expect(emitInput.mock.invocationCallOrder[0]).toBeLessThan(emit.mock.invocationCallOrder[0])
  })

  it('denies interactive no-responder tools via PreToolUse so the gate fires under bypassPermissions', async () => {
    // The SDK skips `canUseTool` for auto-approved paths (bypassPermissions / acceptEdits), so the
    // per-turn denial must also run as a PreToolUse hook (which fires in every permission mode) or a
    // headless bypass run could reach AskUserQuestion / EnterPlanMode and stall on a prompt no one answers.
    const getInteractionState = vi.fn(() => ({ currentTurn: 'headless', userResponse: 'unavailable' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
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
    for (const toolName of NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES) {
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
      expect(results).not.toContainEqual(
        expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'ask' }) })
      )
    }
    expect(getInteractionState).toHaveBeenCalledWith('session-1')
  })

  it('surfaces a headless ExitPlanMode plan from PreToolUse before bypassPermissions denies it', async () => {
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') {
        return { getInteractionState: () => ({ currentTurn: 'headless', userResponse: 'unavailable' }) }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const emitInput = vi.fn()
    settings.approvalEmitter!.emitInput = emitInput
    const input = { plan: '# Headless plan' }

    await Promise.all(
      (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
        hook(
          { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: input } as never,
          'exit-plan-hook-1',
          {} as never
        )
      )
    )

    expect(emitInput).toHaveBeenCalledWith({
      toolCallId: 'exit-plan-hook-1',
      toolName: 'ExitPlanMode',
      input
    })
  })

  it.each(['bypassPermissions', 'acceptEdits'] as const)(
    'surfaces an interactive ExitPlanMode plan from PreToolUse under %s',
    async (permissionMode) => {
      mocks.getAgent.mockReturnValue({
        id: 'agent-1',
        type: 'claude-code',
        instructions: 'Follow instructions.',
        model: 'anthropic::claude-sonnet',
        planModel: 'anthropic::claude-sonnet',
        smallModel: 'anthropic::claude-haiku',
        mcps: [],
        allowedTools: [],
        configuration: { permission_mode: permissionMode }
      })
      const settings = await buildClaudeCodeSessionSettings(
        {
          id: 'session-1',
          agentId: 'agent-1',
          workspace: { type: 'user', path: '/workspace/project' }
        } as never,
        {} as never
      )
      const emitInput = vi.fn()
      settings.approvalEmitter!.emitInput = emitInput
      const input = { plan: '# Interactive plan' }

      const results = await Promise.all(
        (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode', tool_input: input } as never,
            'exit-plan-hook-1',
            {} as never
          )
        )
      )

      expect(settings.permissionMode).toBe(permissionMode)
      expect(results).not.toContainEqual(
        expect.objectContaining({
          hookSpecificOutput: expect.objectContaining({ permissionDecision: expect.stringMatching(/ask|deny/) })
        })
      )
      expect(emitInput).toHaveBeenCalledTimes(1)
      expect(emitInput).toHaveBeenCalledWith({
        toolCallId: 'exit-plan-hook-1',
        toolName: 'ExitPlanMode',
        input
      })
    }
  )

  it('forces AskUserQuestion through approval without denying other interactive tools', async () => {
    const getInteractionState = vi.fn(() => ({ currentTurn: 'interactive', userResponse: 'stream' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
      throw new Error(`Unexpected application.get(${name})`)
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const runHooks = (toolName: string) =>
      Promise.all(
        (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
          hook(
            { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: {} } as never,
            'tool-use-1',
            {} as never
          )
        )
      )

    const askUserQuestionResults = await runHooks('AskUserQuestion')
    expect(askUserQuestionResults).toContainEqual(
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'ask' }) })
    )
    expect(askUserQuestionResults).not.toContainEqual(
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
    )

    const enterPlanModeResults = await runHooks('EnterPlanMode')
    expect(enterPlanModeResults).not.toContainEqual(
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({ permissionDecision: expect.stringMatching(/ask|deny/) })
      })
    )
  })

  it('denies mutating config actions via PreToolUse for the current headless turn', async () => {
    const getInteractionState = vi.fn(() => ({ currentTurn: 'headless', userResponse: 'unavailable' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
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

  it.each([
    { permissionMode: 'default', headless: false, shouldDeny: false },
    { permissionMode: 'acceptEdits', headless: false, shouldDeny: false },
    { permissionMode: 'auto', headless: false, shouldDeny: false },
    { permissionMode: 'bypassPermissions', headless: false, shouldDeny: false },
    { permissionMode: 'default', headless: true, shouldDeny: true },
    { permissionMode: 'acceptEdits', headless: true, shouldDeny: true },
    { permissionMode: 'auto', headless: true, shouldDeny: true },
    { permissionMode: 'bypassPermissions', headless: true, shouldDeny: false }
  ])(
    'applies SDK skill-install permission semantics ($permissionMode, headless=$headless)',
    async ({ permissionMode, headless, shouldDeny }) => {
      const getInteractionState = vi.fn(() => ({
        currentTurn: headless ? 'headless' : 'interactive',
        userResponse: headless ? 'unavailable' : 'stream'
      }))
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') return { getInteractionState }
        throw new Error(`Unexpected application.get(${name})`)
      })
      mocks.createToolPolicySnapshot.mockResolvedValue({
        resolve: vi.fn(),
        isDisabled: vi.fn(() => false),
        getPermissionMode: vi.fn(() => permissionMode),
        update: vi.fn(),
        setPermissionMode: vi.fn()
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
            {
              hook_event_name: 'PreToolUse',
              tool_name: 'mcp__skills__install_skill',
              tool_input: { install_source: 'claude-plugins:owner/repo/skills/example' }
            } as never,
            'tool-use-1',
            {} as never
          )
        )
      )
      const denial = expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' })
      })

      if (shouldDeny) {
        expect(results).toContainEqual(denial)
      } else {
        expect(results).not.toContainEqual(denial)
      }
    }
  )

  it('uses the live permission mode when a warm session switches to bypassPermissions', async () => {
    let permissionMode = 'default'
    const getInteractionState = vi.fn(() => ({ currentTurn: 'headless', userResponse: 'unavailable' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      getPermissionMode: vi.fn(() => permissionMode),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }
    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    permissionMode = 'bypassPermissions'
    const results = await Promise.all(
      (settings.hooks?.PreToolUse?.[0]?.hooks ?? []).map((hook) =>
        hook(
          {
            hook_event_name: 'PreToolUse',
            tool_name: 'mcp__skills__install_skill',
            tool_input: { install_source: 'claude-plugins:owner/repo/skills/example' }
          } as never,
          'tool-use-1',
          {} as never
        )
      )
    )

    expect(results).not.toContainEqual(
      expect.objectContaining({ hookSpecificOutput: expect.objectContaining({ permissionDecision: 'deny' }) })
    )
  })

  it('keeps AskUserQuestion pending when the current permission mode auto-approves tools', async () => {
    const getInteractionState = vi.fn(() => ({ currentTurn: 'interactive', userResponse: 'stream' }))
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
      if (name === 'AgentSessionRuntimeService') return { getInteractionState }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { permission_mode: 'bypassPermissions' }
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
    const emit = vi.fn()
    const input = {
      questions: [
        {
          question: 'Which logger should we use?',
          header: 'Logger',
          options: [{ label: 'Pino' }, { label: 'Winston' }],
          multiSelect: false
        }
      ]
    }
    settings.approvalEmitter!.emit = emit
    const pending = settings.canUseTool?.('AskUserQuestion', input, {
      signal: { aborted: false },
      toolUseID: 'tool-use-1'
    } as never)
    void pending

    expect(getInteractionState).toHaveBeenCalledWith('session-1')
    expect(settings.permissionMode).toBe('bypassPermissions')
    expect(mocks.approvalRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        toolCallId: 'tool-use-1',
        toolName: 'AskUserQuestion',
        originalInput: input
      })
    )
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tool-use-1',
        toolName: 'AskUserQuestion',
        input,
        presentation: 'stream',
        providerMetadata: { cherry: { transport: 'claude-agent', toolName: 'AskUserQuestion' } }
      })
    )
  })

  it('does not emit an approval request when registration settles synchronously', async () => {
    mocks.approvalRegister.mockReturnValueOnce(false)
    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'agent-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )
    const emit = vi.fn()
    settings.approvalEmitter!.emit = emit

    void settings.canUseTool?.('AskUserQuestion', { questions: [] }, {
      signal: { aborted: false },
      toolUseID: 'settled-tool-use'
    } as never)

    expect(mocks.approvalRegister).toHaveBeenCalledOnce()
    expect(emit).not.toHaveBeenCalled()
  })

  it('keeps AskUserQuestion available for channel-linked interactive sessions', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1', agentId: 'agent-1' })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.disallowedTools ?? []).not.toContain('AskUserQuestion')
  })

  it('does not disable normal interactive tools merely because the Agent is built in', async () => {
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
    expect(settings.disallowedTools ?? []).not.toEqual(
      expect.arrayContaining(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'EnterWorktree'])
    )
  })

  it('loads the private skill plugin for the built-in Assistant without restricting normal setting sources', async () => {
    mocks.getAgent.mockReturnValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'assistant' }
    })
    mocks.listSkills.mockResolvedValue([{ id: 'skill-1', folderName: 'system-skill', isEnabled: true }])
    mocks.getBuiltinAgentPluginDirectory.mockReturnValue('/app/feature.agents.builtin/cherry-assistant/.claude')
    mocks.loadBuiltinAgentDefinition.mockReturnValue({
      skills: ['cherry-assistant-guide', 'faq-collector']
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.settingSources).toEqual(['user', 'project', 'local'])
    expect(settings.plugins).toContainEqual({
      type: 'local',
      path: '/app/feature.agents.claude.root',
      skipMcpDiscovery: true
    })
    expect(settings.plugins).toContainEqual({
      type: 'local',
      path: '/app/feature.agents.builtin/cherry-assistant/.claude',
      skipMcpDiscovery: true
    })
    expect(settings.skills).toEqual(expect.arrayContaining(['system-skill', 'cherry-assistant-guide', 'faq-collector']))
    expect(settings.mcpServers?.skills).toBeDefined()
    expect(settings.allowedTools).toContain('mcp__skills__search_skills')
  })

  it('restricts Cherry Support to its bundled skills without marketplace access', async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), 'support-skill-source-'))
    const workspacePluginManifest = path.join(
      workspacePath,
      '.claude',
      'plugins',
      'same-name-skills',
      '.claude-plugin',
      'plugin.json'
    )
    await mkdir(path.dirname(workspacePluginManifest), { recursive: true })
    await writeFile(workspacePluginManifest, '{"name":"same-name-skills"}')
    mocks.getAgent.mockReturnValue({
      id: 'support-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'support' }
    })
    mocks.listSkills.mockResolvedValue([{ id: 'skill-1', folderName: 'issue-reporter', isEnabled: true }])
    mocks.listLocalSkillFolderNames.mockResolvedValue(['faq-collector'])
    mocks.loadBuiltinAgentDefinition.mockReturnValue({
      skills: ['cherry-assistant-guide', 'faq-collector', 'cherry-studio-feedback', 'issue-reporter']
    })
    mocks.getBuiltinAgentPluginDirectory.mockReturnValue('/app/feature.agents.builtin/cherry-assistant/.claude')
    const session = {
      id: 'session-1',
      agentId: 'support-1',
      workspace: { type: 'user', path: workspacePath }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    await rm(workspacePath, { recursive: true, force: true })

    expect(settings.skills).toEqual([
      'cherry-assistant-builtin:cherry-assistant-guide',
      'cherry-assistant-builtin:faq-collector',
      'cherry-assistant-builtin:cherry-studio-feedback',
      'cherry-assistant-builtin:issue-reporter'
    ])
    expect(settings.plugins).toEqual([
      {
        type: 'local',
        path: '/app/feature.agents.builtin/cherry-assistant/.claude',
        skipMcpDiscovery: true
      }
    ])
    expect(settings.settingSources).toEqual([])
    expect(mocks.listSkills).not.toHaveBeenCalled()
    expect(mocks.listLocalSkillFolderNames).not.toHaveBeenCalled()
    expect(settings.mcpServers?.skills).toBeUndefined()
    expect(settings.allowedTools).not.toContain('mcp__skills__search_skills')
    expect(mocks.createAssistantServer).toHaveBeenCalledWith('anthropic::claude-sonnet', [
      'navigate',
      'diagnose',
      'product_info',
      'apply_setting',
      'prepare_diagnostic_report'
    ])
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
    expect(settings.mcpServers?.['assistant-files']).toBeDefined()
    // Only read-only Assistant tools are pre-approved. Mutations and diagnose use per-call approval.
    expect(settings.allowedTools).toContain('mcp__assistant__navigate')
    expect(settings.allowedTools).toContain('mcp__assistant__product_info')
    expect(settings.allowedTools).toContain('mcp__assistant-files__read_file')
    expect(settings.allowedTools).not.toContain('mcp__assistant__apply_setting')
    expect(settings.allowedTools).not.toContain('mcp__assistant__create_agent')
    expect(settings.allowedTools).not.toContain('mcp__assistant__*')
    expect(settings.allowedTools).not.toContain('mcp__assistant__diagnose')
    expect(settings.allowedTools).not.toContain('mcp__assistant-files__save_attachment')
    expect(settings.allowedTools).not.toContain('mcp__assistant-files__move_to_trash')
    expect(settings.allowedTools).not.toContain('mcp__assistant-files__*')
    const snapshotOptions = mocks.createToolPolicySnapshot.mock.calls.at(-1)?.[1]
    expect(snapshotOptions.autoAllowRuntimeNames).toContain('mcp__assistant__navigate')
    expect(snapshotOptions.autoAllowRuntimeNames).toContain('mcp__assistant__product_info')
    expect(snapshotOptions.autoAllowRuntimeNames).not.toContain('mcp__assistant__apply_setting')
    expect(snapshotOptions.autoAllowRuntimeNames).not.toContain('mcp__assistant__create_agent')
    expect(snapshotOptions.autoAllowRuntimeNames).not.toContain('mcp__assistant__diagnose')
    expect(snapshotOptions.autoAllowRuntimeNameExceptions).toEqual(
      expect.arrayContaining(ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES)
    )
    expect(snapshotOptions.autoAllowRuntimeNamePrefixes ?? []).toEqual([])
    expect(mocks.createAssistantServer).toHaveBeenCalledWith('anthropic::claude-sonnet', undefined)
    expect(mocks.createAssistantFileToolsServer).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspacePath: '/workspace/project'
    })

    const cherryServer = (settings.mcpServers?.['cherry-tools'] as any)?.instance
    const handlers = cherryServer.server._requestHandlers
    const listed = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})
    expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['kb_search', 'kb_read', 'kb_list', 'kb_manage', 'cli_list', 'cli_search', 'cli_install'])
    )
    expect(systemPromptText(settings.systemPrompt)).toContain('mcp__cherry-tools__kb_search')
  })

  it('exposes CLI management tools to a normal Agent session', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const cherryServer = (settings.mcpServers?.['cherry-tools'] as any)?.instance
    const handlers = cherryServer.server._requestHandlers
    const listed = await handlers.get('tools/list')({ method: 'tools/list', params: {} }, {})

    expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['cli_list', 'cli_search', 'cli_install'])
    )
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
    expect(settings.mcpServers?.['assistant-files']).toBeDefined()
    expect(settings.allowedTools).toContain('mcp__assistant__navigate')
    expect(settings.allowedTools).toContain('mcp__assistant-files__read_file')
    expect(mocks.findBySessionId).not.toHaveBeenCalled()
  })

  it('uses one captured notification authority throughout async MCP materialization', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }
    const notificationContext = {
      sourceChannel: null,
      channels: [{ id: 'scheduled-channel', type: 'telegram' }],
      allowAnyOwnedChannel: false
    } as const

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never, {
      linkedChannelSnapshot: null,
      notificationContext
    })

    const cherryServer = (settings.mcpServers?.['cherry-tools'] as any)?.instance
    const listed = await cherryServer.server._requestHandlers.get('tools/list')(
      { method: 'tools/list', params: {} },
      {}
    )
    expect(listed.tools.map((tool: { name: string }) => tool.name)).toContain('notify')
    expect(mocks.getTurnTrustedNotifyChannels).not.toHaveBeenCalled()
  })

  it('excludes Assistant MCP capability for channel-linked sessions', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1', agentId: 'agent-1' })
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
    expect(settings.mcpServers?.['assistant-files']).toBeUndefined()
    expect(settings.allowedTools).not.toContain('mcp__assistant__navigate')
    expect(settings.allowedTools).not.toContain('mcp__assistant__product_info')
    expect(settings.allowedTools).not.toContain('mcp__assistant-files__read_file')
    const snapshotOptions = mocks.createToolPolicySnapshot.mock.calls.at(-1)?.[1]
    expect(snapshotOptions.autoAllowRuntimeNames).not.toContain('mcp__assistant__navigate')
  })

  it('keeps reusable Support tools mounted in channel sessions while denying unattended diagnostics and all-KB access', async () => {
    mocks.findBySessionId.mockReturnValue({ id: 'channel-1', sessionId: 'session-1', agentId: 'support-1' })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
      if (name === 'McpCatalogService') {
        return {
          listTools: mocks.listMcpTools,
          warmToolsCache: mocks.warmToolsCache,
          onToolsCacheUpdated: mocks.onToolsCacheUpdated
        }
      }
      if (name === 'AgentSessionRuntimeService') {
        return {
          getInteractionState: () => ({ currentTurn: 'headless', userResponse: 'unavailable' }),
          recordToolExecutionTiming: mocks.recordToolExecutionTiming
        }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.getAgent.mockReturnValue({
      id: 'support-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      knowledgeBaseIds: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { builtin_role: 'support' }
    })

    const settings = await buildClaudeCodeSessionSettings(
      {
        id: 'session-1',
        agentId: 'support-1',
        workspace: { type: 'user', path: '/workspace/project' }
      } as never,
      {} as never
    )

    expect(settings.mcpServers?.assistant).toBeDefined()
    expect(settings.mcpServers?.['assistant-files']).toBeDefined()
    expect(mocks.createAssistantServer).toHaveBeenCalledWith('anthropic::claude-sonnet', [
      'navigate',
      'diagnose',
      'product_info',
      'apply_setting',
      'prepare_diagnostic_report'
    ])
    expect(settings.allowedTools).toContain('mcp__assistant__product_info')
    expect(settings.allowedTools).not.toContain('mcp__assistant__diagnose')
    await expect(
      settings.canUseTool?.('mcp__assistant__diagnose', {}, {
        signal: { aborted: false },
        toolUseID: 'diagnose-1'
      } as never)
    ).resolves.toMatchObject({ behavior: 'deny' })
    await expect(
      settings.canUseTool?.('mcp__assistant__product_info', {}, {
        signal: { aborted: false },
        toolUseID: 'product-info-1'
      } as never)
    ).resolves.toMatchObject({ behavior: 'allow' })

    const cherryServer = (settings.mcpServers?.['cherry-tools'] as any)?.instance
    const listed = await cherryServer.server._requestHandlers.get('tools/list')(
      { method: 'tools/list', params: {} },
      {}
    )
    expect(listed.tools.map((tool: { name: string }) => tool.name)).not.toEqual(
      expect.arrayContaining(['kb_search', 'kb_read', 'kb_list', 'kb_manage'])
    )
  })

  it('does not inject a Cherry Assistant-only contract on every submitted prompt', async () => {
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
    expect(settings.hooks?.UserPromptSubmit).toBeUndefined()
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
    // toolGuardHook (the declarative guard table) + skillDependencyAdvisoryHook + agentsMdHook +
    // rtkRewriteHook + steerHook
    expect(preToolUse).toHaveLength(5)

    const steerHook = preToolUse?.find((hook) => hook.name === 'steerHook') as unknown as (input: {
      hook_event_name: string
    }) => Promise<{ continue?: boolean; hookSpecificOutput?: { additionalContext?: string } }>
    expect(steerHook).toBeDefined()

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

  it('keeps RTK as the only Bash text rewrite', async () => {
    mocks.rtkRewrite.mockResolvedValue('rtk eslint .')
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }
    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const rtkRewriteHook = settings.hooks?.PreToolUse?.[0]?.hooks?.find((hook) => hook.name === 'rtkRewriteHook')

    const output = await rtkRewriteHook?.(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'eslint .' } } as never,
      'tool-use-1',
      {} as never
    )

    expect(mocks.rtkRewrite).toHaveBeenCalledWith('eslint .')
    expect(output).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { command: 'rtk eslint .' }
      }
    })
  })

  it('keeps an empty-text steer pending when the PreToolUse hook cannot inject it', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const preToolUse = settings.hooks?.PreToolUse?.[0]?.hooks
    const steerHook = preToolUse?.find((hook) => hook.name === 'steerHook') as unknown as (input: {
      hook_event_name: string
    }) => Promise<{ continue?: boolean; hookSpecificOutput?: { additionalContext?: string } }>
    expect(steerHook).toBeDefined()
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

    // settingsBuilder must derive approval exceptions from policy entries and pass them to the
    // snapshot. The agentTools test proves those options gate kb_manage; this proves the adapter
    // actually supplies the derived boundary format.
    const exceptions = NON_ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES
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

  it('does not inject an environment snapshot into the built-in Assistant prompt', async () => {
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

    expect(systemPromptText(settings.systemPrompt)).not.toContain('## Current Environment')
    expect(systemPromptText(settings.systemPrompt)).not.toContain('proxy.example')
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
          getPermissionMode: vi.fn(() => undefined),
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
      expect(boundEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCallId: 'tu-1',
          toolName: 'SomeTool',
          presentation: 'stream'
        })
      )
    })

    it('disposeToolPolicySnapshot evicts the snapshot so the next build recreates it (dispose)', async () => {
      await buildClaudeCodeSessionSettings(sessionWith('warm-d'), {} as never)
      disposeToolPolicySnapshot('warm-d')
      await buildClaudeCodeSessionSettings(sessionWith('warm-d'), {} as never)
      expect(mocks.createToolPolicySnapshot).toHaveBeenCalledTimes(2)
    })

    it('still denies a main-agent approval requested after its turn ended', async () => {
      const getInteractionState = vi.fn(() => ({ currentTurn: 'interactive', userResponse: 'message' }))
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return { getInteractionState }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const settings = await buildClaudeCodeSessionSettings(sessionWith('warm-e'), {} as never)
      const emit = vi.fn()
      settings.approvalEmitter!.emit = emit

      const result = await settings.canUseTool!('SomeTool', {}, {
        signal: { aborted: false },
        toolUseID: 'tu-bg'
      } as never)

      expect(result).toEqual({
        behavior: 'deny',
        message:
          'This tool call arrived after its turn had already ended, so no one can approve it. Request it again in your next turn if you still need it.'
      })
      expect(getInteractionState).toHaveBeenCalledWith('warm-e')
      // Nothing was emitted or registered, so no promise is left for a responder that will never come.
      expect(emit).not.toHaveBeenCalled()
      expect(mocks.approvalRegister).not.toHaveBeenCalled()
    })

    it('auto-approves an ordinary background-agent request after the parent turn ended', async () => {
      const getInteractionState = vi.fn(() => ({ currentTurn: 'interactive', userResponse: 'message' }))
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return { getInteractionState }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const settings = await buildClaudeCodeSessionSettings(sessionWith('warm-bg-auto'), {} as never)

      await expect(
        settings.canUseTool!('Read', { file_path: '/outside/file' }, {
          signal: { aborted: false },
          toolUseID: 'tu-bg-auto',
          agentID: 'subagent-1'
        } as never)
      ).resolves.toEqual({ behavior: 'allow', updatedInput: { file_path: '/outside/file' } })
      expect(getInteractionState).toHaveBeenCalledWith('warm-bg-auto')
      expect(mocks.approvalRegister).not.toHaveBeenCalled()
    })

    it('auto-approves an ordinary background-agent request while the parent turn is still live', async () => {
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return {
            getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' })
          }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const settings = await buildClaudeCodeSessionSettings(sessionWith('warm-bg-live'), {} as never)

      await expect(
        settings.canUseTool!('Bash', { command: 'pwd' }, {
          signal: { aborted: false },
          toolUseID: 'tu-bg-live',
          agentID: 'subagent-1'
        } as never)
      ).resolves.toEqual({ behavior: 'allow', updatedInput: { command: 'pwd' } })
      expect(mocks.approvalRegister).not.toHaveBeenCalled()
    })

    it.each(['session_create', 'session_send'])(
      'requires live approval when a background agent calls %s',
      async (toolName) => {
        mocks.applicationGet.mockImplementation((name: string) => {
          if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
          if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
          if (name === 'AgentSessionRuntimeService') {
            return {
              getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' })
            }
          }
          throw new Error(`Unexpected application.get(${name})`)
        })
        const settings = await buildClaudeCodeSessionSettings(sessionWith('warm-bg-delegation'), {} as never)
        const emit = vi.fn()
        settings.approvalEmitter!.emit = emit

        void settings.canUseTool!(toCherryBuiltinRuntimeName(toolName), { target_session_id: 'target' }, {
          signal: { aborted: false },
          toolUseID: 'tu-bg-delegation',
          agentID: 'subagent-1'
        } as never)
        await Promise.resolve()

        expect(mocks.approvalRegister).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'warm-bg-delegation',
            toolCallId: 'tu-bg-delegation',
            presentation: 'message'
          })
        )
        expect(emit).toHaveBeenCalledWith(expect.objectContaining({ toolName: toCherryBuiltinRuntimeName(toolName) }))
      }
    )

    // A channel/scheduled turn has no approval UI, so an ordinary tool must not be denied for
    // lacking a responder — but an interactive turn on the same session must still prompt.
    it.each([
      ['headless', { behavior: 'allow', updatedInput: { command: 'pwd' } }, false],
      ['interactive', undefined, true]
    ] as const)('resolves an ordinary tool per turn kind: %s', async (currentTurn, expected, registers) => {
      const getInteractionState = vi.fn(() => ({
        currentTurn,
        userResponse: currentTurn === 'headless' ? 'unavailable' : 'stream'
      }))
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') return { getInteractionState }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const settings = await buildClaudeCodeSessionSettings(sessionWith(`warm-${currentTurn}`), {} as never)
      settings.approvalEmitter!.emit = vi.fn()

      const call = settings.canUseTool!('Bash', { command: 'pwd' }, {
        signal: { aborted: false },
        toolUseID: `tu-${currentTurn}`
      } as never)

      if (expected) await expect(call).resolves.toEqual(expected)
      expect(mocks.approvalRegister).toHaveBeenCalledTimes(registers ? 1 : 0)
    })

    it('emits an independent AskUserQuestion interaction for a background agent', () => {
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return {
            getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'message' })
          }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const input = {
        questions: [{ question: 'Choose a database', options: [{ label: 'SQLite' }], multiSelect: false }]
      }

      return buildClaudeCodeSessionSettings(sessionWith('warm-bg-question'), {} as never).then((settings) => {
        const emit = vi.fn()
        settings.approvalEmitter!.emit = emit
        void settings.canUseTool!('AskUserQuestion', input, {
          signal: { aborted: false },
          toolUseID: 'tu-bg-question',
          agentID: 'subagent-1'
        } as never)

        expect(mocks.approvalRegister).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'warm-bg-question',
            toolCallId: 'tu-bg-question',
            presentation: 'message'
          })
        )
        expect(emit).toHaveBeenCalledWith(
          expect.objectContaining({
            toolCallId: 'tu-bg-question',
            toolName: 'AskUserQuestion',
            input,
            presentation: 'message'
          })
        )
      })
    })

    it('emits an independent AskUserQuestion interaction for an interactive background wake', () => {
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return {
            getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'message' })
          }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const input = {
        questions: [{ question: 'Continue with the migration?', options: [{ label: 'Continue' }], multiSelect: false }]
      }

      return buildClaudeCodeSessionSettings(sessionWith('warm-wake-question'), {} as never).then((settings) => {
        const emit = vi.fn()
        settings.approvalEmitter!.emit = emit
        void settings.canUseTool!('AskUserQuestion', input, {
          signal: { aborted: false },
          toolUseID: 'tu-wake-question'
        } as never)

        expect(mocks.approvalRegister).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'warm-wake-question',
            toolCallId: 'tu-wake-question',
            presentation: 'message'
          })
        )
        expect(emit).toHaveBeenCalledWith(
          expect.objectContaining({
            toolCallId: 'tu-wake-question',
            toolName: 'AskUserQuestion',
            input,
            presentation: 'message'
          })
        )
      })
    })

    it('keeps a background AskUserQuestion independent from a concurrently live main turn', () => {
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return {
            getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' })
          }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      return buildClaudeCodeSessionSettings(sessionWith('warm-bg-live-question'), {} as never).then((settings) => {
        const emit = vi.fn()
        settings.approvalEmitter!.emit = emit

        void settings.canUseTool!('AskUserQuestion', { questions: [] }, {
          signal: { aborted: false },
          toolUseID: 'tu-bg-live-question',
          agentID: 'subagent-1'
        } as never)

        expect(emit).toHaveBeenCalledWith(
          expect.objectContaining({
            toolCallId: 'tu-bg-live-question',
            presentation: 'message'
          })
        )
      })
    })

    it('still auto-approves a background tool call after the turn ended (out-of-turn allow)', async () => {
      // The out-of-turn gate sits after the auto-approval branch, so unattended background work that
      // needs no prompt keeps running.
      mocks.createToolPolicySnapshot.mockResolvedValue({
        resolve: vi.fn(() => ({ approval: 'auto' })),
        isDisabled: vi.fn(() => false),
        update: vi.fn(),
        setPermissionMode: vi.fn()
      })
      mocks.applicationGet.mockImplementation((name: string) => {
        if (name === 'PreferenceService') return { get: vi.fn(() => undefined) }
        if (name === 'McpCatalogService') return { listTools: vi.fn(async () => []) }
        if (name === 'AgentSessionRuntimeService') {
          return {
            getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'message' })
          }
        }
        throw new Error(`Unexpected application.get(${name})`)
      })
      const settings = await buildClaudeCodeSessionSettings(sessionWith('warm-f'), {} as never)

      await expect(
        settings.canUseTool!('SomeTool', { a: 1 }, { signal: { aborted: false }, toolUseID: 'tu-bg2' } as never)
      ).resolves.toEqual({ behavior: 'allow', updatedInput: { a: 1 } })
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

    it('loads the private skill mirror as a local plugin only for external CLI sessions', async () => {
      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.plugins).toContainEqual({
        type: 'local',
        path: '/app/feature.agents.claude.root',
        skipMcpDiscovery: true
      })
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
      // The managed library is injected unconditionally, so it survives external-CLI stripping.
      expect(settings.env!.CHERRY_STUDIO_SKILLS_DIR).toBe('/app/feature.agents.skills')
    })

    it('falls back CLAUDE_CONFIG_DIR to ~/.claude when the shell does not set it', async () => {
      mocks.getShellEnv.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-shell' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env).not.toHaveProperty('ANTHROPIC_API_KEY')
      // application.getPath('sys.home') is mocked to '/app/sys.home'.
      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe(path.join('/app/sys.home', '.claude'))
    })

    it('falls back CLAUDE_CONFIG_DIR to ~/.claude when the shell exports it empty', async () => {
      // An empty CLAUDE_CONFIG_DIR must not pass through (it would point the SDK at /.credentials.json);
      // the fallback uses || so it matches CodeCliService's login probe rather than diverging from it.
      mocks.getShellEnv.mockResolvedValue({ CLAUDE_CONFIG_DIR: '' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe(path.join('/app/sys.home', '.claude'))
    })

    it('leaves CLAUDE_CONFIG_DIR unset on macOS so the Agent SDK can read the Keychain login', async () => {
      mocks.platform.isMac = true
      mocks.getShellEnv.mockResolvedValue({ CLAUDE_CONFIG_DIR: '/Users/me/.claude' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', authMethods: ['external-cli'] } as never
      )

      expect(settings.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
      // CLAUDE_CONFIG_DIR is dropped on macOS login, but the Cherry managed library stays injected.
      expect(settings.env!.CHERRY_STUDIO_SKILLS_DIR).toBe('/app/feature.agents.skills')
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
      expect(settings.plugins).toBeUndefined()
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

    it('does not start MCP warming when workspace validation fails', async () => {
      mocks.getPathStatus.mockResolvedValue({ ok: false, reason: 'missing' })
      const session = sessionWithMcps(['srv-a'])

      await expect(buildClaudeCodeSessionSettings(session as never, {} as never)).rejects.toThrow()

      expect(mocks.warmToolsCache).not.toHaveBeenCalled()
    })

    it('retries inaccessible workspace paths but fails missing paths and files permanently', async () => {
      mocks.getPathStatus.mockResolvedValueOnce({ ok: false, reason: 'inaccessible', code: 'EIO' })
      await expect(assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/project')).rejects.toMatchObject({
        retryable: true
      })

      mocks.getPathStatus.mockResolvedValueOnce({ ok: false, reason: 'inaccessible', code: 'EACCES' })
      await expect(assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/project')).rejects.toMatchObject({
        retryable: false
      })

      mocks.getPathStatus.mockResolvedValueOnce({ ok: false, reason: 'missing' })
      await expect(assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/project')).rejects.toMatchObject({
        retryable: false
      })

      mocks.getPathStatus.mockResolvedValueOnce({ ok: true, kind: 'file' })
      await expect(assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/project')).rejects.toMatchObject({
        retryable: false
      })
    })

    it.each([
      ['EIO', true],
      ['EACCES', false]
    ] as const)('classifies system-workspace %s failures by errno', async (code, retryable) => {
      mocks.ensureAgentStorageDirectory.mockRejectedValueOnce(Object.assign(new Error(code), { code }))

      await expect(
        prepareClaudeCodeWorkspaceDirectory({
          id: 'session-1',
          workspace: { type: 'system', path: '/app/feature.agents.system_workspaces/session-1' }
        } as never)
      ).rejects.toMatchObject({ retryable })
    })

    it('bounds a stalled workspace probe and classifies the timeout as retryable', async () => {
      vi.useFakeTimers()
      try {
        mocks.getPathStatus.mockReturnValueOnce(new Promise(() => undefined))
        const validation = assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/stalled')
        const assertion = expect(validation).rejects.toMatchObject({ retryable: true })

        await vi.advanceTimersByTimeAsync(5_001)

        await assertion
      } finally {
        vi.useRealTimers()
      }
    })

    it('shares one underlying path probe across repeated timeout windows', async () => {
      vi.useFakeTimers()
      try {
        let resolveProbe!: (status: { ok: true; kind: 'directory' }) => void
        mocks.getPathStatus.mockReturnValueOnce(
          new Promise((resolve) => {
            resolveProbe = resolve
          })
        )

        const first = assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/single-flight')
        const firstAssertion = expect(first).rejects.toMatchObject({ retryable: true })
        await vi.advanceTimersByTimeAsync(5_001)
        await firstAssertion

        const second = assertClaudeCodeWorkspaceDirectory('session-1', '/workspace/single-flight')
        expect(mocks.getPathStatus).toHaveBeenCalledOnce()
        resolveProbe({ ok: true, kind: 'directory' })

        await expect(second).resolves.toBeUndefined()
      } finally {
        vi.useRealTimers()
      }
    })

    it('overlaps MCP warming with independent environment construction', async () => {
      let resolveWarm!: () => void
      mocks.warmToolsCache.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveWarm = resolve
        })
      )
      const session = sessionWithMcps(['srv-a'])

      const build = buildClaudeCodeSessionSettings(session as never, {} as never)
      await vi.waitFor(() => {
        expect(mocks.warmToolsCache).toHaveBeenCalledOnce()
        expect(mocks.getShellEnv).toHaveBeenCalledOnce()
      })

      resolveWarm()
      await expect(build).resolves.toBeDefined()
    })

    it('does not stall the build when a server never responds (issue #16242 guard)', async () => {
      // A dead/slow server returns a never-resolving warm promise. The bounded race must let the
      // build finish; without the timeout race this build would hang forever.
      mocks.warmToolsCache.mockReturnValue(new Promise<never>(() => {}))
      const session = sessionWithMcps(['srv-dead'])

      vi.useFakeTimers()
      try {
        const build = buildClaudeCodeSessionSettings(session as never, {} as never)
        // Advance past the 100ms cache-hit window so the warm race resolves via timeout.
        await vi.advanceTimersByTimeAsync(100)
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
      // The refresh outlives the 100ms window; the cache-only listTools stays cold until it lands. Once it
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
          return {
            listTools: vi.fn(() => cachedTools),
            warmToolsCache: mocks.warmToolsCache,
            onToolsCacheUpdated: mocks.onToolsCacheUpdated
          }
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
        await vi.advanceTimersByTimeAsync(100)
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

    it('keeps the live policy snapshot and metadata aligned with later MCP tool-list changes', async () => {
      const snapshot = {
        resolve: vi.fn(),
        isDisabled: vi.fn(() => false),
        update: vi.fn(),
        setPermissionMode: vi.fn()
      }
      mocks.createToolPolicySnapshot.mockResolvedValue(snapshot)
      mocks.listMcpTools.mockReturnValue([{ id: 'old-tool', name: 'old_tool', description: 'Old' }])
      const session = sessionWithMcps(['srv-a'])

      const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
      expect(settings.mcpToolMetadata).toHaveProperty('mcp__srv-a__old_tool')
      registerMcpSessionCatalogSync('session-1', 'agent-1', ['srv-a'], settings.mcpToolMetadata)

      mocks.listMcpTools.mockReturnValue([{ id: 'new-tool', name: 'new_tool', description: 'New' }])
      const listener = mocks.onToolsCacheUpdated.mock.calls.at(-1)?.[0]
      listener?.({ serverId: 'srv-a' })

      await vi.waitFor(() => {
        expect(snapshot.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'agent-1' }))
        expect(settings.mcpToolMetadata).toHaveProperty('mcp__srv-a__new_tool')
      })
      expect(settings.mcpToolMetadata).not.toHaveProperty('mcp__srv-a__old_tool')
    })

    it('does not subscribe during a warm-only settings build', async () => {
      const session = sessionWithMcps(['srv-a'])

      await buildClaudeCodeSessionSettings(session as never, {} as never)

      expect(mocks.onToolsCacheUpdated).not.toHaveBeenCalled()
    })

    it('disposes the live MCP cache subscription with the session policy snapshot', async () => {
      const session = sessionWithMcps(['srv-a'])

      const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
      registerMcpSessionCatalogSync('session-1', 'agent-1', ['srv-a'], settings.mcpToolMetadata)
      disposeToolPolicySnapshot('session-1')

      expect(mocks.mcpSubscriptionDispose).toHaveBeenCalledOnce()
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
      expect(settings.mcpToolMetadata).toEqual({})
    })
  })
})
