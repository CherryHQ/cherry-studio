import { describe, expect, it } from 'vitest'

import {
  ContextSettingsOverrideSchema,
  DEFAULT_CONTEXT_SETTINGS,
  EffectiveContextSettingsSchema
} from '../contextSettings'

describe('contextSettings schemas', () => {
  // The default is the floor every layer merges onto, so a field added to the
  // schema but not to the constant reaches the request pipeline as undefined.
  it('the hardcoded default satisfies the effective schema', () => {
    expect(() => EffectiveContextSettingsSchema.parse(DEFAULT_CONTEXT_SETTINGS)).not.toThrow()
  })

  it('override is fully partial — empty object parses', () => {
    expect(ContextSettingsOverrideSchema.parse({})).toEqual({})
  })

  it('override accepts a partial compress block', () => {
    const parsed = ContextSettingsOverrideSchema.parse({ compress: { enabled: false } })
    expect(parsed.compress?.enabled).toBe(false)
  })

  it('effective rejects a non-positive threshold', () => {
    expect(() => EffectiveContextSettingsSchema.parse({ ...DEFAULT_CONTEXT_SETTINGS, truncateThreshold: 0 })).toThrow()
  })
})

describe('keep percentage schema', () => {
  it('preserves the historical default and leaves overrides absent', () => {
    expect(DEFAULT_CONTEXT_SETTINGS.compress.keepPercent).toBe(37.5)
    expect(ContextSettingsOverrideSchema.parse({ compress: {} }).compress?.keepPercent).toBeUndefined()
    expect(Math.floor((3200 * DEFAULT_CONTEXT_SETTINGS.compress.keepPercent) / 100)).toBe(1200)
    expect(Math.floor((2000 * DEFAULT_CONTEXT_SETTINGS.compress.keepPercent) / 100)).toBe(750)
  })
  it.each([10, 37.5, 62.3, 62.5, 90])('accepts %s without changing it', (keepPercent) => {
    expect(ContextSettingsOverrideSchema.parse({ compress: { keepPercent } }).compress?.keepPercent).toBe(keepPercent)
  })
  it.each([9.9, 90.1, null, '62.3'])('rejects invalid override %s', (keepPercent) => {
    expect(ContextSettingsOverrideSchema.safeParse({ compress: { keepPercent } }).success).toBe(false)
  })
  it.each([9.9, 90.1])('rejects out of range effective value %s', (keepPercent) => {
    expect(
      EffectiveContextSettingsSchema.safeParse({
        ...DEFAULT_CONTEXT_SETTINGS,
        compress: { ...DEFAULT_CONTEXT_SETTINGS.compress, keepPercent }
      }).success
    ).toBe(false)
  })
})
