import { describe, expect, it, vi } from 'vitest'

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

const mocks = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

vi.mock('@logger', () => ({ loggerService: { withContext: () => mocks.logger } }))
vi.mock('@application', () => ({
  application: { get: vi.fn(() => ({ getTurnTrustedNotifyChannels: vi.fn(() => undefined) })) }
}))
vi.mock('@data/services/AgentChannelService', () => ({ agentChannelService: {} }))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: vi.fn() } }))
vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { findByIdOrName: vi.fn() } }))
vi.mock('@main/ai/agents/builtin/builtinAgentCapabilities', () => ({
  resolveHostTools: vi.fn(() => undefined),
  resolveAgentCapabilities: vi.fn(() => ({ allKnowledgeBases: [] }))
}))
vi.mock('@main/ai/mcp/createMcpBridgeServer', () => ({ createMcpBridgeServer: vi.fn() }))
vi.mock('@main/ai/mcp/servers/agentMemory', () => ({ createAgentMemoryServer: vi.fn() }))
vi.mock('@main/ai/mcp/servers/assistant', () => ({ createAssistantServer: vi.fn() }))
vi.mock('@main/ai/mcp/servers/AssistantFileToolsServer', () => ({ createAssistantFileToolsServer: vi.fn() }))
vi.mock('@main/ai/mcp/servers/cherryBuiltinTools', () => ({ createCherryToolsServer: vi.fn() }))
vi.mock('@main/ai/mcp/servers/mcpManager', () => ({ createMcpManagerServer: vi.fn() }))
vi.mock('@main/ai/mcp/servers/skills', () => ({ createSkillsServer: vi.fn() }))
vi.mock('@main/ai/utils/knowledgeScope', () => ({ resolveKnowledgeBaseScope: vi.fn(() => []) }))

import { buildAgentMcpServers, resolveAgentMcpServerKeys } from './agentMcpServers'

const session = {
  id: 'sess-1',
  workspaceId: 'ws-1',
  workspace: { type: AGENT_WORKSPACE_TYPE.USER, path: '/work/space', name: 'space' }
} as unknown as AgentSessionEntity

function agentWithMcps(mcps: string[]): AgentEntity {
  return { id: 'agent-1', mcps } as unknown as AgentEntity
}

/** Mount one user server without touching builtin branches (mountedServers stays empty). */
function build(snapshots: Array<[string, { id: string; name: string; isActive: true }]>, mcps?: string[]) {
  return buildAgentMcpServers(
    session,
    agentWithMcps(mcps ?? snapshots.map(([id]) => id)),
    new Set(),
    new Map(snapshots),
    null
  )
}

