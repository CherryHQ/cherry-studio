/**
 * disabledTools must take effect on a warm Claude Code connection. The driver pushes
 * `snapshot.update(agent)` on every agent change and the PreToolUse hook consults `snapshot.isDisabled`
 * per invocation — so a tool disabled mid-session is denied without rebuilding the connection.
 * isDisabled reuses the same `resolveDisallowedTools` derivation as the build-time SDK
 * `disallowedTools`, so the live gate and the fresh-connection block stay consistent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CLI_INSTALL_TOOL_NAME, CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME } from '@main/ai/mcp/servers/cherryCliTools'
import {
  findBuiltinToolPolicy,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/toolApproval/builtinToolPolicy'
import { SESSION_CREATE_TOOL_NAME } from '@shared/ai/agentSessionDelivery'
import { KB_MANAGE_TOOL_NAME, TO_MARKDOWN_TOOL_NAME } from '@shared/ai/builtinTools'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

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
      makeAgent(['mcp__cherry-tools__notify', 'mcp__cherry-tools__config'])
    )
    expect(snapshot.isDisabled('mcp__cherry-tools__notify')).toBe(true)
    expect(snapshot.isDisabled('mcp__cherry-tools__config')).toBe(true)
    expect(snapshot.isDisabled('mcp__cherry-tools__cron')).toBe(false)
  })

  it('translates a legacy id-keyed denial onto the name-keyed runtime tool', async () => {
    // Saved while tools were keyed by server id; the runtime now keys tools by configured name.
    const serverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([`mcp__${serverId}__run`]), {
      serverNameById: new Map([[serverId, 'github']])
    })
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
    // An unrelated tool of the same server is not caught by the legacy rule.
    expect(snapshot.isDisabled('mcp__github__other')).toBe(false)
  })

  it('translates a legacy id-keyed denial onto a hyphenated configured key the SDK keeps verbatim', async () => {
    // The pinned SDK underscores only characters outside [A-Za-z0-9_-], so a hyphenated key
    // registers `mcp__my-tools__run` verbatim. Emitting the underscored form (`my_tools`) names
    // a tool the SDK never invokes and silently re-enables the disabled tool under Full Access.
    const serverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([`mcp__${serverId}__run`]), {
      serverNameById: new Map([[serverId, 'my-tools']])
    })
    expect(snapshot.isDisabled('mcp__my-tools__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__my_tools__run')).toBe(false)
  })

  it('keeps blocking a legacy denial after a live update renames the server to a space-bearing key', async () => {
    // Startup translation (settingsBuilder) and the live gate share translateLegacyMcpToolRules.
    // A rename during an active turn moves the key to `Docs MCP`, whose SDK identity is
    // `mcp__Docs_MCP__run`; the live rebuild must emit that form, not only the raw/camelized ones.
    const serverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([`mcp__${serverId}__run`]), {
      serverNameById: new Map([[serverId, 'docs']])
    })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    await snapshot.update(makeAgent([`mcp__${serverId}__run`]), {
      serverNameById: new Map([[serverId, 'Docs MCP']])
    })

    expect(snapshot.isDisabled('mcp__Docs_MCP__run')).toBe(true)
  })

  it('refreshes the server-key mapping on update so a renamed server keeps catching later denials', async () => {
    // Prewarm under `old`, the server is renamed to `new`, and the denial is added during an
    // active turn: the rebuild must translate against the CURRENT key mapping, or the live
    // guard blocks the pre-rename name while the executable tool answers to the new one.
    const serverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([]), {
      serverNameById: new Map([[serverId, 'old']])
    })

    await snapshot.update(makeAgent([`mcp__${serverId}__run`]), {
      serverNameById: new Map([[serverId, 'new']])
    })

    expect(snapshot.isDisabled('mcp__new__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__old__run')).toBe(false)
  })

  it('keeps preserved denials blocking until an update drops the preservation', async () => {
    // A rename migrates the saved rule onto the new identity while the replacement connection
    // is deferred: the ACTIVE connection still serves the old name, so the live gate must keep
    // blocking it. A post-rebuild update carries no preservation and releases the stale name.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['mcp__docs__run']))
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    await snapshot.update(makeAgent(['mcp__github__run']), { preserveDenied: ['mcp__docs__run'] })
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    await snapshot.update(makeAgent(['mcp__github__run']))
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(false)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
  })

  it('keeps retained denials through a same-connection catalog refresh', async () => {
    // A live MCP catalog cache update fires refreshMcpSessionCatalogState on the session while
    // the ACTIVE connection still serves the old identity (its replacement is deferred): that
    // refresh must keep the retained set untouched — merging nothing, releasing nothing. Only
    // the replacement connection's refresh (an update with neither option) releases it.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['mcp__docs__run']))
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    await snapshot.update(makeAgent(['mcp__github__run']), { preserveDenied: ['mcp__docs__run'] })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    await snapshot.update(makeAgent(['mcp__github__run']), { keepRetainedDenied: true })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
  })

  it('carries the effective denials through a refresh that lands before the reconciliation', async () => {
    // `docs/run` is disabled mid-turn, then the server is renamed before the driver's
    // reconciliation submits its preserveDenied baseline: the catalog refresh lands first and
    // the ACTIVE connection still exposes `docs/run` until its replacement rebuilds. The
    // refresh must carry the previously-effective denial forward itself — submission order
    // must not open an unblocked window on the live connection.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['mcp__docs__run']))
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    // The rename migrates the saved rule; the catalog refresh arrives with the migrated agent.
    await snapshot.update(makeAgent(['mcp__github__run']), { keepRetainedDenied: true })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)

    // The replacement connection's refresh releases the old identity.
    await snapshot.update(makeAgent(['mcp__github__run']))
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(false)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
  })

  it('accumulates preserved denials across successive deferred-rebuild updates', async () => {
    // A rename reconcile preserves `mcp__docs__run` once, but the driver's baseline then moves
    // to the migrated rules — a second policy update before the rebuild can only pass that
    // newer baseline. The snapshot must accumulate the preservation internally, or the old
    // connection (still exposing `docs/run`) drops the denial and the tool executes under
    // bypassPermissions. The replacement connection's update carries no preservation and
    // releases everything.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(['mcp__docs__run']))
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    // Rename reconciliation: the driver passes the pre-rename baseline.
    await snapshot.update(makeAgent(['mcp__github__run']), { preserveDenied: ['mcp__docs__run'] })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    // A second tool is disabled before the deferred rebuild lands: the driver can only pass
    // the migrated baseline, which no longer names `docs/run`.
    await snapshot.update(makeAgent(['mcp__github__run', 'mcp__github__other']), {
      preserveDenied: ['mcp__github__run', 'mcp__github__other']
    })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__github__other')).toBe(true)

    // Connect of the replacement connection refreshes without preservation — release.
    await snapshot.update(makeAgent(['mcp__github__run', 'mcp__github__other']), { serverNameById: new Map() })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(false)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__github__other')).toBe(true)
  })

  it('applies a post-rename denial to the active connection as well as the desired allocation', async () => {
    // Full Access turn under `docs`; the server is renamed to `github` and the tool is disabled
    // AFTER the rename but BEFORE the deferred rebuild. The driver's preservation baseline moved
    // to the migrated rules and is empty, so the snapshot must translate the new-form denial back
    // onto the connect-time keys (`baselineServerNameById`) that the ACTIVE connection still serves.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([]), {
      serverNameById: new Map([['mcp-1', 'docs']])
    })

    await snapshot.update(makeAgent(['mcp__github__run']), {
      serverNameById: new Map([['mcp-1', 'github']]),
      baselineServerNameById: new Map([['mcp-1', 'docs']]),
      preserveDenied: []
    })
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)

    // The replacement connection's connect refresh carries no baseline — release.
    await snapshot.update(makeAgent(['mcp__github__run']), { serverNameById: new Map([['mcp-1', 'github']]) })
    expect(snapshot.isDisabled('mcp__docs__run')).toBe(false)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
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

  it('applies overlapping updates in submission order so the newest policy wins', async () => {
    // Construction runs one rebuild against the default (immediately-resolved) mock.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))
    const baselineCalls = mocks.listMcpTools.mock.calls.length

    const firstCatalog = createDeferred<[]>()
    const secondCatalog = createDeferred<[]>()
    mocks.listMcpTools
      .mockImplementationOnce(() => firstCatalog.promise)
      .mockImplementationOnce(() => secondCatalog.promise)

    // Older update disables Bash; newer update re-enables it. Updates serialize: the newer
    // rebuild starts only after the older one completes, so the final policy is the newest
    // update and a slow older rebuild can never clobber it.
    const olderUpdate = snapshot.update(makeAgent(['Bash'], ['mcp-1']))
    const newerUpdate = snapshot.update(makeAgent([], ['mcp-1']))

    firstCatalog.resolve([])
    await vi.waitFor(() => expect(mocks.listMcpTools).toHaveBeenCalledTimes(baselineCalls + 2))
    secondCatalog.resolve([])
    await Promise.all([olderUpdate, newerUpdate])
    expect(snapshot.isDisabled('Bash')).toBe(false)
  })

  it('lands a preserved-denial update that overlaps a same-connection catalog refresh', async () => {
    // A rename reconcile retains the old identity (the active connection still serves it while
    // its replacement is deferred). A live catalog refresh fires while that rebuild is still
    // awaiting its catalog: serialization must let the reconcile land its retention BEFORE the
    // refresh runs, or the refresh drops the retained denial and the still-mounted pre-rename
    // tool becomes executable under Full Access.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([], ['mcp-1']))

    const renameCatalog = createDeferred<[]>()
    const refreshCatalog = createDeferred<[]>()
    mocks.listMcpTools
      .mockImplementationOnce(() => renameCatalog.promise)
      .mockImplementationOnce(() => refreshCatalog.promise)

    const renameReconcile = snapshot.update(makeAgent(['mcp__github__run'], ['mcp-1']), {
      preserveDenied: ['mcp__docs__run']
    })
    const catalogRefresh = snapshot.update(makeAgent(['mcp__github__run'], ['mcp-1']), {
      keepRetainedDenied: true
    })

    renameCatalog.resolve([])
    refreshCatalog.resolve([])
    await Promise.all([renameReconcile, catalogRefresh])

    expect(snapshot.isDisabled('mcp__docs__run')).toBe(true)
    expect(snapshot.isDisabled('mcp__github__run')).toBe(true)
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

  it('auto-approves the merged autonomy tools while kb_manage still prompts', async () => {
    // The former standalone `cherry` server's cron/notify/config now live under cherry-tools and
    // must stay auto-approved; the mutating kb_manage carve-out must survive the merge.
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), {
      autoAllowRuntimeNamePrefixes: ['mcp__cherry-tools__'],
      autoAllowRuntimeNameExceptions: ['mcp__cherry-tools__kb_manage']
    })
    expect(snapshot.resolve('mcp__cherry-tools__cron')).toMatchObject({ approval: 'auto' })
    expect(snapshot.resolve('mcp__cherry-tools__notify')).toMatchObject({ approval: 'auto' })
    expect(snapshot.resolve('mcp__cherry-tools__config')).toMatchObject({ approval: 'auto' })
    expect(snapshot.resolve('mcp__cherry-tools__kb_manage')).toMatchObject({ approval: 'prompt' })
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

  const CHERRY_ONLY_SERVERS: ReadonlySet<string> = new Set(['cherry-tools'])
  const HOST_SERVERS: ReadonlySet<string> = new Set(['assistant', 'assistant-files'])
  // Drive the snapshot with the same derived values settingsBuilder supplies in production.
  const cherryPolicies = listBuiltinToolPolicies({ mountedServers: CHERRY_ONLY_SERVERS }).filter(
    (entry) => entry.serverName === 'cherry-tools'
  )
  const autoApprovedRuntimeNames = cherryPolicies.filter((entry) => entry.approval === 'auto').map(toMcpRuntimeName)
  const approvalRequiredRuntimeNames = cherryPolicies.filter((entry) => entry.approval !== 'auto').map(toMcpRuntimeName)
  const productionOptions = {
    autoAllowRuntimeNames: autoApprovedRuntimeNames,
    autoAllowRuntimeNamePrefixes: [],
    autoAllowRuntimeNameExceptions: approvalRequiredRuntimeNames
  }

  it('keeps mutating and read-only Cherry tools classified on their own entries', () => {
    expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(KB_MANAGE_TOOL_NAME), CHERRY_ONLY_SERVERS)?.approval).toBe(
      'required'
    )
    expect(
      findBuiltinToolPolicy(toCherryBuiltinRuntimeName(CLI_INSTALL_TOOL_NAME), CHERRY_ONLY_SERVERS)?.approval
    ).toBe('required')
    expect(
      findBuiltinToolPolicy(toCherryBuiltinRuntimeName(SESSION_CREATE_TOOL_NAME), CHERRY_ONLY_SERVERS)
    ).toMatchObject({
      approval: 'delegation'
    })
    for (const name of [CLI_LIST_TOOL_NAME, CLI_SEARCH_TOOL_NAME, TO_MARKDOWN_TOOL_NAME]) {
      expect(findBuiltinToolPolicy(toCherryBuiltinRuntimeName(name), CHERRY_ONLY_SERVERS)?.approval).toBe('auto')
    }
  })

  it('keeps Assistant read-only and sensitive tools classified on their own entries', () => {
    expect(findBuiltinToolPolicy('mcp__assistant__navigate', HOST_SERVERS)?.approval).toBe('auto')
    expect(findBuiltinToolPolicy('mcp__assistant__product_info', HOST_SERVERS)?.approval).toBe('auto')
    expect(findBuiltinToolPolicy('mcp__assistant__diagnose', HOST_SERVERS)?.approval).toBe('required')
    expect(findBuiltinToolPolicy('mcp__assistant__apply_setting', HOST_SERVERS)?.approval).toBe('required')
    expect(findBuiltinToolPolicy('mcp__assistant__create_agent', HOST_SERVERS)?.approval).toBe('required')
    expect(findBuiltinToolPolicy('mcp__assistant-files__read_file', HOST_SERVERS)?.approval).toBe('auto')
    expect(findBuiltinToolPolicy('mcp__assistant-files__move_to_trash', HOST_SERVERS)?.approval).toBe('required')
    expect(findBuiltinToolPolicy('mcp__assistant-files__save_attachment', HOST_SERVERS)?.approval).toBe('required')
  })

  it('applies every derived Cherry policy entry under the real wiring', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), productionOptions)

    for (const runtimeName of approvalRequiredRuntimeNames) {
      expect(snapshot.resolve(runtimeName)).toMatchObject({ approval: 'prompt' })
    }
    for (const runtimeName of autoApprovedRuntimeNames) {
      expect(snapshot.resolve(runtimeName)).toMatchObject({ approval: 'auto' })
    }
  })

  it('does not auto-approve future cherry-tools by prefix under the real wiring', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent(), productionOptions)

    expect(snapshot.resolve('mcp__cherry-tools__future_mutator')).toBeUndefined()
  })
})
