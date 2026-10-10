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
