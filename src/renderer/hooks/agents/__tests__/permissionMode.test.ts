import { describe, expect, it } from 'vitest'

import { normalizePermissionMode } from '../permissionMode'

describe('normalizePermissionMode', () => {
  it('passes through the valid non-default modes', () => {
    expect(normalizePermissionMode('plan')).toBe('plan')
    expect(normalizePermissionMode('acceptEdits')).toBe('acceptEdits')
    expect(normalizePermissionMode('bypassPermissions')).toBe('bypassPermissions')
  })

  it('falls back to default for unknown / empty values', () => {
    expect(normalizePermissionMode('default')).toBe('default')
    expect(normalizePermissionMode('bogus')).toBe('default')
    expect(normalizePermissionMode(undefined)).toBe('default')
    expect(normalizePermissionMode(null)).toBe('default')
  })
})
