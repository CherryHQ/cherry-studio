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
    // Built-in entries keep their fixed keys.
    expect(Object.keys(servers)).toEqual(expect.arrayContaining(['cherry-tools', 'agent-memory']))
  })

  it('keeps a server named __proto__ as an own enumerable key instead of mutating the prototype', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const servers = build([[id, { id, name: '__proto__', isActive: true }]])

    expect(servers['__proto__']).toMatchObject({ id, name: '__proto__' })
    // Claude/DSH enumerate via Object.entries and Pi via Object.values — the entry must be own
    // and enumerable or the server silently disappears from every runtime.
    expect(Object.keys(servers)).toContain('__proto__')
    expect(Object.entries(servers).map(([key]) => key)).toContain('__proto__')
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
