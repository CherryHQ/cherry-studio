import { describe, expect, it } from 'vitest'

import { buildSearchSnippet, stripMarkdownFormatting } from '../searchSnippet'

describe('searchSnippet', () => {
  it('strips markdown before snippet matching', () => {
    const snippet = buildSearchSnippet(
      [
        '# Heading',
        'Before the match',
        '**needle** appears in [docs](https://example.com) with `code` and <span>markup</span>.'
      ].join('\n'),
      ['needle'],
      'substring'
    )

    expect(stripMarkdownFormatting('**needle** [docs](https://example.com) `code` <span>markup</span>')).toBe(
      'needle docs code markup'
    )
    expect(snippet).toContain('needle appears in docs with code and markup.')
    expect(snippet).not.toContain('**needle**')
    expect(snippet).not.toContain('https://example.com')
  })

  it('fragments long lines around search matches', () => {
    const line = `${'a'.repeat(90)}needle${'b'.repeat(90)}target${'c'.repeat(90)}`

    const snippet = buildSearchSnippet(line, ['needle', 'target'], 'substring')

    expect(snippet).toContain('needle')
    expect(snippet).toContain('target')
    expect(snippet).toContain(' ... ')
    expect(snippet.startsWith('...')).toBe(true)
    expect(snippet.endsWith('...')).toBe(true)
    expect(snippet.length).toBeLessThanOrEqual(163)
  })

  it('adds ellipsis between non-adjacent matched line windows', () => {
    const snippet = buildSearchSnippet(
      ['before one', 'needle one', 'after one', 'gap one', 'gap two', 'before two', 'needle two', 'after two'].join(
        '\n'
      ),
      ['needle'],
      'substring'
    )

    expect(snippet).toBe(
      ['before one', 'needle one', 'after one', '...', 'before two', 'needle two', 'after two'].join('\n')
    )
  })

  it('truncates fallback snippets when no terms are provided', () => {
    const snippet = buildSearchSnippet(
      Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n'),
      [],
      'substring'
    )

    expect(snippet.split('\n')).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
      'line 8',
      'line 9',
      'line 10',
      'line 11',
      'line 12',
      '...'
    ])
  })
})
