import { describe, expect, it } from 'vitest'

import { mapMarkdownOutsideCode, stripCitationMarkers } from '../citations'

describe('mapMarkdownOutsideCode', () => {
  it('preserves multi-backtick and tilde-fenced code', () => {
    const input = 'Before ``[cite:inline-1]``\n~~~txt\n[cite:fence-1]\n~~~\nAfter [cite:prose-1]'

    expect(mapMarkdownOutsideCode(input, (text) => text.replaceAll('[cite:', '[source:'))).toBe(
      'Before ``[cite:inline-1]``\n~~~txt\n[cite:fence-1]\n~~~\nAfter [source:prose-1]'
    )
  })

  it('treats an unclosed fenced block as code through the end of the text', () => {
    const input = 'Before [cite:prose-1]\n```txt\n[cite:fence-1]'

    expect(mapMarkdownOutsideCode(input, (text) => text.replaceAll('[cite:', '[source:'))).toBe(
      'Before [source:prose-1]\n```txt\n[cite:fence-1]'
    )
  })
})

describe('stripCitationMarkers', () => {
  it('strips prose markers while preserving every supported code delimiter', () => {
    const input = [
      'Before [cite:prose-1]',
      '``[cite:inline-1]``',
      '~~~txt',
      '[cite:tilde-1]',
      '~~~',
      '```txt',
      '[cite:backtick-1]'
    ].join('\n')

    expect(stripCitationMarkers(input)).toBe(
      ['Before', '``[cite:inline-1]``', '~~~txt', '[cite:tilde-1]', '~~~', '```txt', '[cite:backtick-1]'].join('\n')
    )
  })

  it('withholds a possible trailing marker only for a partial stream update', () => {
    const input = 'Claim [cite:source-'

    expect(stripCitationMarkers(input, { withholdIncompleteTrailingMarker: true })).toBe('Claim')
    expect(stripCitationMarkers(input)).toBe(input)
  })

  it('publishes a trailing bracket sequence once it cannot become a citation marker', () => {
    expect(stripCitationMarkers('Array [city', { withholdIncompleteTrailingMarker: true })).toBe('Array [city')
  })
})
