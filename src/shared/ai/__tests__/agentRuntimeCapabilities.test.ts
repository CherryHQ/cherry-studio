import { describe, expect, it } from 'vitest'

import { AGENT_RUNTIME_CAPABILITIES } from '../agentRuntimeCapabilities'

describe('AGENT_RUNTIME_CAPABILITIES', () => {
  it('covers every agent runtime and keeps structural invariants explicit', () => {
    expect(Object.keys(AGENT_RUNTIME_CAPABILITIES).sort()).toEqual(['claude-code', 'pi'])

    const transports = Object.values(AGENT_RUNTIME_CAPABILITIES).map((caps) => caps.transport)
    expect(new Set(transports).size).toBe(transports.length)

    for (const caps of Object.values(AGENT_RUNTIME_CAPABILITIES)) {
      expect(caps.permissionModes.length).toBeGreaterThan(0)
    }

    expect(AGENT_RUNTIME_CAPABILITIES['claude-code'].permissionModes).toContain('plan')
    expect(AGENT_RUNTIME_CAPABILITIES.pi.permissionModes).not.toContain('plan')
  })
})
