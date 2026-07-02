import { describe, expect, it } from 'vitest'

import {
  ContextSettingsOverrideSchema,
  DEFAULT_CONTEXT_SETTINGS,
  EffectiveContextSettingsSchema
} from '../contextSettings'

describe('contextSettings schemas', () => {
  it('defaults: enabled + compress on, 100k threshold, no model', () => {
    expect(DEFAULT_CONTEXT_SETTINGS).toEqual({
      enabled: true,
      truncateThreshold: 100_000,
      compress: { enabled: true, modelId: null }
    })
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
