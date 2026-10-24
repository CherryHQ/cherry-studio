import { describe, expect, it } from 'vitest'

import { formatPiOutputLimitDiagnostic } from './outputLimitDiagnostic'

describe('Pi output-limit diagnostics', () => {
  it('reports the configured cap and measured provider counts without changing a budget', () => {
    const text = formatPiOutputLimitDiagnostic({ configuredMaxTokens: 8192, outputTokens: 8192, reasoningTokens: 7000 })
    expect(text).toContain('Configured maximum output: 8192 tokens')
    expect(text).toContain('provider-reported output tokens: 8192')
    expect(text).toContain('provider-reported reasoning tokens: 7000')
    expect(text).toContain('affects all sessions')
    expect(text).toContain('No output limit was increased automatically')
  })
  it('does not infer reasoning usage or claim a provider-supported higher limit', () => {
    const text = formatPiOutputLimitDiagnostic({ configuredMaxTokens: 8192, outputTokens: 4 })
    expect(text).not.toContain('reasoning tokens:')
    expect(text).toContain('provider-reported output tokens: 4')
    expect(text).not.toContain('32768')
    expect(text).not.toContain('384000')
  })
  it.each([undefined, NaN, Infinity, -1])('labels unavailable or invalid usage unknown: %s', (value) => {
    const text = formatPiOutputLimitDiagnostic({ configuredMaxTokens: value, outputTokens: value })
    expect(text).toContain('Configured maximum output: unknown tokens')
    expect(text).toContain('provider-reported output tokens: unknown')
  })
  it('preserves a real zero count', () => {
    expect(formatPiOutputLimitDiagnostic({ outputTokens: 0, reasoningTokens: 0 })).toContain(
      'output tokens: 0; provider-reported reasoning tokens: 0'
    )
  })
})
