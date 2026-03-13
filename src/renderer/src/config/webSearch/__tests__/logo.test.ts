import { WEB_SEARCH_PROVIDER_IDS } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { getWebSearchProviderLogo, WEB_SEARCH_PROVIDER_LOGOS } from '../logo'

describe('web search provider logos', () => {
  it('maps every web search provider id to a logo asset', () => {
    expect(Object.keys(WEB_SEARCH_PROVIDER_LOGOS)).toHaveLength(WEB_SEARCH_PROVIDER_IDS.length)

    WEB_SEARCH_PROVIDER_IDS.forEach((providerId) => {
      expect(getWebSearchProviderLogo(providerId)).toBeTruthy()
    })
  })
})
