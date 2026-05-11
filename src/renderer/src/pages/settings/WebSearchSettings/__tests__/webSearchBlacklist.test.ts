import { describe, expect, it } from 'vitest'

import { parseWebSearchBlacklistInput } from '../utils/webSearchBlacklist'

describe('parseWebSearchBlacklistInput', () => {
  it('filters empty lines and preserves valid match patterns', () => {
    expect(parseWebSearchBlacklistInput('\nhttps://example.com/*\n  *://*.example.org/*  \n')).toEqual({
      validDomains: ['https://example.com/*', '*://*.example.org/*'],
      hasError: false,
      invalidEntries: []
    })
  })

  it('accepts valid regular expression entries', () => {
    expect(parseWebSearchBlacklistInput('/example\\.(com|org)/')).toEqual({
      validDomains: ['/example\\.(com|org)/'],
      hasError: false,
      invalidEntries: []
    })
  })

  it('reports invalid regular expression entries', () => {
    expect(parseWebSearchBlacklistInput('/[/')).toEqual({
      validDomains: [],
      hasError: true,
      invalidEntries: ['/[/']
    })
  })

  it('reports invalid match pattern entries while preserving valid entries', () => {
    expect(parseWebSearchBlacklistInput('https://example.com/*\nnot a pattern')).toEqual({
      validDomains: ['https://example.com/*'],
      hasError: true,
      invalidEntries: ['not a pattern']
    })
  })
})
