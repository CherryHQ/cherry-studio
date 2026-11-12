import { describe, expect, it } from 'vitest'

import { diagnosticDescriptionByteLength, normalizeDiagnosticDescription } from '../diagnostics'

describe('diagnostic description contract', () => {
  it('normalizes every newline spelling to CRLF idempotently', () => {
    const normalized = normalizeDiagnosticDescription('cr\rlf\ncrlf\r\nend')

    expect(normalized).toBe('cr\r\nlf\r\ncrlf\r\nend')
    expect(normalizeDiagnosticDescription(normalized)).toBe(normalized)
  })

  it('does not normalize Unicode composition', () => {
    const decomposed = 'e\u0301'

    expect(normalizeDiagnosticDescription(decomposed)).toBe(decomposed)
    expect(normalizeDiagnosticDescription(decomposed)).not.toBe('\u00e9')
  })

  it('measures UTF-8 bytes after newline normalization', () => {
    expect(diagnosticDescriptionByteLength('中\n文')).toBe(8)
  })
})
