/**
 * Regression for agents-jobs-3: the CherryClaw prompt/bootstrap drive memory via
 * `mcp__agent-memory__memory`, so Soul Mode must actually inject the `agent-memory`
 * server into the runtime MCP list AND allow its tools — not just reference the name.
 */

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/sessions'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/AgentChannelService', () => ({
  agentChannelService: { listChannels: vi.fn().mockResolvedValue([]) }
}))

const { buildMcpServers, adjustAllowedToolsForMcp, formatNetworkProbeLine } = await import('../settingsBuilder')

const agent = { id: 'agent-1', mcps: [] } as unknown as AgentEntity
const session = { id: 'sess-1', agentId: 'agent-1' } as unknown as AgentSessionEntity

describe('adjustAllowedToolsForMcp', () => {
  it('adds the claw + agent-memory wildcards in Soul Mode', () => {
    expect(adjustAllowedToolsForMcp([], true, false)).toEqual(
      expect.arrayContaining(['mcp__claw__*', 'mcp__agent-memory__*'])
    )
  })

  it('adds the assistant wildcard for the Cherry Assistant', () => {
    expect(adjustAllowedToolsForMcp([], false, true)).toContain('mcp__assistant__*')
  })

  it('leaves allowed tools untouched when neither Soul nor Assistant', () => {
    expect(adjustAllowedToolsForMcp(['existing'], false, false)).toEqual(['existing'])
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
