import { describe, expect, it } from 'vitest'

import { DEFAULT_AGENT_AVATAR, getAgentAvatar, getAgentDescriptionForDisplay, getPermissionModeCards } from '../agent'

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

  it('uses the localized Cherry Support description', () => {
    const t = (key: string) => `translated:${key}`
    expect(
      getAgentDescriptionForDisplay(
        { description: '', configuration: { builtin_role: 'support' } },
        t as Parameters<typeof getAgentDescriptionForDisplay>[1]
      )
    ).toBe('translated:agent.builtin.cherry_support.description')
  })
})

describe('getPermissionModeCards', () => {
  it('offers the full mode set (including plan and auto) for claude-code and unknown types', () => {
    const modes = getPermissionModeCards('claude-code').map((card) => card.mode)
    expect(modes).toContain('plan')
    expect(modes).toContain('auto')
    expect(getPermissionModeCards(undefined).map((c) => c.mode)).toContain('plan')
  })

  it('drops the unsupported plan mode for pi agents but keeps auto', () => {
    const modes = getPermissionModeCards('pi').map((card) => card.mode)
    expect(modes).not.toContain('plan')
    expect(modes).toEqual(expect.arrayContaining(['default', 'acceptEdits', 'auto', 'bypassPermissions']))
  })

  it("describes pi's auto and bypass modes by what they actually do, not by Claude's mechanism", () => {
    const claudeAuto = getPermissionModeCards('claude-code').find((card) => card.mode === 'auto')
    const piAuto = getPermissionModeCards('pi').find((card) => card.mode === 'auto')
    const piBypass = getPermissionModeCards('pi').find((card) => card.mode === 'bypassPermissions')
    const claudeBypass = getPermissionModeCards('claude-code').find((card) => card.mode === 'bypassPermissions')

    // pi's auto is deterministic, so it carries its own caveat (recognition is best-effort) rather
    // than claude's "depends on the model" one.
    expect(claudeAuto?.warningKey).toBeTruthy()
    expect(piAuto?.warningKey).toBeTruthy()
    expect(piAuto?.warningKey).not.toBe(claudeAuto?.warningKey)
    expect(piAuto?.descriptionKey).not.toBe(claudeAuto?.descriptionKey)
    // bypass now means the same thing on every runtime — approvals lifted, explicit safety blocks
    // (disabled tools, global installs) still apply — so pi shares the generic copy.
    expect(piBypass?.warningKey).toBe(claudeBypass?.warningKey)
  })
})
