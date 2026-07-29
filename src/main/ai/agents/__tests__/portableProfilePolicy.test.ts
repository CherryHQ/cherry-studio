import { describe, expect, it } from 'vitest'

import {
  sanitizeAgentAutomation,
  sanitizePermissionMode,
  toDisconnectedAgentWorkspaceSegment
} from '../portableProfilePolicy'

describe('toDisconnectedAgentWorkspaceSegment', () => {
  it('creates one portable inert segment from an untrusted row id', () => {
    expect(toDisconnectedAgentWorkspaceSegment('../../workspace name...')).toBe('ws-.._.._workspace_name')
    expect(toDisconnectedAgentWorkspaceSegment('a'.repeat(80))).toBe(`ws-${'a'.repeat(64)}`)
  })
})

describe('sanitizePermissionMode', () => {
  it('drops bypassPermissions and unknown values', () => {
    expect(sanitizePermissionMode('bypassPermissions')).toBeNull()
    expect(sanitizePermissionMode('superuser')).toBeNull()
    expect(sanitizePermissionMode(null)).toBeNull()
  })

  it.each(['default', 'acceptEdits', 'plan'])('keeps the known non-bypassing mode %s', (mode) => {
    expect(sanitizePermissionMode(mode)).toBe(mode)
  })

  it.each([
    ['a differently-cased bypass', 'BYPASSPERMISSIONS'],
    ['undefined', undefined],
    ['a number', 42],
    ['an object', { mode: 'plan' }]
  ])('falls back for %s', (_label, value) => {
    expect(sanitizePermissionMode(value)).toBeNull()
  })
})

describe('sanitizeAgentAutomation', () => {
  it('writes both automation flags false even when absent', () => {
    expect(sanitizeAgentAutomation({ avatar: 'x' }).patch.configuration).toMatchObject({
      avatar: 'x',
      heartbeat_enabled: false,
      scheduler_enabled: false
    })
  })

  it('overrides an explicitly enabled heartbeat without dropping its interval', () => {
    const { configuration } = sanitizeAgentAutomation({
      heartbeat_enabled: true,
      heartbeat_interval: 3600
    }).patch
    expect(configuration.heartbeat_enabled).toBe(false)
    expect(configuration.heartbeat_interval).toBe(3600)
  })

  it('preserves inert configuration and unknown keys', () => {
    const { patch } = sanitizeAgentAutomation({
      env_vars: { PATH_HINT: '/Users/alice/bin' },
      future_key: { anything: 1 }
    })
    expect(patch.configuration).toMatchObject({
      env_vars: { PATH_HINT: '/Users/alice/bin' },
      future_key: { anything: 1 }
    })
  })

  it('drops a bypass permission mode but keeps a safe mode', () => {
    expect(sanitizeAgentAutomation({ permission_mode: 'bypassPermissions' }).patch.configuration).not.toHaveProperty(
      'permission_mode'
    )
    expect(sanitizeAgentAutomation({ permission_mode: 'plan' }).patch.configuration.permission_mode).toBe('plan')
  })

  it('fails closed when a known field or the root is malformed', () => {
    const field = sanitizeAgentAutomation({ heartbeat_enabled: 'yes', avatar: 'keep.png' })
    expect(field.malformedFields).toContain('heartbeat_enabled')
    expect(field.patch.configuration).toMatchObject({ avatar: 'keep.png', heartbeat_enabled: false })

    const root = sanitizeAgentAutomation('not-an-object')
    expect(root.malformedFields).toEqual(['<root>'])
    expect(root.patch.configuration).toEqual({ heartbeat_enabled: false, scheduler_enabled: false })
  })

  it.each([
    ['an array', ['nope']],
    ['a number', 7],
    ['unparseable stored JSON', Symbol('malformed')]
  ])('disarms automation for %s', (_label, raw) => {
    const result = sanitizeAgentAutomation(raw)
    expect(result.malformedFields).toEqual(['<root>'])
    expect(result.patch.configuration).toEqual({ heartbeat_enabled: false, scheduler_enabled: false })
  })

  it('disarms an absent configuration without reporting degradation', () => {
    const result = sanitizeAgentAutomation(null)
    expect(result.malformedFields).toEqual([])
    expect(result.patch.configuration).toEqual({ heartbeat_enabled: false, scheduler_enabled: false })
  })
})
