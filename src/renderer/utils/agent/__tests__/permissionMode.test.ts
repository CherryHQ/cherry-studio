import { describe, expect, it } from 'vitest'

import { AgentPermissionModeSchema } from '@shared/data/api/schemas/agents'

import { normalizePermissionMode } from '../permissionMode'

describe('normalizePermissionMode', () => {
  // Enumerated from the schema, not hand-listed: a mode added there must round-trip
  // without anyone remembering to touch this file.
  it.each(AgentPermissionModeSchema.options)('passes %s through unchanged', (mode) => {
    expect(normalizePermissionMode(mode)).toBe(mode)
  })

  it('falls back to default for unknown / empty values', () => {
    expect(normalizePermissionMode('default')).toBe('default')
    expect(normalizePermissionMode('bogus')).toBe('default')
    expect(normalizePermissionMode(undefined)).toBe('default')
    expect(normalizePermissionMode(null)).toBe('default')
  })
})
