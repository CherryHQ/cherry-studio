/**
 * Regression for agents-jobs-3: the agent prompt/bootstrap drive memory via
 * `mcp__agent-memory__memory`, so every agent must actually get the `agent-memory`
 * server injected into the runtime MCP list AND allow its tools — not just reference the name.
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

vi.mock('@application', () => ({
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
  it('lists auto-approved cherry-tools + agent-memory for every agent, excluding the mutating kb_manage', () => {
    const allowed = adjustAllowedToolsForMcp(false)
    expect(allowed).toEqual(
      expect.arrayContaining([
        'mcp__cherry-tools__kb_search',
        'mcp__cherry-tools__kb_list',
        'mcp__cherry-tools__cron',
        'mcp__cherry-tools__notify',
        'mcp__cherry-tools__config',
        'mcp__agent-memory__*'
      ])
    )
    // The mutating kb_manage tool must NOT be pre-approved by the SDK allowlist — it requires
    // per-call approval via canUseTool. A bare wildcard would silently re-include it.
    expect(allowed).not.toContain('mcp__cherry-tools__kb_manage')
    expect(allowed).not.toContain('mcp__cherry-tools__*')
  })

  it('additionally lists only the navigate assistant tool for the Cherry Assistant', () => {
    const allowed = adjustAllowedToolsForMcp(true)
    expect(allowed).toEqual(
      expect.arrayContaining(['mcp__cherry-tools__kb_search', 'mcp__cherry-tools__kb_list', 'mcp__assistant__navigate'])
    )
    expect(allowed).not.toContain('mcp__cherry-tools__kb_manage')
    expect(allowed).not.toContain('mcp__cherry-tools__*')
    // diagnose reads local logs/source/config — it must go through per-call approval, so neither
    // the tool itself nor an assistant namespace wildcard may appear in the SDK pre-approval list.
    expect(allowed).not.toContain('mcp__assistant__diagnose')
    expect(allowed).not.toContain('mcp__assistant__*')
  })
})

describe('buildMcpServers', () => {
  it('injects the agent-memory server for every agent (REGRESSION agents-jobs-3)', async () => {
    const result = buildMcpServers(session, agent, false)
    expect(Object.keys(result ?? {})).toEqual(expect.arrayContaining(['cherry-tools', 'agent-memory']))
    expect(Object.keys(result ?? {})).not.toContain('skills')
  })

  it('injects cherry-tools for every session; the standalone cherry server and exa are gone', async () => {
    const result = buildMcpServers(session, agent, false)
    expect(result?.['cherry-tools']).toBeDefined()
    expect(result?.cherry).toBeUndefined()
    expect(result?.exa).toBeUndefined()
  })

  async function cherryToolNames(result: ReturnType<typeof buildMcpServers>): Promise<string[]> {
    if (!result) throw new Error('buildMcpServers returned no servers')
    const instance = (
      result['cherry-tools'] as unknown as {
        instance: {
          server: {
            _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<{ tools: Array<{ name: string }> }>>
          }
        }
      }
    ).instance
    const listHandler = instance.server._requestHandlers.get('tools/list')
    if (!listHandler) throw new Error('tools/list handler not registered')
    const listed = await listHandler({ method: 'tools/list', params: {} }, {})
    return listed.tools.map((tool) => tool.name)
  }

  it('hides the kb_* tools from cherry-tools when the agent has no bound knowledge base', async () => {
    const names = await cherryToolNames(buildMcpServers(session, agent, false))
    expect(names).toContain('web_search')
    expect(names).not.toContain('kb_search')
    expect(names).not.toContain('kb_manage')
  })

  it('exposes the kb_* tools from cherry-tools when the agent is bound to a knowledge base', async () => {
    const boundAgent = { id: 'agent-1', mcps: [], knowledgeBaseIds: ['kb_a'] } as unknown as AgentEntity
    const names = await cherryToolNames(buildMcpServers(session, boundAgent, false))
    expect(names).toEqual(expect.arrayContaining(['kb_search', 'kb_read', 'kb_list', 'kb_manage']))
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
