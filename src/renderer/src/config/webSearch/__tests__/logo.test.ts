import { WEB_SEARCH_PROVIDER_IDS } from '@shared/data/preference/preferenceTypes'
import { describe, expect, it } from 'vitest'

import { getWebSearchProviderLogo } from '../logo'

describe('web search provider logos', () => {
  it('maps every web search provider id to a logo asset', () => {
    WEB_SEARCH_PROVIDER_IDS.forEach((providerId) => {
      expect(getWebSearchProviderLogo(providerId)).toBeTruthy()
    })
  })
})
