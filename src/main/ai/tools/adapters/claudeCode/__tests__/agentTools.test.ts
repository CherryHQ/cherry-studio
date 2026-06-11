/**
 * disabledTools must take effect on a warm Claude Code connection. The driver pushes
 * `snapshot.update(agent)` on every agent change and `canUseTool` consults `snapshot.isDisabled`
 * per invocation — so a tool disabled mid-session is denied without rebuilding the connection.
 * This asserts that live behavior at the snapshot layer.
 */

import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), silly: vi.fn() })
  }
}))

vi.mock('@data/services/McpServerService', () => ({ mcpServerService: { getById: vi.fn() } }))

vi.mock('@main/core/application', () => ({ application: { get: vi.fn() } }))

const { createClaudeAgentToolPolicySnapshot } = await import('../agentTools')

function makeAgent(disabledTools: string[] = []): AgentEntity {
  return { id: 'agent-1', mcps: [], disabledTools, configuration: {} } as unknown as AgentEntity
}

describe('createClaudeAgentToolPolicySnapshot — live disabledTools', () => {
  it('reflects a disabledTools change after update() without a connection rebuild', async () => {
    const snapshot = await createClaudeAgentToolPolicySnapshot(makeAgent([]))
    expect(snapshot.isDisabled('Read')).toBe(false)

    // Same code path the driver runs on a live agent update — no reconnect.
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
})
