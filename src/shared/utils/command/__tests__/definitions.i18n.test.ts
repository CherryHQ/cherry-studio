import { describe, expect, it } from 'vitest'

import enUs from '../../../../renderer/i18n/locales/en-us.json'
import { COMMAND_DEFINITIONS } from '../definitions'

describe('COMMAND_DEFINITIONS i18n', () => {
  it.each(COMMAND_DEFINITIONS.map((c) => [c.id, c.titleKey] as const))(
    '%s titleKey resolves to a real string in en-us.json',
    (_id, titleKey) => {
      expect(typeof (enUs as Record<string, unknown>)[titleKey]).toBe('string')
    }
  )
})
