import type { PortableAgentPermissionMode } from '@main/ai/agents/portableProfilePolicy'
import { describe, expect, expectTypeOf, it } from 'vitest'

import { type AgentChannelCapabilityMalformedField, sanitizeAgentChannelCapability } from '../portableProfilePolicy'

describe('sanitizeAgentChannelCapability', () => {
  it('exposes a typed inactive patch and typed malformed fields', () => {
    const result = sanitizeAgentChannelCapability({
      type: 'telegram',
      config: { bot_token: 'secret' },
      permissionMode: 'plan'
    })
    expectTypeOf(result.patch.isActive).toEqualTypeOf<false>()
    expectTypeOf(result.patch.permissionMode).toEqualTypeOf<PortableAgentPermissionMode | null>()
    expectTypeOf(result.malformedFields).toEqualTypeOf<readonly AgentChannelCapabilityMalformedField[]>()
  })

  it('deactivates the channel and clears proactive notification state', () => {
    const result = sanitizeAgentChannelCapability({
      type: 'telegram',
      config: { bot_token: 'secret' },
      permissionMode: 'acceptEdits'
    })
    expect(result.patch).toEqual({ isActive: false, activeChatIds: [], permissionMode: 'acceptEdits' })
    expect(result.malformedFields).toEqual([])
  })

  it('drops bypassPermissions', () => {
    expect(
      sanitizeAgentChannelCapability({
        type: 'telegram',
        config: { bot_token: 'secret' },
        permissionMode: 'bypassPermissions'
      }).patch.permissionMode
    ).toBeNull()
  })

  it.each([
    ['a string', 'token'],
    ['an array', []],
    ['null', null]
  ])('reports malformed config stored as %s without destroying it', (_label, config) => {
    const result = sanitizeAgentChannelCapability({ type: 'telegram', config, permissionMode: null })
    expect(result.malformedFields).toEqual(['config'])
    expect(result.patch).not.toHaveProperty('config')
    expect(result.patch.isActive).toBe(false)
  })

  it('reports an unknown channel type and permission mode without activating the row', () => {
    const result = sanitizeAgentChannelCapability({
      type: 'future-channel',
      config: { future: true },
      permissionMode: 'superuser'
    })
    expect(result.malformedFields).toEqual(['type', 'permissionMode'])
    expect(result.patch).toEqual({ isActive: false, activeChatIds: [], permissionMode: null })
  })
})
