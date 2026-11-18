import { describe, expect, it } from 'vitest'

import {
  getAgentAvatar,
  getAgentAvatarFromConfiguration,
  getAgentDescriptionForDisplay,
  getPermissionModeCards
} from '../agent'

describe('agent utilities', () => {
  it('preserves non-blank stored avatars after trimming', () => {
    expect(getAgentAvatar('  🦞  ')).toBe('🦞')
  })

  it('prefers an uploaded image while retaining the configured emoji fallback', () => {
    expect(getAgentAvatarFromConfiguration({ avatar: '🌟' }, 'file:///avatar.webp')).toBe('file:///avatar.webp')
    expect(getAgentAvatarFromConfiguration({ avatar: '🌟' })).toBe('🌟')
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

describe('getPermissionModeCards', () => {
  it('drops the unsupported plan mode for pi agents but keeps auto', () => {
    const modes = getPermissionModeCards('pi').map((card) => card.mode)
    expect(modes).not.toContain('plan')
    expect(modes).toEqual(expect.arrayContaining(['default', 'acceptEdits', 'auto', 'bypassPermissions']))
  })
})
