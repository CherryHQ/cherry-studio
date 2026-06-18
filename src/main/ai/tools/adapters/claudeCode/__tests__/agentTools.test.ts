/**
 * disabledTools must take effect on a warm Claude Code connection. The driver pushes
 * `snapshot.update(agent)` on every agent change and the PreToolUse hook consults `snapshot.isDisabled`
 * per invocation — so a tool disabled mid-session is denied without rebuilding the connection.
 * isDisabled reuses the same `resolveDisallowedTools` derivation as the build-time SDK
 * `disallowedTools`, so the live gate and the fresh-connection block stay consistent.
 */

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getMcpServerById: vi.fn(),
  applicationGet: vi.fn(),
  listMcpTools: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { getById: mocks.getMcpServerById } }))

vi.mock('@main/core/application', () => ({ application: { get: mocks.applicationGet } }))

const { createClaudeAgentToolPolicySnapshot } = await import('../agentTools')

function makeAgent(disabledTools: string[] = [], mcps: string[] = []): AgentEntity {
  return { id: 'agent-1', mcps, disabledTools, configuration: {} } as unknown as AgentEntity
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('createClaudeAgentToolPolicySnapshot — live disabledTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getMcpServerById.mockResolvedValue({ id: 'mcp-1', name: 'server' })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listMcpTools }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.listMcpTools.mockResolvedValue([])
  })

  it('reflects a disabledTools change after update() without a connection rebuild', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([]))
    expect(snapshot.isDisabled('Bash')).toBe(false)

    // Same code path the driver runs on a live agent update — no reconnect.
    await snapshot.update(makeAgent(['Bash']))
    expect(snapshot.isDisabled('Bash')).toBe(true)

    // Re-enabling propagates live too.
    await snapshot.update(makeAgent([]))
    expect(snapshot.isDisabled('Bash')).toBe(false)
  })

  it('does not flag tools the agent has not disabled', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['Bash']))
    expect(snapshot.isDisabled('Read')).toBe(false)
    expect(snapshot.isDisabled('Bash')).toBe(true)
  })

  it('keeps prior MCP descriptors when a later server listing fails', async () => {
    mocks.listMcpTools.mockResolvedValueOnce([{ name: 'search_docs', description: 'Search docs' }])
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))
    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({
      id: 'mcp__server__searchDocs',
      name: 'search_docs'
    })

    // A transient catalog failure must not drop the previously-known descriptor.
    mocks.listMcpTools.mockRejectedValueOnce(new Error('catalog unavailable'))
    await snapshot.update(makeAgent([], ['mcp-1']))

    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({
      id: 'mcp__server__searchDocs',
      name: 'search_docs'
    })
  })

  it('keeps the newest policy when an older rebuild completes late', async () => {
    // Construction runs one rebuild against the default (immediately-resolved) mock.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))
    const baselineCalls = mocks.listMcpTools.mock.calls.length

    const firstCatalog = createDeferred<[]>()
    const secondCatalog = createDeferred<[]>()
    mocks.listMcpTools
      .mockImplementationOnce(() => firstCatalog.promise)
      .mockImplementationOnce(() => secondCatalog.promise)

    // Older update disables Bash; newer update re-enables it. The newer one resolves FIRST.
    const olderUpdate = snapshot.update(makeAgent(['Bash'], ['mcp-1']))
    const newerUpdate = snapshot.update(makeAgent([], ['mcp-1']))

    await vi.waitFor(() => expect(mocks.listMcpTools).toHaveBeenCalledTimes(baselineCalls + 2))
    secondCatalog.resolve([])
    await newerUpdate
    expect(snapshot.isDisabled('Bash')).toBe(false)

    // The older (disabling) rebuild now completes late — the sequence guard must drop it so it can't
    // clobber the newer policy and re-disable Bash.
    firstCatalog.resolve([])
    await olderUpdate
    expect(snapshot.isDisabled('Bash')).toBe(false)
  })
})
