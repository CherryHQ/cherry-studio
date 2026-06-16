import { describe, expect, it } from 'vitest'

import enUs from '../../../renderer/i18n/locales/en-us.json'
import { COMMAND_DEFINITIONS } from '../definitions'

// en-us.json is the i18n base locale; resolve a dotted key into its nested value.
const resolveKey = (key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => {
    if (node == null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[part]
  }, enUs as unknown)

describe('COMMAND_DEFINITIONS i18n', () => {
  it.each(COMMAND_DEFINITIONS.map((c) => [c.id, c.titleKey] as const))(
    '%s titleKey resolves to a real string in en-us.json',
    (_id, titleKey) => {
      expect(typeof resolveKey(titleKey)).toBe('string')
    }
  )
})
