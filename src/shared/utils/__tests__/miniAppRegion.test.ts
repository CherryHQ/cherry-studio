import { describe, expect, it } from 'vitest'

import { getMiniAppRegionPartition, selectedMiniAppCountry } from '../miniAppRegion'

describe('website MiniApp country selection', () => {
  it('preserves legacy cookies by retaining partition names and respects explicit per-app overrides', () => {
    expect(selectedMiniAppCountry('google', {}, ['google'], 'JP')).toBe('JP')
    expect(getMiniAppRegionPartition('google', 'US')).toBe('persist:webview-us:google')
    expect(getMiniAppRegionPartition('google', 'JP')).toBe('persist:webview-fake:JP:google')
    expect(selectedMiniAppCountry('google', { google: 'DE', claude: 'FR' }, ['google'], 'JP')).toBe('DE')
    expect(selectedMiniAppCountry('claude', { google: 'DE', claude: 'FR' }, ['google'], 'JP')).toBe('FR')
    expect(selectedMiniAppCountry('google', { google: null }, ['google'], 'JP')).toBeNull()
  })

  it('does not confuse an inherited property with a saved country selection', () => {
    expect(selectedMiniAppCountry('toString', {}, [], 'US')).toBeNull()
    expect(getMiniAppRegionPartition('a/b:c', 'JP')).toBe('persist:webview-fake:JP:a%2Fb%3Ac')
  })
})
