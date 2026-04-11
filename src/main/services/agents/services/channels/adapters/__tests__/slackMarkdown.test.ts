import { describe, expect, it } from 'vitest'

import { toSlackMarkdown } from '../slack/slackMarkdown'

describe('toSlackMarkdown', () => {
  it('returns empty string unchanged', () => {
    expect(toSlackMarkdown('')).toBe('')
  })

  // ─── Bold ──────────────────────────────────────────────────

  it('converts **bold** to *bold*', () => {
    expect(toSlackMarkdown('Hello **world**')).toBe('Hello *world*')
  })

  it('handles multiple bold segments', () => {
    expect(toSlackMarkdown('**a** and **b**')).toBe('*a* and *b*')
  })

  // ─── Italic ────────────────────────────────────────────────

  it('converts *italic* to _italic_', () => {
    expect(toSlackMarkdown('Hello *world*')).toBe('Hello _world_')
  })

  // ─── Bold + Italic ────────────────────────────────────────

  it('handles bold and italic in the same text', () => {
    expect(toSlackMarkdown('**bold** and *italic*')).toBe('*bold* and _italic_')
  })

  // ─── Strikethrough ────────────────────────────────────────

  it('converts ~~strikethrough~~ to ~strikethrough~', () => {
    expect(toSlackMarkdown('~~deleted~~')).toBe('~deleted~')
  })

  // ─── Links ────────────────────────────────────────────────

  it('converts [text](url) to <url|text>', () => {
    expect(toSlackMarkdown('[Click here](https://example.com)')).toBe('<https://example.com|Click here>')
  })

  it('handles multiple links', () => {
    expect(toSlackMarkdown('[a](https://a.com) and [b](https://b.com)')).toBe('<https://a.com|a> and <https://b.com|b>')
  })

  // ─── Headers ──────────────────────────────────────────────

  it('converts # header to *header*', () => {
    expect(toSlackMarkdown('# Title')).toBe('*Title*')
  })

  it('converts ## header to *header*', () => {
    expect(toSlackMarkdown('## Subtitle')).toBe('*Subtitle*')
  })

  it('converts ### header to *header*', () => {
    expect(toSlackMarkdown('### Section')).toBe('*Section*')
  })

  it('handles header in multiline text', () => {
    const input = '# Title\n\nSome text\n\n## Section'
    const expected = '*Title*\n\nSome text\n\n*Section*'
    expect(toSlackMarkdown(input)).toBe(expected)
  })

  // ─── Code preservation ────────────────────────────────────

  it('preserves inline code', () => {
    expect(toSlackMarkdown('Use `**not bold**` here')).toBe('Use `**not bold**` here')
  })

  it('preserves fenced code blocks', () => {
    const input = 'Before\n```\n**bold** and *italic*\n```\nAfter **bold**'
    const expected = 'Before\n```\n**bold** and *italic*\n```\nAfter *bold*'
    expect(toSlackMarkdown(input)).toBe(expected)
  })

  it('preserves code blocks with language tag', () => {
    const input = '```typescript\nconst x = **y**\n```'
    expect(toSlackMarkdown(input)).toBe(input)
  })

  // ─── Blockquotes ──────────────────────────────────────────

  it('preserves blockquotes (same syntax)', () => {
    expect(toSlackMarkdown('> quoted text')).toBe('> quoted text')
  })

  // ─── Bullet lists ─────────────────────────────────────────

  it('preserves dash bullet lists', () => {
    expect(toSlackMarkdown('- item 1\n- item 2')).toBe('- item 1\n- item 2')
  })

  // ─── Mixed content ────────────────────────────────────────

  it('handles a complex mixed message', () => {
    const input = [
      '# Summary',
      '',
      'Here is **important** info and *note* this.',
      '',
      '```python',
      'x = **not_bold**',
      '```',
      '',
      'Visit [docs](https://docs.example.com) for ~~old~~ new details.'
    ].join('\n')

    const expected = [
      '*Summary*',
      '',
      'Here is *important* info and _note_ this.',
      '',
      '```python',
      'x = **not_bold**',
      '```',
      '',
      'Visit <https://docs.example.com|docs> for ~old~ new details.'
    ].join('\n')

    expect(toSlackMarkdown(input)).toBe(expected)
  })
})
