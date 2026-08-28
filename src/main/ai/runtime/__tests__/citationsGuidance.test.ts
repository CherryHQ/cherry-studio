import { describe, expect, it } from 'vitest'

import { buildCitationsGuidance } from '../citationsGuidance'

describe('buildCitationsGuidance', () => {
  it('returns undefined when neither web nor kb is available', () => {
    expect(buildCitationsGuidance({ web: false, kb: false })).toBeUndefined()
  })

  it('mentions only web tools when kb is unavailable', () => {
    const out = buildCitationsGuidance({ web: true, kb: false })
    expect(out).toContain('mcp__cherry_tools__webSearch__a26653c54bd6')
    expect(out).toContain('mcp__cherry_tools__webFetch__0d46b7903981')
    expect(out).not.toContain('mcp__cherry_tools__kbSearch__7fb1469c1b2d')
    expect(out).toContain('[cite:ID]')
  })

  it('mentions only the kb tools when web is disabled', () => {
    const out = buildCitationsGuidance({ web: false, kb: true })
    expect(out).toContain('mcp__cherry_tools__kbSearch__7fb1469c1b2d')
    expect(out).toContain('mcp__cherry_tools__kbRead__01a3c9c066e6')
    expect(out).not.toContain('web_search')
  })

  it('mentions both tool groups when both are available', () => {
    const out = buildCitationsGuidance({ web: true, kb: true })
    expect(out).toContain('mcp__cherry_tools__webSearch__a26653c54bd6')
    expect(out).toContain('mcp__cherry_tools__kbSearch__7fb1469c1b2d')
  })
})
