import { describe, expect, it } from 'vitest'

import { AGENT_TYPES } from '@shared/data/api/schemas/agents'

import { resolveMountedMcpServers } from '../builtinAgentCapabilities'

describe('desktop control mounting', () => {
  it.each(AGENT_TYPES)('requires a local open environment and explicit enablement for %s', (type) => {
    const agent = { type, configuration: {}, disabledTools: [] }
    expect(resolveMountedMcpServers(agent, { channelLinked: false }).has('computer')).toBe(false)
    expect(resolveMountedMcpServers(agent, { channelLinked: false, computerUseEnabled: true }).has('computer')).toBe(
      true
    )
    expect(resolveMountedMcpServers(agent, { channelLinked: true, computerUseEnabled: true }).has('computer')).toBe(
      false
    )
    expect(
      resolveMountedMcpServers(
        { ...agent, disabledTools: ['mcp__computer'] },
        { channelLinked: false, computerUseEnabled: true }
      ).has('computer')
    ).toBe(false)
    expect(
      resolveMountedMcpServers(
        { ...agent, configuration: { builtin_role: 'support' } },
        { channelLinked: false, computerUseEnabled: true }
      ).has('computer')
    ).toBe(false)
  })
})
