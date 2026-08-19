/**
 * disabledTools must take effect on a warm Claude Code connection. The driver pushes
 * `snapshot.update(agent)` on every agent change and the PreToolUse hook consults `snapshot.isDisabled`
 * per invocation — so a tool disabled mid-session is denied without rebuilding the connection.
 * isDisabled reuses the same `resolveDisallowedTools` derivation as the build-time SDK
 * `disallowedTools`, so the live gate and the fresh-connection block stay consistent.
 */

import { CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME } from '@main/ai/mcp/servers/cherryCliTools'
import {
  ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES,
  ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES,
  ASSISTANT_FILE_APPROVAL_REQUIRED_RUNTIME_NAMES,
  ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES,
  CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES,
  CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES,
  toCherryBuiltinRuntimeName
} from '@main/ai/runtime/toolApproval/cherryBuiltinApproval'
import { SESSION_CREATE_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { KB_MANAGE_TOOL_NAME, TO_MARKDOWN_TOOL_NAME } from '@shared/ai/builtinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMcpServer: vi.fn(),
  applicationGet: vi.fn(),
  listMcpTools: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { findByIdOrName: mocks.findMcpServer } }))

vi.mock('@application', () => ({ application: { get: mocks.applicationGet } }))

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
    mocks.findMcpServer.mockReturnValue({ id: 'mcp-1', name: 'server' })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listMcpTools }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.listMcpTools.mockReturnValue([])
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

  it('honors disabledTools for notify and config autonomy tools', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(
      makeAgent(['mcp__cherry_tools__notify__2484dc7ba152', 'mcp__cherry_tools__config__7ebbe6253854'])
    )
    expect(snapshot.isDisabled('mcp__cherry_tools__notify__2484dc7ba152')).toBe(true)
    expect(snapshot.isDisabled('mcp__cherry_tools__config__7ebbe6253854')).toBe(true)
    expect(snapshot.isDisabled('mcp__cherry_tools__cron__ceb5bf2c5e21')).toBe(false)
  })

  it('keeps prior MCP descriptors when a later server listing fails', async () => {
    mocks.listMcpTools.mockReturnValueOnce([{ name: 'search_docs', description: 'Search docs' }])
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))
    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({
      id: 'mcp__server__searchDocs',
      name: 'search_docs'
    })

    // A transient catalog failure must not drop the previously-known descriptor.
    mocks.listMcpTools.mockImplementationOnce(() => {
      throw new Error('catalog unavailable')
    })
    await snapshot.update(makeAgent([], ['mcp-1']))

    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({
      id: 'mcp__server__searchDocs',
      name: 'search_docs'
    })
  })

  it('resolves an MCP entry referenced by server name, not only by id', async () => {
    // `agent.mcps` may hold a server name; findByIdOrName resolves it where the old getById(id) threw.
    // The arg-sensitive mock (returns undefined for anything but the name) proves the name is passed through.
    mocks.findMcpServer.mockImplementation((idOrName: string) =>
      idOrName === 'server' ? { id: 'mcp-1', name: 'server' } : undefined
    )
    mocks.listMcpTools.mockReturnValueOnce([{ name: 'search_docs', description: 'Search docs' }])

    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['server']))

    expect(mocks.findMcpServer).toHaveBeenCalledWith('server')
    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({ name: 'search_docs' })
  })

  it('drops a server that becomes unknown on a later update instead of carrying it forward', async () => {
    mocks.listMcpTools.mockReturnValueOnce([{ name: 'search_docs', description: 'Search docs' }])
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))
    expect(snapshot.resolve('mcp__server__searchDocs')).toMatchObject({ name: 'search_docs' })

    // Server deleted → resolver returns undefined. Unlike a transient listTools failure, a genuinely
    // missing server must drop its descriptor, not resurrect it via the carry-forward path.
    mocks.findMcpServer.mockReturnValue(undefined)
    await snapshot.update(makeAgent([], ['mcp-1']))

    expect(snapshot.resolve('mcp__server__searchDocs')).toBeUndefined()
  })

  it('preserves prior descriptors of a name-referenced server on a transient failure', async () => {
    // agent.mcps holds the server NAME; failedMcpIds must be keyed by the resolved server.id so the
    // carry-forward (which matches against prior descriptors' sourceId = server.id) still fires.
    mocks.findMcpServer.mockImplementation((idOrName: string) =>
      idOrName === 'docs' ? { id: 'mcp-1', name: 'docs' } : undefined
    )
    mocks.listMcpTools.mockReturnValueOnce([{ name: 'search_docs', description: 'Search docs' }])
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['docs']))
    expect(snapshot.resolve('mcp__docs__searchDocs')).toMatchObject({ name: 'search_docs' })

    // Transient catalog failure on the same (name-referenced) server must not drop its descriptor.
    mocks.listMcpTools.mockImplementationOnce(() => {
      throw new Error('catalog unavailable')
    })
    await snapshot.update(makeAgent([], ['docs']))

    expect(snapshot.resolve('mcp__docs__searchDocs')).toMatchObject({ name: 'search_docs' })
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
    mocks.listMcpTools.mockReturnValue([])
  })

  it('auto-approves an injected tool matching an auto-allow prefix', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), {
      autoAllowRuntimeNamePrefixes: ['mcp__cherry_tools__']
    })
    expect(snapshot.resolve('mcp__cherry_tools__kbSearch__7fb1469c1b2d')).toMatchObject({ approval: 'auto' })
  })

  it('requires approval for an excepted tool even though it matches the auto-allow prefix', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), {
      autoAllowRuntimeNamePrefixes: ['mcp__cherry_tools__'],
      autoAllowRuntimeNameExceptions: ['mcp__cherry_tools__kbManage__d21480aca963']
    })
    // kb_manage mutates the knowledge base — it must prompt, not auto-approve, despite the prefix.
    expect(snapshot.resolve('mcp__cherry_tools__kbManage__d21480aca963')).toMatchObject({ approval: 'prompt' })
    // A sibling read tool under the same prefix is still auto-approved.
    expect(snapshot.resolve('mcp__cherry_tools__kbRead__01a3c9c066e6')).toMatchObject({ approval: 'auto' })
  })

  it('auto-approves the merged autonomy tools while kb_manage still prompts', async () => {
    // The former standalone `cherry` server's cron/notify/config now live under cherry-tools and
    // must stay auto-approved; the mutating kb_manage carve-out must survive the merge.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), {
      autoAllowRuntimeNamePrefixes: ['mcp__cherry_tools__'],
      autoAllowRuntimeNameExceptions: ['mcp__cherry_tools__kbManage__d21480aca963']
    })
    expect(snapshot.resolve('mcp__cherry_tools__cron__ceb5bf2c5e21')).toMatchObject({ approval: 'auto' })
    expect(snapshot.resolve('mcp__cherry_tools__notify__2484dc7ba152')).toMatchObject({ approval: 'auto' })
    expect(snapshot.resolve('mcp__cherry_tools__config__7ebbe6253854')).toMatchObject({ approval: 'auto' })
    expect(snapshot.resolve('mcp__cherry_tools__kbManage__d21480aca963')).toMatchObject({ approval: 'prompt' })
  })
})

