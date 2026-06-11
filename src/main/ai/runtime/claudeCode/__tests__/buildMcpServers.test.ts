/**
 * Regression for agents-jobs-3: the CherryClaw prompt/bootstrap drive memory via
 * `mcp__agent-memory__memory`, so Soul Mode must actually inject the `agent-memory`
 * server into the runtime MCP list AND allow its tools — not just reference the name.
 */

import type * as NodeFs from 'node:fs'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPathStatus, mockMkdir, mockRealpath, mockGetPath } = vi.hoisted(() => ({
  mockGetPathStatus: vi.fn(),
  mockMkdir: vi.fn(),
  mockRealpath: vi.fn(),
  mockGetPath: vi.fn(() => '/tmp/managed-workspaces')
}))

const settingsMocks = vi.hoisted(() => ({
  mockGetAgent: vi.fn(),
  mockGetModelByKey: vi.fn(),
  mockReconcileAgentSkills: vi.fn(),
  mockGetLoginShellEnvironment: vi.fn(),
  mockGetBinaryPath: vi.fn(),
  mockAutoDiscoverGitBash: vi.fn(),
  mockGetProxyEnvironment: vi.fn(),
  mockCreateToolPolicySnapshot: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof NodeFs
  return {
    ...actual,
    default: actual,
    promises: {
      ...actual.promises,
      mkdir: mockMkdir,
      realpath: mockRealpath
    }
  }
})

vi.mock('@main/core/application', () => ({
  application: {
    get: vi.fn(),
    getPath: mockGetPath
  }
}))

vi.mock('@main/utils/file/pathStatus', () => ({
  getPathStatus: mockGetPathStatus
}))

vi.mock('@main/utils/language', () => ({
  getAppLanguage: vi.fn(() => 'en-US'),
  t: vi.fn((key: string, vars?: Record<string, string>) => `${key}:${Object.values(vars ?? {}).join(',')}`)
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: { getAgent: settingsMocks.mockGetAgent }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: settingsMocks.mockGetModelByKey }
}))

vi.mock('@main/ai/mcp/servers/cherryBuiltinTools', () => ({
  default: vi.fn(() => ({ mcpServer: { id: 'cherry-tools' } }))
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: {
    listChannels: vi.fn().mockResolvedValue([]),
    findBySessionId: vi.fn().mockResolvedValue(null)
  }
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: { reconcileAgentSkills: settingsMocks.mockReconcileAgentSkills }
}))

vi.mock('@main/utils/shell-env', () => ({
  default: settingsMocks.mockGetLoginShellEnvironment
}))

vi.mock('@main/utils/process', () => ({
  getBinaryPath: settingsMocks.mockGetBinaryPath,
  autoDiscoverGitBash: settingsMocks.mockAutoDiscoverGitBash
}))

vi.mock('@main/services/proxy/nodeProxy', () => ({
  getProxyEnvironment: settingsMocks.mockGetProxyEnvironment
}))

vi.mock('@main/ai/tools/adapters/claudeCode/agentTools', () => ({
  createClaudeAgentToolPolicySnapshot: settingsMocks.mockCreateToolPolicySnapshot
}))

const {
  AgentSessionWorkspaceError,
  buildClaudeCodeSessionSettings,
  buildInjectedMcpAllowedTools,
  assertClaudeCodeWorkspaceDirectory,
  buildMcpServers,
  formatNetworkProbeLine,
  prepareClaudeCodeWorkspaceDirectory
} = await import('../settingsBuilder')

const agent = { id: 'agent-1', mcps: [] } as unknown as AgentEntity
const session = {
  id: 'sess-1',
  agentId: 'agent-1',
  workspaceId: 'ws-1',
  workspace: {
    id: 'ws-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    type: 'user',
    orderKey: 'a0',
    createdAt: '2026-05-20T00:00:00.000Z',
    updatedAt: '2026-05-20T00:00:00.000Z'
  }
} as unknown as AgentSessionEntity

