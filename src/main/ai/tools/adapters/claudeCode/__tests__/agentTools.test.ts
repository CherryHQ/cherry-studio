/**
 * disabledTools must take effect on a warm Claude Code connection. The driver pushes
 * `snapshot.update(agent)` on every agent change and the PreToolUse hook consults `snapshot.isDisabled`
 * per invocation — so a tool disabled mid-session is denied without rebuilding the connection.
 * isDisabled reuses the same `resolveDisallowedTools` derivation as the build-time SDK
 * `disallowedTools`, so the live gate and the fresh-connection block stay consistent.
 */

import {
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES,
  CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES,
  CHERRY_BUILTIN_MCP_SERVER,
  cherryBuiltinRuntimeName,
  KB_MANAGE_TOOL_NAME
} from '@shared/ai/builtinTools'
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

describe('createClaudeAgentToolPolicySnapshot — auto-allow prefix + approval exceptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listMcpTools }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.listMcpTools.mockResolvedValue([])
  })

  it('auto-approves an injected tool matching an auto-allow prefix', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), {
      autoAllowRuntimeNamePrefixes: ['mcp__cherry-tools__']
    })
    expect(snapshot.resolve('mcp__cherry-tools__kb_search')).toMatchObject({ approval: 'auto' })
  })

  it('requires approval for an excepted tool even though it matches the auto-allow prefix', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), {
      autoAllowRuntimeNamePrefixes: ['mcp__cherry-tools__'],
      autoAllowRuntimeNameExceptions: ['mcp__cherry-tools__kb_manage']
    })
    // kb_manage mutates the knowledge base — it must prompt, not auto-approve, despite the prefix.
    expect(snapshot.resolve('mcp__cherry-tools__kb_manage')).toMatchObject({ approval: 'prompt' })
    // A sibling read tool under the same prefix is still auto-approved.
    expect(snapshot.resolve('mcp__cherry-tools__kb_read')).toMatchObject({ approval: 'auto' })
  })
})

describe('createClaudeAgentToolPolicySnapshot — production approval-gate wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listMcpTools }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.listMcpTools.mockResolvedValue([])
  })

  // Drive the snapshot with the SAME values settingsBuilder.buildToolPermissions wires in production:
  // the cherry-tools auto-allow prefix plus the approval exceptions derived from the shared constant.
  // The literal-string tests above stay green even if these constants are emptied or .map() drifts;
  // these fail the moment the real gate stops carving the mutating tools out.
  const PREFIX = `mcp__${CHERRY_BUILTIN_MCP_SERVER}__`
  const productionOptions = {
    autoAllowRuntimeNamePrefixes: [PREFIX],
    autoAllowRuntimeNameExceptions: CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.map(cherryBuiltinRuntimeName)
  }

  it('keeps kb_manage approval-gated and the two policy sets disjoint', () => {
    // Catches the gate being undone: kb_manage dropped from approval-required, or added to
    // auto-approved, or the two sets overlapping. (It cannot catch a brand-new mutating tool added
    // only to auto-approved — nothing marks a tool as mutating — that is the human reviewer's job.)
    expect(CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES).toContain(KB_MANAGE_TOOL_NAME)
    expect(CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES).not.toContain(KB_MANAGE_TOOL_NAME)
    const autoApproved = new Set<string>(CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES)
    expect(CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.some((name) => autoApproved.has(name))).toBe(false)
    // The derived prefix matches the fully-qualified runtime name, pinning the two helpers in sync.
    expect(cherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME)).toBe(`${PREFIX}${KB_MANAGE_TOOL_NAME}`)
  })

  it('prompts for every approval-required tool and auto-approves every read tool under the real wiring', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), productionOptions)

    for (const name of CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES) {
      expect(snapshot.resolve(cherryBuiltinRuntimeName(name))).toMatchObject({ approval: 'prompt' })
    }
    for (const name of CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES) {
      expect(snapshot.resolve(cherryBuiltinRuntimeName(name))).toMatchObject({ approval: 'auto' })
    }
  })
})
