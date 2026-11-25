import { describe, expect, it } from 'vitest'

import { MiniAppUrlSchema } from '@shared/data/api/schemas/miniApps'

import { isMiniAppRegionEligible, isMiniAppRegionPartition, selectedMiniAppCountry } from '../miniAppRegion'

describe('website MiniApp country selection', () => {
  it('retains legacy country selections unless the app has an explicit override', () => {
    expect(selectedMiniAppCountry('google', {}, ['google'], 'JP')).toBe('JP')
    expect(selectedMiniAppCountry('google', { google: 'DE', claude: 'FR' }, ['google'], 'JP')).toBe('DE')
    expect(selectedMiniAppCountry('claude', { google: 'DE', claude: 'FR' }, ['google'], 'JP')).toBe('FR')
    expect(selectedMiniAppCountry('google', { google: null }, ['google'], 'JP')).toBeNull()
  })

  it('does not confuse an inherited property with a saved country selection', () => {
    expect(selectedMiniAppCountry('toString', {}, [], 'US')).toBeNull()
  })

  it.each(['https:example.test', 'http://example.test', ' HTTPS://EXAMPLE.TEST '])(
    'agrees with the website form for a valid web URL %s',
    (url) => {
      expect(MiniAppUrlSchema.safeParse(url).success).toBe(true)
      expect(isMiniAppRegionEligible({ kind: 'site', url })).toBe(true)
    }
  )

  it('accepts a saved file URL without making it eligible for a regional session', () => {
    const url = 'file:///example.html'
    expect(MiniAppUrlSchema.safeParse(url).success).toBe(true)
    expect(isMiniAppRegionEligible({ kind: 'site', url })).toBe(false)
  })

  it.each(['persist:webview-region-v2:jp:key', 'persist:webview-us:demo', 'persist:WEBVIEW-FAKE:JP:demo'])(
    'requires authorization for the regional namespace %s',
    (partition) => {
      expect(isMiniAppRegionPartition(partition)).toBe(true)
    }
  )

  it('keeps the shared default partition outside the regional namespace', () => {
    expect(isMiniAppRegionPartition('persist:webview')).toBe(false)
  })
})