function makeSession(path: string, type: 'user' | 'system' = 'user'): AgentSessionEntity {
  return {
    id: 'sess-workspace',
    agentId: 'agent-1',
    workspaceId: 'ws-1',
    workspace: {
      id: 'ws-1',
      name: 'Workspace',
      path,
      type,
      orderKey: 'a0',
      createdAt: '2026-05-20T00:00:00.000Z',
      updatedAt: '2026-05-20T00:00:00.000Z'
    }
  } as unknown as AgentSessionEntity
}

describe('buildInjectedMcpAllowedTools', () => {
  it('adds the cherry-tools + claw + agent-memory wildcards in Soul Mode', () => {
    expect(buildInjectedMcpAllowedTools(true, false)).toEqual(
      expect.arrayContaining(['mcp__cherry-tools__*', 'mcp__claw__*', 'mcp__agent-memory__*'])
    )
  })

  it('adds the cherry-tools + assistant wildcards for the Cherry Assistant', () => {
    expect(buildInjectedMcpAllowedTools(false, true)).toEqual(
      expect.arrayContaining(['mcp__cherry-tools__*', 'mcp__assistant__*'])
    )
  })

  it('returns undefined when neither Soul nor Assistant injects tools', () => {
    expect(buildInjectedMcpAllowedTools(false, false)).toBeUndefined()
  })
})

describe('buildMcpServers', () => {
  it('injects the agent-memory server in Soul Mode (REGRESSION agents-jobs-3)', async () => {
    const result = await buildMcpServers(session, agent, true, false)
    expect(Object.keys(result ?? {})).toEqual(expect.arrayContaining(['claw', 'agent-memory']))
  })

  it('does not inject agent-memory when Soul Mode is off', async () => {
    const result = await buildMcpServers(session, agent, false, false)
    expect(result?.['agent-memory']).toBeUndefined()
  })

  it('injects cherry-tools for every session and no longer injects exa', async () => {
    const result = await buildMcpServers(session, agent, false, false)
    expect(result?.['cherry-tools']).toBeDefined()
    expect(result?.exa).toBeUndefined()
  })
})

