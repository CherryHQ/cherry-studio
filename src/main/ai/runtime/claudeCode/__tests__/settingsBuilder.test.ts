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
      isDisabled: vi.fn(),
      update: vi.fn(),
      setPermissionMode: vi.fn()
    })
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
    expect(settings.settings).toMatchObject({ autoCompactEnabled: true })
  })

  it('denies a disabled tool via a PreToolUse hook so the gate fires in all permission modes', async () => {
    mocks.createToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn((tool: string) => tool === 'Bash')
    })
    const session = {
      id: 'session-1',
      agentId: 'agent-1',
      workspace: { type: 'user', path: '/workspace/project' }
    }

    const settings = await buildClaudeCodeSessionSettings(session as never, {} as never)

    const hooks = settings.hooks?.PreToolUse?.[0]?.hooks ?? []
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
})
