import { describe, expect, it } from 'vitest'

import { WEB_SEARCH_SETTINGS_KEYS, WEB_SEARCH_SETTINGS_PREFERENCE_KEYS } from '../setting'

describe('WEB_SEARCH_SETTINGS_PREFERENCE_KEYS', () => {
  it('contains every web search settings preference key exactly once', () => {
    const expectedKeys = Object.values(WEB_SEARCH_SETTINGS_KEYS)

    expect(new Set(WEB_SEARCH_SETTINGS_PREFERENCE_KEYS)).toEqual(new Set(expectedKeys))
    expect(WEB_SEARCH_SETTINGS_PREFERENCE_KEYS).toHaveLength(expectedKeys.length)
  })
})