describe('buildClaudeCodeSessionSettings tool permissions', () => {
  beforeEach(() => {
    mockGetPathStatus.mockReset()
    mockGetPathStatus.mockResolvedValue({ ok: true, kind: 'directory' })
    settingsMocks.mockGetAgent.mockReset()
    settingsMocks.mockGetModelByKey.mockReset()
    settingsMocks.mockReconcileAgentSkills.mockReset()
    settingsMocks.mockGetLoginShellEnvironment.mockReset()
    settingsMocks.mockGetBinaryPath.mockReset()
    settingsMocks.mockAutoDiscoverGitBash.mockReset()
    settingsMocks.mockGetProxyEnvironment.mockReset()
    settingsMocks.mockCreateToolPolicySnapshot.mockReset()

    settingsMocks.mockGetAgent.mockResolvedValue({
      ...agent,
      model: 'anthropic::claude-sonnet-4-5',
      disabledTools: ['Bash', 'Read'],
      configuration: {}
    })
    settingsMocks.mockGetModelByKey.mockResolvedValue({ apiModelId: 'claude-sonnet-4-5' })
    settingsMocks.mockReconcileAgentSkills.mockResolvedValue(undefined)
    settingsMocks.mockGetLoginShellEnvironment.mockResolvedValue({})
    settingsMocks.mockGetBinaryPath.mockResolvedValue('/usr/bin/bun')
    settingsMocks.mockAutoDiscoverGitBash.mockReturnValue(null)
    settingsMocks.mockGetProxyEnvironment.mockReturnValue({})
    settingsMocks.mockCreateToolPolicySnapshot.mockResolvedValue({ resolve: vi.fn(), isDisabled: vi.fn() })
  })

  it('passes agent disabledTools through to SDK disallowedTools', async () => {
    const settings = await buildClaudeCodeSessionSettings(session, {} as never)

    expect(settings.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Read']))
    expect(settings.allowedTools).toBeUndefined()
  })

  it('denies a disabled tool via a PreToolUse hook so the gate fires in all permission modes', async () => {
    settingsMocks.mockCreateToolPolicySnapshot.mockResolvedValue({
      resolve: vi.fn(),
      isDisabled: vi.fn((tool: string) => tool === 'Bash')
    })

    const settings = await buildClaudeCodeSessionSettings(session, {} as never)

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
      expect.objectContaining({
        hookSpecificOutput: expect.objectContaining({
          permissionDecision: 'deny',
          permissionDecisionReason: 'agent.session.tool.disabled:Bash'
        })
      })
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
})

describe('prepareClaudeCodeWorkspaceDirectory', () => {
  beforeEach(() => {
    mockGetPathStatus.mockReset()
    mockMkdir.mockReset()
    mockRealpath.mockReset()
    mockRealpath.mockImplementation(async (targetPath: string) => targetPath)
    mockGetPath.mockReturnValue('/tmp/managed-workspaces')
  })

  it('does not create a missing user workspace', async () => {
    mockGetPathStatus.mockResolvedValueOnce({ ok: false, reason: 'missing' })

    await expect(
      prepareClaudeCodeWorkspaceDirectory(makeSession('/tmp/user-workspace', 'user'))
    ).rejects.toBeInstanceOf(AgentSessionWorkspaceError)

    expect(mockMkdir).not.toHaveBeenCalled()
  })

  it('creates a missing system workspace before asserting it', async () => {
    const workspacePath = '/tmp/managed-workspaces/sess-workspace'
    mockGetPathStatus
      .mockResolvedValueOnce({ ok: false, reason: 'missing' })
      .mockResolvedValueOnce({ ok: true, kind: 'directory' })
    mockMkdir.mockResolvedValueOnce(undefined)

    await prepareClaudeCodeWorkspaceDirectory(makeSession(workspacePath, 'system'))

    expect(mockMkdir).toHaveBeenCalledWith(workspacePath, { recursive: true })
  })

  it('rejects system workspace paths outside the managed root', async () => {
    await expect(prepareClaudeCodeWorkspaceDirectory(makeSession('/tmp/outside', 'system'))).rejects.toBeInstanceOf(
      AgentSessionWorkspaceError
    )

    expect(mockGetPathStatus).not.toHaveBeenCalled()
    expect(mockMkdir).not.toHaveBeenCalled()
  })

  it('rejects system workspace symlinks that resolve outside the managed root', async () => {
    const workspacePath = '/tmp/managed-workspaces/sess-link'
    mockRealpath.mockImplementation(async (targetPath: string) => {
      if (targetPath === '/tmp/managed-workspaces') return '/tmp/managed-workspaces'
      if (targetPath === workspacePath) return '/tmp/outside-workspace'
      return targetPath
    })

    await expect(prepareClaudeCodeWorkspaceDirectory(makeSession(workspacePath, 'system'))).rejects.toBeInstanceOf(
      AgentSessionWorkspaceError
    )

    expect(mockGetPathStatus).not.toHaveBeenCalled()
    expect(mockMkdir).not.toHaveBeenCalled()
  })

  it('keeps assertClaudeCodeWorkspaceDirectory as pure validation', async () => {
    mockGetPathStatus.mockResolvedValueOnce({ ok: false, reason: 'missing' })

    await expect(assertClaudeCodeWorkspaceDirectory('sess-1', '/tmp/missing')).rejects.toBeInstanceOf(
      AgentSessionWorkspaceError
    )

    expect(mockMkdir).not.toHaveBeenCalled()
  })
})

// claude-code-driver-3: the probe line must not embed volatile latency, or the assistant
// systemPrompt (and thus the warm-query signature) differs every run and warm queries never reuse.
describe('formatNetworkProbeLine', () => {
  it('emits a stable reachable/unreachable line with no latency', () => {
    expect(formatNetworkProbeLine({ host: 'github.com', ok: true })).toBe('- github.com: reachable')
    expect(formatNetworkProbeLine({ host: 'github.com', ok: false })).toBe('- github.com: unreachable')
    // No digits/ms — the line is identical across probe runs regardless of measured latency.
    expect(formatNetworkProbeLine({ host: 'x', ok: true })).not.toMatch(/\d|ms/)
  })
})
