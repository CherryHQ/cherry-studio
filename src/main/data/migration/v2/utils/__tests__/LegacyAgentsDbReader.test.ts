import { describe, expect, it, vi } from 'vitest'

import { LegacyAgentsDbReader } from '../LegacyAgentsDbReader'

describe('LegacyAgentsDbReader', () => {
  it('returns the legacy agents db path when it exists', () => {
    const exists = vi.fn((path: unknown) => path === '/data/agents.db')
    const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: '/data/agents.db' }, exists)

    expect(reader.resolvePath()).toBe('/data/agents.db')
    expect(exists).toHaveBeenCalledWith('/data/agents.db')
  })

  it('returns null when the legacy agents db does not exist', () => {
    const reader = new LegacyAgentsDbReader({ legacyAgentDbFile: '/data/agents.db' }, () => false)

    expect(reader.resolvePath()).toBeNull()
  })
})
