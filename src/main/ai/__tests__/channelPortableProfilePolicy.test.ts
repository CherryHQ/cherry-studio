import { describe, expect, it } from 'vitest'

import { sanitizeAgentChannelCapability } from '../channelPortableProfilePolicy'

describe('sanitizeAgentChannelCapability', () => {
  it('deactivates the channel and clears proactive notification state', () => {
    const result = sanitizeAgentChannelCapability({
      config: { botToken: 'secret' },
      permissionMode: 'acceptEdits'
    })
    expect(result.patch).toEqual({ isActive: false, activeChatIds: [], permissionMode: 'acceptEdits' })
    expect(result.malformedFields).toEqual([])
  })

  it('drops bypassPermissions', () => {
    expect(
      sanitizeAgentChannelCapability({ config: {}, permissionMode: 'bypassPermissions' }).patch.permissionMode
    ).toBeNull()
  })

  it.each([
    ['a string', 'token'],
    ['an array', []],
    ['null', null]
  ])('reports malformed config stored as %s without destroying it', (_label, config) => {
    const result = sanitizeAgentChannelCapability({ config, permissionMode: null })
    expect(result.malformedFields).toEqual(['config'])
    expect(result.patch).not.toHaveProperty('config')
    expect(result.patch.isActive).toBe(false)
  })
})
