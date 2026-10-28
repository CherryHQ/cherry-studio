import { describe, expect, it } from 'vitest'

import { validateModelSettingsSearch } from '../modelSettingsFocus'

describe('validateModelSettingsSearch', () => {
  it.each(['default', 'translate'] as const)('accepts the %s model row', (focus) => {
    expect(validateModelSettingsSearch({ focus })).toEqual({ focus })
  })

  it.each([{ focus: 'quick' }, { focus: 1 }, {}])('drops an unsupported focus value', (search) => {
    expect(validateModelSettingsSearch(search)).toEqual({})
  })
})
