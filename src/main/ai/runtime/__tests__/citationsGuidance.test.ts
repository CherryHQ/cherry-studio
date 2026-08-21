import { describe, expect, it } from 'vitest'

import { buildCitationsGuidance } from '../citationsGuidance'

describe('buildCitationsGuidance', () => {
  it('returns undefined when neither web nor kb is available', () => {
    expect(buildCitationsGuidance({ web: false, kb: false })).toBeUndefined()
  })

  it('mentions only web tools when kb is unavailable', () => {
    const out = buildCitationsGuidance({ web: true, kb: false })
    expect(out).toContain('mcp__cherry-tools__web_search')
    expect(out).toContain('mcp__cherry-tools__web_fetch')
    expect(out).not.toContain('mcp__cherry-tools__kb_search')
    expect(out).toContain('[cite:ID]')
  })

  it('mentions only the kb tools when web is disabled', () => {
    const out = buildCitationsGuidance({ web: false, kb: true })
    expect(out).toContain('mcp__cherry-tools__kb_search')
    expect(out).toContain('mcp__cherry-tools__kb_read')
    expect(out).not.toContain('web_search')
  })

  it('mentions both tool groups when both are available', () => {
    const out = buildCitationsGuidance({ web: true, kb: true })
    expect(out).toContain('mcp__cherry-tools__web_search')
    expect(out).toContain('mcp__cherry-tools__kb_search')
  })
})
