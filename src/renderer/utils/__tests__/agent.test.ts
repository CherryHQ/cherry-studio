import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_AVATAR, getAgentAvatar, getAgentDescriptionForDisplay } from '../agent'

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

  it('uses localized builtin Cherry Assistant description only when the stored description is empty', () => {
    const t = (key: string) => `translated:${key}`
    expect(
      getAgentDescriptionForDisplay(
        { description: '', configuration: { builtin_role: 'assistant' } },
        t as Parameters<typeof getAgentDescriptionForDisplay>[1]
      )
    ).toBe('translated:agent.builtin.cherry_assistant.description')
    expect(
      getAgentDescriptionForDisplay(
        { description: 'User description', configuration: { builtin_role: 'assistant' } },
        t as Parameters<typeof getAgentDescriptionForDisplay>[1]
      )
    ).toBe('User description')
  })
})