describe('createClaudeAgentToolPolicySnapshot — production approval-gate wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'McpCatalogService') return { listTools: mocks.listMcpTools }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.listMcpTools.mockReturnValue([])
  })

  // Drive the snapshot with the SAME values settingsBuilder.buildToolPermissions wires in production:
  // the cherry-tools auto-allow prefix plus the approval exceptions derived from the shared constant.
  // The literal-string tests above stay green even if these constants are emptied or .map() drifts;
  // these fail the moment the real gate stops carving the mutating tools out.
  const productionOptions = {
    autoAllowRuntimeNames: CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES.map(toCherryBuiltinRuntimeName),
    autoAllowRuntimeNamePrefixes: [],
    autoAllowRuntimeNameExceptions: CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.map(toCherryBuiltinRuntimeName)
  }

  it('keeps kb_manage approval-gated and the two policy sets disjoint', () => {
    // Catches the gate being undone: kb_manage dropped from approval-required, or added to
    // auto-approved, or the two sets overlapping. (It cannot catch a brand-new mutating tool added
    // only to auto-approved — nothing marks a tool as mutating — that is the human reviewer's job.)
    expect(CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES).toContain(KB_MANAGE_TOOL_NAME)
    expect(CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES).toContain(CLI_INSTALL_TOOL_NAME)
    expect(CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES).toContain(SESSION_CREATE_TOOL_NAME)
    expect(CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES).toEqual(
      expect.arrayContaining([CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME, TO_MARKDOWN_TOOL_NAME])
    )
    expect(CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES).not.toContain(KB_MANAGE_TOOL_NAME)
    expect(CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES).not.toContain(SESSION_CREATE_TOOL_NAME)
    const autoApproved = new Set<string>(CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES)
    expect(CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES.some((name) => autoApproved.has(name))).toBe(false)
    // The derived prefix matches the fully-qualified runtime name, pinning the two helpers in sync.
    expect(toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME)).toBe('mcp__cherry_tools__kbManage__d21480aca963')
  })

  it('keeps Assistant read-only and sensitive tools in disjoint policy sets', () => {
    expect(ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES).toEqual([
      'mcp__assistant__navigate__78c92f559d6a',
      'mcp__assistant__productInfo__c0cfa9e1920f'
    ])
    expect(ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES).toEqual([
      'mcp__assistant__diagnose__7461c4bedfe3',
      'mcp__assistant__applySetting__b76773b19eee',
      'mcp__assistant__createAgent__2a307a1740c0'
    ])
    const autoApproved = new Set(ASSISTANT_AUTO_APPROVED_RUNTIME_NAMES)
    expect(ASSISTANT_APPROVAL_REQUIRED_RUNTIME_NAMES.some((name) => autoApproved.has(name))).toBe(false)

    expect(ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES).toEqual(['mcp__assistant_files__readFile__5d2275a68b0b'])
    expect(ASSISTANT_FILE_APPROVAL_REQUIRED_RUNTIME_NAMES).toEqual([
      'mcp__assistant_files__moveToTrash__b1ffadb33d56',
      'mcp__assistant_files__saveAttachment__310619340d60'
    ])
    const autoApprovedFiles = new Set(ASSISTANT_FILE_AUTO_APPROVED_RUNTIME_NAMES)
    expect(ASSISTANT_FILE_APPROVAL_REQUIRED_RUNTIME_NAMES.some((name) => autoApprovedFiles.has(name))).toBe(false)
  })

  it('prompts for every approval-required tool and auto-approves every allowlisted tool under the real wiring', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), productionOptions)

    for (const name of CHERRY_BUILTIN_APPROVAL_REQUIRED_TOOL_NAMES) {
      expect(snapshot.resolve(toCherryBuiltinRuntimeName(name))).toMatchObject({ approval: 'prompt' })
    }
    for (const name of CHERRY_BUILTIN_AUTO_APPROVED_TOOL_NAMES) {
      expect(snapshot.resolve(toCherryBuiltinRuntimeName(name))).toMatchObject({ approval: 'auto' })
    }
  })

  it('does not auto-approve future cherry-tools by prefix under the real wiring', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), productionOptions)

    expect(snapshot.resolve('mcp__cherry-tools__future_mutator')).toBeUndefined()
  })
})