describe('buildAgentMcpServers key allocation', () => {
  it('registers a server under its configured name when the name is free', () => {
    const id = '44444444-4444-4444-8444-444444444444'
    const servers = build([[id, { id, name: 'my-tools', isActive: true }]])

    expect(servers['my-tools']).toMatchObject({ id, name: 'my-tools' })
    // Built-in entries keep their fixed keys (agent-memory is mount-gated upstream, so only
    // cherry-tools is unconditional for an empty mountedServers set).
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['cherry-tools']))
  })

  it('keeps a server named __proto__ on a sanitized own enumerable key', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const servers = build([[id, { id, name: '__proto__', isActive: true }]])

    // `__` runs collapse and trailing `_`s strip in the key, so the hazardous name never
    // reaches the record at all (`_proto_` would end in `_` and blur the `__` delimiter).
    expect(servers['_proto']).toMatchObject({ id, name: '_proto' })
    // Claude/DSH enumerate via Object.entries and Pi via Object.values — the entry must be own
    // and enumerable or the server silently disappears from every runtime.
    expect(Object.keys(servers)).toContain('_proto')
    expect(Object.entries(servers).map(([key]) => key)).toContain('_proto')
    expect(Object.prototype.hasOwnProperty.call(servers, '__proto__')).toBe(false)
  })

  it('keeps `__` out of allocated keys so flattened tool identities stay unambiguous', () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    // `docs` exposing `search__all` and `docs__search` exposing `all` both flatten to the
    // SDK-derived id `mcp__docs__search__all` when both keys mount verbatim — the CLI keeps
    // one callable and metadata cannot say which. Sanitized keys keep the identity injective.
    const servers = build([
      [idA, { id: idA, name: 'docs', isActive: true }],
      [idB, { id: idB, name: 'docs__search', isActive: true }]
    ])

    expect(servers['docs']).toMatchObject({ id: idA })
    expect(servers['docs_search']).toMatchObject({ id: idB })
    expect(servers['docs__search']).toBeUndefined()
  })

  it('strips trailing underscores from keys so the delimiter boundary stays unique', () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    // A key ending in `_` blurs the `__` delimiter: `docs` exposing `_run` and `docs_`
    // exposing `run` both flatten to `mcp__docs___run`, and first-wins metadata drops the
    // second owner. Keys must never end in `_`; `docs_` sanitizes onto the taken `docs`,
    // so allocation falls back to that server's id.
    const servers = build([
      [idA, { id: idA, name: 'docs', isActive: true }],
      [idB, { id: idB, name: 'docs_', isActive: true }]
    ])

    expect(servers['docs']).toMatchObject({ id: idA })
    expect(servers['docs_']).toBeUndefined()
    expect(servers[idB]).toMatchObject({ id: idB })
  })

  it("does not let a sanitized key take another server's literal name", () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    const idC = '55555555-5555-4555-8555-555555555555'
    // `docs__search` sanitizes onto idC's literal `docs_search` name — the sanitizer must
    // respect taken keys, so the second server falls back to its own id.
    const servers = build([
      [idA, { id: idA, name: 'docs', isActive: true }],
      [idC, { id: idC, name: 'docs_search', isActive: true }],
      [idB, { id: idB, name: 'docs__search', isActive: true }]
    ])

    expect(servers['docs']).toMatchObject({ id: idA })
    expect(servers['docs_search']).toMatchObject({ id: idC })
    expect(servers[idB]).toMatchObject({ id: idB })
  })

  it('keeps every mounted server when a fallback id collides with another server key', () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    // A's configured name is B's id; B's configured name is reserved by the builtin skills server,
    // so B falls back to its id — which A already took under the old allocation order.
    const servers = build([
      [idA, { id: idA, name: idB, isActive: true }],
      [idB, { id: idB, name: 'skills', isActive: true }]
    ])

    expect(servers[idA]).toMatchObject({ id: idA })
    expect(servers[idB]).toMatchObject({ id: idB })
  })

  it('falls back to the id when a configured name collapses into another claim SDK namespace', () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    // `Docs MCP` and `Docs_MCP` are distinct record keys, but the pinned SDK underscores the
    // space: both would register `mcp__Docs_MCP__*` callables and the SDK advertises only one
    // server's tool. The later claim must fall back to its id so both servers stay reachable.
    const servers = build([
      [idA, { id: idA, name: 'Docs MCP', isActive: true }],
      [idB, { id: idB, name: 'Docs_MCP', isActive: true }]
    ])

    // The allocation key folds the name into the SDK namespace BEFORE the delimiter
    // protection, so `Docs MCP` claims the protected key `Docs_MCP` — which is exactly the
    // form `Docs_MCP` folds onto, and the later claim falls back to its id.
    expect(servers['Docs_MCP']).toMatchObject({ id: idA })
    expect(servers[idB]).toMatchObject({ id: idB })
    expect(servers['Docs MCP']).toBeUndefined()
    // Policy translation reads the same allocation, so its key map must agree with registration.
    const keys = resolveAgentMcpServerKeys(
      agentWithMcps([idA, idB]),
      new Map([
        [idA, { id: idA, name: 'Docs MCP', isActive: true }],
        [idB, { id: idB, name: 'Docs_MCP', isActive: true }]
      ])
    )
    expect(keys.get(idA)).toBe('Docs_MCP')
    expect(keys.get(idB)).toBe(idB)
  })

  it('keeps hyphenated names distinct because the SDK preserves hyphens verbatim', () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    // `my-tools` and `my_tools` stay distinct SDK callables: only characters outside
    // [A-Za-z0-9_-] are underscored, so both names keep their own namespace.
    const servers = build([
      [idA, { id: idA, name: 'my-tools', isActive: true }],
      [idB, { id: idB, name: 'my_tools', isActive: true }]
    ])

    expect(servers['my-tools']).toMatchObject({ id: idA })
    expect(servers['my_tools']).toMatchObject({ id: idB })
  })
})

describe('resolveAgentMcpServerKeys', () => {
  it('mirrors buildAgentMcpServers key allocation per server id', () => {
    const idA = '22222222-2222-4222-8222-222222222222'
    const idB = '33333333-3333-4333-8333-333333333333'
    const snapshots: Array<[string, { id: string; name: string; isActive: true }]> = [
      [idA, { id: idA, name: 'alpha', isActive: true }],
      [idB, { id: idB, name: 'skills', isActive: true }]
    ]
    const keys = resolveAgentMcpServerKeys(agentWithMcps([idA, idB]), new Map(snapshots))
    const servers = build(snapshots)

    // Every translated key must host exactly that server in the built record.
    for (const [id, key] of keys) {
      expect(servers[key]).toMatchObject({ id })
    }
    expect(keys.get(idA)).toBe('alpha')
    expect(keys.get(idB)).toBe(idB) // 'skills' is reserved by the builtin → id fallback
  })

  it('skips unresolvable servers instead of inventing a key', () => {
    const keys = resolveAgentMcpServerKeys(agentWithMcps(['missing-id']))
    expect(keys.size).toBe(0)
  })
})
