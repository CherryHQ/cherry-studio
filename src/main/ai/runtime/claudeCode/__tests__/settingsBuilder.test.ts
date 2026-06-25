import type * as NodeModule from 'node:module'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  reconcileAgentSkills: vi.fn(),
  modelGetByKey: vi.fn(),
  findBySessionId: vi.fn(),
  createToolPolicySnapshot: vi.fn(),
  listChannels: vi.fn(),
  applicationGet: vi.fn(),
  applicationGetPath: vi.fn(),
  getLoginShellEnvironment: vi.fn(),
  getBinaryPath: vi.fn(),
  getProxyEnvironment: vi.fn(),
  getPathStatus: vi.fn(),
  getAppLanguage: vi.fn(),
  resolveRequire: vi.fn(),
  loggerWarn: vi.fn(),
  platform: { isMac: false }
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
    findBySessionId: mocks.findBySessionId,
    listChannels: mocks.listChannels
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
  isWin: false,
  get isMac() {
    return mocks.platform.isMac
  }
}))

vi.mock('@main/services/proxy/proxyEnv', () => ({
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
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn(() => false),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
    mocks.listChannels.mockResolvedValue([])
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
    mocks.platform.isMac = false
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
    expect(settings.settings).toMatchObject({ autoCompactEnabled: true })
  })

  it('resolves the plan (sonnet) and small (haiku) model env keys from their own model ids', async () => {
    // Each of the three model lookups must resolve independently from its own key/provider.
    mocks.modelGetByKey.mockImplementation(async (providerId: string, modelId: string) => {
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
    mocks.modelGetByKey.mockImplementation(async (_providerId: string, modelId: string) => {
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
    mocks.getAgent.mockResolvedValue({
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
    expect(settings.allowedTools).toBeUndefined()
  })

  it('composes disallowedTools: globals + EnterWorktree (no .git cwd) + dedup, no AskUserQuestion for a plain agent', async () => {
    mocks.getAgent.mockResolvedValue({
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
    // A plain (non-assistant, non-soul) agent does not block AskUserQuestion.
    expect(disallowed).not.toContain('AskUserQuestion')
    // The `new Set` dedup holds — no entry appears twice even when registry + globals overlap.
    expect(new Set(disallowed).size).toBe(disallowed.length)
  })

  it('soul mode adds SOUL_MODE_DISALLOWED_TOOLS to disallowedTools', async () => {
    mocks.getAgent.mockResolvedValue({
      id: 'agent-1',
      type: 'claude-code',
      model: 'anthropic::claude-sonnet',
      mcps: [],
      allowedTools: [],
      disabledTools: [],
      configuration: { soul_enabled: true }
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const disallowed = settings.disallowedTools ?? []

    expect(disallowed).toEqual(
      expect.arrayContaining(['CronCreate', 'EnterPlanMode', 'AskUserQuestion', 'NotebookEdit'])
    )
    expect(new Set(disallowed).size).toBe(disallowed.length)
  })

  it('assistant role adds AskUserQuestion to disallowedTools', async () => {
    mocks.getAgent.mockResolvedValue({
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
    expect(settings.disallowedTools ?? []).toContain('AskUserQuestion')
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

  it('keeps an empty-text steer pending when the PreToolUse hook cannot inject it', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)
    const preToolUse = settings.hooks?.PreToolUse?.[0]?.hooks
    const steerHook = preToolUse![2] as unknown as (input: {
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

  it('warns and falls back to no channels when channel lookup fails during tool-policy build', async () => {
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }
    mocks.listChannels.mockRejectedValueOnce(new Error('channel db down'))

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    expect(settings.cwd).toBe('/workspace/project')
    expect(mocks.loggerWarn).toHaveBeenCalledWith('Failed to list channels for tool policy context', {
      agentId: 'agent-1',
      error: 'channel db down'
    })
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

    it('strips every inherited Anthropic credential channel and points CLAUDE_CONFIG_DIR at the shell config dir', async () => {
      mocks.getLoginShellEnvironment.mockResolvedValue({
        ANTHROPIC_API_KEY: 'sk-shell',
        ANTHROPIC_AUTH_TOKEN: 'tok-shell',
        ANTHROPIC_BASE_URL: 'https://shell.example',
        ANTHROPIC_CUSTOM_HEADERS: 'Authorization: Bearer sk-shell',
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth-shell',
        CLAUDE_CONFIG_DIR: '/home/me/.claude'
      })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', credentialSource: 'external-cli' } as never
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
      mocks.getLoginShellEnvironment.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-shell' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', credentialSource: 'external-cli' } as never
      )

      expect(settings.env).not.toHaveProperty('ANTHROPIC_API_KEY')
      // application.getPath('sys.home') is mocked to '/app/sys.home'.
      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe('/app/sys.home/.claude')
    })

    it('falls back CLAUDE_CONFIG_DIR to ~/.claude when the shell exports it empty', async () => {
      // An empty CLAUDE_CONFIG_DIR must not pass through (it would point the SDK at /.credentials.json);
      // the fallback uses || so it matches CodeCliService's login probe rather than diverging from it.
      mocks.getLoginShellEnvironment.mockResolvedValue({ CLAUDE_CONFIG_DIR: '' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', credentialSource: 'external-cli' } as never
      )

      expect(settings.env!.CLAUDE_CONFIG_DIR).toBe('/app/sys.home/.claude')
    })

    it('leaves CLAUDE_CONFIG_DIR unset on macOS so the Agent SDK can read the Keychain login', async () => {
      mocks.platform.isMac = true
      mocks.getLoginShellEnvironment.mockResolvedValue({ CLAUDE_CONFIG_DIR: '/Users/me/.claude' })

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        { id: 'claude-code', credentialSource: 'external-cli' } as never
      )

      expect(settings.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
    })

    it('blocks a user env_var override of CLAUDE_CODE_USE_VERTEX', async () => {
      // CLAUDE_CODE_USE_VERTEX is a runtime-forced routing flag, like CLAUDE_CODE_USE_BEDROCK;
      // user env_vars must not be able to flip it on.
      mocks.getLoginShellEnvironment.mockResolvedValue({})

      const settings = await buildClaudeCodeSessionSettings(
        session as never,
        {
          id: 'claude-code',
          configuration: { env_vars: { CLAUDE_CODE_USE_VERTEX: '1' } }
        } as never
      )

      expect(settings.env!.CLAUDE_CODE_USE_VERTEX).toBe('0')
    })

    it('leaves inherited Anthropic credentials intact for a non-login provider', async () => {
      mocks.getLoginShellEnvironment.mockResolvedValue({ ANTHROPIC_API_KEY: 'sk-shell' })

      const settings = await buildClaudeCodeSessionSettings(session as never, { id: 'anthropic' } as never)

      expect(settings.env!.ANTHROPIC_API_KEY).toBe('sk-shell')
    })
  })
})
