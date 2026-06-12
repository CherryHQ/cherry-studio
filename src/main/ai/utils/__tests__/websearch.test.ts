import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { hasExternalSearchProvider } from '../websearch'

describe('hasExternalSearchProvider', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('returns false when no default search keywords provider is configured', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', null)
    expect(hasExternalSearchProvider()).toBe(false)
  })

  it('returns true when a default search keywords provider is configured', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.web_search.default_search_keywords_provider', 'tavily')
    expect(hasExternalSearchProvider()).toBe(true)
  })
})
