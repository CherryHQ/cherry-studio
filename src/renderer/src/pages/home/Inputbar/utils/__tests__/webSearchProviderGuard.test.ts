import { describe, expect, it } from 'vitest'

import { shouldClearWebSearchProvider } from '../webSearchProviderGuard'

describe('shouldClearWebSearchProvider', () => {
  it('keeps provider override while provider preference cache is cold', () => {
    expect(
      shouldClearWebSearchProvider({
        hasProviderOverride: true,
        isMandatoryWebSearchModel: false,
        isProviderOverridesLoaded: false,
        isSelectedProviderEnabled: false
      })
    ).toBe(false)
  })

  it('clears provider override when loaded preferences show the provider is disabled', () => {
    expect(
      shouldClearWebSearchProvider({
        hasProviderOverride: true,
        isMandatoryWebSearchModel: false,
        isProviderOverridesLoaded: true,
        isSelectedProviderEnabled: false
      })
    ).toBe(true)
  })

  it('clears provider override for mandatory web-search models even when cache is cold', () => {
    expect(
      shouldClearWebSearchProvider({
        hasProviderOverride: true,
        isMandatoryWebSearchModel: true,
        isProviderOverridesLoaded: false,
        isSelectedProviderEnabled: true
      })
    ).toBe(true)
  })

  it('does nothing when no provider override is selected', () => {
    expect(
      shouldClearWebSearchProvider({
        hasProviderOverride: false,
        isMandatoryWebSearchModel: true,
        isProviderOverridesLoaded: true,
        isSelectedProviderEnabled: false
      })
    ).toBe(false)
  })
})
