/**
 * disabledTools must take effect on a warm Claude Code connection. The driver pushes
 * `snapshot.update(agent)` on every agent change and the PreToolUse hook consults `snapshot.isDisabled`
 * per invocation. This asserts that live behavior at the snapshot layer.
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
    expect(snapshot.isDisabled('Read')).toBe(false)

    // Same snapshot path the driver runs on a live agent update.
    await snapshot.update(makeAgent(['Read']))
    expect(snapshot.isDisabled('Read')).toBe(true)

    // Re-enabling propagates live too.
    await snapshot.update(makeAgent([]))
    expect(snapshot.isDisabled('Read')).toBe(false)
  })

  it('does not flag tools the agent has not disabled', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['Read']))
    expect(snapshot.isDisabled('Bash')).toBe(false)
    expect(snapshot.isDisabled('Read')).toBe(true)
  })

  it('denies raw runtime names even when the catalog has no matching descriptor', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['mcp__docs__*']))

    expect(snapshot.isDisabled('mcp__docs__search_docs')).toBe(true)
    expect(snapshot.isDisabled('mcp__other__search_docs')).toBe(false)
  })

  it('keeps prior MCP descriptors when a later server listing fails', async () => {
    mocks.listMcpTools.mockResolvedValueOnce([{ name: 'search_docs', description: 'Search docs' }])
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))
    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({
      id: 'mcp__server__searchDocs',
      name: 'search_docs'
    })

    mocks.listMcpTools.mockRejectedValueOnce(new Error('catalog unavailable'))
    await snapshot.update(makeAgent(['mcp__server__*'], ['mcp-1']))

    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({
      id: 'mcp__server__searchDocs',
      name: 'search_docs'
    })
    expect(snapshot.isDisabled('mcp__server__searchDocs')).toBe(true)
  })

  it('keeps the newest policy when an older rebuild completes late', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([]))
    const firstCatalog = createDeferred<[]>()
    const secondCatalog = createDeferred<[]>()
    mocks.listMcpTools
      .mockImplementationOnce(() => firstCatalog.promise)
      .mockImplementationOnce(() => secondCatalog.promise)

    const olderUpdate = snapshot.update(makeAgent(['Read'], ['mcp-1']))
    const newerUpdate = snapshot.update(makeAgent([], ['mcp-1']))

    await vi.waitFor(() => expect(mocks.listMcpTools).toHaveBeenCalledTimes(2))
    secondCatalog.resolve([])
    await newerUpdate
    expect(snapshot.isDisabled('Read')).toBe(false)

    firstCatalog.resolve([])
    await olderUpdate
    expect(snapshot.isDisabled('Read')).toBe(false)
  })
})
