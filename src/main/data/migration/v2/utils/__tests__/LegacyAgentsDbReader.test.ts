import { describe, expect, it, vi } from 'vitest'

import { resolveLegacyAgentsDbPath } from '../LegacyAgentsDbReader'

describe('LegacyAgentsDbReader', () => {
  it('prefers the canonical agents db path when it exists', () => {
    const exists = vi.fn((candidate: string) => candidate === '/data/agents.db')

    expect(
      resolveLegacyAgentsDbPath({
        canonicalPath: '/data/agents.db',
        fallbackPath: '/user/agents.db',
        exists
      })
    ).toBe('/data/agents.db')
  })

  it('falls back to the old userData root path', () => {
    const exists = vi.fn((candidate: string) => candidate === '/user/agents.db')

    expect(
      resolveLegacyAgentsDbPath({
        canonicalPath: '/data/agents.db',
        fallbackPath: '/user/agents.db',
        exists
      })
    ).toBe('/user/agents.db')
  })

  it('returns null when no legacy agents db exists', () => {
    expect(
      resolveLegacyAgentsDbPath({
        canonicalPath: '/data/agents.db',
        fallbackPath: '/user/agents.db',
        exists: () => false
      })
    ).toBeNull()
  })
})
