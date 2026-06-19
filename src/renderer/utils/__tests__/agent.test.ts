import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_AVATAR, getAgentAvatar } from '../agent'

describe('agent utilities', () => {
  it('normalizes blank stored avatars to the default agent avatar', () => {
    expect(getAgentAvatar()).toBe(DEFAULT_AGENT_AVATAR)
    expect(getAgentAvatar(null)).toBe(DEFAULT_AGENT_AVATAR)
    expect(getAgentAvatar('')).toBe(DEFAULT_AGENT_AVATAR)
    expect(getAgentAvatar('   ')).toBe(DEFAULT_AGENT_AVATAR)
  })

  it('preserves non-blank stored avatars after trimming', () => {
    expect(getAgentAvatar('  🦞  ')).toBe('🦞')
  })
})
