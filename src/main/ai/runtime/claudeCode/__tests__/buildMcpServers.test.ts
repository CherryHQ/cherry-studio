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

vi.mock('@main/utils/file', () => ({
  getPathStatus: mockGetPathStatus
}))

vi.mock('@main/i18n', () => ({
  getAppLanguage: vi.fn(() => 'en-US'),
  t: vi.fn((key: string, vars?: { path?: string }) => `${key}:${vars?.path ?? ''}`)
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { listChannels: vi.fn().mockResolvedValue([]) }
}))

const {
  AgentSessionWorkspaceError,
  adjustAllowedToolsForMcp,
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

describe('adjustAllowedToolsForMcp', () => {
  it('lists read-only cherry-tools + claw + agent-memory in Soul Mode, excluding the mutating kb_manage', () => {
    const allowed = adjustAllowedToolsForMcp(true, false)
    expect(allowed).toEqual(
      expect.arrayContaining([
        'mcp__cherry-tools__kb_search',
        'mcp__cherry-tools__kb_list',
        'mcp__claw__*',
        'mcp__agent-memory__*'
      ])
    )
    // The mutating kb_manage tool must NOT be pre-approved by the SDK allowlist — it requires
    // per-call approval via canUseTool. A bare wildcard would silently re-include it.
    expect(allowed).not.toContain('mcp__cherry-tools__kb_manage')
    expect(allowed).not.toContain('mcp__cherry-tools__*')
  })

  it('lists read-only cherry-tools + assistant for the Cherry Assistant, excluding kb_manage', () => {
    const allowed = adjustAllowedToolsForMcp(false, true)
    expect(allowed).toEqual(
      expect.arrayContaining(['mcp__cherry-tools__kb_search', 'mcp__cherry-tools__kb_list', 'mcp__assistant__*'])
    )
    expect(allowed).not.toContain('mcp__cherry-tools__kb_manage')
    expect(allowed).not.toContain('mcp__cherry-tools__*')
  })

  it('leaves the allowlist undefined for a plain agent (all tools permitted)', () => {
    expect(adjustAllowedToolsForMcp(false, false)).toBeUndefined()
  })
})

describe('buildMcpServers', () => {
  it('injects the agent-memory server in Soul Mode (REGRESSION agents-jobs-3)', async () => {
    const result = buildMcpServers(session, agent, true, false)
    expect(Object.keys(result ?? {})).toEqual(expect.arrayContaining(['claw', 'agent-memory']))
  })

  it('does not inject agent-memory when Soul Mode is off', async () => {
    const result = buildMcpServers(session, agent, false, false)
    expect(result?.['agent-memory']).toBeUndefined()
  })

  it('injects cherry-tools for every session and no longer injects exa', async () => {
    const result = buildMcpServers(session, agent, false, false)
    expect(result?.['cherry-tools']).toBeDefined()
    expect(result?.exa).toBeUndefined()
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
